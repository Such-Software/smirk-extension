/**
 * Wallet Restoration Module
 *
 * Handles restoring wallet from existing mnemonic.
 * Validates that the wallet was previously created in Smirk.
 */

import type { MessageResponse, AssetType } from '@/types';
import { getPublicKey, bytesToHex } from '@/lib/crypto';
import {
  isValidMnemonic,
  deriveAllKeys,
  computeSeedFingerprint,
} from '@/lib/hd';
import { saveOnboardingState, clearOnboardingState } from '@/lib/storage';
import { api } from '@/lib/api';
import { createWalletFromMnemonic } from './create';

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
  // Try v3 first (correct SLIP-10), then v2 (buggy), then v1 (legacy custom)
  const fingerprint = computeSeedFingerprint(mnemonic);

  function buildKeysToCheck(version: 1 | 2 | 3) {
    const dk = deriveAllKeys(mnemonic, '', version);
    return [
      { asset: 'btc', publicKey: bytesToHex(getPublicKey(dk.btc.privateKey)) },
      { asset: 'ltc', publicKey: bytesToHex(getPublicKey(dk.ltc.privateKey)) },
      { asset: 'xmr', publicKey: bytesToHex(dk.xmr.publicSpendKey) },
      { asset: 'wow', publicKey: bytesToHex(dk.wow.publicSpendKey) },
      { asset: 'grin', publicKey: bytesToHex(dk.grin.publicKey) },
    ];
  }

  // Try v3 first (correct 5-level SLIP-10)
  let checkResult = await api.checkRestore({ fingerprint, keys: buildKeysToCheck(3) });
  let restoredVersion: 1 | 2 | 3 = 3;

  // If v3 keys don't match, try v2 (buggy 3-level SLIP-10)
  if (checkResult.data?.exists && checkResult.data.keysValid === false) {
    console.log('v3 keys did not match, trying v2 derivation...');
    checkResult = await api.checkRestore({ fingerprint, keys: buildKeysToCheck(2) });
    restoredVersion = 2;
  }

  // If v2 keys don't match, try v1 (legacy custom)
  if (checkResult.data?.exists && checkResult.data.keysValid === false) {
    console.log('v2 keys did not match, trying v1 legacy derivation...');
    checkResult = await api.checkRestore({ fingerprint, keys: buildKeysToCheck(1) });
    restoredVersion = 1;
  }

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
  // Use the derivation version that matched during restore check
  const result = await createWalletFromMnemonic(mnemonic, password, true, true, restoreHeights, restoredVersion);

  // Clear onboarding state on success
  if (result.success) {
    await clearOnboardingState();
  }

  return result;
}
