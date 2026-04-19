/**
 * Grin WASM Helpers
 *
 * Shared helper functions for all Grin operations:
 * - WASM module access
 * - Key initialization
 * - Authentication checks
 * - Output fetching
 */

// Static import — import() is blocked in Chrome MV3 service workers.
// The Grin WASM modules use fetch()+initSync(), not DOM APIs, so static import is safe.
import * as grinModule from '@/lib/grin';
import type { GrinKeys, GrinOutput } from '@/lib/grin';
import { getAuthState } from '@/lib/storage';
import { api } from '@/lib/api';
import {
  isUnlocked,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedMnemonic,
} from '../state';

/** Return Grin module. Callers may `await` this — it's a no-op but harmless. */
export function getGrinModule() {
  return grinModule;
}

/** Legacy MWC derivation path for migration sweeps */
export const LEGACY_MWC_PATH = new Uint32Array([
  44 | 0x80000000, 593 | 0x80000000, 0 | 0x80000000, 0, 0,
]);

/**
 * Init Grin wallet at a specific derivation path.
 * Calls initGrinWallet which initializes WASM, then reinits at specified path
 * using the Seed class's pathOverride parameter.
 */
export async function initGrinWalletAtPath(mnemonic: string, path: Uint32Array): Promise<GrinKeys> {
  // Just initialize WASM modules — do NOT create a Seed at the default path
  // (calling initGrinWallet would create a Seed at the new path, potentially
  // corrupting global Seed state that affects subsequent derivations)
  await grinModule.initializeGrinWasm();

  // Now the WASM modules are loaded. Get the internal module references.
  // The Seed class is available on globalThis after WASM init.
  const Seed = (globalThis as Record<string, unknown>).Seed as {
    new(): { initialize(m: string): Promise<void>; getExtendedPrivateKey(k: string, b: boolean, s?: unknown, p?: Uint32Array): Promise<Uint8Array> };
  };
  const Crypto = (globalThis as Record<string, unknown>).Crypto as {
    addressKey(k: Uint8Array, i: number): Promise<Uint8Array>;
  };
  const Secp256k1Zkp = (globalThis as Record<string, unknown>).Secp256k1Zkp as {
    publicKeyFromSecretKey(k: Uint8Array): Uint8Array | number;
    OPERATION_FAILED: number;
  };
  const Ed25519 = (globalThis as Record<string, unknown>).Ed25519 as {
    publicKeyFromSecretKey(k: Uint8Array): Uint8Array | number;
    OPERATION_FAILED: number;
  };
  const bech32Lib = (globalThis as Record<string, unknown>).bech32 as {
    toWords(d: Uint8Array): number[];
    encode(p: string, w: number[], l: number): string;
  };

  const seedInstance = new Seed();
  await seedInstance.initialize(mnemonic);
  // CRITICAL: pass empty Uint8Array as bip39Salt (Seed.DEFAULT_BIP39_SALT),
  // NOT undefined — undefined corrupts the salt computation and changes all derived keys
  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    (globalThis as Record<string, unknown>).Wallet ? ((globalThis as Record<string, unknown>).Wallet as Record<string, string>).SEED_KEY : 'IamVoldemort',
    true,
    new Uint8Array([]), // DEFAULT_BIP39_SALT
    path
  );

  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) throw new Error('Failed to derive public key');

  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) throw new Error('Failed to derive Ed25519 public key');

  const words = bech32Lib.toWords(ed25519PublicKey as Uint8Array);
  const slatepackAddress = bech32Lib.encode('grin', words, 1023);

  return { secretKey, publicKey: publicKey as Uint8Array, slatepackAddress, extendedPrivateKey, addressKey };
}

// =============================================================================
// Key Initialization
// =============================================================================

/**
 * Ensure Grin WASM keys are initialized.
 *
 * Returns cached keys if available, otherwise initializes from mnemonic.
 * Always uses the new grin-wallet standard path m/0/0/0/0/0.
 *
 * @returns Initialized GrinKeys
 * @throws Error if wallet is locked or mnemonic unavailable
 */
export async function ensureGrinKeysInitialized(): Promise<GrinKeys> {
  if (!isUnlocked) {
    throw new Error('Wallet is locked');
  }

  // Return cached keys if available
  if (grinWasmKeys) {
    return grinWasmKeys;
  }

  // Initialize from mnemonic
  if (!unlockedMnemonic) {
    throw new Error('Mnemonic not available - please re-unlock wallet');
  }

  const keys = await grinModule.initGrinWallet(unlockedMnemonic);
  setGrinWasmKeys(keys);
  return keys;
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Get authenticated user ID.
 *
 * @returns User ID from auth state
 * @throws Error if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<string> {
  const authState = await getAuthState();
  if (!authState?.userId) {
    throw new Error('Not authenticated');
  }
  return authState.userId;
}

// =============================================================================
// Output Management
// =============================================================================

/**
 * Get the next child index for key derivation.
 *
 * CRITICAL: This must be unique across ALL outputs (including spent).
 * Reusing n_child would create duplicate commitments, which the network
 * rejects as a double-spend attempt.
 *
 * @param userId - User ID for API call
 * @returns Next available child index
 */
export async function getNextChildIndex(userId: string): Promise<number> {
  const outputsResult = await api.getGrinOutputs(userId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch outputs: ${outputsResult.error}`);
  }
  return outputsResult.data?.next_child_index ?? 0;
}

/**
 * Fetch unspent outputs for transaction building.
 *
 * Returns outputs in the GrinOutput format needed by WASM functions.
 *
 * @param userId - User ID for API call
 * @returns Object with outputs array and next_child_index
 */
export async function fetchUnspentOutputs(userId: string): Promise<{
  outputs: GrinOutput[];
  nextChildIndex: number;
}> {
  const outputsResult = await api.getGrinOutputs(userId);
  if (outputsResult.error) {
    throw new Error(`Failed to fetch outputs: ${outputsResult.error}`);
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

  return { outputs, nextChildIndex };
}

/**
 * Get current Grin blockchain height.
 *
 * @returns Current block height as BigInt
 * @throws Error if height unavailable
 */
export async function getCurrentBlockHeight(): Promise<bigint> {
  const heightsResult = await api.getBlockchainHeights();
  if (heightsResult.error || !heightsResult.data?.grin) {
    throw new Error('Failed to get blockchain height');
  }
  return BigInt(heightsResult.data.grin);
}
