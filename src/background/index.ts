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
  generatePrivateKey,
  getPublicKey,
  encryptPrivateKey,
  decryptPrivateKey,
  decryptTipPayload,
  decryptPublicTipPayload,
  decodeUrlFragmentKey,
  bytesToHex,
} from '@/lib/crypto';
import { getWalletState, saveWalletState, DEFAULT_WALLET_STATE } from '@/lib/storage';
import { api } from '@/lib/api';

// Pending claim data from content script
let pendingClaim: { linkId: string; fragmentKey?: string } | null = null;

// In-memory decrypted keys (cleared on lock)
let unlockedKeys: Map<AssetType, Uint8Array> = new Map();
let isUnlocked = false;
let passwordSalt: string | null = null;

/**
 * Handles messages from popup and content scripts.
 */
chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse: (response: MessageResponse) => void) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: MessageType): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_WALLET_STATE':
      return handleGetWalletState();

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

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function handleGetWalletState(): Promise<MessageResponse<{
  isUnlocked: boolean;
  hasWallet: boolean;
  assets: AssetType[];
}>> {
  const state = await getWalletState();
  const hasWallet = !!state.encryptedSeed;
  const assets = (Object.keys(state.keys) as AssetType[]).filter(
    (k) => state.keys[k] !== undefined
  );

  return {
    success: true,
    data: { isUnlocked, hasWallet, assets },
  };
}

async function handleCreateWallet(password: string): Promise<MessageResponse<{
  created: boolean;
  assets: AssetType[];
}>> {
  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  // Generate keys for each asset type
  const state: WalletState = { ...DEFAULT_WALLET_STATE };
  const assets: AssetType[] = ['btc', 'ltc']; // Start with BTC and LTC

  for (const asset of assets) {
    const privateKey = generatePrivateKey();
    const publicKey = getPublicKey(privateKey);

    const { encrypted, salt } = await encryptPrivateKey(privateKey, password);

    state.keys[asset] = {
      asset,
      publicKey: bytesToHex(publicKey),
      privateKey: encrypted,
      createdAt: Date.now(),
    };

    // Store salt for unlocking
    if (!passwordSalt) {
      passwordSalt = salt;
      state.encryptedSeed = salt; // Use salt as marker that wallet exists
    }

    // Keep unlocked in memory
    unlockedKeys.set(asset, privateKey);
  }

  await saveWalletState(state);
  isUnlocked = true;

  return { success: true, data: { created: true, assets } };
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
      state.encryptedSeed,
      password
    );

    // Password correct - decrypt all keys
    unlockedKeys.clear();

    for (const asset of Object.keys(state.keys) as AssetType[]) {
      const assetKey = state.keys[asset];
      if (assetKey) {
        const privateKey = await decryptPrivateKey(
          assetKey.privateKey,
          state.encryptedSeed,
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
  chrome.notifications.create({
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

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Smirk Wallet installed');
  }
});

console.log('Smirk Wallet background service worker started');
