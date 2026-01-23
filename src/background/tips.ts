/**
 * Tips Module
 *
 * This module handles tip link decryption and claiming:
 * - Decrypt encrypted tips using ECDH
 * - Decrypt public tips using URL fragment key
 * - Claim tips by sweeping funds to wallet
 *
 * Tip Types:
 * 1. Public Tips:
 *    - Key is in URL fragment (#key=...) which is never sent to server
 *    - Anyone with the full link can claim
 *    - Used for general tipping (e.g., content creators)
 *
 * 2. Encrypted Tips (Recipient-Specific):
 *    - Key is encrypted with recipient's public key using ECDH
 *    - Only the intended recipient can decrypt and claim
 *    - Used for targeted tips (e.g., tipping a specific user)
 *
 * ECDH Encryption:
 * - Sender generates ephemeral keypair
 * - Derives shared secret using ECDH: secret = ephemeralPrivate * recipientPublic
 * - Encrypts tip key with shared secret
 * - Recipient decrypts using: secret = recipientPrivate * ephemeralPublic
 */

import type { MessageResponse, TipInfo } from '@/types';
import {
  bytesToHex,
  decryptTipPayload,
  decryptPublicTipPayload,
  decodeUrlFragmentKey,
} from '@/lib/crypto';
import { api } from '@/lib/api';
import { notifications } from '@/lib/browser';
import { isUnlocked, unlockedKeys, pendingClaim, setPendingClaim } from './state';

// =============================================================================
// Tip Decryption
// =============================================================================

/**
 * Decrypt a tip's private key.
 *
 * For encrypted tips: Uses ECDH with our private key and sender's ephemeral pubkey
 * For public tips: Requires the URL fragment key (not handled here)
 *
 * @param tipInfo - Tip metadata including encrypted key and ephemeral pubkey
 * @returns Decrypted tip private key
 */
export async function handleDecryptTip(
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
      // ECDH: shared_secret = recipientPrivate * ephemeralPublic
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
      // This is passed from the content script via handleClaimTip
      return { success: false, error: 'Public tip requires URL fragment key' };
    }

    return { success: true, data: { privateKey: bytesToHex(decryptedKey) } };
  } catch {
    return { success: false, error: 'Failed to decrypt tip' };
  }
}

// =============================================================================
// Claim Popup Management
// =============================================================================

/**
 * Open the claim popup with tip info.
 *
 * Called by content script when it detects a tip link.
 * Stores the tip info and shows a notification prompting
 * user to open the extension.
 *
 * Note: chrome.action.openPopup() requires user gesture in MV3,
 * so we use a notification instead.
 *
 * @param linkId - Backend link ID for the tip
 * @param fragmentKey - URL fragment key for public tips
 * @returns Open status
 */
export async function handleOpenClaimPopup(
  linkId: string,
  fragmentKey?: string
): Promise<MessageResponse<{ opened: boolean }>> {
  // Store pending claim data
  setPendingClaim({ linkId, fragmentKey });

  // Show notification prompting user to open extension
  await notifications.create(undefined, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Tip Ready to Claim!',
    message: 'Click the Smirk Wallet icon to claim your tip.',
  });

  return { success: true, data: { opened: true } };
}

/**
 * Get pending claim data.
 *
 * Called by popup to check if there's a tip waiting to be claimed.
 *
 * @returns Pending claim info or empty
 */
export async function handleGetPendingClaim(): Promise<MessageResponse<{
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

/**
 * Clear pending claim data.
 *
 * Called after claim is processed (success or cancel).
 *
 * @returns Clear status
 */
export function handleClearPendingClaim(): MessageResponse<{ cleared: boolean }> {
  setPendingClaim(null);
  return { success: true, data: { cleared: true } };
}

// =============================================================================
// Tip Info Queries
// =============================================================================

/**
 * Get tip info from backend.
 *
 * Fetches metadata about a tip including:
 * - Asset type and amount
 * - Status (pending, funded, claimed, expired)
 * - Encrypted key data
 * - Sender info (if any)
 *
 * @param linkId - Backend link ID
 * @returns Tip metadata
 */
export async function handleGetTipInfo(
  linkId: string
): Promise<MessageResponse<{ tip: TipInfo }>> {
  const result = await api.getTip(linkId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { tip: result.data! } };
}

// =============================================================================
// Tip Claiming
// =============================================================================

/**
 * Claim a tip by sweeping funds to wallet.
 *
 * Process:
 * 1. Fetch tip info from backend
 * 2. Verify tip is claimable (funded or pending status)
 * 3. Decrypt tip private key
 * 4. Build sweep transaction to our wallet
 * 5. Broadcast transaction
 * 6. Mark as claimed on backend
 *
 * Note: This is currently a stub - actual sweep implementation
 * varies by asset type and requires blockchain interaction.
 *
 * @param linkId - Backend link ID
 * @param fragmentKey - URL fragment key for public tips
 * @returns Claim status and transaction hash
 */
export async function handleClaimTip(
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
  setPendingClaim(null);

  return {
    success: true,
    data: {
      claimed: true,
      // txHash: actualTxHash
    },
  };
}
