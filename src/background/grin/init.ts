/**
 * Grin Wallet Initialization
 *
 * Initialize the Grin WASM wallet from mnemonic.
 */

import type { MessageResponse } from '@/types';
import {
  isUnlocked,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedMnemonic,
  persistSessionKeys,
} from '../state';
import { getGrinModule } from './helpers';
import { getWalletState } from '@/lib/storage';

interface GrinPathResult {
  path: string;
  slatepackAddress: string;
}

/**
 * Test multiple Grin derivation paths and return the slatepack addresses.
 * Used to find which path matches grin-wallet/Grim.
 */
export async function handleGrinTestPaths(): Promise<MessageResponse<{
  results: GrinPathResult[];
}>> {
  if (!isUnlocked || !unlockedMnemonic) {
    return { success: false, error: 'Wallet must be unlocked' };
  }

  const grinModule = await getGrinModule();
  const results: GrinPathResult[] = [];

  // 1. Default path (no explicit path = MWC default for GRIN_WALLET_TYPE = m/44'/592'/0'/0/0)
  try {
    const defaultKeys = await grinModule.initGrinWallet(unlockedMnemonic);
    results.push({ path: 'default (m/44\'/592\'/0\'/0/0)', slatepackAddress: defaultKeys.slatepackAddress });
  } catch (err) {
    results.push({ path: 'default', slatepackAddress: `ERROR: ${err}` });
  }

  // 2. grin-wallet standard path: m/0/0/0/0/0 (non-hardened)
  try {
    const grinWalletPath = new Uint32Array([0, 0, 0, 0, 0]);
    const grinKeys = await grinModule.initGrinWalletAtPath(unlockedMnemonic, grinWalletPath);
    results.push({ path: 'm/0/0/0/0/0 (grin-wallet standard)', slatepackAddress: grinKeys.slatepackAddress });
  } catch (err) {
    results.push({ path: 'm/0/0/0/0/0', slatepackAddress: `ERROR: ${err}` });
  }

  // 3. BIP44 Grin path with all hardened: m/44'/592'/0'/0'/0'
  try {
    const H = 0x80000000;
    const bip44AllHardened = new Uint32Array([44 | H, 592 | H, 0 | H, 0 | H, 0 | H]);
    const bip44Keys = await grinModule.initGrinWalletAtPath(unlockedMnemonic, bip44AllHardened);
    results.push({ path: 'm/44\'/592\'/0\'/0\'/0\' (BIP44 all hardened)', slatepackAddress: bip44Keys.slatepackAddress });
  } catch (err) {
    results.push({ path: 'm/44\'/592\'/0\'/0\'/0\'', slatepackAddress: `ERROR: ${err}` });
  }

  // 4. Legacy MWC path: m/44'/593'/0'/0/0
  try {
    const H = 0x80000000;
    const LEGACY_MWC_PATH = new Uint32Array([44 | H, 593 | H, 0 | H, 0, 0]);
    const mwcKeys = await grinModule.initGrinWalletAtPath(unlockedMnemonic, LEGACY_MWC_PATH);
    results.push({ path: 'm/44\'/593\'/0\'/0/0 (legacy MWC)', slatepackAddress: mwcKeys.slatepackAddress });
  } catch (err) {
    results.push({ path: 'm/44\'/593\'/0\'/0/0', slatepackAddress: `ERROR: ${err}` });
  }

  // 5-10. grin-wallet compatible derivation tests.
  //
  // KEY FINDING: grin-wallet does NOT use BIP39 PBKDF2!
  // - grin-wallet: mnemonic → raw entropy (16 bytes) → HMAC-SHA512("IamVoldemort", entropy)
  // - MWC WASM (useBip39=true): mnemonic → PBKDF2 → 64-byte seed → HMAC-SHA512("IamVoldemort", seed)
  // These produce completely different master keys.
  //
  // MWC Seed class with useBip39=false does: HMAC-SHA512(key, raw_entropy) — matching grin-wallet!
  // Then grin-wallet derives the address key at path m/0/1/0 → BLAKE2b → ed25519.
  try {
    await grinModule.initializeGrinWasm();

    const Seed = (globalThis as Record<string, unknown>).Seed as {
      new(): {
        initialize(m: string): Promise<void>;
        getExtendedPrivateKey(k: string, b: boolean, s?: Uint8Array, p?: Uint32Array): Promise<Uint8Array>;
      };
    };
    const Crypto = (globalThis as Record<string, unknown>).Crypto as {
      deriveChildKey(k: Uint8Array, p: Uint32Array, useBip39?: boolean): Promise<Uint8Array>;
      addressKey(k: Uint8Array, i: number): Promise<Uint8Array>;
    };
    const Blake2b = (globalThis as Record<string, unknown>).Blake2b as {
      compute(len: number, data: Uint8Array, key: Uint8Array): Uint8Array | number;
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

    // Helper: derive slatepack address from extended key at given path → BLAKE2b → ed25519
    const deriveSlatepackAddr = async (extKey: Uint8Array, path: number[]): Promise<string> => {
      const childKey = path.length > 0
        ? await Crypto.deriveChildKey(extKey, new Uint32Array(path))
        : extKey;
      const secretKey = childKey.subarray(0, 32);
      const hashed = Blake2b.compute(32, secretKey, new Uint8Array([]));
      if (hashed === Blake2b.OPERATION_FAILED) throw new Error('BLAKE2b failed');
      const ed25519Pub = Ed25519.publicKeyFromSecretKey(hashed as Uint8Array);
      if (ed25519Pub === Ed25519.OPERATION_FAILED) throw new Error('Ed25519 failed');
      const words = bech32Lib.toWords(ed25519Pub as Uint8Array);
      return bech32Lib.encode('grin', words, 1023);
    };

    // Helper: derive slatepack address using MWC's built-in addressKey
    const deriveViaAddressKey = async (extKey: Uint8Array): Promise<string> => {
      const addrKey = await Crypto.addressKey(extKey, 0);
      const ed25519Pub = Ed25519.publicKeyFromSecretKey(addrKey);
      if (ed25519Pub === Ed25519.OPERATION_FAILED) throw new Error('Ed25519 failed');
      const words = bech32Lib.toWords(ed25519Pub as Uint8Array);
      return bech32Lib.encode('grin', words, 1023);
    };

    const seedInstance = new Seed();
    await seedInstance.initialize(unlockedMnemonic);

    // --- useBip39=false: HMAC-SHA512("IamVoldemort", raw_entropy) = grin-wallet master ---
    const grinMaster = await seedInstance.getExtendedPrivateKey('IamVoldemort', false);

    // 5. grin-wallet: master(no-bip39) → m/0/1/0 → BLAKE2b
    const addr5 = await deriveSlatepackAddr(grinMaster, [0, 1, 0]);
    results.push({ path: 'NO-BIP39 master → m/0/1/0 → BLAKE2b', slatepackAddress: addr5 });

    // 6. grin-wallet: master(no-bip39) → MWC addressKey(0)
    const addr6 = await deriveViaAddressKey(grinMaster);
    results.push({ path: 'NO-BIP39 master → addressKey(0)', slatepackAddress: addr6 });

    // 7. grin-wallet: master(no-bip39) → m/0 → BLAKE2b
    const addr7 = await deriveSlatepackAddr(grinMaster, [0]);
    results.push({ path: 'NO-BIP39 master → m/0 → BLAKE2b', slatepackAddress: addr7 });

    // 8. grin-wallet: master(no-bip39) → no path, just BLAKE2b of master secret key
    const addr8 = await deriveSlatepackAddr(grinMaster, []);
    results.push({ path: 'NO-BIP39 master → BLAKE2b (no child)', slatepackAddress: addr8 });

    // --- useBip39=true with empty path: for comparison ---
    const seedInstance2 = new Seed();
    await seedInstance2.initialize(unlockedMnemonic);
    const bip39Master = await seedInstance2.getExtendedPrivateKey(
      'IamVoldemort', true, new Uint8Array([]), new Uint32Array([])
    );

    // 9. BIP39 master → m/0/1/0 → BLAKE2b (for comparison)
    const addr9 = await deriveSlatepackAddr(bip39Master, [0, 1, 0]);
    results.push({ path: 'BIP39 master → m/0/1/0 → BLAKE2b', slatepackAddress: addr9 });

    // 10. BIP39 master → addressKey(0) (for comparison)
    const addr10 = await deriveViaAddressKey(bip39Master);
    results.push({ path: 'BIP39 master → addressKey(0)', slatepackAddress: addr10 });

  } catch (err) {
    results.push({ path: 'grin-wallet compat tests', slatepackAddress: `ERROR: ${err}` });
  }

  // Restore the default keys after testing (version-aware)
  try {
    const testState = await getWalletState();
    const testUseBip39 = !testState.derivationVersion || testState.derivationVersion < 3;
    const freshKeys = await grinModule.initGrinWallet(unlockedMnemonic, testUseBip39);
    setGrinWasmKeys(freshKeys);
  } catch { /* ignore */ }

  console.log('[GrinTestPaths] Results:');
  for (const r of results) {
    console.log(`  ${r.path}: ${r.slatepackAddress}`);
  }

  return { success: true, data: { results } };
}

// =============================================================================
// Wallet Initialization
// =============================================================================

/**
 * Initialize the Grin WASM wallet and return the slatepack address.
 *
 * The Grin wallet uses MWC's WebAssembly implementation for all
 * cryptographic operations. Keys are derived from the BIP39 mnemonic
 * using the MWC Seed class.
 *
 * Keys can be initialized from:
 * 1. Cached grinWasmKeys (already initialized this session)
 * 2. Session storage (restored after service worker restart)
 * 3. Mnemonic (fresh unlock - derives keys and persists to session)
 *
 * @returns Slatepack address (bech32-encoded ed25519 pubkey for receiving)
 */
export async function handleInitGrinWallet(): Promise<MessageResponse<{
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
    // v3+: useBip39=false (raw entropy HMAC, grin-wallet/Grim compatible)
    // v1/v2: useBip39=true (PBKDF2 then HMAC, MWC-style legacy)
    const state = await getWalletState();
    const useBip39 = !state.derivationVersion || state.derivationVersion < 3;
    const keys = await (await getGrinModule()).initGrinWallet(unlockedMnemonic, useBip39);
    setGrinWasmKeys(keys);

    // Persist the extended key to session storage so it survives service worker restarts
    // NOTE: We only store the extended key, NOT the mnemonic - this limits exposure to Grin only
    await persistSessionKeys();

    return {
      success: true,
      data: { slatepackAddress: keys.slatepackAddress },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to initialize Grin wallet',
    };
  }
}
