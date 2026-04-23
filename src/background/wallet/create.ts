/**
 * Wallet Creation Module
 *
 * Handles wallet creation from new mnemonic:
 * - Step 1: Generate mnemonic
 * - Step 2: Verify backup and create wallet
 * - Legacy direct creation (no verification)
 */

import type { MessageResponse, WalletState, AssetType } from '@/types';
import {
  getPublicKey,
  deriveKeyFromPassword,
  PBKDF2_ITERATIONS,
  bytesToHex,
  encrypt,
  randomBytes,
} from '@/lib/crypto';
import {
  generateMnemonicPhrase,
  isValidMnemonic,
  deriveAllKeys,
  mnemonicToWords,
  getVerificationIndices,
  computeSeedFingerprint,
  mnemonicToSeed,
} from '@/lib/hd';
import {
  saveWalletState,
  DEFAULT_WALLET_STATE,
  saveOnboardingState,
  clearOnboardingState,
} from '@/lib/storage';
import { api } from '@/lib/api';
import {
  setIsUnlocked,
  unlockedKeys,
  unlockedViewKeys,
  setUnlockedMnemonic,
  setUnlockedSeed,
  pendingMnemonic,
  setPendingMnemonic,
  persistSessionKeys,
} from '../state';
import { startAutoLockTimer } from '../settings';
import type { DerivedKeys, RestoreHeights } from './types';
import { registerWithBackendRetry, registerWithLws } from './registration';

// =============================================================================
// Wallet Creation - Step 1: Generate Mnemonic
// =============================================================================

/**
 * Step 1 of wallet creation: Generate a new mnemonic.
 *
 * Generates a 12-word BIP39 mnemonic and returns it along with indices
 * of words the user must verify (to confirm they wrote it down).
 *
 * The mnemonic is stored temporarily in memory and cleared after
 * confirmation or if creation is cancelled.
 *
 * @returns Generated words and indices to verify
 */
export async function handleGenerateMnemonic(): Promise<MessageResponse<{
  words: string[];
  verifyIndices: number[];
}>> {
  // Generate new mnemonic
  const mnemonic = generateMnemonicPhrase();
  setPendingMnemonic(mnemonic);
  const words = mnemonicToWords(mnemonic);
  const verifyIndices = getVerificationIndices(words.length, 3);

  return {
    success: true,
    data: { words, verifyIndices },
  };
}

// =============================================================================
// Wallet Creation - Step 2: Verify and Create
// =============================================================================

/**
 * Step 2 of wallet creation: Verify seed backup and create wallet.
 *
 * Verifies that the user correctly wrote down their seed phrase by
 * checking specific words, then creates the wallet with the provided
 * password.
 *
 * If the service worker restarted and pendingMnemonic was lost,
 * accepts the words array from the popup to reconstruct the mnemonic.
 *
 * @param password - User's password (min 8 characters)
 * @param verifiedWords - Map of word indices to verified words
 * @param wordsFromPopup - Optional: all words from popup (for recovery after SW restart)
 * @returns Created wallet info
 */
export async function handleConfirmMnemonic(
  password: string,
  verifiedWords: Record<number, string>,
  wordsFromPopup?: string[]
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  // If pendingMnemonic was lost (service worker restart), reconstruct from passed words
  let mnemonic = pendingMnemonic;
  if (!mnemonic && wordsFromPopup && wordsFromPopup.length > 0) {
    mnemonic = wordsFromPopup.join(' ');
    // Validate the reconstructed mnemonic
    if (!isValidMnemonic(mnemonic)) {
      return { success: false, error: 'Invalid mnemonic. Please start over.' };
    }
  }

  if (!mnemonic) {
    return { success: false, error: 'No pending mnemonic. Start over.' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Verify the words match
  const words = mnemonicToWords(mnemonic);
  for (const [idx, word] of Object.entries(verifiedWords)) {
    if (words[parseInt(idx)] !== word.toLowerCase().trim()) {
      return { success: false, error: 'Word verification failed. Please check your backup.' };
    }
  }

  // Set state to 'creating' so popup can show progress if reopened
  await saveOnboardingState({ step: 'creating', createdAt: Date.now() });

  // Create wallet from mnemonic
  const result = await createWalletFromMnemonic(mnemonic, password, true);

  // Clear pending mnemonic
  setPendingMnemonic(null);

  // Clear onboarding state on success
  if (result.success) {
    await clearOnboardingState();
  }

  return result;
}

// =============================================================================
// Legacy Wallet Creation
// =============================================================================

/**
 * Legacy wallet creation endpoint.
 *
 * Creates a wallet directly without mnemonic verification step.
 * Kept for backwards compatibility; new code should use the
 * generate/confirm flow.
 *
 * @param password - User's password
 * @returns Created wallet info
 */
export async function handleCreateWallet(password: string): Promise<MessageResponse<{
  created: boolean;
  assets: AssetType[];
}>> {
  // Generate mnemonic and create wallet directly (skip verification for legacy)
  const mnemonic = generateMnemonicPhrase();
  return createWalletFromMnemonic(mnemonic, password, false);
}

// =============================================================================
// Core Wallet Creation
// =============================================================================

/**
 * Core wallet creation from mnemonic.
 *
 * This is the main function that creates a wallet from a mnemonic:
 * 1. Derives all keys (BTC, LTC, XMR, WOW, Grin)
 * 2. Encrypts keys with user's password
 * 3. Fetches current blockchain heights for wallet birthday
 * 4. Saves encrypted wallet state
 * 5. Registers with backend (public keys)
 * 6. Registers with LWS (XMR/WOW view keys)
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param password - User's password for encryption
 * @param backupConfirmed - Whether user confirmed seed backup
 * @param isRestore - If true, use stored heights for LWS start
 * @param restoreHeights - Original blockchain heights from backend (restore only)
 * @returns Created wallet info
 */
export async function createWalletFromMnemonic(
  mnemonic: string,
  password: string,
  backupConfirmed: boolean,
  isRestore: boolean = false,
  restoreHeights?: RestoreHeights,
  derivationVersion: 1 | 2 | 3 = 3
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  // Derive all keys from mnemonic using specified version
  // New wallets use v2 (BIP44/SLIP-10 standard)
  // Restore may use v1 if wallet was created before migration
  const derivedKeys = deriveAllKeys(mnemonic, '', derivationVersion) as DerivedKeys;

  // Derive encryption key ONCE and reuse for all keys
  // Uses 600K PBKDF2 iterations (OWASP recommendation)
  const masterSalt = randomBytes(16);
  const encryptionKey = await deriveKeyFromPassword(password, masterSalt);
  const saltHex = bytesToHex(masterSalt);

  // Helper to encrypt with pre-derived key
  const encryptWithKey = (data: Uint8Array): string => bytesToHex(encrypt(data, encryptionKey));

  // Encrypt mnemonic for storage
  const mnemonicBytes = new TextEncoder().encode(mnemonic);
  const encryptedMnemonic = encryptWithKey(mnemonicBytes);

  // Encrypt BIP39 seed (64 bytes) for Grin WASM operations
  const bip39Seed = mnemonicToSeed(mnemonic);
  const encryptedBip39Seed = encryptWithKey(bip39Seed);

  // Set up wallet birthday heights
  // For restore: use provided heights from backend (original creation heights)
  // For new wallet: fetch current blockchain heights
  let walletBirthday: WalletState['walletBirthday'];
  if (isRestore && restoreHeights) {
    // Use the original heights from when wallet was created
    walletBirthday = {
      timestamp: Date.now(),
      heights: {
        xmr: restoreHeights.xmr,
        wow: restoreHeights.wow,
        // BTC/LTC don't use start heights for scanning
      },
    };
    console.log('Restore: using original heights', restoreHeights);
  } else {
    // New wallet: fetch current heights
    try {
      const heightsResult = await api.getBlockchainHeights();
      if (heightsResult.data) {
        walletBirthday = {
          timestamp: Date.now(),
          heights: {
            btc: heightsResult.data.btc ?? undefined,
            ltc: heightsResult.data.ltc ?? undefined,
            xmr: heightsResult.data.xmr ?? undefined,
            wow: heightsResult.data.wow ?? undefined,
          },
        };
      } else {
        // Backend unavailable - store timestamp only, heights will be missing
        console.warn('Could not fetch blockchain heights:', heightsResult.error);
        walletBirthday = { timestamp: Date.now(), heights: {} };
      }
    } catch (err) {
      console.warn('Failed to fetch blockchain heights:', err);
      walletBirthday = { timestamp: Date.now(), heights: {} };
    }
  }

  // Build wallet state
  const state: WalletState = {
    ...DEFAULT_WALLET_STATE,
    encryptedSeed: encryptedMnemonic,
    seedSalt: saltHex,
    encryptedBip39Seed,
    pbkdf2Iterations: PBKDF2_ITERATIONS,
    derivationVersion,
    backupConfirmed,
    walletBirthday,
  };

  const assets: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];
  const now = Date.now();

  // Store BTC key
  const btcPub = getPublicKey(derivedKeys.btc.privateKey);
  state.keys.btc = {
    asset: 'btc',
    publicKey: bytesToHex(btcPub),
    privateKey: encryptWithKey(derivedKeys.btc.privateKey),
    privateKeySalt: saltHex,
    createdAt: now,
  };
  unlockedKeys.set('btc', derivedKeys.btc.privateKey);

  // Store LTC key
  const ltcPub = getPublicKey(derivedKeys.ltc.privateKey);
  state.keys.ltc = {
    asset: 'ltc',
    publicKey: bytesToHex(ltcPub),
    privateKey: encryptWithKey(derivedKeys.ltc.privateKey),
    privateKeySalt: saltHex,
    createdAt: now,
  };
  unlockedKeys.set('ltc', derivedKeys.ltc.privateKey);

  // Store XMR keys
  state.keys.xmr = {
    asset: 'xmr',
    publicKey: bytesToHex(derivedKeys.xmr.publicSpendKey), // Primary public key
    privateKey: encryptWithKey(derivedKeys.xmr.privateSpendKey),
    privateKeySalt: saltHex,
    publicSpendKey: bytesToHex(derivedKeys.xmr.publicSpendKey),
    publicViewKey: bytesToHex(derivedKeys.xmr.publicViewKey),
    privateViewKey: encryptWithKey(derivedKeys.xmr.privateViewKey),
    privateViewKeySalt: saltHex,
    createdAt: now,
  };
  unlockedKeys.set('xmr', derivedKeys.xmr.privateSpendKey);
  unlockedViewKeys.set('xmr', derivedKeys.xmr.privateViewKey);

  // Store WOW keys
  state.keys.wow = {
    asset: 'wow',
    publicKey: bytesToHex(derivedKeys.wow.publicSpendKey),
    privateKey: encryptWithKey(derivedKeys.wow.privateSpendKey),
    privateKeySalt: saltHex,
    publicSpendKey: bytesToHex(derivedKeys.wow.publicSpendKey),
    publicViewKey: bytesToHex(derivedKeys.wow.publicViewKey),
    privateViewKey: encryptWithKey(derivedKeys.wow.privateViewKey),
    privateViewKeySalt: saltHex,
    createdAt: now,
  };
  unlockedKeys.set('wow', derivedKeys.wow.privateSpendKey);
  unlockedViewKeys.set('wow', derivedKeys.wow.privateViewKey);

  // Store Grin key (ed25519 for slatepack addresses)
  state.keys.grin = {
    asset: 'grin',
    publicKey: bytesToHex(derivedKeys.grin.publicKey),
    privateKey: encryptWithKey(derivedKeys.grin.privateKey),
    privateKeySalt: saltHex,
    createdAt: now,
  };
  unlockedKeys.set('grin', derivedKeys.grin.privateKey);

  await saveWalletState(state);
  setIsUnlocked(true);

  // Store mnemonic in memory for Grin WASM operations
  setUnlockedMnemonic(mnemonic);

  // Store BIP39 seed in memory
  setUnlockedSeed(bip39Seed);

  // Persist keys to session storage (survives service worker restarts)
  await persistSessionKeys();

  // Start auto-lock timer
  startAutoLockTimer();

  // Compute seed fingerprint for wallet identification
  const seedFingerprint = computeSeedFingerprint(mnemonic);

  // Register with backend, then register with LWS (LWS requires user_id from backend)
  // This is non-blocking - wallet works offline too
  // Includes retry logic in case of temporary network issues
  registerWithBackendRetry(state, seedFingerprint)
    .then((userId) => {
      // Now register XMR/WOW with LWS using the user_id
      // For new wallets: LWS starts from current block
      // For restored wallets: use wallet birthday heights to avoid scanning from genesis
      return registerWithLws(userId, state, derivedKeys, isRestore);
    })
    .catch((err) => {
      console.warn('Failed to register with backend/LWS after retries:', err);
      // Continue working - ensureValidAuth will retry on next unlock
    });

  return { success: true, data: { created: true, assets } };
}
