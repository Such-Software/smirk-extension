/**
 * Background service worker for Smirk extension.
 *
 * Handles:
 * - Wallet state management
 * - Crypto operations
 * - API communication
 * - Message passing between popup/content scripts
 */

// Polyfill window for WASM modules that expect browser context
// Service workers don't have window, but some WASM modules require it
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import type { MessageType, MessageResponse, WalletState, AssetType, TipInfo, UserSettings } from '@/types';
import {
  getPublicKey,
  encryptPrivateKey,
  decryptPrivateKey,
  decryptTipPayload,
  decryptPublicTipPayload,
  decodeUrlFragmentKey,
  deriveKeyFromPassword,
  bytesToHex,
  encrypt,
  decrypt,
  randomBytes,
} from '@/lib/crypto';
// Note: monero-crypto (calculateVerifiedBalance) runs in popup for UI responsiveness
import {
  generateMnemonicPhrase,
  isValidMnemonic,
  deriveAllKeys,
  mnemonicToWords,
  getVerificationIndices,
} from '@/lib/hd';
import {
  btcAddress,
  ltcAddress,
  xmrAddress,
  wowAddress,
  grinSlatpackAddress,
  hexToBytes,
} from '@/lib/address';
import { createSignedTransaction, maxSendable as maxSendableUtxo, type Utxo } from '@/lib/btc-tx';
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
import type { OnboardingState } from '@/types';
import { api } from '@/lib/api';
import { runtime, notifications, alarms, storage } from '@/lib/browser';
import {
  initGrinWallet,
  initGrinWalletFromExtendedKey,
  signSlate,
  encodeSlatepack,
  createSendTransaction,
  finalizeSlate,
  type GrinKeys,
  type GrinOutput,
} from '@/lib/grin';
import { mnemonicToSeed } from '@/lib/hd';

// Pending claim data from content script
let pendingClaim: { linkId: string; fragmentKey?: string } | null = null;

// Temporary mnemonic during wallet creation (cleared after confirmation)
let pendingMnemonic: string | null = null;

// In-memory decrypted keys (cleared on lock)
let unlockedKeys: Map<AssetType, Uint8Array> = new Map();
// View keys for XMR/WOW (needed for balance queries)
let unlockedViewKeys: Map<'xmr' | 'wow', Uint8Array> = new Map();
let isUnlocked = false;
// Cached Grin WASM wallet keys (derived from mnemonic when needed)
let grinWasmKeys: GrinKeys | null = null;
// Decrypted BIP39 seed (64 bytes) - kept for backwards compatibility
let unlockedSeed: Uint8Array | null = null;
// Decrypted mnemonic string for Grin WASM operations - cleared on lock
let unlockedMnemonic: string | null = null;

// Auto-lock alarm name (uses chrome.alarms API for persistence across service worker restarts)
const AUTO_LOCK_ALARM = 'smirk_auto_lock';
let cachedAutoLockMinutes: number | null = null; // Cache to avoid reading storage on every activity

// Promise that resolves when background initialization is complete
// Messages wait for this before processing to avoid race conditions
let initializationPromise: Promise<void> | null = null;

// Session storage key for persisting unlock state across service worker restarts
const SESSION_KEYS_KEY = 'smirk_session_keys';

// Storage key for pending outgoing transactions (not yet confirmed)
const PENDING_TXS_KEY = 'smirk_pending_txs';

interface SessionKeysData {
  unlockedKeys: Record<string, string>; // asset -> hex-encoded key
  unlockedViewKeys: Record<string, string>; // 'xmr' | 'wow' -> hex-encoded key
  grinExtendedPrivateKey?: string; // hex-encoded 64-byte key for Grin WASM operations
  mnemonic?: string; // BIP39 mnemonic for Grin init (session storage clears on browser close)
}

interface PendingTx {
  txHash: string;
  asset: AssetType;
  amount: number; // atomic units sent (including fee)
  fee: number;
  timestamp: number; // when sent
}

/**
 * Add a pending outgoing transaction.
 * This is subtracted from displayed balance until confirmed.
 */
async function addPendingTx(tx: PendingTx): Promise<void> {
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  pending.push(tx);
  await storage.local.set({ [PENDING_TXS_KEY]: pending });
  console.log(`[PendingTx] Added pending tx: ${tx.txHash} (${tx.amount} ${tx.asset})`);
}

/**
 * Clean up old pending transactions.
 * After the confirmation time passes, LWS should reflect the spend,
 * so we can remove from our pending list.
 *
 * XMR: ~20 minutes for 10 confirmations
 * WOW: ~2 minutes for 10 confirmations (12s blocks)
 */
async function cleanupOldPendingTxs(): Promise<void> {
  const now = Date.now();
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];

  // Age thresholds in ms (conservative to avoid removing too early)
  const ageThresholds: Record<string, number> = {
    xmr: 30 * 60 * 1000, // 30 minutes for XMR
    wow: 5 * 60 * 1000,  // 5 minutes for WOW
  };

  const updated = pending.filter(tx => {
    const threshold = ageThresholds[tx.asset] || 30 * 60 * 1000;
    const age = now - tx.timestamp;
    if (age > threshold) {
      console.log(`[PendingTx] Removing old pending tx ${tx.txHash} (age: ${Math.round(age / 60000)}min)`);
      return false;
    }
    return true;
  });

  if (updated.length < pending.length) {
    await storage.local.set({ [PENDING_TXS_KEY]: updated });
  }
}

/**
 * Get pending outgoing transactions for an asset.
 * Also cleans up old pending transactions that should be confirmed by now.
 */
async function getPendingTxs(asset: AssetType): Promise<PendingTx[]> {
  // Clean up old pending txs first
  await cleanupOldPendingTxs();

  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  return pending.filter(tx => tx.asset === asset);
}

/**
 * Remove a pending transaction by hash (when confirmed).
 */
async function removePendingTx(txHash: string): Promise<void> {
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  const updated = pending.filter(tx => tx.txHash !== txHash);
  await storage.local.set({ [PENDING_TXS_KEY]: updated });
  if (updated.length < pending.length) {
    console.log(`[PendingTx] Removed confirmed tx: ${txHash}`);
  }
}

/**
 * Get total pending outgoing amount for an asset.
 */
async function getPendingOutgoingAmount(asset: AssetType): Promise<number> {
  const pending = await getPendingTxs(asset);
  return pending.reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
}

/**
 * Persist decrypted keys to session storage.
 * Session storage survives service worker restarts but clears on browser close.
 */
async function persistSessionKeys(): Promise<void> {
  const keysData: Record<string, string> = {};
  const viewKeysData: Record<string, string> = {};

  for (const [asset, key] of unlockedKeys) {
    keysData[asset] = bytesToHex(key);
  }
  for (const [asset, key] of unlockedViewKeys) {
    viewKeysData[asset] = bytesToHex(key);
  }

  const sessionData: SessionKeysData = {
    unlockedKeys: keysData,
    unlockedViewKeys: viewKeysData,
  };

  // Include Grin extended private key if available (for Grin WASM operations after restart)
  if (grinWasmKeys?.extendedPrivateKey) {
    sessionData.grinExtendedPrivateKey = bytesToHex(grinWasmKeys.extendedPrivateKey);
  }

  // Include mnemonic for Grin first-time init after service worker restart
  // Session storage clears on browser close, so this is reasonably safe
  if (unlockedMnemonic) {
    sessionData.mnemonic = unlockedMnemonic;
  }

  await storage.session.set({
    [SESSION_KEYS_KEY]: sessionData,
  });
  console.log('[Session] Persisted keys to session storage');
}

/**
 * Restore decrypted keys from session storage after service worker restart.
 * Returns true if keys were restored, false otherwise.
 */
async function restoreSessionKeys(): Promise<boolean> {
  const data = await storage.session.get<{ [SESSION_KEYS_KEY]?: SessionKeysData }>([SESSION_KEYS_KEY]);
  const sessionData = data[SESSION_KEYS_KEY];

  if (!sessionData) {
    console.log('[Session] No session keys found');
    return false;
  }

  // Restore unlocked keys
  for (const [asset, hexKey] of Object.entries(sessionData.unlockedKeys)) {
    unlockedKeys.set(asset as AssetType, hexToBytes(hexKey));
  }

  // Restore view keys
  for (const [asset, hexKey] of Object.entries(sessionData.unlockedViewKeys)) {
    unlockedViewKeys.set(asset as 'xmr' | 'wow', hexToBytes(hexKey));
  }

  // Restore mnemonic for Grin first-time init
  if (sessionData.mnemonic) {
    unlockedMnemonic = sessionData.mnemonic;
    console.log('[Session] Restored mnemonic from session storage');
  }

  // Restore Grin extended private key (for Grin WASM operations)
  // This allows Grin wallet to work after service worker restart without re-deriving
  if (sessionData.grinExtendedPrivateKey) {
    try {
      const extendedKey = hexToBytes(sessionData.grinExtendedPrivateKey);
      grinWasmKeys = await initGrinWalletFromExtendedKey(extendedKey);
      console.log('[Session] Restored Grin WASM keys from extended private key');
    } catch (err) {
      console.warn('[Session] Failed to restore Grin WASM keys:', err);
      // Non-fatal - mnemonic is restored, so Grin can be re-initialized
    }
  }

  if (unlockedKeys.size > 0) {
    isUnlocked = true;
    console.log('[Session] Restored keys from session storage, assets:', Array.from(unlockedKeys.keys()));
    return true;
  }

  return false;
}

/**
 * Clear session keys on lock.
 */
async function clearSessionKeys(): Promise<void> {
  await storage.session.remove([SESSION_KEYS_KEY]);
  console.log('[Session] Cleared session keys');
}

/**
 * Handles messages from popup and content scripts.
 * Waits for initialization to complete before processing to avoid race conditions.
 */
runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    // Wait for initialization before processing messages
    const process = async () => {
      if (initializationPromise) {
        await initializationPromise;
      }
      return handleMessage(message as MessageType);
    };

    process()
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ success: false, error: err.message }));

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: MessageType): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_WALLET_STATE':
      return handleGetWalletState();

    case 'GENERATE_MNEMONIC':
      return handleGenerateMnemonic();

    case 'CONFIRM_MNEMONIC':
      return handleConfirmMnemonic(message.password, message.verifiedWords);

    case 'RESTORE_WALLET':
      return handleRestoreWallet(message.mnemonic, message.password);

    case 'CREATE_WALLET':
      return handleCreateWallet(message.password);

    case 'UNLOCK_WALLET':
      return handleUnlockWallet(message.password);

    case 'LOCK_WALLET':
      return handleLockWallet();

    case 'DECRYPT_TIP':
      return handleDecryptTip(message.tipInfo as TipInfo);

    case 'GET_BALANCE':
      return handleGetBalance(message.asset);

    case 'GET_ADDRESSES':
      return handleGetAddresses();

    case 'OPEN_CLAIM_POPUP':
      return handleOpenClaimPopup(message.linkId, message.fragmentKey);

    case 'GET_TIP_INFO':
      return handleGetTipInfo(message.linkId);

    case 'CLAIM_TIP':
      return handleClaimTip(message.linkId, message.fragmentKey);

    case 'GET_PENDING_CLAIM':
      return handleGetPendingClaim();

    case 'CLEAR_PENDING_CLAIM':
      pendingClaim = null;
      return { success: true, data: { cleared: true } };

    case 'GET_ONBOARDING_STATE':
      return handleGetOnboardingState();

    case 'SAVE_ONBOARDING_STATE':
      return handleSaveOnboardingState(message.state);

    case 'CLEAR_ONBOARDING_STATE':
      return handleClearOnboardingState();

    case 'GET_SETTINGS':
      return handleGetSettings();

    case 'UPDATE_SETTINGS':
      return handleUpdateSettings(message.settings);

    case 'RESET_AUTO_LOCK_TIMER':
      return handleResetAutoLockTimer();

    case 'GET_UTXOS':
      return handleGetUtxos(message.asset, message.address);

    case 'SEND_TX':
      return handleSendTx(message.asset, message.recipientAddress, message.amount, message.feeRate, message.sweep);

    case 'MAX_SENDABLE_UTXO':
      return handleMaxSendableUtxo(message.asset, message.feeRate);

    case 'GET_HISTORY':
      return handleGetHistory(message.asset);

    case 'ESTIMATE_FEE':
      return handleEstimateFee(message.asset);

    case 'GET_WALLET_KEYS':
      return handleGetWalletKeys(message.asset);

    case 'REVEAL_SEED':
      return handleRevealSeed(message.password);

    case 'ADD_PENDING_TX':
      return handleAddPendingTx(message.txHash, message.asset, message.amount, message.fee);

    case 'GET_PENDING_TXS':
      return handleGetPendingTxs(message.asset);

    // Grin WASM wallet operations
    case 'INIT_GRIN_WALLET':
      return handleInitGrinWallet();

    case 'GET_GRIN_PENDING_SLATEPACKS':
      return handleGetGrinPendingSlatepacks();

    case 'GRIN_SIGN_SLATE':
      return handleGrinSignSlate(message.relayId, message.slatepack);

    case 'GRIN_FINALIZE_SLATE':
      return handleGrinFinalizeSlate(message.relayId, message.slatepack);

    case 'GRIN_CANCEL_SLATE':
      return handleGrinCancelSlate(message.relayId);

    // Direct slatepack operations (no relay)
    case 'GRIN_SIGN_SLATEPACK':
      return handleGrinSignSlatepack(message.slatepack);

    // Grin send transaction (creates S1 slatepack)
    case 'GRIN_CREATE_SEND':
      return handleGrinCreateSend(message.amount, message.fee, message.recipientAddress);

    // Grin finalize transaction (S2 -> S3 -> broadcast)
    case 'GRIN_FINALIZE_AND_BROADCAST':
      return handleGrinFinalizeAndBroadcast(message.slatepack, message.sendContext);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function handleGetWalletState(): Promise<MessageResponse<{
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

/**
 * Step 1 of wallet creation: Generate mnemonic and return words + verification indices.
 */
async function handleGenerateMnemonic(): Promise<MessageResponse<{
  words: string[];
  verifyIndices: number[];
}>> {
  // Generate new mnemonic
  pendingMnemonic = generateMnemonicPhrase();
  const words = mnemonicToWords(pendingMnemonic);
  const verifyIndices = getVerificationIndices(words.length, 3);

  return {
    success: true,
    data: { words, verifyIndices },
  };
}

/**
 * Step 2 of wallet creation: Verify user wrote down seed and create wallet.
 */
async function handleConfirmMnemonic(
  password: string,
  verifiedWords: Record<number, string>
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  if (!pendingMnemonic) {
    return { success: false, error: 'No pending mnemonic. Start over.' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Verify the words match
  const words = mnemonicToWords(pendingMnemonic);
  for (const [idx, word] of Object.entries(verifiedWords)) {
    if (words[parseInt(idx)] !== word.toLowerCase().trim()) {
      return { success: false, error: 'Word verification failed. Please check your backup.' };
    }
  }

  // Set state to 'creating' so popup can show progress if reopened
  await saveOnboardingState({ step: 'creating', createdAt: Date.now() });

  // Create wallet from mnemonic
  const result = await createWalletFromMnemonic(pendingMnemonic, password, true);

  // Clear pending mnemonic
  pendingMnemonic = null;

  // Clear onboarding state on success
  if (result.success) {
    await clearOnboardingState();
  }

  return result;
}

/**
 * Restore wallet from existing mnemonic.
 */
async function handleRestoreWallet(
  mnemonic: string,
  password: string
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  if (!isValidMnemonic(mnemonic)) {
    return { success: false, error: 'Invalid recovery phrase' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Set state to 'creating' so popup can show progress if reopened
  await saveOnboardingState({ step: 'creating', createdAt: Date.now() });

  // Pass isRestore=true so LWS registration uses stored heights
  const result = await createWalletFromMnemonic(mnemonic, password, true, true);

  // Clear onboarding state on success
  if (result.success) {
    await clearOnboardingState();
  }

  return result;
}

/**
 * Core wallet creation from mnemonic.
 * @param isRestore - If true, this is a wallet restore (use stored heights for LWS start)
 */
async function createWalletFromMnemonic(
  mnemonic: string,
  password: string,
  backupConfirmed: boolean,
  isRestore: boolean = false
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

  // Fetch current blockchain heights for wallet birthday (run in parallel with key setup)
  let walletBirthday: WalletState['walletBirthday'];
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
  isUnlocked = true;

  // Persist keys to session storage (survives service worker restarts)
  await persistSessionKeys();

  // Start auto-lock timer
  startAutoLockTimer();

  // Register with backend (non-blocking - wallet works offline too)
  registerWithBackend(state).catch((err) => {
    console.warn('Failed to register with backend:', err);
    // Continue working - we can retry later
  });

  // Register XMR/WOW with LWS for balance scanning (non-blocking)
  // For new wallets: LWS starts from current block
  // For restored wallets: use wallet birthday heights to avoid scanning from genesis
  registerWithLws(state, derivedKeys, isRestore).catch((err) => {
    console.warn('Failed to register with LWS:', err);
  });

  return { success: true, data: { created: true, assets } };
}

/**
 * Register wallet with backend server.
 * Registers public keys and creates user account.
 */
async function registerWithBackend(state: WalletState): Promise<void> {
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
    return;
  }

  const result = await api.extensionRegister({
    keys,
    walletBirthday: state.walletBirthday?.timestamp,
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
}

/**
 * Register XMR/WOW wallets with LWS for balance scanning.
 * Uses the private view key to register with the Light Wallet Server.
 *
 * @param isRestore - If true, use wallet birthday heights as start_height to avoid scanning from genesis
 */
async function registerWithLws(
  state: WalletState,
  derivedKeys: { xmr: { privateViewKey: Uint8Array; publicSpendKey: Uint8Array; publicViewKey: Uint8Array }; wow: { privateViewKey: Uint8Array; publicSpendKey: Uint8Array; publicViewKey: Uint8Array } },
  isRestore: boolean = false
): Promise<void> {
  // Get start heights from wallet birthday (for restore scenarios)
  const xmrStartHeight = isRestore ? state.walletBirthday?.heights?.xmr : undefined;
  const wowStartHeight = isRestore ? state.walletBirthday?.heights?.wow : undefined;

  // Register XMR with LWS
  if (state.keys.xmr?.publicSpendKey && state.keys.xmr?.publicViewKey) {
    const xmrAddress = getAddressForAsset('xmr', state.keys.xmr);
    const xmrViewKey = bytesToHex(derivedKeys.xmr.privateViewKey);

    const xmrResult = await api.registerLws('xmr', xmrAddress, xmrViewKey, xmrStartHeight);
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

    const wowResult = await api.registerLws('wow', wowAddress, wowViewKey, wowStartHeight);
    if (wowResult.error) {
      console.warn('Failed to register WOW with LWS:', wowResult.error);
    } else {
      console.log('WOW registered with LWS:', wowResult.data?.message, wowStartHeight ? `(start_height: ${wowStartHeight})` : '(from current)');
    }
  }
}

// Legacy create wallet (for backwards compat, redirects to mnemonic flow)
async function handleCreateWallet(password: string): Promise<MessageResponse<{
  created: boolean;
  assets: AssetType[];
}>> {
  // Generate mnemonic and create wallet directly (skip verification for legacy)
  const mnemonic = generateMnemonicPhrase();
  return createWalletFromMnemonic(mnemonic, password, false);
}

async function handleUnlockWallet(password: string): Promise<MessageResponse<{
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
        unlockedMnemonic = new TextDecoder().decode(mnemonicBytes);
      } catch (err) {
        console.warn('Failed to decrypt mnemonic:', err);
      }
    }

    // Decrypt BIP39 seed (kept for backwards compatibility with other operations)
    if (state.encryptedBip39Seed && state.seedSalt) {
      try {
        unlockedSeed = await decryptPrivateKey(state.encryptedBip39Seed, state.seedSalt, password);
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
          unlockedSeed = bip39Seed;
          console.log('Migrated wallet: added encrypted BIP39 seed');
        }

        // Migrate: derive and store Grin key if missing
        if (!state.keys.grin) {
          const derivedKeys = deriveAllKeys(unlockedMnemonic);
          state.keys.grin = {
            asset: 'grin',
            publicKey: bytesToHex(derivedKeys.grin.publicKey),
            privateKey: encryptWithKey(derivedKeys.grin.privateKey),
            privateKeySalt: state.seedSalt!,
            createdAt: Date.now(),
          };
          unlockedKeys.set('grin', derivedKeys.grin.privateKey);
          console.log('Migrated wallet: added Grin key');
        }

        // Save updated state
        await saveWalletState(state);
      } catch (err) {
        console.warn('Failed to migrate wallet:', err);
      }
    }

    isUnlocked = true;

    // Persist keys to session storage (survives service worker restarts)
    await persistSessionKeys();

    // Start auto-lock timer
    startAutoLockTimer();

    return { success: true, data: { unlocked: true } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

async function handleLockWallet(): Promise<MessageResponse<{ locked: boolean }>> {
  unlockedKeys.clear();
  unlockedViewKeys.clear();
  grinWasmKeys = null;
  unlockedSeed = null;
  unlockedMnemonic = null;
  isUnlocked = false;
  await clearSessionKeys();
  stopAutoLockTimer();
  return { success: true, data: { locked: true } };
}

/**
 * Reveal seed phrase after password verification.
 * Requires re-entering password for security even if wallet is unlocked.
 */
async function handleRevealSeed(password: string): Promise<MessageResponse<{ words: string[] }>> {
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

async function handleDecryptTip(
  tipInfo: TipInfo
): Promise<MessageResponse<{ privateKey: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  if (!tipInfo.encryptedKey) {
    return { success: false, error: 'No encrypted key in tip' };
  }

  try {
    let decryptedKey: Uint8Array;

    if (tipInfo.isEncrypted && tipInfo.ephemeralPubkey) {
      // Encrypted tip - use our private key for ECDH
      const recipientKey = unlockedKeys.get(tipInfo.asset);
      if (!recipientKey) {
        return { success: false, error: `No ${tipInfo.asset} key available` };
      }

      decryptedKey = decryptTipPayload(
        tipInfo.encryptedKey,
        tipInfo.ephemeralPubkey,
        recipientKey
      );
    } else {
      // Public tip - key should be in URL fragment
      // This would typically be passed from the content script
      return { success: false, error: 'Public tip requires URL fragment key' };
    }

    return { success: true, data: { privateKey: bytesToHex(decryptedKey) } };
  } catch {
    return { success: false, error: 'Failed to decrypt tip' };
  }
}

/**
 * Get balance for a specific asset via backend API.
 * Returns UTXO format for BTC/LTC/Grin, or LWS raw format for XMR/WOW.
 * XMR/WOW balances require client-side WASM verification in the popup.
 */
async function handleGetBalance(
  asset: AssetType
): Promise<MessageResponse<
  | { asset: AssetType; confirmed: number; unconfirmed: number; total: number }
  | {
      asset: 'xmr' | 'wow';
      total_received: number;
      locked_balance: number;
      pending_balance: number;
      spent_outputs: Array<{ amount: number; key_image: string; tx_pub_key: string; out_index: number }>;
      viewKeyHex: string;
      publicSpendKey: string;
      spendKeyHex: string;
      needsVerification: true;
    }
>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];

  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  try {
    // Get the address for this asset
    const address = getAddressForAsset(asset, key);

    if (asset === 'btc' || asset === 'ltc') {
      // Use Electrum endpoint for UTXO coins
      const result = await api.getUtxoBalance(asset, address);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          asset,
          confirmed: result.data!.confirmed,
          unconfirmed: result.data!.unconfirmed,
          total: result.data!.total,
        },
      };
    } else if (asset === 'xmr' || asset === 'wow') {
      // Use LWS endpoint for Cryptonote coins
      // Return raw data + keys so popup can verify spent outputs with WASM
      const viewKey = unlockedViewKeys.get(asset);
      if (!viewKey) {
        return { success: false, error: `No ${asset} view key available` };
      }

      const spendKey = unlockedKeys.get(asset);
      if (!spendKey) {
        return { success: false, error: `No ${asset} spend key available` };
      }

      const viewKeyHex = bytesToHex(viewKey);
      const spendKeyHex = bytesToHex(spendKey);
      const publicSpendKey = key.publicSpendKey;

      if (!publicSpendKey) {
        return { success: false, error: `No ${asset} public spend key found` };
      }

      const result = await api.getLwsBalance(asset, address, viewKeyHex);

      if (result.error) {
        return { success: false, error: result.error };
      }

      // Return raw LWS data + keys for popup to verify with WASM
      // WASM can't run in service worker, so popup does the verification
      return {
        success: true,
        data: {
          asset,
          // Raw LWS data
          total_received: result.data!.total_received,
          locked_balance: result.data!.locked_balance,
          pending_balance: result.data!.pending_balance,
          spent_outputs: result.data!.spent_outputs,
          // Keys needed for verification (popup will use these with WASM)
          viewKeyHex,
          publicSpendKey,
          spendKeyHex,
          // Flag to indicate this needs client-side verification
          needsVerification: true,
        },
      };
    } else if (asset === 'grin') {
      // Grin is non-custodial - balance tracked in backend grin_transactions table
      const authState = await getAuthState();
      if (!authState?.userId) {
        return { success: false, error: 'Not authenticated' };
      }

      const result = await api.getGrinUserBalance(authState.userId);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          asset,
          confirmed: result.data!.confirmed,
          unconfirmed: result.data!.pending,
          total: result.data!.total,
        },
      };
    } else {
      return { success: false, error: `Unknown asset: ${asset}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch balance',
    };
  }
}

/**
 * Get all wallet addresses.
 */
async function handleGetAddresses(): Promise<MessageResponse<{
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

/**
 * Derive address from wallet key for a specific asset.
 */
function getAddressForAsset(asset: AssetType, key: { publicKey: string; publicSpendKey?: string; publicViewKey?: string }): string {
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

async function handleOpenClaimPopup(
  linkId: string,
  fragmentKey?: string
): Promise<MessageResponse<{ opened: boolean }>> {
  // Store pending claim data
  pendingClaim = { linkId, fragmentKey };

  // Open popup (this triggers the popup to check for pending claims)
  // Note: chrome.action.openPopup() requires user gesture in MV3
  // We'll store the claim data and show a notification instead
  await notifications.create(undefined, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Tip Ready to Claim!',
    message: 'Click the Smirk Wallet icon to claim your tip.',
  });

  return { success: true, data: { opened: true } };
}

async function handleGetTipInfo(
  linkId: string
): Promise<MessageResponse<{ tip: TipInfo }>> {
  const result = await api.getTip(linkId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { tip: result.data! } };
}

async function handleGetPendingClaim(): Promise<MessageResponse<{
  pending: boolean;
  linkId?: string;
  fragmentKey?: string;
}>> {
  if (pendingClaim) {
    return {
      success: true,
      data: {
        pending: true,
        linkId: pendingClaim.linkId,
        fragmentKey: pendingClaim.fragmentKey,
      },
    };
  }
  return { success: true, data: { pending: false } };
}

async function handleClaimTip(
  linkId: string,
  fragmentKey?: string
): Promise<MessageResponse<{ claimed: boolean; txHash?: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  // 1. Fetch tip info from backend
  const tipResult = await api.getTip(linkId);
  if (tipResult.error || !tipResult.data) {
    return { success: false, error: tipResult.error || 'Failed to fetch tip' };
  }

  const tip = tipResult.data;

  if (tip.status !== 'funded' && tip.status !== 'pending') {
    return { success: false, error: `Tip is not claimable (status: ${tip.status})` };
  }

  // 2. Decrypt the tip private key
  let tipPrivateKey: Uint8Array;

  try {
    if (tip.isEncrypted && tip.ephemeralPubkey) {
      // Encrypted tip - recipient-specific
      const recipientKey = unlockedKeys.get(tip.asset);
      if (!recipientKey) {
        return { success: false, error: `No ${tip.asset} key available` };
      }

      tipPrivateKey = decryptTipPayload(
        tip.encryptedKey,
        tip.ephemeralPubkey,
        recipientKey
      );
    } else if (fragmentKey) {
      // Public tip - use URL fragment key
      const keyBytes = decodeUrlFragmentKey(fragmentKey);
      tipPrivateKey = decryptPublicTipPayload(tip.encryptedKey, keyBytes);
    } else {
      return { success: false, error: 'No decryption key available' };
    }
  } catch (err) {
    return { success: false, error: 'Failed to decrypt tip key' };
  }

  // 3. Sweep funds to our wallet
  // For now, just log the private key - actual sweep requires blockchain interaction
  console.log('Decrypted tip key:', bytesToHex(tipPrivateKey));

  // TODO: Create sweep transaction based on asset type
  // - BTC/LTC: Create and broadcast transaction to our address
  // - XMR/WOW: Import key into wallet and transfer
  // - Grin: Slate-based receive flow

  // 4. Mark as claimed on backend (once sweep tx is broadcast)
  // const claimResult = await api.claimTip(linkId, txHash);

  // Clear pending claim
  pendingClaim = null;

  return {
    success: true,
    data: {
      claimed: true,
      // txHash: actualTxHash
    },
  };
}

async function handleGetOnboardingState(): Promise<MessageResponse<{ state: OnboardingState | null }>> {
  const state = await getOnboardingState();
  return { success: true, data: { state } };
}

async function handleSaveOnboardingState(
  state: OnboardingState
): Promise<MessageResponse<{ saved: boolean }>> {
  await saveOnboardingState(state);
  return { success: true, data: { saved: true } };
}

async function handleClearOnboardingState(): Promise<MessageResponse<{ cleared: boolean }>> {
  await clearOnboardingState();
  return { success: true, data: { cleared: true } };
}

// ============================================================================
// Settings Handlers
// ============================================================================

async function handleGetSettings(): Promise<MessageResponse<{ settings: UserSettings }>> {
  const state = await getWalletState();
  return { success: true, data: { settings: state.settings } };
}

async function handleUpdateSettings(
  updates: Partial<UserSettings>
): Promise<MessageResponse<{ settings: UserSettings }>> {
  const state = await getWalletState();

  // Merge updates with existing settings
  state.settings = {
    ...state.settings,
    ...updates,
  };

  // Validate autoLockMinutes
  if (updates.autoLockMinutes !== undefined) {
    const minutes = updates.autoLockMinutes;
    if (minutes < 0 || minutes > 240) {
      return { success: false, error: 'Auto-lock time must be between 0 and 240 minutes' };
    }
    state.settings.autoLockMinutes = minutes;

    // Update cache and restart auto-lock timer with new setting
    cachedAutoLockMinutes = minutes;
    if (isUnlocked) {
      resetAutoLockTimer();
    }
  }

  await saveWalletState(state);
  return { success: true, data: { settings: state.settings } };
}

async function handleResetAutoLockTimer(): Promise<MessageResponse<{ reset: boolean }>> {
  console.log('[AutoLock] handleResetAutoLockTimer called, isUnlocked:', isUnlocked, 'cachedAutoLockMinutes:', cachedAutoLockMinutes);
  if (isUnlocked) {
    // If cache is null (service worker restarted), load from storage first
    if (cachedAutoLockMinutes === null) {
      const state = await getWalletState();
      cachedAutoLockMinutes = state.settings.autoLockMinutes;
      console.log('[AutoLock] Loaded from storage:', cachedAutoLockMinutes);
    }
    resetAutoLockTimer();
  }
  return { success: true, data: { reset: true } };
}

/**
 * Resets the auto-lock timer using cached settings.
 * Uses chrome.alarms API which persists across service worker restarts.
 */
function resetAutoLockTimer() {
  console.log('[AutoLock] resetAutoLockTimer called, cachedAutoLockMinutes:', cachedAutoLockMinutes, 'isUnlocked:', isUnlocked);
  // Use cached value - if not set, don't start timer (will be set on unlock)
  if (cachedAutoLockMinutes === null || cachedAutoLockMinutes === 0 || !isUnlocked) {
    console.log('[AutoLock] Clearing alarm (cache null, 0, or locked)');
    alarms.clear(AUTO_LOCK_ALARM);
    return;
  }

  // Create alarm that fires after the configured minutes
  // delayInMinutes must be at least 1 minute in Chrome
  const delayMinutes = Math.max(1, cachedAutoLockMinutes);
  console.log('[AutoLock] Creating alarm with delayMinutes:', delayMinutes);
  alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: delayMinutes });
}

/**
 * Starts the auto-lock timer, loading settings from storage.
 * Call this on unlock or when settings change.
 */
async function startAutoLockTimer() {
  const state = await getWalletState();
  cachedAutoLockMinutes = state.settings.autoLockMinutes;
  console.log('[AutoLock] startAutoLockTimer loaded cachedAutoLockMinutes:', cachedAutoLockMinutes);

  // Now use the fast path
  resetAutoLockTimer();
}

/**
 * Stops the auto-lock timer.
 */
function stopAutoLockTimer() {
  alarms.clear(AUTO_LOCK_ALARM);
}

/**
 * Handle auto-lock alarm firing.
 * Note: This runs when service worker wakes from the alarm, potentially before
 * initializeBackground() restores session state. We must clear session storage
 * directly to ensure the wallet stays locked even if the handler runs early.
 */
alarms.onAlarm.addListener(async (alarm) => {
  console.log('[AutoLock] Alarm fired:', alarm.name);
  if (alarm.name === AUTO_LOCK_ALARM) {
    console.log(`[AutoLock] Auto-locking wallet due to inactivity`);
    // Clear in-memory state
    unlockedKeys.clear();
    unlockedViewKeys.clear();
    isUnlocked = false;
    // Clear session storage directly - this is the source of truth across restarts
    // Must await to ensure it completes before service worker sleeps again
    await clearSessionKeys();
    console.log('[AutoLock] Wallet locked and session cleared');
  }
});

// ============================================================================
// UTXO / Send Handlers (BTC/LTC)
// ============================================================================

/**
 * Get UTXOs for a BTC or LTC address.
 */
async function handleGetUtxos(
  asset: 'btc' | 'ltc',
  address: string
): Promise<MessageResponse<{ utxos: Utxo[] }>> {
  const result = await api.getUtxos(asset, address);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { utxos: result.data!.utxos } };
}

/**
 * Calculate maximum sendable amount for BTC/LTC.
 * Fetches UTXOs and calculates max after fees.
 */
async function handleMaxSendableUtxo(
  asset: 'btc' | 'ltc',
  feeRate: number
): Promise<MessageResponse<{ maxAmount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  const address = getAddressForAsset(asset, key);

  // Fetch UTXOs
  const utxoResult = await api.getUtxos(asset, address);
  if (utxoResult.error || !utxoResult.data) {
    return { success: false, error: utxoResult.error || 'Failed to fetch UTXOs' };
  }

  const utxos = utxoResult.data.utxos;
  if (utxos.length === 0) {
    return { success: true, data: { maxAmount: 0 } };
  }

  // Calculate max sendable using btc-tx helper
  const maxAmount = maxSendableUtxo(utxos, feeRate);

  return { success: true, data: { maxAmount } };
}

/**
 * Send BTC or LTC transaction.
 * Builds, signs, and broadcasts a transaction to the given recipient.
 * If sweep is true, sends all UTXOs with no change output (empties the wallet).
 */
async function handleSendTx(
  asset: 'btc' | 'ltc',
  recipientAddress: string,
  amount: number,
  feeRate: number,
  sweep: boolean = false
): Promise<MessageResponse<{ txid: string; fee: number; actualAmount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const privateKey = unlockedKeys.get(asset);
  if (!privateKey) {
    return { success: false, error: `No ${asset} key available` };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  // Get our address (for change output)
  const changeAddress = getAddressForAsset(asset, key);

  // Fetch UTXOs
  const utxoResult = await api.getUtxos(asset, changeAddress);
  if (utxoResult.error || !utxoResult.data) {
    return { success: false, error: utxoResult.error || 'Failed to fetch UTXOs' };
  }

  const utxos = utxoResult.data.utxos;
  if (utxos.length === 0) {
    return { success: false, error: 'No UTXOs available' };
  }

  try {
    // Build and sign transaction (sweep mode uses all UTXOs, no change)
    const { txHex, fee, actualAmount } = createSignedTransaction(
      asset,
      utxos,
      recipientAddress,
      amount,
      changeAddress,
      privateKey,
      feeRate,
      sweep
    );

    // Broadcast transaction
    const broadcastResult = await api.broadcastTx(asset, txHex);
    if (broadcastResult.error) {
      return { success: false, error: broadcastResult.error };
    }

    console.log(`[Send] ${asset.toUpperCase()} tx broadcast:`, broadcastResult.data!.txid, sweep ? '(sweep)' : '');

    return { success: true, data: { txid: broadcastResult.data!.txid, fee, actualAmount } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create transaction',
    };
  }
}

/**
 * Get transaction history for any asset.
 * BTC/LTC use Electrum, XMR/WOW use LWS.
 */
async function handleGetHistory(
  asset: AssetType
): Promise<MessageResponse<{ transactions: Array<{ txid: string; height: number; fee?: number; is_pending?: boolean; total_received?: number; total_sent?: number }> }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  const address = getAddressForAsset(asset, key);

  if (asset === 'btc' || asset === 'ltc') {
    // Electrum-based history
    const result = await api.getHistory(asset, address);
    if (result.error) {
      return { success: false, error: result.error };
    }
    return { success: true, data: { transactions: result.data!.transactions } };
  } else if (asset === 'xmr' || asset === 'wow') {
    // LWS-based history
    const viewKey = unlockedViewKeys.get(asset);
    if (!viewKey) {
      return { success: false, error: `No ${asset} view key available` };
    }

    const result = await api.getLwsHistory(asset, address, bytesToHex(viewKey));
    if (result.error) {
      return { success: false, error: result.error };
    }

    // Map LWS format to common format
    const transactions = result.data!.transactions.map(tx => ({
      txid: tx.txid,
      height: tx.height,
      is_pending: tx.is_pending,
      total_received: tx.total_received,
      total_sent: tx.total_sent,
    }));

    return { success: true, data: { transactions } };
  } else if (asset === 'grin') {
    // Grin history from backend grin_transactions table
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await api.getGrinUserHistory(authState.userId);
    if (result.error) {
      return { success: false, error: result.error };
    }

    // Map to common format - use slate_id as txid equivalent
    const transactions = result.data!.transactions.map(tx => ({
      txid: tx.slate_id,
      height: tx.status === 'confirmed' ? 1 : 0, // Placeholder - we don't track block height yet
      is_pending: tx.status !== 'confirmed' && tx.status !== 'finalized',
      total_received: tx.direction === 'receive' ? tx.amount : 0,
      total_sent: tx.direction === 'send' ? tx.amount + tx.fee : 0,
    }));

    return { success: true, data: { transactions } };
  } else {
    return { success: false, error: `History not supported for ${asset}` };
  }
}

/**
 * Estimate fee rates for BTC or LTC.
 */
async function handleEstimateFee(
  asset: 'btc' | 'ltc'
): Promise<MessageResponse<{ fast: number | null; normal: number | null; slow: number | null }>> {
  const result = await api.estimateFee(asset);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      fast: result.data!.fast,
      normal: result.data!.normal,
      slow: result.data!.slow,
    },
  };
}

/**
 * Get wallet keys for XMR/WOW (needed for client-side tx signing).
 * Returns address, view key, and spend key.
 */
async function handleGetWalletKeys(
  asset: 'xmr' | 'wow'
): Promise<MessageResponse<{ address: string; viewKey: string; spendKey: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const spendKey = unlockedKeys.get(asset);
  const viewKey = unlockedViewKeys.get(asset);

  if (!spendKey || !viewKey) {
    return { success: false, error: `No ${asset} keys available` };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  // Get address
  const address = getAddressForAsset(asset, key);

  return {
    success: true,
    data: {
      address,
      viewKey: bytesToHex(viewKey),
      spendKey: bytesToHex(spendKey),
    },
  };
}

/**
 * Add a pending outgoing transaction to track.
 */
async function handleAddPendingTx(
  txHash: string,
  asset: AssetType,
  amount: number,
  fee: number
): Promise<MessageResponse<{ added: boolean }>> {
  await addPendingTx({
    txHash,
    asset,
    amount,
    fee,
    timestamp: Date.now(),
  });
  return { success: true, data: { added: true } };
}

/**
 * Get pending outgoing transactions for an asset.
 */
async function handleGetPendingTxs(
  asset: AssetType
): Promise<MessageResponse<{ pending: Array<{ txHash: string; amount: number; fee: number; timestamp: number }> }>> {
  const pending = await getPendingTxs(asset);
  return {
    success: true,
    data: {
      pending: pending.map(tx => ({
        txHash: tx.txHash,
        amount: tx.amount,
        fee: tx.fee,
        timestamp: tx.timestamp,
      })),
    },
  };
}

// ============================================================================
// Grin WASM Wallet Handlers
// ============================================================================

/**
 * Initialize the Grin WASM wallet and return the slatepack address.
 * This derives the proper Grin keys using the MWC wallet's derivation.
 *
 * Keys can be initialized from:
 * 1. Cached grinWasmKeys (already initialized this session)
 * 2. Session storage (restored after service worker restart)
 * 3. Mnemonic (fresh unlock - derives keys and persists to session)
 */
async function handleInitGrinWallet(): Promise<MessageResponse<{
  slatepackAddress: string;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  // Return cached keys if already initialized (or restored from session)
  if (grinWasmKeys) {
    return {
      success: true,
      data: { slatepackAddress: grinWasmKeys.slatepackAddress },
    };
  }

  // MWC Seed class requires the mnemonic string, not the 64-byte BIP39 seed
  // Valid seed lengths for MWC are 16/20/24/28/32 bytes (raw entropy), not 64 bytes
  if (!unlockedMnemonic) {
    return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
  }

  try {
    // Initialize Grin WASM wallet with mnemonic
    grinWasmKeys = await initGrinWallet(unlockedMnemonic);

    // Persist the extended key to session storage so it survives service worker restarts
    // NOTE: We only store the extended key, NOT the mnemonic - this limits exposure to Grin only
    await persistSessionKeys();

    return {
      success: true,
      data: { slatepackAddress: grinWasmKeys.slatepackAddress },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to initialize Grin wallet',
    };
  }
}

/**
 * Get pending slatepacks for the current user.
 */
async function handleGetGrinPendingSlatepacks(): Promise<MessageResponse<{
  pendingToSign: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
  pendingToFinalize: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await api.getGrinPendingSlatepacks(authState.userId);
    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        pendingToSign: result.data!.pending_to_sign.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
        pendingToFinalize: result.data!.pending_to_finalize.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch pending slatepacks',
    };
  }
}

/**
 * Sign an incoming slate as recipient.
 * Decodes the slatepack, signs it with our keys, encodes response, and submits to relay.
 */
async function handleGrinSignSlate(
  relayId: string,
  slatepack: string
): Promise<MessageResponse<{ signed: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    // Ensure Grin WASM wallet is initialized
    if (!grinWasmKeys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      grinWasmKeys = await initGrinWallet(unlockedMnemonic);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the next available child index for key derivation
    // This ensures we don't reuse blinding factors (which would create duplicate commitments)
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }
    const nextChildIndex = outputsResult.data?.next_child_index ?? 0;
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes, adds our signature, returns S2 slate and output info)
    const { slate: signedSlate, outputInfo } = await signSlate(grinWasmKeys, slatepack, nextChildIndex);

    // Encode the signed slate as a slatepack response for the sender
    const signedSlatepack = await encodeSlatepack(grinWasmKeys, signedSlate, 'response');

    // Submit signed slatepack to relay
    const result = await api.signGrinSlatepack({
      relayId,
      userId: authState.userId,
      signedSlatepack,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Record the received output to the backend so balance is updated
    try {
      const recordResult = await api.recordGrinOutput({
        userId: authState.userId,
        keyId: outputInfo.keyId,
        nChild: outputInfo.nChild,
        amount: Number(outputInfo.amount),
        commitment: outputInfo.commitment,
        txSlateId: signedSlate.id,
      });
      if (recordResult.error) {
        console.warn('[Grin] Failed to record output (non-fatal):', recordResult.error);
      } else {
        console.log(`[Grin] Recorded output ${outputInfo.commitment} for ${outputInfo.amount} nanogrin`);
      }
    } catch (recordErr) {
      console.warn('[Grin] Failed to record output (non-fatal):', recordErr);
    }

    console.log(`[Grin] Signed slate ${signedSlate.id}, amount: ${signedSlate.amount} nanogrin`);

    return { success: true, data: { signed: true } };
  } catch (err) {
    console.error('[Grin] Failed to sign slate:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign slate',
    };
  }
}

/**
 * Finalize a slate and broadcast.
 * Decodes the signed slatepack from recipient, finalizes it, and submits for broadcast.
 *
 * NOTE: This requires the original S1 slate and sender's secret nonce from when the
 * transaction was initiated. Currently not implemented - the relay workflow has the
 * sender finalize client-side, but we'd need to store slate state to support this.
 *
 * TODO: Implement slate state storage for sender-initiated transactions
 */
async function handleGrinFinalizeSlate(
  _relayId: string,
  _slatepack: string
): Promise<MessageResponse<{ broadcast: boolean; txid?: string }>> {
  // Finalization requires the original S1 slate and sender's secret nonce
  // which we don't currently store. This flow needs additional implementation.
  return {
    success: false,
    error: 'Grin send/finalize flow not yet implemented. Use receive flow for now.',
  };
}

/**
 * Sign a slatepack directly (no relay).
 * This is for the standard Grin receive flow:
 * 1. Sender creates S1 slatepack and gives it to receiver (out of band)
 * 2. Receiver pastes S1 here, signs it, gets S2 slatepack back
 * 3. Receiver gives S2 back to sender (out of band)
 * 4. Sender finalizes and broadcasts
 */
async function handleGrinSignSlatepack(
  slatepackString: string
): Promise<MessageResponse<{ signedSlatepack: string; slateId: string; amount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    // Ensure Grin WASM wallet is initialized
    if (!grinWasmKeys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      grinWasmKeys = await initGrinWallet(unlockedMnemonic);
    }

    // Get auth state for user ID (needed to record output)
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the next available child index for key derivation
    // This ensures we don't reuse blinding factors (which would create duplicate commitments)
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }
    const nextChildIndex = outputsResult.data?.next_child_index ?? 0;
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes S1, adds our signature, returns S2 slate and output info)
    const { slate: signedSlate, outputInfo } = await signSlate(grinWasmKeys, slatepackString, nextChildIndex);

    // Encode the signed slate as a slatepack response
    const signedSlatepack = await encodeSlatepack(grinWasmKeys, signedSlate, 'response');

    console.log(`[Grin] Signed slatepack, amount: ${signedSlate.amount} nanogrin, output: ${outputInfo.commitment}`);

    // Record the received output to the backend so balance is updated
    // The output is created when we sign (receive) - it will be spendable after tx confirms
    console.log('[Grin] Recording output to backend...', {
      userId: authState.userId,
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: Number(outputInfo.amount),
      commitment: outputInfo.commitment,
      txSlateId: signedSlate.id,
    });
    try {
      const recordResult = await api.recordGrinOutput({
        userId: authState.userId,
        keyId: outputInfo.keyId,
        nChild: outputInfo.nChild,
        amount: Number(outputInfo.amount),
        commitment: outputInfo.commitment,
        txSlateId: signedSlate.id,
      });
      console.log('[Grin] recordGrinOutput result:', JSON.stringify(recordResult));
      if (recordResult.error) {
        console.error('[Grin] Failed to record output:', recordResult.error);
      } else {
        console.log(`[Grin] Recorded output ${outputInfo.commitment} for ${outputInfo.amount} nanogrin, id: ${recordResult.data?.id}`);
      }
    } catch (recordErr) {
      // Non-fatal - the signing worked, we just couldn't record the output
      // User can still give slatepack to sender, balance will be wrong until fixed
      console.error('[Grin] Exception recording output:', recordErr);
    }

    // Record the transaction so it shows up in balance and history
    // Status starts as 'pending' - will become 'confirmed' when tx is mined
    console.log('[Grin] Recording transaction to backend...', {
      userId: authState.userId,
      slateId: signedSlate.id,
      amount: Number(signedSlate.amount),
      direction: 'receive',
    });
    try {
      const txResult = await api.recordGrinTransaction({
        userId: authState.userId,
        slateId: signedSlate.id,
        amount: Number(signedSlate.amount),
        fee: 0, // Receiver doesn't pay fee
        direction: 'receive',
      });
      console.log('[Grin] recordGrinTransaction result:', JSON.stringify(txResult));
      if (txResult.error) {
        console.error('[Grin] Failed to record transaction:', txResult.error);
      } else {
        console.log(`[Grin] Recorded receive transaction ${signedSlate.id}, id: ${txResult.data?.id}`);
      }
    } catch (txErr) {
      console.error('[Grin] Exception recording transaction:', txErr);
    }

    return {
      success: true,
      data: {
        signedSlatepack,
        slateId: signedSlate.id,
        amount: Number(signedSlate.amount),
      },
    };
  } catch (err) {
    console.error('[Grin] Failed to sign slatepack:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign slatepack',
    };
  }
}

/**
 * Cancel a pending slatepack.
 */
async function handleGrinCancelSlate(
  relayId: string
): Promise<MessageResponse<{ success: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await api.cancelGrinSlatepack({
      relayId,
      userId: authState.userId,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    return { success: true, data: { success: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel slatepack',
    };
  }
}

/**
 * Create a Grin send transaction (S1 slatepack).
 * Fetches UTXOs from backend, builds transaction with proper inputs/outputs.
 */
async function handleGrinCreateSend(
  amount: number,
  fee: number,
  recipientAddress?: string
): Promise<MessageResponse<{
  slatepack: string;
  slateId: string;
  sendContext: import('@/types').GrinSendContext;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    // Ensure Grin WASM wallet is initialized
    if (!grinWasmKeys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      grinWasmKeys = await initGrinWallet(unlockedMnemonic);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch UTXOs from backend
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }

    const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

    // Filter to only unspent outputs and convert to GrinOutput format
    const outputs: GrinOutput[] = rawOutputs
      .filter(o => o.status === 'unspent')
      .map(o => ({
        id: o.id,
        keyId: o.key_id,
        nChild: o.n_child,
        amount: BigInt(o.amount),
        commitment: o.commitment,
        isCoinbase: o.is_coinbase,
        blockHeight: o.block_height ?? undefined,
      }));

    if (outputs.length === 0) {
      return { success: false, error: 'No unspent outputs available' };
    }

    // Get current blockchain height
    const heightsResult = await api.getBlockchainHeights();
    if (heightsResult.error || !heightsResult.data?.grin) {
      return { success: false, error: 'Failed to get blockchain height' };
    }
    const currentHeight = BigInt(heightsResult.data.grin);

    // Create the send transaction
    const result = await createSendTransaction(
      grinWasmKeys,
      outputs,
      BigInt(amount),
      BigInt(fee),
      currentHeight,
      nextChildIndex,
      recipientAddress
    );

    // Lock the inputs on the backend
    await api.lockGrinOutputs({
      outputIds: result.inputIds,
      txSlateId: result.slate.id,
    });

    // Record the transaction
    await api.recordGrinTransaction({
      userId: authState.userId,
      slateId: result.slate.id,
      amount,
      fee,
      direction: 'send',
      counterpartyAddress: recipientAddress,
    });

    // Build send context for later finalization
    const sendContext: import('@/types').GrinSendContext = {
      slateId: result.slate.id,
      secretKey: bytesToHex(result.secretKey),
      secretNonce: bytesToHex(result.secretNonce),
      inputIds: result.inputIds,
      changeOutput: result.changeOutput ? {
        keyId: result.changeOutput.keyId,
        nChild: result.changeOutput.nChild,
        amount: Number(result.changeOutput.amount),
        commitment: result.changeOutput.commitment,
      } : undefined,
    };

    // Clear sensitive data from memory
    result.secretKey.fill(0);
    result.secretNonce.fill(0);

    console.log(`[Grin] Created send slate ${result.slate.id}, amount: ${amount} nanogrin`);

    return {
      success: true,
      data: {
        slatepack: result.slatepack,
        slateId: result.slate.id,
        sendContext,
      },
    };
  } catch (err) {
    console.error('[Grin] Failed to create send transaction:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create send transaction',
    };
  }
}

/**
 * Finalize a Grin transaction and broadcast it.
 * Takes S2 slatepack from receiver, finalizes to S3, broadcasts to network.
 */
async function handleGrinFinalizeAndBroadcast(
  slatepackString: string,
  sendContext: import('@/types').GrinSendContext
): Promise<MessageResponse<{ broadcast: boolean; txid?: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    // Ensure Grin WASM wallet is initialized
    if (!grinWasmKeys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      grinWasmKeys = await initGrinWallet(unlockedMnemonic);
    }

    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Decode sendContext secrets
    const secretKey = hexToBytes(sendContext.secretKey);
    const secretNonce = hexToBytes(sendContext.secretNonce);

    // We need to reconstruct the initial slate to finalize
    // For now, we'll decode the S2 response directly with the finalizeSlate function
    // that accepts the secret key and nonce

    // Finalize the slate (S2 -> S3)
    const finalizedSlate = await finalizeSlate(
      grinWasmKeys,
      slatepackString,
      { id: sendContext.slateId, amount: BigInt(0), fee: BigInt(0), state: 'S1', raw: null } as any, // Placeholder - finalizeSlate will decode the actual slate
      secretKey,
      secretNonce
    );

    // Clear sensitive data
    secretKey.fill(0);
    secretNonce.fill(0);

    // Encode the finalized slate for broadcast
    const finalizedSlatepack = await encodeSlatepack(grinWasmKeys, finalizedSlate, 'send');

    // Broadcast to network via backend
    const broadcastResult = await api.broadcastGrinTransaction({
      slateId: sendContext.slateId,
      slatepack: finalizedSlatepack,
    });

    if (broadcastResult.error) {
      // Unlock inputs on failure
      await api.unlockGrinOutputs({ outputIds: sendContext.inputIds });
      return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
    }

    // Mark inputs as spent
    await api.spendGrinOutputs({
      outputIds: sendContext.inputIds,
      txSlateId: sendContext.slateId,
    });

    // Record change output if any
    if (sendContext.changeOutput) {
      await api.recordGrinOutput({
        userId: authState.userId,
        keyId: sendContext.changeOutput.keyId,
        nChild: sendContext.changeOutput.nChild,
        amount: sendContext.changeOutput.amount,
        commitment: sendContext.changeOutput.commitment,
        txSlateId: sendContext.slateId,
      });
    }

    // Update transaction status
    await api.updateGrinTransaction({
      slateId: sendContext.slateId,
      status: 'finalized',
    });

    console.log(`[Grin] Finalized and broadcast slate ${sendContext.slateId}`);

    return {
      success: true,
      data: { broadcast: true },
    };
  } catch (err) {
    console.error('[Grin] Failed to finalize and broadcast:', err);

    // Try to unlock inputs on error
    try {
      await api.unlockGrinOutputs({ outputIds: sendContext.inputIds });
    } catch {
      // Ignore unlock errors
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize transaction',
    };
  }
}

// Listen for extension installation
runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Smirk Wallet installed');
  }
});

// Initialize on startup - load auth state and restore session
async function initializeBackground() {
  // Debug: Log stored auto-lock setting on startup
  const walletState = await getWalletState();
  console.log('[AutoLock] Stored autoLockMinutes on startup:', walletState.settings.autoLockMinutes);

  // Try to restore unlock state from session storage (survives service worker restarts)
  const restored = await restoreSessionKeys();
  if (restored) {
    // Also restore cached auto-lock minutes so timer works correctly
    cachedAutoLockMinutes = walletState.settings.autoLockMinutes;
    console.log('[Session] Restored unlock state, cachedAutoLockMinutes:', cachedAutoLockMinutes);

    // Check if there's already an alarm set; if not, create one
    // This handles the case where the service worker restarted but wasn't triggered by the alarm
    const existingAlarm = await alarms.get(AUTO_LOCK_ALARM);
    if (!existingAlarm && cachedAutoLockMinutes && cachedAutoLockMinutes > 0) {
      console.log('[AutoLock] No existing alarm found after restore, creating new one');
      resetAutoLockTimer();
    } else if (existingAlarm) {
      console.log('[AutoLock] Existing alarm found, scheduled for:', new Date(existingAlarm.scheduledTime));
    }
  }

  const authState = await getAuthState();
  if (authState) {
    // Check if token is expired
    if (authState.expiresAt > Date.now()) {
      api.setAccessToken(authState.accessToken);
      console.log('Auth state restored');
    } else {
      // Try to refresh
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
      } else {
        console.warn('Failed to refresh auth token, user may need to re-register');
      }
    }
  }
}

// Start initialization and store the promise so message handlers can wait for it
initializationPromise = initializeBackground().catch((err) => {
  console.error('Background initialization failed:', err);
});

console.log('Smirk Wallet background service worker started');
