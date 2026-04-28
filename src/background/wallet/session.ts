/**
 * Wallet Session Module
 *
 * Handles wallet unlock/lock operations and authentication state.
 */

import type { MessageResponse, WalletState, AssetType } from '@/types';
import {
  getPublicKey,
  decryptPrivateKey,
  deriveKeyFromPassword,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LEGACY,
  bytesToHex,
  encrypt,
  randomBytes,
} from '@/lib/crypto';
import { hexToBytes } from '@/lib/address';
import {
  deriveAllKeys,
  computeSeedFingerprint,
  mnemonicToSeed,
} from '@/lib/hd';
import {
  getWalletState,
  saveWalletState,
  getAuthState,
  saveAuthState,
} from '@/lib/storage';
import { api } from '@/lib/api';
import {
  setIsUnlocked,
  unlockedKeys,
  unlockedViewKeys,
  setUnlockedSeed,
  unlockedSeed,
  unlockedMnemonic,
  setUnlockedMnemonic,
  persistSessionKeys,
  clearSessionKeys,
  clearInMemoryKeys,
} from '../state';
import { startAutoLockTimer, stopAutoLockTimer } from '../settings';
import { registerWithBackend, registerWithLwsFromUnlockedKeys, reconcileUserKeys } from './registration';
import { getAddressForAsset } from './addresses';

// =============================================================================
// Unlock
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

  // Use stored iterations or default to legacy 100K for old wallets
  const iterations = state.pbkdf2Iterations || PBKDF2_ITERATIONS_LEGACY;

  try {
    const key = state.keys[firstAsset]!;
    const decrypted = await decryptPrivateKey(
      key.privateKey,
      key.privateKeySalt,
      password,
      iterations
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
          password,
          iterations
        );
        unlockedKeys.set(asset, privateKey);

        // Also decrypt view keys for XMR/WOW (needed for balance queries)
        if ((asset === 'xmr' || asset === 'wow') && assetKey.privateViewKey && assetKey.privateViewKeySalt) {
          const viewKey = await decryptPrivateKey(
            assetKey.privateViewKey,
            assetKey.privateViewKeySalt,
            password,
            iterations
          );
          unlockedViewKeys.set(asset, viewKey);
        }
      }
    }

    // Decrypt mnemonic for Grin WASM operations (MWC Seed class needs the mnemonic, not BIP39 seed)
    if (state.encryptedSeed && state.seedSalt) {
      try {
        const mnemonicBytes = await decryptPrivateKey(state.encryptedSeed, state.seedSalt, password, iterations);
        setUnlockedMnemonic(new TextDecoder().decode(mnemonicBytes));
      } catch (err) {
        console.warn('Failed to decrypt mnemonic:', err);
      }
    }

    // Decrypt BIP39 seed (kept for backwards compatibility with other operations)
    if (state.encryptedBip39Seed && state.seedSalt) {
      try {
        setUnlockedSeed(await decryptPrivateKey(state.encryptedBip39Seed, state.seedSalt, password, iterations));
      } catch (err) {
        console.warn('Failed to decrypt BIP39 seed:', err);
      }
    }

    // If wallet is v2+ but encrypted keys are still v1 (migration updated public keys
    // but not encrypted private keys), re-derive correct keys from mnemonic and replace in-memory.
    if (state.derivationVersion && state.derivationVersion >= 2 && unlockedMnemonic) {
      try {
        const vKeys = deriveAllKeys(unlockedMnemonic, '', state.derivationVersion);
        // Replace XMR/WOW private keys with correct version derivation
        unlockedKeys.set('xmr', vKeys.xmr.privateSpendKey);
        unlockedKeys.set('wow', vKeys.wow.privateSpendKey);
        unlockedKeys.set('grin', vKeys.grin.privateKey);
        unlockedViewKeys.set('xmr', vKeys.xmr.privateViewKey);
        unlockedViewKeys.set('wow', vKeys.wow.privateViewKey);

        // Always ensure ALL public keys match current version derivation
        if (state.keys.xmr) {
          state.keys.xmr.publicKey = bytesToHex(vKeys.xmr.publicSpendKey);
          state.keys.xmr.publicSpendKey = bytesToHex(vKeys.xmr.publicSpendKey);
          state.keys.xmr.publicViewKey = bytesToHex(vKeys.xmr.publicViewKey);
        }
        if (state.keys.wow) {
          state.keys.wow.publicKey = bytesToHex(vKeys.wow.publicSpendKey);
          state.keys.wow.publicSpendKey = bytesToHex(vKeys.wow.publicSpendKey);
          state.keys.wow.publicViewKey = bytesToHex(vKeys.wow.publicViewKey);
        }
        if (state.keys.grin) {
          state.keys.grin.publicKey = bytesToHex(vKeys.grin.publicKey);
        }
        await saveWalletState(state);

        console.log(`[Unlock] Re-derived v${state.derivationVersion} keys from mnemonic`);
      } catch (err) {
        console.warn('[Unlock] Failed to re-derive versioned keys:', err);
      }
    }

    // Auto-upgrade PBKDF2 iterations from legacy 100K to 600K
    if (!state.pbkdf2Iterations || state.pbkdf2Iterations < PBKDF2_ITERATIONS) {
      try {
        console.log(`[PBKDF2] Upgrading iterations from ${iterations} to ${PBKDF2_ITERATIONS}`);
        const newSalt = randomBytes(16);
        const newKey = await deriveKeyFromPassword(password, newSalt, PBKDF2_ITERATIONS);
        const newSaltHex = bytesToHex(newSalt);
        const reencrypt = (data: Uint8Array) => bytesToHex(encrypt(data, newKey));

        // Re-encrypt mnemonic
        if (unlockedMnemonic) {
          state.encryptedSeed = reencrypt(new TextEncoder().encode(unlockedMnemonic));
        }

        // Re-encrypt BIP39 seed
        if (unlockedSeed) {
          state.encryptedBip39Seed = reencrypt(unlockedSeed);
        }

        // Re-encrypt all asset keys
        for (const asset of Object.keys(state.keys) as AssetType[]) {
          const pk = unlockedKeys.get(asset);
          if (pk && state.keys[asset]) {
            state.keys[asset]!.privateKey = reencrypt(pk);
            state.keys[asset]!.privateKeySalt = newSaltHex;
          }
          const vk = unlockedViewKeys.get(asset as 'xmr' | 'wow');
          if (vk && state.keys[asset]) {
            state.keys[asset]!.privateViewKey = reencrypt(vk);
            state.keys[asset]!.privateViewKeySalt = newSaltHex;
          }
        }

        state.seedSalt = newSaltHex;
        state.pbkdf2Iterations = PBKDF2_ITERATIONS;
        await saveWalletState(state);
        console.log('[PBKDF2] Upgrade complete');
      } catch (err) {
        console.warn('[PBKDF2] Upgrade failed, will retry on next unlock:', err);
      }
    }

    // Migration: derive Grin key and BIP39 seed if missing (for wallets created before Grin support)
    if ((!state.keys.grin || !state.encryptedBip39Seed) && unlockedMnemonic) {
      try {
        // Derive encryption key from password
        const saltBytes = hexToBytes(state.seedSalt!);
        const currentIterations = state.pbkdf2Iterations || PBKDF2_ITERATIONS;
        const encKey = await deriveKeyFromPassword(password, saltBytes, currentIterations);
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
          const walletVersion = state.derivationVersion || 1;
          const derivedKeysAll = deriveAllKeys(unlockedMnemonic, '', walletVersion);
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

    // Always re-register LWS addresses on unlock (non-blocking).
    // This ensures the backend has the correct address even if the wallet
    // was restored with a different seed while auth was still valid.
    const authState = await getAuthState();
    if (authState?.userId) {
      registerWithLwsFromUnlockedKeys(authState.userId, state)
        .then(() => console.log('LWS registration verified on unlock'))
        .catch(err => console.warn('LWS registration on unlock failed (non-fatal):', err));

      // Reconcile user_keys with backend if drifted (throttled to 24h).
      // Self-heals legacy desync from past derivation bugs.
      reconcileUserKeys(state, authState.userId);
    }

    return { success: true, data: { unlocked: true } };
  } catch {
    return { success: false, error: 'Invalid password' };
  }
}

// =============================================================================
// Lock
// =============================================================================

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
// Auth Management
// =============================================================================

/**
 * Ensure we have valid auth tokens.
 *
 * Checks existing auth state and either:
 * 1. Refreshes expired token
 * 2. Re-registers if no auth or refresh fails
 *
 * Includes retry logic for failed registrations (e.g., temporary network issues).
 */
export async function ensureValidAuth(state: WalletState): Promise<void> {
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

  // No valid auth - re-register with backend (with retry)
  console.log('No valid auth, re-registering with backend...');

  // Compute seed fingerprint if we have the mnemonic
  const seedFingerprint = unlockedMnemonic ? computeSeedFingerprint(unlockedMnemonic) : undefined;

  // Retry up to 3 times with exponential backoff
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  let userId: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      userId = await registerWithBackend(state, seedFingerprint);
      console.log('Re-registration successful');
      break;
    } catch (err) {
      console.error(`Re-registration attempt ${attempt}/${maxRetries} failed:`, err);

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }

  // Note: LWS registration is handled separately on every unlock
  // (not just on re-registration) to catch address changes from restores.
}
