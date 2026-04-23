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

  // Restore the default keys after testing
  try {
    const freshKeys = await grinModule.initGrinWallet(unlockedMnemonic);
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
    const keys = await (await getGrinModule()).initGrinWallet(unlockedMnemonic);
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
