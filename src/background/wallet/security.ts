/**
 * Wallet Security Module
 *
 * Handles sensitive operations:
 * - Seed phrase reveal
 * - Seed fingerprint
 * - Password change
 */

import type { MessageResponse, AssetType } from '@/types';
import {
  decryptPrivateKey,
  deriveKeyFromPassword,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LEGACY,
  bytesToHex,
  encrypt,
  randomBytes,
} from '@/lib/crypto';
import {
  isValidMnemonic,
  deriveAllKeys,
  computeSeedFingerprint,
  mnemonicToSeed,
} from '@/lib/hd';
import { getWalletState, saveWalletState } from '@/lib/storage';
import { handleLockWallet } from './session';

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
    const iterations = state.pbkdf2Iterations || PBKDF2_ITERATIONS_LEGACY;
    const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, password, iterations);
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
// Seed Fingerprint
// =============================================================================

/**
 * Get the seed fingerprint for the current wallet.
 *
 * Requires password to decrypt the mnemonic and compute the fingerprint.
 *
 * @param password - Wallet password
 * @returns Seed fingerprint (64 hex chars, 256 bits)
 */
export async function handleGetFingerprint(password: string): Promise<MessageResponse<{ fingerprint: string }>> {
  const state = await getWalletState();

  if (!state.encryptedSeed || !state.seedSalt) {
    return { success: false, error: 'No wallet found' };
  }

  try {
    const iterations = state.pbkdf2Iterations || PBKDF2_ITERATIONS_LEGACY;
    const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, password, iterations);
    const mnemonic = new TextDecoder().decode(mnemonicBytes);
    const fingerprint = computeSeedFingerprint(mnemonic);
    return { success: true, data: { fingerprint } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

// =============================================================================
// Password Change
// =============================================================================

/**
 * Change the wallet password.
 *
 * Decrypts all encrypted data with old password and re-encrypts with new password.
 *
 * @param oldPassword - Current wallet password
 * @param newPassword - New wallet password
 * @returns Success status
 */
export async function handleChangePassword(
  oldPassword: string,
  newPassword: string
): Promise<MessageResponse<{ changed: boolean }>> {
  if (!newPassword || newPassword.length < 1) {
    return { success: false, error: 'New password cannot be empty' };
  }

  const state = await getWalletState();

  if (!state.encryptedSeed || !state.seedSalt) {
    return { success: false, error: 'No wallet found' };
  }

  try {
    // Decrypt mnemonic with old password to verify it's correct
    const oldIterations = state.pbkdf2Iterations || PBKDF2_ITERATIONS_LEGACY;
    const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, oldPassword, oldIterations);
    const mnemonic = new TextDecoder().decode(mnemonicBytes);

    // Verify it's a valid mnemonic
    if (!isValidMnemonic(mnemonic)) {
      return { success: false, error: 'Invalid password' };
    }

    // Generate new salt and derive new encryption key (always use latest iterations)
    const newSalt = randomBytes(16);
    const newSaltHex = bytesToHex(newSalt);
    const newEncryptionKey = await deriveKeyFromPassword(newPassword, newSalt, PBKDF2_ITERATIONS);
    const encryptWithNewKey = (data: Uint8Array): string => bytesToHex(encrypt(data, newEncryptionKey));

    // Re-encrypt mnemonic
    state.encryptedSeed = encryptWithNewKey(mnemonicBytes);
    state.seedSalt = newSaltHex;

    // Re-encrypt BIP39 seed if present
    if (state.encryptedBip39Seed) {
      const bip39Seed = mnemonicToSeed(mnemonic);
      state.encryptedBip39Seed = encryptWithNewKey(bip39Seed);
    }

    // Re-encrypt all keys (use the wallet's derivation version)
    const walletVersion = state.derivationVersion || 1;
    const derivedKeys = deriveAllKeys(mnemonic, '', walletVersion);

    for (const asset of Object.keys(state.keys) as AssetType[]) {
      const key = state.keys[asset];
      if (!key) continue;

      const assetKeys = derivedKeys[asset];
      if (!assetKeys) continue;

      // Handle different key structures per asset type
      if (asset === 'xmr' || asset === 'wow') {
        // CryptonoteKeys: privateSpendKey + privateViewKey
        const cryptoKeys = assetKeys as { privateSpendKey: Uint8Array; privateViewKey: Uint8Array };
        key.privateKey = encryptWithNewKey(cryptoKeys.privateSpendKey);
        key.privateKeySalt = newSaltHex;
        if (key.privateViewKey) {
          key.privateViewKey = encryptWithNewKey(cryptoKeys.privateViewKey);
          key.privateViewKeySalt = newSaltHex;
        }
      } else {
        // BTC/LTC/Grin: privateKey
        const simpleKeys = assetKeys as { privateKey: Uint8Array };
        key.privateKey = encryptWithNewKey(simpleKeys.privateKey);
        key.privateKeySalt = newSaltHex;
      }
    }

    // Update PBKDF2 iterations to latest
    state.pbkdf2Iterations = PBKDF2_ITERATIONS;

    // Save the updated state
    await saveWalletState(state);

    // Lock the wallet to force re-authentication with new password
    await handleLockWallet();

    return { success: true, data: { changed: true } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}
