/**
 * Global namespace for Grin library classes.
 *
 * The MWC wallet code expects these classes to be available globally.
 * This module sets them up as globals after importing from ESM modules.
 */

// Type augmentation for globalThis
declare global {
  var BigNumber: any;
  var bech32: any;
  var bech32m: any;
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
