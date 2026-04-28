/**
 * Wallet Registration Module
 *
 * Handles registration with backend and LWS (Light Wallet Server).
 * These are internal functions used by create and session modules.
 */

import type { WalletState } from '@/types';
import { bytesToHex, signBitcoinMessage } from '@/lib/crypto';
import { saveAuthState } from '@/lib/storage';
import { storage } from '@/lib/browser';
import { api } from '@/lib/api';
import { unlockedKeys, unlockedViewKeys } from '../state';
import { getAddressForAsset } from './addresses';
import type { DerivedKeys } from './types';

const RECONCILE_KEY = 'lastUserKeysReconcile';
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Register with backend with retry logic.
 *
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * Used during initial wallet creation to handle temporary network issues.
 */
export async function registerWithBackendRetry(
  state: WalletState,
  seedFingerprint?: string
): Promise<string> {
  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await registerWithBackend(state, seedFingerprint);
    } catch (err) {
      console.error(`Backend registration attempt ${attempt}/${maxRetries} failed:`, err);

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Retrying registration in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Registration failed after all retries');
}

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
export async function registerWithBackend(state: WalletState, seedFingerprint?: string): Promise<string> {
  // Collect all public keys
  const keys: Array<{ asset: string; publicKey: string; publicSpendKey?: string }> = [];

  if (state.keys.btc) {
    keys.push({ asset: 'btc', publicKey: state.keys.btc.publicKey });
  }
  if (state.keys.ltc) {
    keys.push({ asset: 'ltc', publicKey: state.keys.ltc.publicKey });
  }
  if (state.keys.xmr) {
    keys.push({
      asset: 'xmr',
      publicKey: state.keys.xmr.publicSpendKey || state.keys.xmr.publicKey,
    });
  }
  if (state.keys.wow) {
    keys.push({
      asset: 'wow',
      publicKey: state.keys.wow.publicSpendKey || state.keys.wow.publicKey,
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

  // Sign timestamp to prove ownership of BTC private key
  const btcPrivateKey = unlockedKeys.get('btc');
  if (!btcPrivateKey) {
    throw new Error('BTC private key not available - wallet must be unlocked');
  }

  const signedTimestamp = Math.floor(Date.now() / 1000);
  const message = `smirk-auth-${signedTimestamp}`;
  const signature = signBitcoinMessage(message, btcPrivateKey);

  const result = await api.extensionRegister({
    keys,
    walletBirthday: state.walletBirthday?.timestamp,
    seedFingerprint,
    xmrStartHeight: state.walletBirthday?.heights?.xmr,
    wowStartHeight: state.walletBirthday?.heights?.wow,
    signedTimestamp,
    signature,
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
 * Register XMR/WOW with LWS using already-unlocked view keys.
 *
 * Used by ensureValidAuth when re-registering after failed initial registration.
 * Uses the unlockedViewKeys Map which is populated during wallet unlock.
 *
 * @param userId - User ID from backend registration
 * @param state - Wallet state with public keys
 */
export async function registerWithLwsFromUnlockedKeys(
  userId: string,
  state: WalletState
): Promise<void> {
  // Use wallet birthday heights so LWS scans from creation, not just current block.
  // Critical after migration: sweep tx would be missed without scanning back far enough.
  const xmrStartHeight = state.walletBirthday?.heights?.xmr;
  const wowStartHeight = state.walletBirthday?.heights?.wow;

  // Register XMR with LWS
  if (state.keys.xmr?.publicSpendKey && state.keys.xmr?.publicViewKey) {
    const xmrViewKey = unlockedViewKeys.get('xmr');
    if (xmrViewKey) {
      const xmrAddress = getAddressForAsset('xmr', state.keys.xmr);
      const xmrResult = await api.registerLws(userId, 'xmr', xmrAddress, bytesToHex(xmrViewKey), xmrStartHeight);
      if (xmrResult.error) {
        console.warn('Failed to register XMR with LWS:', xmrResult.error);
      } else {
        console.log('XMR registered with LWS:', xmrResult.data?.message,
          xmrStartHeight ? `(start_height: ${xmrStartHeight})` : '(from current)');
      }
    } else {
      console.warn('XMR view key not available for LWS registration');
    }
  }

  // Register WOW with LWS
  if (state.keys.wow?.publicSpendKey && state.keys.wow?.publicViewKey) {
    const wowViewKey = unlockedViewKeys.get('wow');
    if (wowViewKey) {
      const wowAddress = getAddressForAsset('wow', state.keys.wow);
      const wowResult = await api.registerLws(userId, 'wow', wowAddress, bytesToHex(wowViewKey), wowStartHeight);
      if (wowResult.error) {
        console.warn('Failed to register WOW with LWS:', wowResult.error);
      } else {
        console.log('WOW registered with LWS:', wowResult.data?.message,
          wowStartHeight ? `(start_height: ${wowStartHeight})` : '(from current)');
      }
    } else {
      console.warn('WOW view key not available for LWS registration');
    }
  }
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
export async function registerWithLws(
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

/**
 * Reconcile backend `user_keys.public_key` against the locally-derived
 * public spend key. If they drift (which is possible after past derivation
 * bugs, or if a future bug ever desyncs them), silently call /auth/migrate-keys
 * with the current correct values. Throttled to once per 24h to avoid
 * hammering the endpoint on every unlock.
 *
 * Failures are non-fatal — wallet keeps working, we'll just retry next time.
 */
export async function reconcileUserKeys(state: WalletState, userId: string): Promise<void> {
  try {
    const last = await storage.local.get(RECONCILE_KEY);
    const lastRun = (last as Record<string, number>)[RECONCILE_KEY] ?? 0;
    if (Date.now() - lastRun < RECONCILE_INTERVAL_MS) return;

    const result = await api.getUserKeys(userId);
    if (!result.data) {
      console.warn('reconcileUserKeys: getUserKeys failed:', result.error);
      return;
    }
    // Backend response is snake_case; the typed interface above is aspirational
    // (the API client doesn't transform). Cast to the actual wire shape.
    const stored = ((result.data as unknown) as {
      keys?: Array<{ asset: string; public_key: string }>;
    }).keys ?? [];
    const findStored = (asset: string) => stored.find((k) => k.asset === asset);

    const drifted: Array<{
      asset: string;
      public_key: string;
      address?: string;
      view_key?: string;
    }> = [];

    for (const asset of ['xmr', 'wow'] as const) {
      const localKey = state.keys[asset];
      if (!localKey) continue;
      const localPub = localKey.publicSpendKey || localKey.publicKey;
      const storedKey = findStored(asset);
      if (!storedKey || storedKey.public_key !== localPub) {
        const viewKey = unlockedViewKeys.get(asset);
        drifted.push({
          asset,
          public_key: localPub,
          address: getAddressForAsset(asset, localKey),
          view_key: viewKey ? bytesToHex(viewKey) : undefined,
        });
      }
    }

    const grinLocal = state.keys.grin?.publicKey;
    const grinStored = findStored('grin');
    if (grinLocal && (!grinStored || grinStored.public_key !== grinLocal)) {
      drifted.push({ asset: 'grin', public_key: grinLocal });
    }

    if (drifted.length === 0) {
      // Already in sync — record timestamp so we skip until next interval
      await storage.local.set({ [RECONCILE_KEY]: Date.now() });
      return;
    }

    console.log(
      'reconcileUserKeys: backend keys drifted, re-uploading:',
      drifted.map(d => d.asset).join(', '),
    );
    const migrateResult = await api.migrateKeys(drifted);
    if (migrateResult.error) {
      console.warn('reconcileUserKeys: migrateKeys failed:', migrateResult.error);
      return;
    }
    await storage.local.set({ [RECONCILE_KEY]: Date.now() });
    console.log('reconcileUserKeys: backend keys reconciled');
  } catch (err) {
    console.warn('reconcileUserKeys: unexpected error (non-fatal):', err);
  }
}
