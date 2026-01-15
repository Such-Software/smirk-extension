/**
 * Grin wallet functionality for Smirk extension.
 *
 * Based on MWC Wallet (MIT License) - see MWC_LICENSE
 * https://github.com/NicolasFlamel1/MWC-Wallet-Standalone
 *
 * This module provides client-side Grin transaction building:
 * - Key derivation from seed
 * - Slate creation and signing
 * - Slatepack encoding/decoding
 * - Bulletproof range proofs
 *
 * All cryptographic operations happen in WASM, keys never leave the client.
 */

import {
  initializeGrinWasm,
  isGrinWasmInitialized,
  getCrypto,
  getConsensus,
  getIdentifier,
  getSlate,
  getSlatepack,
  getSeed,
  getCommon,
  getBigNumber,
  getSecp256k1Zkp,
  getEd25519,
  getBech32,
} from './loader';

export { initializeGrinWasm, isGrinWasmInitialized };

/**
 * Grin wallet keys derived from a seed.
 */
export interface GrinKeys {
  /** The secret key (32 bytes) */
  secretKey: Uint8Array;
  /** The public key (33 bytes, compressed) */
  publicKey: Uint8Array;
  /** The slatepack address (ed25519-based) */
  slatepackAddress: string;
  /** The extended private key (64 bytes: secret key + chain code) */
  extendedPrivateKey: Uint8Array;
}

/**
 * Grin transaction slate.
 */
export interface GrinSlate {
  /** Slate ID (UUID) */
  id: string;
  /** Transaction amount in nanogrin */
  amount: bigint;
  /** Transaction fee in nanogrin */
  fee: bigint;
  /** Slate state: S1 (initial), S2 (signed by recipient), S3 (finalized) */
  state: 'S1' | 'S2' | 'S3';
  /** Raw slate object from MWC wallet */
  raw: any;
}

/**
 * Initialize the Grin wallet and return keys derived from a seed.
 *
 * @param seed - The BIP39 seed bytes (64 bytes)
 * @returns Grin wallet keys
 */
export async function initGrinWallet(seed: Uint8Array): Promise<GrinKeys> {
  // Ensure WASM modules are initialized
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Consensus = getConsensus();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Set wallet type to Grin
  Consensus.setWalletType(Consensus.GRIN_WALLET_TYPE);

  // Derive extended private key from seed using Grin's derivation
  // This follows the same path as grin-wallet
  const extendedPrivateKey = await Seed.deriveExtendedPrivateKey(seed);

  // Get the root secret key (first 32 bytes of extended private key)
  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));

  // Derive public key from secret key
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key from secret key');
  }

  // Derive slatepack address key (index 0)
  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);

  // Get Ed25519 public key for slatepack address
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  // Encode as slatepack address (bech32 with 'grin' prefix)
  const bech32 = getBech32();
  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return {
    secretKey,
    publicKey,
    slatepackAddress,
    extendedPrivateKey,
  };
}

/**
 * Create a send slate (S1) for initiating a Grin transaction.
 *
 * @param keys - Grin wallet keys
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param recipientAddress - Recipient's slatepack address (optional)
 * @returns The initial slate (S1)
 */
export async function createSendSlate(
  keys: GrinKeys,
  amount: bigint,
  fee: bigint,
  recipientAddress?: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const BigNumber = getBigNumber();

  // Create a new slate for sending
  const slate = new Slate();

  // Set amount and fee
  slate.setAmount(new BigNumber(amount.toString()));
  slate.setFee(new BigNumber(fee.toString()));

  // Build the sender's side of the transaction
  // This creates inputs, outputs, and the sender's partial signature
  await slate.build(
    keys.extendedPrivateKey,
    new BigNumber(amount.toString()),
    new BigNumber(fee.toString()),
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    recipientAddress || null
  );

  return {
    id: slate.getId(),
    amount,
    fee,
    state: 'S1',
    raw: slate,
  };
}

/**
 * Sign an incoming slate as the recipient (S1 -> S2).
 *
 * @param keys - Grin wallet keys
 * @param slatepack - The incoming slatepack string
 * @returns The signed slate (S2)
 */
export async function signSlate(
  keys: GrinKeys,
  slatepack: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();
  const BigNumber = getBigNumber();

  // Decode the slatepack
  const decoded = await Slatepack.decode(slatepack, keys.extendedPrivateKey);
  const slate = decoded.getSlate();

  // Add recipient's signature
  await slate.receive(keys.extendedPrivateKey);

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  return {
    id: slate.getId(),
    amount,
    fee,
    state: 'S2',
    raw: slate,
  };
}

/**
 * Finalize a slate for broadcast (S2 -> S3).
 *
 * @param keys - Grin wallet keys
 * @param slatepack - The signed slatepack from recipient
 * @returns The finalized slate (S3)
 */
export async function finalizeSlate(
  keys: GrinKeys,
  slatepack: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();

  // Decode the slatepack
  const decoded = await Slatepack.decode(slatepack, keys.extendedPrivateKey);
  const slate = decoded.getSlate();

  // Finalize the transaction
  await slate.finalize(keys.extendedPrivateKey);

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  return {
    id: slate.getId(),
    amount,
    fee,
    state: 'S3',
    raw: slate,
  };
}

/**
 * Encode a slate as a slatepack string.
 *
 * @param keys - Grin wallet keys
 * @param slate - The slate to encode
 * @param recipientAddress - Recipient's slatepack address (for encryption)
 * @returns The slatepack string
 */
export async function encodeSlatepack(
  keys: GrinKeys,
  slate: GrinSlate,
  recipientAddress?: string
): Promise<string> {
  await initializeGrinWasm();

  const Slatepack = getSlatepack();

  // Encode the slate as a slatepack
  const slatepack = await Slatepack.encode(
    slate.raw,
    keys.extendedPrivateKey,
    recipientAddress || null
  );

  return slatepack;
}

/**
 * Decode a slatepack string to a slate.
 *
 * @param keys - Grin wallet keys
 * @param slatepack - The slatepack string
 * @returns The decoded slate
 */
export async function decodeSlatepack(
  keys: GrinKeys,
  slatepack: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slatepack = getSlatepack();

  // Decode the slatepack
  const decoded = await Slatepack.decode(slatepack, keys.extendedPrivateKey);
  const slate = decoded.getSlate();

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  // Determine state based on participant count
  let state: 'S1' | 'S2' | 'S3' = 'S1';
  if (slate.isFinalized()) {
    state = 'S3';
  } else if (slate.getParticipants().length > 1) {
    state = 'S2';
  }

  return {
    id: slate.getId(),
    amount,
    fee,
    state,
    raw: slate,
  };
}

/**
 * Get the transaction hex from a finalized slate for broadcasting.
 *
 * @param slate - The finalized slate (S3)
 * @returns The transaction hex
 */
export function getTransactionHex(slate: GrinSlate): string {
  if (slate.state !== 'S3') {
    throw new Error('Slate must be finalized (S3) to get transaction hex');
  }

  // Get the finalized transaction from the slate
  const tx = slate.raw.getTransaction();
  return getCommon().toHexString(tx.serialize());
}
