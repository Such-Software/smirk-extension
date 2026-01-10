/**
 * Background service worker for Smirk extension.
 *
 * Handles:
 * - Wallet state management
 * - Crypto operations
 * - API communication
 * - Message passing between popup/content scripts
 */

import type { MessageType, MessageResponse, WalletState, AssetType, TipInfo } from '@/types';
import {
  getPublicKey,
  encryptPrivateKey,
  decryptPrivateKey,
  decryptTipPayload,
  decryptPublicTipPayload,
  decodeUrlFragmentKey,
  bytesToHex,
  encrypt,
  decrypt,
  randomBytes,
} from '@/lib/crypto';
import {
  generateMnemonicPhrase,
  isValidMnemonic,
  deriveAllKeys,
  mnemonicToWords,
  getVerificationIndices,
} from '@/lib/hd';
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
import { runtime, notifications } from '@/lib/browser';

// Pending claim data from content script
let pendingClaim: { linkId: string; fragmentKey?: string } | null = null;

// Temporary mnemonic during wallet creation (cleared after confirmation)
let pendingMnemonic: string | null = null;

// In-memory decrypted keys (cleared on lock)
let unlockedKeys: Map<AssetType, Uint8Array> = new Map();
let isUnlocked = false;

/**
 * Handles messages from popup and content scripts.
 */
runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    handleMessage(message as MessageType)
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

  // Create wallet from mnemonic
  const result = await createWalletFromMnemonic(pendingMnemonic, password, true);

  // Clear pending mnemonic
  pendingMnemonic = null;

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

  return createWalletFromMnemonic(mnemonic, password, true);
}

/**
 * Core wallet creation from mnemonic.
 */
async function createWalletFromMnemonic(
  mnemonic: string,
  password: string,
  backupConfirmed: boolean
): Promise<MessageResponse<{ created: boolean; assets: AssetType[] }>> {
  // Derive all keys from mnemonic
  const derivedKeys = deriveAllKeys(mnemonic);

  // Encrypt mnemonic for storage
  const mnemonicBytes = new TextEncoder().encode(mnemonic);
  const { encrypted: encryptedMnemonic, salt: mnemonicSalt } = await encryptPrivateKey(mnemonicBytes, password);

  // Build wallet state
  const state: WalletState = {
    ...DEFAULT_WALLET_STATE,
    encryptedSeed: encryptedMnemonic,
    seedSalt: mnemonicSalt,
    backupConfirmed,
    walletBirthday: Date.now(),
  };

  const assets: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

  // Store BTC key
  const btcPub = getPublicKey(derivedKeys.btc.privateKey);
  const { encrypted: btcEnc, salt: btcSalt } = await encryptPrivateKey(derivedKeys.btc.privateKey, password);
  state.keys.btc = {
    asset: 'btc',
    publicKey: bytesToHex(btcPub),
    privateKey: btcEnc,
    privateKeySalt: btcSalt,
    createdAt: Date.now(),
  };
  unlockedKeys.set('btc', derivedKeys.btc.privateKey);

  // Store LTC key
  const ltcPub = getPublicKey(derivedKeys.ltc.privateKey);
  const { encrypted: ltcEnc, salt: ltcSalt } = await encryptPrivateKey(derivedKeys.ltc.privateKey, password);
  state.keys.ltc = {
    asset: 'ltc',
    publicKey: bytesToHex(ltcPub),
    privateKey: ltcEnc,
    privateKeySalt: ltcSalt,
    createdAt: Date.now(),
  };
  unlockedKeys.set('ltc', derivedKeys.ltc.privateKey);

  // Store XMR keys
  const { encrypted: xmrSpendEnc, salt: xmrSpendSalt } = await encryptPrivateKey(derivedKeys.xmr.privateSpendKey, password);
  const { encrypted: xmrViewEnc, salt: xmrViewSalt } = await encryptPrivateKey(derivedKeys.xmr.privateViewKey, password);
  state.keys.xmr = {
    asset: 'xmr',
    publicKey: bytesToHex(derivedKeys.xmr.publicSpendKey), // Primary public key
    privateKey: xmrSpendEnc,
    privateKeySalt: xmrSpendSalt,
    publicSpendKey: bytesToHex(derivedKeys.xmr.publicSpendKey),
    publicViewKey: bytesToHex(derivedKeys.xmr.publicViewKey),
    privateViewKey: xmrViewEnc,
    privateViewKeySalt: xmrViewSalt,
    createdAt: Date.now(),
  };
  unlockedKeys.set('xmr', derivedKeys.xmr.privateSpendKey);

  // Store WOW keys
  const { encrypted: wowSpendEnc, salt: wowSpendSalt } = await encryptPrivateKey(derivedKeys.wow.privateSpendKey, password);
  const { encrypted: wowViewEnc, salt: wowViewSalt } = await encryptPrivateKey(derivedKeys.wow.privateViewKey, password);
  state.keys.wow = {
    asset: 'wow',
    publicKey: bytesToHex(derivedKeys.wow.publicSpendKey),
    privateKey: wowSpendEnc,
    privateKeySalt: wowSpendSalt,
    publicSpendKey: bytesToHex(derivedKeys.wow.publicSpendKey),
    publicViewKey: bytesToHex(derivedKeys.wow.publicViewKey),
    privateViewKey: wowViewEnc,
    privateViewKeySalt: wowViewSalt,
    createdAt: Date.now(),
  };
  unlockedKeys.set('wow', derivedKeys.wow.privateSpendKey);

  // Store Grin key
  const { encrypted: grinEnc, salt: grinSalt } = await encryptPrivateKey(derivedKeys.grin.privateKey, password);
  state.keys.grin = {
    asset: 'grin',
    publicKey: '', // Grin doesn't have traditional public keys
    privateKey: grinEnc,
    privateKeySalt: grinSalt,
    createdAt: Date.now(),
  };
  unlockedKeys.set('grin', derivedKeys.grin.privateKey);

  await saveWalletState(state);
  isUnlocked = true;

  // Register with backend (non-blocking - wallet works offline too)
  registerWithBackend(state).catch((err) => {
    console.warn('Failed to register with backend:', err);
    // Continue working - we can retry later
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
  // Grin doesn't have traditional public keys, skip for now

  if (keys.length === 0) {
    console.warn('No keys to register with backend');
    return;
  }

  const result = await api.extensionRegister({
    keys,
    walletBirthday: state.walletBirthday,
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

    for (const asset of Object.keys(state.keys) as AssetType[]) {
      const assetKey = state.keys[asset];
      if (assetKey) {
        const privateKey = await decryptPrivateKey(
          assetKey.privateKey,
          assetKey.privateKeySalt,
          password
        );
        unlockedKeys.set(asset, privateKey);
      }
    }

    isUnlocked = true;
    return { success: true, data: { unlocked: true } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

async function handleLockWallet(): Promise<MessageResponse<{ locked: boolean }>> {
  unlockedKeys.clear();
  isUnlocked = false;
  return { success: true, data: { locked: true } };
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

async function handleGetBalance(
  _asset: AssetType
): Promise<MessageResponse<{ balance: string }>> {
  // TODO: Implement balance fetching from nodes
  return { success: true, data: { balance: '0' } };
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

// Listen for extension installation
runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Smirk Wallet installed');
  }
});

// Initialize on startup - load auth state
async function initializeBackground() {
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

initializeBackground().catch(console.error);

console.log('Smirk Wallet background service worker started');
