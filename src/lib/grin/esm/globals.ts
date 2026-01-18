/**
 * Global namespace for Grin library classes.
 *
 * The MWC wallet code expects these classes to be available globally.
 * This module sets them up as globals after importing from ESM modules.
 */

import { $ } from './jquery-stub';
import { installMockWorker } from './slate-worker-mock';

// Set up jQuery stub globally (MWC wallet code uses $ for events)
(globalThis as any).$ = $;
(globalThis as any).jQuery = $;

// Create stub document/window objects for service worker compatibility
// The MWC wallet code references document/window directly for jQuery events
// In service workers these don't exist, so we create minimal stubs
if (typeof document === 'undefined') {
  (globalThis as any).document = { __stub: 'document' };
}
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

// Install mock Worker for service worker compatibility
// The MWC wallet Slate class uses a Web Worker which isn't available in service workers
installMockWorker();

// Type augmentation for globalThis
declare global {
  var $: any;
  var jQuery: any;
  var BigNumber: any;
  var bech32: any;
  var bech32m: any;
  var Base58: any;
  var sha256: any;
  var Uuid: any;
  var CRC32: any;
  var Hash: any;
  var Common: any;
  var BitReader: any;
  var BitWriter: any;
  var Secp256k1Zkp: any;
  var Ed25519: any;
  var X25519: any;
  var Blake2b: any;
  var Consensus: any;
  var Identifier: any;
  var Crypto: any;
  var Seed: any;
  var SlateInput: any;
  var SlateOutput: any;
  var SlateKernel: any;
  var SlateParticipant: any;
  var Slate: any;
  var Slatepack: any;
  var Tor: any;
  var Wallet: any;
  var HardwareWallet: any;
  var getResource: (path: string) => string;
}

export {};
