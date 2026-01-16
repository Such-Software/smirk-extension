/**
 * Secp256k1-zkp ES module wrapper.
 *
 * This file imports the secp256k1-zkp WASM module and re-exports it as an ES module.
 * The original file defines both the Emscripten loader and the Secp256k1Zkp class.
 */

// Import the WASM loader utility first to set up getResource
import './wasm-loader';

// The original file is a side-effect import that sets up:
// 1. The `secp256k1Zkp` factory function (Emscripten-generated)
// 2. The `Secp256k1Zkp` class
// We need to import it and capture the class from the module.exports or global

// For Vite bundling, we'll use a dynamic import approach that doesn't need eval
// The file sets module.exports = Secp256k1Zkp at the end

// Import as CommonJS module - Vite handles this transformation
import Secp256k1ZkpModule from '../secp256k1-zkp-0.0.29.js';

// The module exports the Secp256k1Zkp class
export const Secp256k1Zkp = Secp256k1ZkpModule as typeof Secp256k1ZkpClass;

// Type definition for the class
interface Secp256k1ZkpClass {
  initialize(): Promise<void>;
  uninitialize(): void;
  blindSwitch(blind: Uint8Array, value: string): Uint8Array | null;
  blindSum(positives: Uint8Array[], negatives: Uint8Array[]): Uint8Array | null;
  isValidSecretKey(secretKey: Uint8Array): boolean;
  isValidPublicKey(publicKey: Uint8Array): boolean;
  isValidCommit(commit: Uint8Array): boolean;
  isValidSingleSignerSignature(signature: Uint8Array): boolean;
  createBulletproof(
    blind: Uint8Array,
    value: string,
    nonce: Uint8Array,
    privateNonce: Uint8Array,
    extraCommit: Uint8Array,
    message: Uint8Array
  ): Uint8Array | null;
  createBulletproofBlindless(
    tau1: Uint8Array,
    tau2: Uint8Array,
    taux: Uint8Array,
    tOne: Uint8Array,
    tTwo: Uint8Array,
    commit: Uint8Array,
    value: string,
    nonce: Uint8Array,
    extraCommit: Uint8Array,
    message: Uint8Array
  ): Uint8Array | null;
  rewindBulletproof(
    proof: Uint8Array,
    commit: Uint8Array,
    nonce: Uint8Array
  ): { value: string; message: Uint8Array } | null;
  verifyBulletproof(
    proof: Uint8Array,
    commit: Uint8Array,
    extraCommit: Uint8Array
  ): boolean;
  publicKeyFromSecretKey(secretKey: Uint8Array): Uint8Array | null;
  publicKeyFromData(data: Uint8Array): Uint8Array | null;
  uncompressPublicKey(publicKey: Uint8Array): Uint8Array | null;
  secretKeyTweakAdd(secretKey: Uint8Array, tweak: Uint8Array): Uint8Array | null;
  publicKeyTweakAdd(publicKey: Uint8Array, tweak: Uint8Array): Uint8Array | null;
  secretKeyTweakMultiply(secretKey: Uint8Array, tweak: Uint8Array): Uint8Array | null;
  publicKeyTweakMultiply(publicKey: Uint8Array, tweak: Uint8Array): Uint8Array | null;
  sharedSecretKeyFromSecretKeyAndPublicKey(
    secretKey: Uint8Array,
    publicKey: Uint8Array
  ): Uint8Array | null;
  pedersenCommit(blind: Uint8Array, value: string): Uint8Array | null;
  pedersenCommitSum(positives: Uint8Array[], negatives: Uint8Array[]): Uint8Array | null;
  pedersenCommitToPublicKey(commit: Uint8Array): Uint8Array | null;
  publicKeyToPedersenCommit(publicKey: Uint8Array): Uint8Array | null;
  createSingleSignerSignature(
    message: Uint8Array,
    secretKey: Uint8Array,
    secretNonce: Uint8Array | null,
    publicKey: Uint8Array,
    publicNonce: Uint8Array | null,
    publicNonceTotal: Uint8Array | null,
    seed: Uint8Array
  ): Uint8Array | null;
  addSingleSignerSignatures(
    signatures: Uint8Array[],
    publicNonceTotal: Uint8Array
  ): Uint8Array | null;
  verifySingleSignerSignature(
    signature: Uint8Array,
    message: Uint8Array,
    publicNonce: Uint8Array | null,
    publicKey: Uint8Array,
    publicKeyTotal: Uint8Array,
    isPartial: boolean
  ): boolean;
  singleSignerSignatureFromData(data: Uint8Array): Uint8Array | null;
  compactSingleSignerSignature(signature: Uint8Array): Uint8Array | null;
  uncompactSingleSignerSignature(signature: Uint8Array): Uint8Array | null;
  combinePublicKeys(publicKeys: Uint8Array[]): Uint8Array | null;
  createSecretNonce(seed: Uint8Array): Uint8Array | null;
  createMessageHashSignature(
    message: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null;
  verifyMessageHashSignature(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): boolean;
  instance: any;
  INVALID: null;
  OPERATION_FAILED: null;
  C_TRUE: number;
  C_FALSE: number;
  C_NULL: null;
  DECIMAL_NUMBER_BASE: number;
}

export default Secp256k1Zkp;
