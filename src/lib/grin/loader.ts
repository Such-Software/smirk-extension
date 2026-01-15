/**
 * Grin WASM module loader.
 *
 * This module re-exports the initialization functions from the ESM wrapper.
 * Use initializeGrinWasm() to load all WASM modules before using Grin functionality.
 */

export {
  initializeGrin as initializeGrinWasm,
  isInitialized as isGrinWasmInitialized,
  getSecp256k1Zkp,
  getEd25519,
  getX25519,
  getBlake2b,
  getCommon,
  getCrypto,
  getConsensus,
  getIdentifier,
  getSeed,
  getSlate,
  getSlatepack,
  getBigNumber,
  getBech32,
  getBech32m,
} from './esm/init';
