/**
 * Grin WASM initialization module (ESM version).
 *
 * This module loads all the MWC wallet modules using static ES imports
 * instead of eval(), making it CSP-compliant AND service worker compatible.
 *
 * Note: We use static imports because dynamic import() is not allowed in
 * service workers per the HTML spec.
 */

import './globals';
import { getResource } from './wasm-loader';

// Static imports - all modules loaded at bundle time
// Phase 1: Core utilities (npm packages)
import { BigNumber } from './bignumber.esm';
import { bech32, bech32m } from './bech32.esm';

// Phase 2: WASM module wrappers
import { Secp256k1Zkp } from '../secp256k1-zkp.esm.js';
import { Ed25519 } from '../Ed25519.esm.js';
import { X25519 } from '../X25519.esm.js';
import { Blake2b } from '../BLAKE2b.esm.js';

// Phase 4: Utility classes
import { Common } from '../common.esm.js';
import { BitReader } from '../bit_reader.esm.js';
import { BitWriter } from '../bit_writer.esm.js';

// Phase 5: Crypto-dependent modules
import { Identifier } from '../identifier.esm.js';
import { Consensus } from '../consensus.esm.js';
import { Crypto } from '../crypto.esm.js';
import { Seed } from '../seed.esm.js';

// Phase 6: Slate modules
import { SlateInput } from '../slate_input.esm.js';
import { SlateOutput } from '../slate_output.esm.js';
import { SlateKernel } from '../slate_kernel.esm.js';
import { SlateParticipant } from '../slate_participant.esm.js';
import { Slatepack } from '../slatepack.esm.js';
import { Slate } from '../slate.esm.js';

// Phase 7: Stub classes for MWC wallet dependencies
import { Tor, Wallet, HardwareWallet } from './stubs';

// Set up getResource globally first (needed by WASM loaders)
globalThis.getResource = getResource;

// Set all modules as globals for legacy code compatibility
globalThis.BigNumber = BigNumber;
globalThis.bech32 = bech32;
globalThis.bech32m = bech32m;
globalThis.Secp256k1Zkp = Secp256k1Zkp;
globalThis.Ed25519 = Ed25519;
globalThis.X25519 = X25519;
globalThis.Blake2b = Blake2b;
globalThis.Common = Common;
globalThis.BitReader = BitReader;
globalThis.BitWriter = BitWriter;
globalThis.Identifier = Identifier;
globalThis.Consensus = Consensus;
globalThis.Crypto = Crypto;
globalThis.Seed = Seed;
globalThis.SlateInput = SlateInput;
globalThis.SlateOutput = SlateOutput;
globalThis.SlateKernel = SlateKernel;
globalThis.SlateParticipant = SlateParticipant;
globalThis.Slatepack = Slatepack;
globalThis.Slate = Slate;
globalThis.Tor = Tor;
globalThis.Wallet = Wallet;
globalThis.HardwareWallet = HardwareWallet;

// Track initialization state
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the Grin WASM modules.
 *
 * All modules are already loaded via static imports.
 * This function just initializes the WASM crypto modules.
 */
export async function initializeGrin(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[Grin] Starting WASM initialization...');

    // Initialize WASM modules (must be done async)
    console.log('[Grin] Initializing secp256k1-zkp WASM...');
    await Secp256k1Zkp.initialize();

    console.log('[Grin] Initializing Ed25519 WASM...');
    await Ed25519.initialize();

    console.log('[Grin] Initializing X25519 WASM...');
    await X25519.initialize();

    console.log('[Grin] Initializing BLAKE2b WASM...');
    await Blake2b.initialize();

    // Set wallet type to GRIN (not MWC which is the default)
    // This is critical - without it, slatepack encoding/decoding uses MWC format
    // which is incompatible with Grin slatepacks from external wallets
    console.log('[Grin] Setting wallet type to GRIN...');
    Consensus.walletType = Consensus.GRIN_WALLET_TYPE;

    initialized = true;
    console.log('[Grin] WASM initialization complete');
  })();

  return initPromise;
}

/**
 * Check if Grin WASM modules are initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

// Re-export getters for TypeScript access
export function getSecp256k1Zkp(): typeof Secp256k1Zkp {
  if (!initialized) throw new Error('Grin not initialized');
  return Secp256k1Zkp;
}

export function getEd25519(): typeof Ed25519 {
  if (!initialized) throw new Error('Grin not initialized');
  return Ed25519;
}

export function getX25519(): typeof X25519 {
  if (!initialized) throw new Error('Grin not initialized');
  return X25519;
}

export function getBlake2b(): typeof Blake2b {
  if (!initialized) throw new Error('Grin not initialized');
  return Blake2b;
}

export function getCommon(): typeof Common {
  if (!initialized) throw new Error('Grin not initialized');
  return Common;
}

export function getCrypto(): typeof Crypto {
  if (!initialized) throw new Error('Grin not initialized');
  return Crypto;
}

export function getConsensus(): typeof Consensus {
  if (!initialized) throw new Error('Grin not initialized');
  return Consensus;
}

export function getIdentifier(): typeof Identifier {
  if (!initialized) throw new Error('Grin not initialized');
  return Identifier;
}

export function getSeed(): typeof Seed {
  if (!initialized) throw new Error('Grin not initialized');
  return Seed;
}

export function getSlate(): typeof Slate {
  if (!initialized) throw new Error('Grin not initialized');
  return Slate;
}

export function getSlatepack(): typeof Slatepack {
  if (!initialized) throw new Error('Grin not initialized');
  return Slatepack;
}

export function getBigNumber(): typeof BigNumber {
  if (!initialized) throw new Error('Grin not initialized');
  return BigNumber;
}

export function getBech32(): typeof bech32 {
  if (!initialized) throw new Error('Grin not initialized');
  return bech32;
}

export function getBech32m(): typeof bech32m {
  if (!initialized) throw new Error('Grin not initialized');
  return bech32m;
}

export function getSlateInput(): typeof SlateInput {
  if (!initialized) throw new Error('Grin not initialized');
  return SlateInput;
}

export function getSlateOutput(): typeof SlateOutput {
  if (!initialized) throw new Error('Grin not initialized');
  return SlateOutput;
}
