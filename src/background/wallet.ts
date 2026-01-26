/**
 * Wallet Management Module
 *
 * This module handles all wallet lifecycle operations:
 * - Wallet creation (new mnemonic generation)
 * - Wallet restoration (from existing mnemonic)
 * - Wallet unlock/lock
 * - Seed phrase reveal
 * - Backend registration (keys + LWS)
 *
 * Security Model:
 * - Private keys are encrypted with user password using AES-256-GCM
 * - Password is used to derive encryption key via PBKDF2 (100k iterations)
 * - Decrypted keys are held in memory only while wallet is unlocked
 * - Session storage allows persistence across service worker restarts
 *
 * Key Derivation:
 * - BIP39 mnemonic (12 words) -> BIP39 seed (64 bytes)
 * - BIP44 derivation for BTC/LTC (secp256k1)
 * - Monero derivation for XMR/WOW (ed25519)
 * - Ed25519 for Grin slatepack addresses
 */

import type { MessageResponse, WalletState, AssetType, OnboardingState } from '@/types';
import {
  getPublicKey,
  decryptPrivateKey,
  deriveKeyFromPassword,
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
  btcAddress,
  ltcAddress,
  xmrAddress,
  wowAddress,
  grinSlatpackAddress,
  hexToBytes,
} from '@/lib/address';
import {
  getWalletState,
  saveWalletState,
  DEFAULT_WALLET_STATE,
  getOnboardingState,
  saveOnboardingState,
  clearOnboardingState,
  saveAuthState,
  getAuthState,
} from '@/lib/storage';
import { api } from '@/lib/api';
import { initGrinWallet } from '@/lib/grin';
import {
  isUnlocked,
  setIsUnlocked,
  unlockedKeys,
  unlockedViewKeys,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedSeed,
  setUnlockedSeed,
  unlockedMnemonic,
  setUnlockedMnemonic,
  pendingMnemonic,
  setPendingMnemonic,
  persistSessionKeys,
  clearSessionKeys,
  clearInMemoryKeys,
  cachedAutoLockMinutes,
  setCachedAutoLockMinutes,
} from './state';
import { startAutoLockTimer, stopAutoLockTimer } from './settings';

// =============================================================================
// Types
// =============================================================================

/** Keys derived from mnemonic for a specific asset */
interface DerivedKeys {
  btc: { privateKey: Uint8Array };
  ltc: { privateKey: Uint8Array };
  xmr: {
    privateSpendKey: Uint8Array;
    publicSpendKey: Uint8Array;
    privateViewKey: Uint8Array;
    publicViewKey: Uint8Array;
  };
  wow: {
    privateSpendKey: Uint8Array;
    publicSpendKey: Uint8Array;
    privateViewKey: Uint8Array;
    publicViewKey: Uint8Array;
  };
  grin: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  };
}

// =============================================================================
// Wallet State
// =============================================================================

/**
 * Get the current wallet state.
 *
 * Returns information about the wallet including:
 * - Whether it's unlocked
 * - Whether a wallet exists
 * - Which assets are configured
 * - Whether backup has been confirmed
 *
 * @returns Wallet state information
 */
export async function handleGetWalletState(): Promise<MessageResponse<{
  isUnlocked: boolean;
  hasWallet: boolean;
  assets: AssetType[];
  needsBackup: boolean;
}>> {
  const state = await getWalletState();
  const hasWallet = !!state.encryptedSeed;
  const assets = (Object.keys(state.keys) as AssetType[]).filter(
    (k) => state.keys[k] !== undefined
  );

  return {
    success: true,
    data: {
      isUnlocked,
      hasWallet,
      assets,
      needsBackup: hasWallet && !state.backupConfirmed,
    },
  };
}

// =============================================================================
// Wallet Creation
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
// Wallet Restoration
// =============================================================================

/**
 * Restore wallet from existing mnemonic.
 *
 * Validates the mnemonic, checks with the backend that this wallet was
 * previously created in Smirk (to prevent random external seeds from
 * being restored), then creates the wallet.
 *
 * Security: Only wallets that were originally created in Smirk can be
 * restored. This is enforced via seed fingerprint matching on the backend.
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param password - User's password
 * @returns Restored wallet info
 */
export async function handleRestoreWallet(
  mnemonic: string,
  password: string
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  if (!isValidMnemonic(mnemonic)) {
    return { success: false, error: 'Invalid recovery phrase' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Check if this wallet was previously created in Smirk
  const fingerprint = computeSeedFingerprint(mnemonic);
  const derivedKeys = deriveAllKeys(mnemonic);

  // Build keys array for restore check
  const keysToCheck: Array<{ asset: string; publicKey: string; publicSpendKey?: string }> = [
    { asset: 'btc', publicKey: bytesToHex(getPublicKey(derivedKeys.btc.privateKey)) },
    { asset: 'ltc', publicKey: bytesToHex(getPublicKey(derivedKeys.ltc.privateKey)) },
    {
      asset: 'xmr',
      publicKey: bytesToHex(derivedKeys.xmr.publicSpendKey),
      publicSpendKey: bytesToHex(derivedKeys.xmr.publicViewKey),
    },
    {
      asset: 'wow',
      publicKey: bytesToHex(derivedKeys.wow.publicSpendKey),
      publicSpendKey: bytesToHex(derivedKeys.wow.publicViewKey),
    },
    { asset: 'grin', publicKey: bytesToHex(derivedKeys.grin.publicKey) },
  ];

  const checkResult = await api.checkRestore({ fingerprint, keys: keysToCheck });

  // REQUIRE successful check - don't allow restore if we can't verify
  if (checkResult.error) {
    console.error('Failed to check restore status:', checkResult.error);
    return {
      success: false,
      error: 'Unable to verify wallet. Please check your connection and try again.',
    };
  }

  if (!checkResult.data) {
    return {
      success: false,
      error: 'Unable to verify wallet. Please try again.',
    };
  }

  if (!checkResult.data.exists) {
    // Wallet was not created in Smirk - reject restore
    return {
      success: false,
      error: 'This wallet was not created in Smirk. Please create a new wallet instead.',
    };
  }

  if (checkResult.data.keysValid === false) {
    // Keys don't match - this shouldn't happen with correct derivation
    return {
      success: false,
      error: checkResult.data.error || 'Key derivation mismatch. Please try again.',
    };
  }

  // exists=true and keysValid=true - proceed with restore
  console.log('Restore check passed for user:', checkResult.data.userId);

  // Set state to 'creating' so popup can show progress if reopened
  await saveOnboardingState({ step: 'creating', createdAt: Date.now() });

  // Extract original heights from backend response
  const restoreHeights = {
    xmr: checkResult.data.xmrStartHeight,
    wow: checkResult.data.wowStartHeight,
  };
  console.log('Restore heights from backend:', restoreHeights);

  // Pass isRestore=true and original heights so LWS registration uses stored heights
  const result = await createWalletFromMnemonic(mnemonic, password, true, true, restoreHeights);

  // Clear onboarding state on success
  if (result.success) {
    await clearOnboardingState();
  }

  return result;
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
async function createWalletFromMnemonic(
  mnemonic: string,
  password: string,
  backupConfirmed: boolean,
  isRestore: boolean = false,
  restoreHeights?: { xmr?: number; wow?: number }
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  // Derive all keys from mnemonic
  const derivedKeys = deriveAllKeys(mnemonic);

  // Derive encryption key ONCE and reuse for all keys
  // This is 8x faster than calling encryptPrivateKey for each key (100k PBKDF2 iterations each)
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

  // Persist keys to session storage (survives service worker restarts)
  await persistSessionKeys();

  // Start auto-lock timer
  startAutoLockTimer();

  // Compute seed fingerprint for wallet identification
  const seedFingerprint = computeSeedFingerprint(mnemonic);

  // Register with backend, then register with LWS (LWS requires user_id from backend)
  // This is non-blocking - wallet works offline too
  registerWithBackend(state, seedFingerprint)
    .then((userId) => {
      // Now register XMR/WOW with LWS using the user_id
      // For new wallets: LWS starts from current block
      // For restored wallets: use wallet birthday heights to avoid scanning from genesis
      return registerWithLws(userId, state, derivedKeys, isRestore);
    })
    .catch((err) => {
      console.warn('Failed to register with backend/LWS:', err);
      // Continue working - we can retry later
    });

  return { success: true, data: { created: true, assets } };
}

// =============================================================================
// Backend Registration
// =============================================================================

/**
 * Register wallet with backend server.
 *
 * Sends public keys to the backend to create/update user account.
 * This enables:
 * - Encrypted tips (recipients can look up public keys)
 * - Grin relay (slatepack routing between users)
 * - Wallet identification for restore
 *
 * @param state - Wallet state with public keys
 * @param seedFingerprint - Seed fingerprint for wallet identification
 * @returns User ID from the backend
 */
async function registerWithBackend(state: WalletState, seedFingerprint?: string): Promise<string> {
  // Collect all public keys
  const keys: Array<{ asset: string; publicKey: string; publicSpendKey?: string }> = [];

  if (state.keys.btc) {
    keys.push({ asset: 'btc', publicKey: state.keys.btc.publicKey });
  }
  if (state.keys.ltc) {
    keys.push({ asset: 'ltc', publicKey: state.keys.ltc.publicKey });
  }
  if (state.keys.xmr) {
    // For XMR: send public spend key (main identity) and public view key
    keys.push({
      asset: 'xmr',
      publicKey: state.keys.xmr.publicSpendKey || state.keys.xmr.publicKey,
      publicSpendKey: state.keys.xmr.publicViewKey, // Backend uses this for encrypted tips
    });
  }
  if (state.keys.wow) {
    keys.push({
      asset: 'wow',
      publicKey: state.keys.wow.publicSpendKey || state.keys.wow.publicKey,
      publicSpendKey: state.keys.wow.publicViewKey,
    });
  }
  if (state.keys.grin) {
    // Grin: ed25519 public key for slatepack address
    keys.push({
      asset: 'grin',
      publicKey: state.keys.grin.publicKey,
    });
  }

  if (keys.length === 0) {
    console.warn('No keys to register with backend');
    throw new Error('No keys to register');
  }

  const result = await api.extensionRegister({
    keys,
    walletBirthday: state.walletBirthday?.timestamp,
    seedFingerprint,
    xmrStartHeight: state.walletBirthday?.heights?.xmr,
    wowStartHeight: state.walletBirthday?.heights?.wow,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Store auth tokens
  const auth = result.data!;
  await saveAuthState({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: Date.now() + auth.expiresIn * 1000,
    userId: auth.user.id,
  });

  // Set token on API client for future requests
  api.setAccessToken(auth.accessToken);

  console.log('Registered with backend:', auth.user.isNew ? 'new user' : 'existing user');

  return auth.user.id;
}

/**
 * Register XMR/WOW wallets with Light Wallet Server (LWS).
 *
 * LWS scans the blockchain for transactions involving our addresses
 * using the private view key. This enables balance queries without
 * running a full node.
 *
 * For new wallets: Starts scanning from current block
 * For restored wallets: Uses stored birthday heights to resume scanning
 *
 * @param userId - User ID from backend registration (required by LWS API)
 * @param state - Wallet state with public keys
 * @param derivedKeys - Derived keys including private view keys
 * @param isRestore - If true, use wallet birthday heights as start
 */
async function registerWithLws(
  userId: string,
  state: WalletState,
  derivedKeys: DerivedKeys,
  isRestore: boolean = false
): Promise<void> {
  // Get start heights from wallet birthday (for restore scenarios)
  const xmrStartHeight = isRestore ? state.walletBirthday?.heights?.xmr : undefined;
  const wowStartHeight = isRestore ? state.walletBirthday?.heights?.wow : undefined;

  // Register XMR with LWS
  if (state.keys.xmr?.publicSpendKey && state.keys.xmr?.publicViewKey) {
    const xmrAddress = getAddressForAsset('xmr', state.keys.xmr);
    const xmrViewKey = bytesToHex(derivedKeys.xmr.privateViewKey);

    const xmrResult = await api.registerLws(userId, 'xmr', xmrAddress, xmrViewKey, xmrStartHeight);
    if (xmrResult.error) {
      console.warn('Failed to register XMR with LWS:', xmrResult.error);
    } else {
      console.log('XMR registered with LWS:', xmrResult.data?.message, xmrStartHeight ? `(start_height: ${xmrStartHeight})` : '(from current)');
    }
  }

  // Register WOW with LWS
  if (state.keys.wow?.publicSpendKey && state.keys.wow?.publicViewKey) {
    const wowAddress = getAddressForAsset('wow', state.keys.wow);
    const wowViewKey = bytesToHex(derivedKeys.wow.privateViewKey);

    const wowResult = await api.registerLws(userId, 'wow', wowAddress, wowViewKey, wowStartHeight);
    if (wowResult.error) {
      console.warn('Failed to register WOW with LWS:', wowResult.error);
    } else {
      console.log('WOW registered with LWS:', wowResult.data?.message, wowStartHeight ? `(start_height: ${wowStartHeight})` : '(from current)');
    }
  }
}

// =============================================================================
// Unlock / Lock
// =============================================================================

/**
 * Unlock the wallet with password.
 *
 * Decrypts all stored keys using the provided password:
 * 1. Verifies password by attempting to decrypt first key
 * 2. Decrypts all private keys and view keys
 * 3. Decrypts mnemonic (needed for Grin WASM)
 * 4. Persists keys to session storage
 * 5. Starts auto-lock timer
 *
 * Also handles migration for wallets created before Grin support.
 *
 * @param password - User's password
 * @returns Unlock status
 */
export async function handleUnlockWallet(password: string): Promise<MessageResponse<{
  unlocked: boolean;
}>> {
  const state = await getWalletState();

  if (!state.encryptedSeed) {
    return { success: false, error: 'No wallet found' };
  }

  // Try to decrypt the first key to verify password
  const firstAsset = (Object.keys(state.keys) as AssetType[]).find(
    (k) => state.keys[k] !== undefined
  );

  if (!firstAsset || !state.keys[firstAsset]) {
    return { success: false, error: 'No keys found' };
  }

  try {
    const key = state.keys[firstAsset]!;
    const decrypted = await decryptPrivateKey(
      key.privateKey,
      key.privateKeySalt,
      password
    );

    // Password correct - decrypt all keys
    unlockedKeys.clear();
    unlockedViewKeys.clear();

    for (const asset of Object.keys(state.keys) as AssetType[]) {
      const assetKey = state.keys[asset];
      if (assetKey) {
        const privateKey = await decryptPrivateKey(
          assetKey.privateKey,
          assetKey.privateKeySalt,
          password
        );
        unlockedKeys.set(asset, privateKey);

        // Also decrypt view keys for XMR/WOW (needed for balance queries)
        if ((asset === 'xmr' || asset === 'wow') && assetKey.privateViewKey && assetKey.privateViewKeySalt) {
          const viewKey = await decryptPrivateKey(
            assetKey.privateViewKey,
            assetKey.privateViewKeySalt,
            password
          );
          unlockedViewKeys.set(asset, viewKey);
        }
      }
    }

    // Decrypt mnemonic for Grin WASM operations (MWC Seed class needs the mnemonic, not BIP39 seed)
    if (state.encryptedSeed && state.seedSalt) {
      try {
        const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, password);
        setUnlockedMnemonic(new TextDecoder().decode(mnemonicBytes));
      } catch (err) {
        console.warn('Failed to decrypt mnemonic:', err);
      }
    }

    // Decrypt BIP39 seed (kept for backwards compatibility with other operations)
    if (state.encryptedBip39Seed && state.seedSalt) {
      try {
        setUnlockedSeed(await decryptPrivateKey(state.encryptedBip39Seed, state.seedSalt, password));
      } catch (err) {
        console.warn('Failed to decrypt BIP39 seed:', err);
      }
    }

    // Migration: derive Grin key and BIP39 seed if missing (for wallets created before Grin support)
    if ((!state.keys.grin || !state.encryptedBip39Seed) && unlockedMnemonic) {
      try {
        // Derive encryption key from password
        const saltBytes = hexToBytes(state.seedSalt!);
        const encKey = await deriveKeyFromPassword(password, saltBytes);
        const encryptWithKey = (data: Uint8Array) => bytesToHex(encrypt(data, encKey));

        // Migrate: encrypt and store BIP39 seed if missing
        if (!state.encryptedBip39Seed) {
          const bip39Seed = mnemonicToSeed(unlockedMnemonic);
          state.encryptedBip39Seed = encryptWithKey(bip39Seed);
          setUnlockedSeed(bip39Seed);
          console.log('Migrated wallet: added encrypted BIP39 seed');
        }

        // Migrate: derive and store Grin key if missing
        if (!state.keys.grin) {
          const derivedKeysAll = deriveAllKeys(unlockedMnemonic);
          state.keys.grin = {
            asset: 'grin',
            publicKey: bytesToHex(derivedKeysAll.grin.publicKey),
            privateKey: encryptWithKey(derivedKeysAll.grin.privateKey),
            privateKeySalt: state.seedSalt!,
            createdAt: Date.now(),
          };
          unlockedKeys.set('grin', derivedKeysAll.grin.privateKey);
          console.log('Migrated wallet: added Grin key');
        }

        // Save updated state
        await saveWalletState(state);
      } catch (err) {
        console.warn('Failed to migrate wallet:', err);
      }
    }

    setIsUnlocked(true);

    // Persist keys to session storage (survives service worker restarts)
    await persistSessionKeys();

    // Start auto-lock timer
    startAutoLockTimer();

    // Ensure we have valid auth tokens (re-register if needed)
    // This is blocking so auth is ready before we return
    try {
      await ensureValidAuth(state);
    } catch (err) {
      console.warn('Failed to ensure auth:', err);
      // Continue anyway - wallet works offline, just social tips won't work
    }

    return { success: true, data: { unlocked: true } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

/**
 * Ensure we have valid auth tokens.
 *
 * Checks existing auth state and either:
 * 1. Refreshes expired token
 * 2. Re-registers if no auth or refresh fails
 */
async function ensureValidAuth(state: WalletState): Promise<void> {
  const authState = await getAuthState();

  if (authState && authState.expiresAt > Date.now()) {
    // Token is still valid
    api.setAccessToken(authState.accessToken);
    console.log('Auth token still valid');
    return;
  }

  if (authState && authState.expiresAt <= Date.now()) {
    // Try to refresh
    try {
      const result = await api.refreshToken(authState.refreshToken);
      if (result.data) {
        await saveAuthState({
          accessToken: result.data.accessToken,
          refreshToken: result.data.refreshToken,
          expiresAt: Date.now() + result.data.expiresIn * 1000,
          userId: authState.userId,
        });
        api.setAccessToken(result.data.accessToken);
        console.log('Auth token refreshed');
        return;
      }
    } catch (err) {
      console.warn('Token refresh failed, will re-register:', err);
    }
  }

  // No valid auth - re-register with backend
  console.log('No valid auth, re-registering with backend...');

  // Compute seed fingerprint if we have the mnemonic
  const seedFingerprint = unlockedMnemonic ? computeSeedFingerprint(unlockedMnemonic) : undefined;

  try {
    await registerWithBackend(state, seedFingerprint);
    console.log('Re-registration successful');
  } catch (err) {
    console.error('Re-registration failed:', err);
    throw err;
  }
}

/**
 * Lock the wallet.
 *
 * Clears all decrypted keys from memory and session storage.
 * Stops the auto-lock timer.
 *
 * @returns Lock status
 */
export async function handleLockWallet(): Promise<MessageResponse<{ locked: boolean }>> {
  clearInMemoryKeys();
  await clearSessionKeys();
  stopAutoLockTimer();
  return { success: true, data: { locked: true } };
}

// =============================================================================
// Seed Reveal
// =============================================================================

/**
 * Reveal seed phrase after password verification.
 *
 * Requires re-entering password for security even if wallet is unlocked.
 * This prevents accidental exposure of the seed phrase.
 *
 * @param password - User's password (re-verified)
 * @returns Seed words
 */
export async function handleRevealSeed(password: string): Promise<MessageResponse<{ words: string[] }>> {
  const state = await getWalletState();

  if (!state.encryptedSeed || !state.seedSalt) {
    return { success: false, error: 'No wallet found' };
  }

  try {
    // Decrypt the mnemonic using provided password
    const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, password);
    const mnemonic = new TextDecoder().decode(mnemonicBytes);

    // Split into words
    const words = mnemonic.trim().split(/\s+/);

    if (words.length !== 12 && words.length !== 24) {
      return { success: false, error: 'Invalid seed format' };
    }

    return { success: true, data: { words } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

// =============================================================================
// Onboarding State
// =============================================================================

/**
 * Get current onboarding state.
 *
 * Used to resume onboarding if popup is closed and reopened.
 *
 * @returns Current onboarding state or null
 */
export async function handleGetOnboardingState(): Promise<MessageResponse<{ state: OnboardingState | null }>> {
  const state = await getOnboardingState();
  return { success: true, data: { state } };
}

/**
 * Save onboarding state.
 *
 * Persists onboarding progress so it survives popup close/reopen.
 *
 * @param state - Onboarding state to save
 * @returns Save status
 */
export async function handleSaveOnboardingState(
  state: OnboardingState
): Promise<MessageResponse<{ saved: boolean }>> {
  await saveOnboardingState(state);
  return { success: true, data: { saved: true } };
}

/**
 * Clear onboarding state.
 *
 * Called when onboarding is complete or cancelled.
 *
 * @returns Clear status
 */
export async function handleClearOnboardingState(): Promise<MessageResponse<{ cleared: boolean }>> {
  await clearOnboardingState();
  return { success: true, data: { cleared: true } };
}

// =============================================================================
// Address Helpers
// =============================================================================

/**
 * Derive address from wallet key for a specific asset.
 *
 * Different chains use different address formats:
 * - BTC: P2WPKH (bech32, bc1...)
 * - LTC: P2WPKH (bech32, ltc1...)
 * - XMR: Standard Monero address (4...)
 * - WOW: Standard Wownero address (Wo...)
 * - Grin: Slatepack address (bech32-encoded ed25519 pubkey)
 *
 * @param asset - Asset type
 * @param key - Key data with public keys
 * @returns Address string for the asset
 */
export function getAddressForAsset(
  asset: AssetType,
  key: { publicKey: string; publicSpendKey?: string; publicViewKey?: string }
): string {
  switch (asset) {
    case 'btc':
      return btcAddress(hexToBytes(key.publicKey));
    case 'ltc':
      return ltcAddress(hexToBytes(key.publicKey));
    case 'xmr':
      if (!key.publicSpendKey || !key.publicViewKey) {
        return 'Address unavailable';
      }
      return xmrAddress(hexToBytes(key.publicSpendKey), hexToBytes(key.publicViewKey));
    case 'wow':
      if (!key.publicSpendKey || !key.publicViewKey) {
        return 'Address unavailable';
      }
      return wowAddress(hexToBytes(key.publicSpendKey), hexToBytes(key.publicViewKey));
    case 'grin':
      // Grin slatepack address from ed25519 public key
      // Must be 64 hex chars (32 bytes)
      if (!key.publicKey || key.publicKey.length !== 64) {
        return 'Address unavailable';
      }
      return grinSlatpackAddress(hexToBytes(key.publicKey));
    default:
      return 'Unknown asset';
  }
}

/**
 * Get all wallet addresses.
 *
 * Returns addresses for all configured assets.
 *
 * @returns Array of address info objects
 */
export async function handleGetAddresses(): Promise<MessageResponse<{
  addresses: Array<{
    asset: AssetType;
    address: string;
    publicKey: string;
  }>;
}>> {
  const state = await getWalletState();
  const addresses: Array<{ asset: AssetType; address: string; publicKey: string }> = [];

  for (const asset of ['btc', 'ltc', 'xmr', 'wow', 'grin'] as AssetType[]) {
    const key = state.keys[asset];
    if (key) {
      const address = getAddressForAsset(asset, key);
      addresses.push({
        asset,
        address,
        publicKey: key.publicKey,
      });
    }
  }

  return { success: true, data: { addresses } };
}
