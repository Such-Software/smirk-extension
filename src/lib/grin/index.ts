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
 *
 * NOTE: The MWC wallet library has a complex API designed for interactive wallet use.
 * The functions below provide a simplified wrapper for basic Grin operations.
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
  getBlake2b,
  getSlateInput,
  getSlateOutput,
} from './loader';

export { initializeGrinWasm, isGrinWasmInitialized };

// Grin consensus constants for fee calculation
const GRIN_BASE_FEE = BigInt(500000); // 0.0005 GRIN per weight unit
const GRIN_INPUT_WEIGHT = BigInt(1);
const GRIN_OUTPUT_WEIGHT = BigInt(21);
const GRIN_KERNEL_WEIGHT = BigInt(3);

/**
 * Calculate the required fee for a Grin transaction.
 * Fee = weight * baseFee, where weight = inputs*1 + outputs*21 + kernels*3
 *
 * @param numInputs - Number of inputs
 * @param numOutputs - Number of outputs (including change)
 * @param numKernels - Number of kernels (usually 1)
 * @returns Required fee in nanogrin
 */
export function calculateGrinFee(numInputs: number, numOutputs: number, numKernels: number = 1): bigint {
  const weight = BigInt(numInputs) * GRIN_INPUT_WEIGHT +
                 BigInt(numOutputs) * GRIN_OUTPUT_WEIGHT +
                 BigInt(Math.max(numKernels, 1)) * GRIN_KERNEL_WEIGHT;
  return weight * GRIN_BASE_FEE;
}

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
  /** The Ed25519 address key for slatepack encryption */
  addressKey: Uint8Array;
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
  /** Serialized slate data for transport */
  serialized?: Uint8Array;
}

/**
 * A Grin UTXO (unspent output) from the backend.
 */
export interface GrinOutput {
  /** Database ID */
  id: string;
  /** Key derivation path (BIP32-style, e.g. "0300000000040000000100000000") */
  keyId: string;
  /** Child index within the path */
  nChild: number;
  /** Amount in nanogrin */
  amount: bigint;
  /** Pedersen commitment (hex string) */
  commitment: string;
  /** Whether this is a coinbase output */
  isCoinbase: boolean;
  /** Block height where this output was confirmed */
  blockHeight?: number;
}

/**
 * Result of creating a send transaction.
 */
export interface SendTransactionResult {
  /** The S1 slate ready to be sent to receiver */
  slate: GrinSlate;
  /** The slatepack-encoded slate */
  slatepack: string;
  /** Secret nonce needed to finalize the transaction later */
  secretNonce: Uint8Array;
  /** Secret key (blinding factor sum after offset) for finalization */
  secretKey: Uint8Array;
  /** Inputs used in this transaction (to lock on backend) */
  inputIds: string[];
  /** Change output details (to record on backend after finalization) */
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
    proof: string; // hex encoded - needed to restore output to slate for finalization
  };
}

/**
 * Initialize the Grin wallet and return keys derived from a mnemonic.
 *
 * NOTE: The MWC wallet Seed class expects either:
 * - Raw entropy bytes (16, 20, 24, 28, or 32 bytes)
 * - A mnemonic string
 * - A number indicating seed length to generate
 *
 * It does NOT accept a 64-byte BIP39 derived seed. We must pass the mnemonic.
 *
 * @param mnemonic - The BIP39 mnemonic phrase (12 or 24 words)
 * @returns Grin wallet keys
 */
export async function initGrinWallet(mnemonic: string): Promise<GrinKeys> {
  // Ensure WASM modules are initialized
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Create a Seed instance (constructor takes no arguments)
  const seedInstance = new Seed();

  // Initialize with the mnemonic string - the MWC Seed class will parse it internally
  await seedInstance.initialize(mnemonic);

  // Derive extended private key using BIP39 derivation
  // Parameters: key (string), useBip39 (boolean), bip39Salt (optional)
  // The key parameter is the HMAC key used for derivation - MWC uses "IamVoldemort"
  // This is accessed via globalThis.Wallet.SEED_KEY (set up by stubs.ts)
  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    globalThis.Wallet.SEED_KEY,
    true
  );

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
    addressKey,
  };
}

/**
 * Reconstruct Grin wallet keys from a stored extended private key.
 * This allows restoring the wallet after service worker restart without the mnemonic.
 *
 * @param extendedPrivateKey - The 64-byte extended private key
 * @returns Grin wallet keys
 */
export async function initGrinWalletFromExtendedKey(extendedPrivateKey: Uint8Array): Promise<GrinKeys> {
  // Ensure WASM modules are initialized
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

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
    extendedPrivateKey: new Uint8Array(extendedPrivateKey),
    addressKey,
  };
}

/**
 * Create a send slate (S1) for initiating a Grin transaction.
 *
 * NOTE: This is a simplified version. The full MWC wallet requires:
 * - Input selection from UTXOs
 * - Change output creation
 * - Proof generation
 *
 * For Smirk, the backend relay handles transaction coordination.
 * This function creates the initial slate structure for the sender.
 *
 * @param keys - Grin wallet keys
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param height - Current blockchain height
 * @param recipientAddress - Recipient's slatepack address (optional)
 * @returns The initial slate (S1)
 */
export async function createSendSlate(
  keys: GrinKeys,
  amount: bigint,
  fee: bigint,
  height: bigint,
  recipientAddress?: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const BigNumber = getBigNumber();
  const Consensus = getConsensus();

  // Create a new slate with amount, fee, and height
  // Constructor: (amount, isMainnet, fee, height, lockHeight, relativeHeight, ...)
  const amountBN = new BigNumber(amount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(height.toString());

  const slate = new Slate(
    amountBN,
    true, // isMainnet (Grin mainnet)
    feeBN,
    heightBN,
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    Slate.NO_SENDER_ADDRESS,
    recipientAddress || Slate.NO_RECEIVER_ADDRESS
  );

  return {
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state: 'S1',
    raw: slate,
  };
}

/**
 * Decode a slatepack string and return the slate data.
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The slatepack string to decode
 * @param initialSlate - The initial send slate (required for S2 responses)
 * @returns The decoded slate
 */
export async function decodeSlatepack(
  keys: GrinKeys,
  slatepackString: string,
  initialSlate?: GrinSlate
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();
  const Consensus = getConsensus();

  // Debug: log slatepack info
  console.log('[Grin] decodeSlatepack called, wallet type:', Consensus.getWalletType());
  console.log('[Grin] slatepack length:', slatepackString.length);
  console.log('[Grin] slatepack starts with:', slatepackString.substring(0, 50));
  console.log('[Grin] slatepack ends with:', slatepackString.substring(slatepackString.length - 50));

  // Find delimiters for debugging
  const sep = '.';
  const headerDelim = slatepackString.indexOf(sep);
  const payloadDelim = slatepackString.indexOf(sep, headerDelim + 1);
  const footerDelim = slatepackString.indexOf(sep, payloadDelim + 1);
  console.log('[Grin] Delimiter positions - header:', headerDelim, 'payload:', payloadDelim, 'footer:', footerDelim);

  // Decode the slatepack - returns Uint8Array of slate data
  let slateData: Uint8Array;
  try {
    slateData = await Slatepack.decodeSlatepack(
      slatepackString,
      keys.addressKey // Ed25519 secret key for decryption
    );
    console.log('[Grin] Slatepack.decodeSlatepack() succeeded, data length:', slateData?.length);
    console.log('[Grin] First 32 bytes:', Array.from(slateData?.slice(0, 32) || []).map(b => b.toString(16).padStart(2, '0')).join(' '));
  } catch (e: any) {
    console.error('[Grin] Slatepack.decodeSlatepack() FAILED:', e?.message || e);
    throw e;
  }

  // Determine purpose based on whether we have an initial slate
  const purpose = initialSlate
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE
    : Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL;

  // Create Slate from decoded data
  // Constructor: (serializedSlate, isMainnet, purpose, initialSendSlate)
  console.log('[Grin] Creating Slate with purpose:', purpose, '(SEND_INITIAL=0, SEND_RESPONSE=1)');
  console.log('[Grin] initialSlate provided:', !!initialSlate);
  let slate;
  try {
    slate = new Slate(
      slateData,
      true, // isMainnet
      purpose,
      initialSlate?.raw || null
    );
    console.log('[Grin] Slate created successfully, id:', slate.getId?.());
  } catch (e: any) {
    console.error('[Grin] Slate constructor FAILED:', e?.message || e);
    throw e;
  }

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  // Determine state based on participant count and kernel completion
  let state: 'S1' | 'S2' | 'S3' = 'S1';
  const kernels = slate.getKernels();
  if (kernels.length > 0 && kernels[0].isComplete()) {
    state = 'S3';
  } else if (slate.getParticipants().length > 1) {
    state = 'S2';
  }

  return {
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state,
    raw: slate,
    serialized: slateData,
  };
}

/**
 * Reconstruct a GrinSlate from serialized binary data.
 * Used to recreate the S1 slate for finalizing S2 responses.
 *
 * @param serializedData - The serialized slate as Uint8Array
 * @returns The reconstructed GrinSlate
 */
export async function reconstructSlateFromSerialized(
  serializedData: Uint8Array
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();

  console.log('[Grin] Reconstructing slate from serialized data, length:', serializedData.length);

  // Create Slate from serialized data as S1 (SEND_INITIAL)
  const slate = new Slate(
    serializedData,
    true, // isMainnet
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    null // no initial slate needed for S1
  );

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  console.log('[Grin] Reconstructed slate - id:', slate.getId().value, 'amount:', amount.toString(), 'fee:', fee.toString());

  return {
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state: 'S1',
    raw: slate,
    serialized: serializedData,
  };
}

/**
 * Add inputs to a slate that was reconstructed from serialized data.
 * Compact slate serialization (SEND_INITIAL purpose) doesn't include inputs,
 * so we need to re-add them before finalization.
 *
 * @param slate - The slate to add inputs to
 * @param inputs - Array of input data (commitment + features)
 */
export async function addInputsToSlate(
  slate: GrinSlate,
  inputs: Array<{ commitment: string; features: number }>
): Promise<void> {
  await initializeGrinWasm();

  const Common = getCommon();
  const SlateInput = getSlateInput();
  const Slate = getSlate();

  // Create SlateInput objects from the stored data
  const slateInputs = inputs.map(input => {
    const commitBytes = Common.fromHexString(input.commitment);
    return new SlateInput(input.features, commitBytes);
  });

  console.log('[addInputsToSlate] Adding', slateInputs.length, 'inputs to slate');

  // Add inputs to the slate - sync method modifies in place
  // Use updateKernel=false since we don't want to modify the kernel
  // expectedNumberOfOutputs=0 since outputs are already in the slate
  const addResult = slate.raw.addInputs(slateInputs, false, 0);
  if (addResult === false) {
    throw new Error('Failed to add inputs to slate');
  }

  console.log('[addInputsToSlate] Done, slate now has', slate.raw.getInputs?.()?.length, 'inputs');
}

/**
 * Add outputs to a slate that was reconstructed from serialized data.
 * Compact slate serialization (SEND_INITIAL purpose) doesn't include outputs,
 * so we need to re-add the change output before finalization.
 *
 * @param slate - The slate to add outputs to
 * @param outputs - Array of output data (commitment + proof + features)
 */
export async function addOutputsToSlate(
  slate: GrinSlate,
  outputs: Array<{ commitment: string; proof: string; features?: number }>
): Promise<void> {
  await initializeGrinWasm();

  const Common = getCommon();
  const SlateOutput = getSlateOutput();

  // Create SlateOutput objects from the stored data
  const slateOutputs = outputs.map(output => {
    const commitBytes = Common.fromHexString(output.commitment);
    const proofBytes = Common.fromHexString(output.proof);
    const features = output.features ?? SlateOutput.PLAIN_FEATURES;
    return new SlateOutput(features, commitBytes, proofBytes);
  });

  console.log('[addOutputsToSlate] Adding', slateOutputs.length, 'outputs to slate');

  // Add outputs to the slate - sync method modifies in place
  // Use updateKernel=false since we don't want to modify the kernel
  const addResult = slate.raw.addOutputs(slateOutputs, false);
  if (addResult === false) {
    throw new Error('Failed to add outputs to slate');
  }

  console.log('[addOutputsToSlate] Done, slate now has', slate.raw.getOutputs?.()?.length, 'outputs');
}

/**
 * Sign an incoming slate as the recipient (S1 -> S2).
 *
 * This creates an output for the received amount, updates the offset,
 * and adds the receiver's participant data with a partial signature.
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The incoming slatepack string
 * @param nextChildIndex - The next child index for the output key derivation
 * @returns The signed slate (S2) and output info for recording
 */
export async function signSlate(
  keys: GrinKeys,
  slatepackString: string,
  nextChildIndex: number = 0
): Promise<{ slate: GrinSlate; outputInfo: { keyId: string; nChild: number; amount: bigint; commitment: string } }> {
  console.log('[signSlate] ENTRY - nextChildIndex parameter:', nextChildIndex);
  await initializeGrinWasm();

  const Secp256k1Zkp = getSecp256k1Zkp();
  const Crypto = getCrypto();
  const Identifier = getIdentifier();
  const BigNumber = getBigNumber();
  const SlateOutput = getSlateOutput();
  const Slate = getSlate();
  const Common = getCommon();

  // Decode the incoming slate
  const slate = await decodeSlatepack(keys, slatepackString);
  const rawSlate = slate.raw;

  // Get the amount being received
  const amount = slate.amount;
  const amountBN = new BigNumber(amount.toString());

  // === ENHANCED DEBUG LOGGING: S1 Slate Details ===
  console.log('[signSlate] ========== S1 SLATE DETAILS ==========');
  console.log('[signSlate] Slate ID:', slate.id);
  console.log('[signSlate] Amount:', amount.toString(), 'nanogrin');
  console.log('[signSlate] Fee:', slate.fee.toString(), 'nanogrin');
  console.log('[signSlate] State:', slate.state);

  // Kernel info
  const kernelFeatures = rawSlate.getKernelFeatures?.();
  const lockHeight = rawSlate.getLockHeight?.();
  const relativeHeight = rawSlate.getRelativeHeight?.();
  console.log('[signSlate] Kernel features:', kernelFeatures);
  console.log('[signSlate] Lock height:', lockHeight?.toFixed?.() ?? lockHeight);
  console.log('[signSlate] Relative height:', relativeHeight?.toFixed?.() ?? relativeHeight);

  // Initial offset from sender
  const initialOffset = rawSlate.getOffset?.();
  console.log('[signSlate] Initial offset (from S1):', initialOffset ? Common.toHexString(initialOffset) : 'null');

  // Sender's participant (should be participant 0)
  const senderParticipants = rawSlate.getParticipants?.();
  if (senderParticipants && senderParticipants.length > 0) {
    const sender = senderParticipants[0];
    console.log('[signSlate] --- Sender Participant (ID 0) ---');
    console.log('[signSlate] Sender public_blind_excess:', Common.toHexString(sender.getPublicBlindExcess?.()));
    console.log('[signSlate] Sender public_nonce:', Common.toHexString(sender.getPublicNonce?.()));
    const senderPartSig = sender.getPartialSignature?.();
    console.log('[signSlate] Sender partial_sig:', senderPartSig ? Common.toHexString(senderPartSig) : 'null (expected for S1)');
  } else {
    console.log('[signSlate] WARNING: No sender participant found in S1!');
  }

  // Inputs from sender
  const s1Inputs = rawSlate.getInputs?.();
  console.log('[signSlate] S1 inputs count:', s1Inputs?.length ?? 0);
  if (s1Inputs) {
    s1Inputs.forEach((inp: any, i: number) => {
      console.log(`[signSlate] Input ${i} commit:`, Common.toHexString(inp.getCommit?.()));
    });
  }
  console.log('[signSlate] ========================================');

  console.log('[signSlate] Receiving amount:', amount.toString());

  // Create identifier for the receive output
  // Use depth 3 (account/change/index pattern)
  // NOTE: Identifier constructor only takes 1 arg, must use setValue() for depth + paths
  const outputIdentifier = new Identifier();
  outputIdentifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]));
  console.log('[signSlate] Created identifier with path [0, 0, ' + nextChildIndex + ', 0]');
  console.log('[signSlate] Identifier depth:', outputIdentifier.getDepth());
  console.log('[signSlate] Identifier paths:', Array.from(outputIdentifier.getPaths()));
  console.log('[signSlate] Identifier getValue hex:', Common.toHexString(outputIdentifier.getValue()));

  // Create commitment for the output
  const outputCommit = await Crypto.commit(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  console.log('[signSlate] Created output commitment');

  // Create bulletproof range proof using ProofBuilder
  const proofBuilder = new ProofBuilder();
  await proofBuilder.initialize(keys.extendedPrivateKey);

  const outputProof = await Crypto.proof(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR,
    proofBuilder
  );

  proofBuilder.uninitialize();

  console.log('[signSlate] Created range proof');

  // Create SlateOutput for the receive amount
  const slateOutput = new SlateOutput(
    SlateOutput.PLAIN_FEATURES,
    outputCommit,
    outputProof
  );

  // Add output to slate (use synchronous method - async worker doesn't work in service workers)
  console.log('[signSlate] slateOutput created:', slateOutput);
  console.log('[signSlate] slateOutput commit:', Common.toHexString(slateOutput.getCommit?.()));
  console.log('[signSlate] slateOutput proof length:', slateOutput.getProof?.()?.length);
  console.log('[signSlate] rawSlate.outputs before add:', rawSlate.outputs?.length);

  const addResult = rawSlate.addOutputs([slateOutput]);
  console.log('[signSlate] addOutputs returned:', addResult);

  if (!addResult) {
    throw new Error('Failed to add output to slate');
  }

  console.log('[signSlate] rawSlate.outputs after add:', rawSlate.outputs?.length);
  console.log('[signSlate] rawSlate.getOutputs() after add:', rawSlate.getOutputs?.()?.length);

  // Derive the blinding factor for this output
  const outputBlind = await Crypto.deriveSecretKey(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // Generate a RANDOM secret key for signing (this is our "excess" contribution)
  // Per Grin protocol, the receiver generates a random key and adjusts the offset
  // to account for: new_offset = old_offset - random_key + output_blind
  // Use createSecretNonce() which generates random 32 bytes - same as what we need
  const randomSecretKey = Secp256k1Zkp.createSecretNonce();
  if (randomSecretKey === Secp256k1Zkp.OPERATION_FAILED) {
    outputBlind.fill(0);
    throw new Error('Failed to create random secret key');
  }

  // Verify it's a valid secret key (should be, but let's be safe)
  if (Secp256k1Zkp.isValidSecretKey(randomSecretKey) !== true) {
    outputBlind.fill(0);
    randomSecretKey.fill(0);
    throw new Error('Generated random key is not a valid secret key');
  }

  console.log('[signSlate] Output blind:', Common.toHexString(outputBlind));
  console.log('[signSlate] Random signing key:', Common.toHexString(randomSecretKey));

  // Adjust offset: new_offset = old_offset - random_key + output_blind
  // This is done in two steps:
  // 1. Subtract the random key (our signing key)
  // 2. Add the output blind

  const offsetBefore = rawSlate.getOffset();
  console.log('[signSlate] Offset BEFORE adjustment:', Common.toHexString(offsetBefore));

  // Use blindSum to compute: offset = offset - randomSecretKey + outputBlind
  const newOffset = Secp256k1Zkp.blindSum(
    [rawSlate.getOffset(), outputBlind],  // positives: old_offset + output_blind
    [randomSecretKey]                      // negatives: - random_key
  );

  if (newOffset === Secp256k1Zkp.OPERATION_FAILED) {
    outputBlind.fill(0);
    randomSecretKey.fill(0);
    throw new Error('Failed to compute new offset');
  }

  // Set the new offset
  rawSlate.offset = newOffset;

  console.log('[signSlate] Offset AFTER adjustment:', Common.toHexString(rawSlate.getOffset()));

  // The signing key is the random key we generated
  const finalSecretKey = new Uint8Array(randomSecretKey);
  outputBlind.fill(0);
  randomSecretKey.fill(0);

  console.log('[signSlate] Using random key as signing key');

  // Generate secret nonce for participant
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    finalSecretKey.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  console.log('[signSlate] Generated secret nonce');

  // Add recipient's participant data with partial signature
  await rawSlate.addParticipant(
    finalSecretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  console.log('[signSlate] Added participant');

  // NOTE: Do NOT manually zero amount/fee or filter participants!
  // The library's serialize() method with COMPACT_SLATE_PURPOSE_SEND_RESPONSE
  // handles this automatically:
  // - Amount/fee are not serialized for SEND_RESPONSE
  // - Only the receiver's participant (ID 1) is serialized
  // Manual manipulation breaks the library's internal state management.

  // === ENHANCED DEBUG LOGGING: After addParticipant ===
  console.log('[signSlate] ========== S2 SLATE STATE ==========');
  console.log('[signSlate] Amount:', rawSlate.amount?.toFixed?.(), 'Fee:', rawSlate.fee?.toFixed?.());

  // Debug: Check slate state before returning
  const outputs = rawSlate.getOutputs?.();
  const inputs = rawSlate.getInputs?.();
  const participants = rawSlate.getParticipants?.();

  console.log('[signSlate] Outputs count:', outputs?.length);
  console.log('[signSlate] Inputs count:', inputs?.length);
  console.log('[signSlate] Participants count:', participants?.length);

  // Log all outputs
  if (outputs) {
    outputs.forEach((out: any, i: number) => {
      console.log(`[signSlate] Output ${i} commit:`, Common.toHexString(out.getCommit?.()));
      console.log(`[signSlate] Output ${i} proof length:`, out.getProof?.()?.length);
    });
  }

  // Log all participants with full detail
  if (participants) {
    participants.forEach((p: any, i: number) => {
      console.log(`[signSlate] --- Participant ${i} ---`);
      console.log(`[signSlate] P${i} public_blind_excess:`, Common.toHexString(p.getPublicBlindExcess?.()));
      console.log(`[signSlate] P${i} public_nonce:`, Common.toHexString(p.getPublicNonce?.()));
      const partSig = p.getPartialSignature?.();
      console.log(`[signSlate] P${i} partial_sig:`, partSig ? Common.toHexString(partSig) : 'null');
      console.log(`[signSlate] P${i} isComplete:`, p.isComplete?.());
    });
  }

  // Log final offset
  const finalOffset = rawSlate.getOffset?.();
  console.log('[signSlate] Final offset (S2):', finalOffset ? Common.toHexString(finalOffset) : 'null');

  // Try to compute and log the kernel excess for verification
  try {
    const excess = rawSlate.getExcess?.();
    if (excess) {
      console.log('[signSlate] Computed kernel excess:', Common.toHexString(excess));
    }
  } catch (e) {
    console.log('[signSlate] Could not compute excess:', e);
  }

  console.log('[signSlate] ========================================');

  // Clear sensitive data
  finalSecretKey.fill(0);
  secretNonce.fill(0);

  // Update state to S2
  slate.state = 'S2';

  // Return slate and output info for recording
  return {
    slate,
    outputInfo: {
      keyId: Common.toHexString(outputIdentifier.getValue()),
      nChild: nextChildIndex,
      amount,
      commitment: Common.toHexString(outputCommit),
    },
  };
}

/**
 * Finalize a slate after receiving the signed response (S2 -> S3).
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The signed slatepack from recipient
 * @param initialSlate - The original send slate (S1)
 * @param senderSecretKey - The sender's secret key (blinding factor) from initial slate creation
 * @param senderSecretNonce - The sender's secret nonce from initial slate creation
 * @returns The finalized slate (S3)
 */
export async function finalizeSlate(
  keys: GrinKeys,
  slatepackString: string,
  initialSlate: GrinSlate,
  senderSecretKey: Uint8Array,
  senderSecretNonce: Uint8Array
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Consensus = getConsensus();
  const Slate = getSlate();

  // Decode the signed response slate
  const slate = await decodeSlatepack(keys, slatepackString, initialSlate);

  // The compact S2 slate doesn't include inputs - we need to copy them from S1
  // This is required for verifyAfterFinalize to pass (it checks inputs vs outputs balance)
  const s1Inputs = initialSlate.raw.getInputs?.();
  const s2Inputs = slate.raw.getInputs?.();
  console.log('[finalizeSlate] S1 inputs:', s1Inputs?.length ?? 0, 'S2 inputs:', s2Inputs?.length ?? 0);

  if (s1Inputs && s1Inputs.length > 0 && (!s2Inputs || s2Inputs.length === 0)) {
    console.log('[finalizeSlate] Copying inputs from S1 to S2 slate');
    // Add inputs from S1 to S2 slate - sync method modifies in place
    const addResult = slate.raw.addInputs(s1Inputs, false, 0);
    if (addResult === false) {
      throw new Error('Failed to add inputs to slate during finalization');
    }
    console.log('[finalizeSlate] Inputs added, new count:', slate.raw.getInputs?.()?.length ?? 0);
  }

  // The compact S2 slate doesn't include sender's change output - copy from S1
  // The S2 from receiver only has their output, not our change output
  const s1Outputs = initialSlate.raw.getOutputs?.();
  const s2Outputs = slate.raw.getOutputs?.();
  console.log('[finalizeSlate] S1 outputs:', s1Outputs?.length ?? 0, 'S2 outputs:', s2Outputs?.length ?? 0);

  if (s1Outputs && s1Outputs.length > 0) {
    // S2 should have receiver's output. We need to add sender's change output from S1.
    // Check which outputs from S1 are missing in S2 by comparing commits
    const s2CommitSet = new Set(s2Outputs?.map((o: any) => Common.toHexString(o.getCommit())) || []);
    const missingOutputs = s1Outputs.filter((o: any) => !s2CommitSet.has(Common.toHexString(o.getCommit())));

    if (missingOutputs.length > 0) {
      console.log('[finalizeSlate] Adding', missingOutputs.length, 'missing outputs from S1 to S2');
      const addResult = slate.raw.addOutputs(missingOutputs, false);
      if (addResult === false) {
        throw new Error('Failed to add outputs to slate during finalization');
      }
      console.log('[finalizeSlate] Outputs added, new count:', slate.raw.getOutputs?.()?.length ?? 0);
    }
  }

  // Get base fee for verification
  const baseFee = Consensus.getBaseFee(true); // isMainnet

  // Debug: Check slate state before finalize
  console.log('[finalizeSlate] === PRE-FINALIZE STATE ===');
  console.log('[finalizeSlate] Inputs:', slate.raw.getInputs?.()?.length);
  console.log('[finalizeSlate] Outputs:', slate.raw.getOutputs?.()?.length);
  console.log('[finalizeSlate] Kernels:', slate.raw.getKernels?.()?.length);
  console.log('[finalizeSlate] Participants:', slate.raw.getParticipants?.()?.length);

  const kernel = slate.raw.getKernels?.()?.[0];
  if (kernel) {
    console.log('[finalizeSlate] Kernel features:', kernel.getFeatures?.());
    console.log('[finalizeSlate] Kernel fee:', kernel.getFee?.()?.toFixed?.());
    console.log('[finalizeSlate] Kernel excess before finalize:', kernel.getExcess?.() ? Common.toHexString(kernel.getExcess()) : 'null');
    console.log('[finalizeSlate] Kernel isComplete before finalize:', kernel.isComplete?.());
  }

  // Finalize the transaction
  // finalize(secretKey, secretNonce, baseFee, isMainnet, ...)
  await slate.raw.finalize(
    senderSecretKey,
    senderSecretNonce,
    baseFee,
    true // isMainnet
  );

  // Debug: Check slate state after finalize
  console.log('[finalizeSlate] === POST-FINALIZE STATE ===');
  const kernelAfter = slate.raw.getKernels?.()?.[0];
  if (kernelAfter) {
    console.log('[finalizeSlate] Kernel excess after finalize:', kernelAfter.getExcess?.() ? Common.toHexString(kernelAfter.getExcess()) : 'null');
    console.log('[finalizeSlate] Kernel excessSig after finalize:', kernelAfter.getExcessSignature?.() ? Common.toHexString(kernelAfter.getExcessSignature()) : 'null');
    console.log('[finalizeSlate] Kernel isComplete after finalize:', kernelAfter.isComplete?.());
  }

  // Debug: Run individual verifications manually
  console.log('[finalizeSlate] === MANUAL VERIFICATIONS ===');
  console.log('[finalizeSlate] sort():', slate.raw.sort?.());
  console.log('[finalizeSlate] verifyWeight():', slate.raw.verifyWeight?.());
  console.log('[finalizeSlate] verifySortedAndUnique():', slate.raw.verifySortedAndUnique?.());
  console.log('[finalizeSlate] verifyNoCutThrough():', slate.raw.verifyNoCutThrough?.());
  console.log('[finalizeSlate] verifyFees(baseFee):', slate.raw.verifyFees?.(baseFee));
  console.log('[finalizeSlate] kernel.isComplete():', kernelAfter?.isComplete?.());
  console.log('[finalizeSlate] verifyKernelSums():', slate.raw.verifyKernelSums?.());
  console.log('[finalizeSlate] hasPaymentProof():', slate.raw.hasPaymentProof?.());
  console.log('[finalizeSlate] verifyReceiverSignature(true):', slate.raw.verifyReceiverSignature?.(true));
  console.log('[finalizeSlate] verifyNoRecentDuplicateKernels(true):', slate.raw.verifyNoRecentDuplicateKernels?.(true));

  // Update state to S3
  slate.state = 'S3';

  return slate;
}

/**
 * Encode a slate as a slatepack string.
 *
 * @param keys - Grin wallet keys
 * @param slate - The slate to encode
 * @param purpose - The slate purpose (SEND_INITIAL or SEND_RESPONSE)
 * @param recipientPublicKey - Recipient's Ed25519 public key for encryption (optional)
 * @returns The slatepack string
 */
export async function encodeSlatepack(
  keys: GrinKeys,
  slate: GrinSlate,
  purpose: 'send' | 'response',
  recipientPublicKey?: Uint8Array
): Promise<string> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();

  // Serialize the slate
  const slatePurpose = purpose === 'send'
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL
    : Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE;

  console.log('[Grin.encodeSlatepack] Purpose:', purpose, 'slatePurpose:', slatePurpose);
  console.log('[Grin.encodeSlatepack] Slate version:', slate.raw.getVersion?.().toFixed?.());
  console.log('[Grin.encodeSlatepack] Slate ID:', slate.raw.getId?.().serialize?.());
  console.log('[Grin.encodeSlatepack] Participants:', slate.raw.getParticipants?.()?.length);

  // Debug: show offset being serialized
  const Common = getCommon();
  const offset = slate.raw.getOffset?.();
  if (offset) {
    console.log('[Grin.encodeSlatepack] Slate offset:', Common.toHexString(offset));
  }

  const serializedSlate = slate.raw.serialize(true, slatePurpose, true); // isMainnet, purpose, preferBinary
  console.log('[Grin.encodeSlatepack] Serialized slate length:', serializedSlate?.length);
  console.log('[Grin.encodeSlatepack] First 64 bytes:', Array.from(serializedSlate?.slice(0, 64) || []).map((b: number) => b.toString(16).padStart(2, '0')).join(' '));

  // Encode as slatepack
  // encodeSlatepack(slate, secretKey, publicKey)
  const slatepackString = await Slatepack.encodeSlatepack(
    serializedSlate,
    recipientPublicKey ? keys.addressKey : null, // encrypt if recipient provided
    recipientPublicKey || null
  );

  console.log('[Grin.encodeSlatepack] Slatepack generated, length:', slatepackString?.length);
  return slatepackString;
}

/**
 * Get the transaction JSON from a finalized slate for broadcasting.
 *
 * @param slate - The finalized slate (S3)
 * @returns The transaction as a JSON object (for push_transaction API)
 */
export function getTransactionJson(slate: GrinSlate): object {
  if (slate.state !== 'S3') {
    throw new Error('Slate must be finalized (S3) to get transaction');
  }

  // Get the finalized transaction from the slate
  // This returns { body: { inputs, kernels, outputs }, offset }
  return slate.raw.getTransaction();
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

  const Common = getCommon();

  // Get the finalized transaction from the slate
  const tx = slate.raw.getTransaction();
  return Common.toHexString(tx.serialize());
}

/**
 * Convert a slatepack address to its Ed25519 public key.
 *
 * @param address - The slatepack address (grin1...)
 * @returns The Ed25519 public key (32 bytes)
 */
export function slatepackAddressToPublicKey(address: string): Uint8Array {
  const Slatepack = getSlatepack();
  return Slatepack.slatepackAddressToPublicKey(address);
}

/**
 * Convert an Ed25519 public key to a slatepack address.
 *
 * @param publicKey - The Ed25519 public key (32 bytes)
 * @returns The slatepack address (grin1...)
 */
export function publicKeyToSlatepackAddress(publicKey: Uint8Array): string {
  const Slatepack = getSlatepack();
  return Slatepack.publicKeyToSlatepackAddress(publicKey);
}

/**
 * Internal: ProofBuilder for creating bulletproof range proofs.
 * Based on NewProofBuilder from MWC wallet.
 */
class ProofBuilder {
  private privateHash: Uint8Array | null = null;
  private rewindHash: Uint8Array | null = null;

  async initialize(extendedPrivateKey: Uint8Array): Promise<void> {
    const Crypto = getCrypto();
    const Blake2b = getBlake2b();
    const Identifier = getIdentifier();
    const BigNumber = getBigNumber();

    // Derive secret key from root identifier
    const secretKey = await Crypto.deriveSecretKey(
      extendedPrivateKey,
      new BigNumber(0),
      new Identifier(Identifier.ROOT_SERIALIZED_IDENTIFIER),
      Crypto.SWITCH_TYPE_NONE
    );

    // Get private hash from secret key
    this.privateHash = Blake2b.compute(Crypto.NONCE_LENGTH, secretKey, new Uint8Array([]));
    if (this.privateHash === Blake2b.OPERATION_FAILED) {
      secretKey.fill(0);
      throw new Error('Failed to compute private hash');
    }
    secretKey.fill(0);

    // Get root public key and compute rewind hash
    const publicKey = await Crypto.rootPublicKey(extendedPrivateKey);
    this.rewindHash = Blake2b.compute(Crypto.NONCE_LENGTH, publicKey, new Uint8Array([]));
    if (this.rewindHash === Blake2b.OPERATION_FAILED) {
      if (this.privateHash) this.privateHash.fill(0);
      publicKey.fill(0);
      throw new Error('Failed to compute rewind hash');
    }
    publicKey.fill(0);
  }

  uninitialize(): void {
    if (this.privateHash) {
      this.privateHash.fill(0);
      this.privateHash = null;
    }
    if (this.rewindHash) {
      this.rewindHash.fill(0);
      this.rewindHash = null;
    }
  }

  async rewindNonce(commit: Uint8Array): Promise<Uint8Array> {
    const Blake2b = getBlake2b();
    const Crypto = getCrypto();
    const Secp256k1Zkp = getSecp256k1Zkp();

    if (!this.rewindHash) throw new Error('ProofBuilder not initialized');

    const nonce = Blake2b.compute(Crypto.NONCE_LENGTH, this.rewindHash, commit);
    if (nonce === Blake2b.OPERATION_FAILED) {
      throw new Error('Failed to compute rewind nonce');
    }
    if (Secp256k1Zkp.isValidSecretKey(nonce) !== true) {
      nonce.fill(0);
      throw new Error('Rewind nonce is not a valid secret key');
    }
    return nonce;
  }

  async privateNonce(commit: Uint8Array): Promise<Uint8Array> {
    const Blake2b = getBlake2b();
    const Crypto = getCrypto();
    const Secp256k1Zkp = getSecp256k1Zkp();

    if (!this.privateHash) throw new Error('ProofBuilder not initialized');

    const nonce = Blake2b.compute(Crypto.NONCE_LENGTH, this.privateHash, commit);
    if (nonce === Blake2b.OPERATION_FAILED) {
      throw new Error('Failed to compute private nonce');
    }
    if (Secp256k1Zkp.isValidSecretKey(nonce) !== true) {
      nonce.fill(0);
      throw new Error('Private nonce is not a valid secret key');
    }
    return nonce;
  }

  proofMessage(identifier: any, switchType: number): Uint8Array {
    const Common = getCommon();
    const Identifier = getIdentifier();

    // Message format: [0, 0, switchType, depth, ...paths]
    const messageLength = 4 + Identifier.MAX_DEPTH * 4; // header + 4 uint32 paths
    const message = new Uint8Array(messageLength).fill(0);

    // Set switch type at index 2
    message[2] = switchType;

    // Copy identifier value starting at index 3
    const identifierValue = identifier.getValue();
    message.set(identifierValue.subarray(0, messageLength - 3), 3);

    return message;
  }
}

/**
 * Create a send transaction (S1 slate) with proper UTXO selection and change output.
 *
 * This is the main function for initiating a Grin send. It:
 * 1. Selects UTXOs to cover the amount + fee
 * 2. Creates inputs from the selected UTXOs
 * 3. Creates a change output with bulletproof range proof
 * 4. Builds the slate with sender participant data
 * 5. Returns the slatepack to send to the receiver
 *
 * @param keys - Grin wallet keys
 * @param outputs - Available UTXOs from the backend
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param height - Current blockchain height
 * @param nextChildIndex - Next available child index for key derivation
 * @param recipientAddress - Recipient's slatepack address (optional, for encryption)
 * @returns SendTransactionResult with slate, slatepack, and data needed for finalization
 */
export async function createSendTransaction(
  keys: GrinKeys,
  outputs: GrinOutput[],
  amount: bigint,
  _fee: bigint, // Ignored - we calculate fee dynamically based on transaction weight
  height: bigint,
  nextChildIndex: number,
  recipientAddress?: string
): Promise<SendTransactionResult> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const SlateInput = getSlateInput();
  const SlateOutput = getSlateOutput();
  const BigNumber = getBigNumber();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Sort outputs by amount (smallest first for efficient selection)
  const sortedOutputs = [...outputs].sort((a, b) =>
    a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
  );

  // Select UTXOs with dynamic fee calculation
  // The fee depends on the number of inputs, so we iterate until stable
  let selectedOutputs: GrinOutput[] = [];
  let totalSelected = BigInt(0);
  let fee = BigInt(0);
  let hasChange = false;
  let changeAmount = BigInt(0);

  // Start with estimated fee for 1 input, 2 outputs (send + change), 1 kernel
  let estimatedInputs = 1;
  const MAX_ITERATIONS = 10;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Calculate fee based on estimated inputs
    // Outputs = 1 (receiver) + 1 (change if any) = 2 worst case
    const estimatedOutputs = 2;
    fee = calculateGrinFee(estimatedInputs, estimatedOutputs, 1);

    const requiredAmount = amount + fee;
    selectedOutputs = [];
    totalSelected = BigInt(0);

    for (const output of sortedOutputs) {
      selectedOutputs.push(output);
      totalSelected += output.amount;
      if (totalSelected >= requiredAmount) break;
    }

    if (totalSelected < requiredAmount) {
      throw new Error(`Insufficient balance: have ${totalSelected}, need ${requiredAmount} (amount: ${amount}, fee: ${fee})`);
    }

    // Check if we need more inputs than estimated
    if (selectedOutputs.length > estimatedInputs) {
      estimatedInputs = selectedOutputs.length;
      continue; // Recalculate with more inputs
    }

    // Stable - fee calculation matches actual inputs
    break;
  }

  // Recalculate fee with actual input/output count
  changeAmount = totalSelected - amount - fee;
  hasChange = changeAmount > BigInt(0);
  const actualOutputs = hasChange ? 2 : 1; // receiver output + optional change
  fee = calculateGrinFee(selectedOutputs.length, actualOutputs, 1);

  // Recalculate change with final fee
  changeAmount = totalSelected - amount - fee;
  hasChange = changeAmount > BigInt(0);
  const numberOfChangeOutputs = hasChange ? 1 : 0;

  console.log('[createSendTransaction] UTXO selection complete:');
  console.log('  - Inputs:', selectedOutputs.length);
  console.log('  - Outputs:', actualOutputs, '(1 send +', numberOfChangeOutputs, 'change)');
  console.log('  - Fee:', fee.toString(), 'nanogrin (', Number(fee) / 1e9, 'GRIN)');
  console.log('  - Change:', changeAmount.toString(), 'nanogrin');

  // Create the slate
  const amountBN = new BigNumber(amount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(height.toString());

  let slate = new Slate(
    amountBN,
    true, // isMainnet
    feeBN,
    heightBN.plus(1), // height + 1
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    keys.slatepackAddress, // sender address for payment proof
    recipientAddress || Slate.NO_RECEIVER_ADDRESS
  );

  // Create SlateInputs from selected UTXOs
  const slateInputs = selectedOutputs.map(output => {
    const commitBytes = Common.fromHexString(output.commitment);
    const features = output.isCoinbase ? SlateInput.COINBASE_FEATURES : SlateInput.PLAIN_FEATURES;
    return new SlateInput(features, commitBytes);
  });

  // Add inputs to slate - use sync method which modifies in place
  console.log('[createSendTransaction] Adding', slateInputs.length, 'inputs to slate');
  slate.addInputs(slateInputs, true, numberOfChangeOutputs + 1);
  console.log('[createSendTransaction] After addInputs, slate inputs:', slate.getInputs?.()?.length ?? 'getInputs not available');

  // Build change output if needed
  let changeOutputInfo: SendTransactionResult['changeOutput'] = undefined;
  const inputsForSum: Array<{
    amount: any;
    identifier: any;
    switchType: number;
  }> = [];

  // Track input identifiers for sum calculation
  for (const output of selectedOutputs) {
    const identifier = new Identifier(output.keyId);
    inputsForSum.push({
      amount: new BigNumber(output.amount.toString()),
      identifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    });
  }

  let outputForSum: { amount: any; identifier: any; switchType: number } | null = null;

  if (hasChange) {
    // Create identifier for change output
    // Use depth 3 (account/change/index pattern)
    const changeIdentifier = new Identifier(
      3,
      new Uint32Array([0, 0, nextChildIndex, 0])
    );

    const changeAmountBN = new BigNumber(changeAmount.toString());

    // Create commitment for change output
    const changeCommit = await Crypto.commit(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR
    );

    // Create bulletproof range proof using ProofBuilder
    const proofBuilder = new ProofBuilder();
    await proofBuilder.initialize(keys.extendedPrivateKey);

    const changeProof = await Crypto.proof(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR,
      proofBuilder
    );

    proofBuilder.uninitialize();

    // Create SlateOutput for change
    const slateOutput = new SlateOutput(
      SlateOutput.PLAIN_FEATURES,
      changeCommit,
      changeProof
    );

    // Add output to slate - sync method modifies in place
    const addOutputResult = slate.addOutputs([slateOutput]);
    if (addOutputResult === false) {
      throw new Error('Failed to add change output to slate');
    }

    // Store change output info for backend recording
    // Include proof since compact S1 serialization doesn't include outputs
    changeOutputInfo = {
      keyId: Common.toHexString(changeIdentifier.getValue()),
      nChild: nextChildIndex,
      amount: changeAmount,
      commitment: Common.toHexString(changeCommit),
      proof: Common.toHexString(changeProof),
    };

    outputForSum = {
      amount: changeAmountBN,
      identifier: changeIdentifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    };
  }

  // NOTE: For compact slates (SEND_INITIAL), we do NOT create an offset.
  // The compact slate serialization writes zero offset regardless, and the receiver
  // will compute their offset adjustment starting from zero. If we create a non-zero
  // offset here, the sender's blind excess would include it, but the receiver wouldn't
  // know about it, causing verifyKernelSums to fail at finalization.
  // The offset remains at its default (zero) from slate creation.
  // slate.createOffset(); // DO NOT call for compact slates

  // Calculate sum of inputs and outputs (blinding factors)
  // Sum = sum(output blinds) - sum(input blinds)
  let sum: Uint8Array;

  if (outputForSum) {
    // Derive output secret key
    const outputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      outputForSum.amount,
      outputForSum.identifier,
      outputForSum.switchType
    );

    // Start with output blinding factor
    sum = new Uint8Array(outputSecretKey);
  } else {
    // No change output, start with zero
    sum = new Uint8Array(32).fill(0);
  }

  // Subtract input blinding factors
  for (const input of inputsForSum) {
    const inputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      input.amount,
      input.identifier,
      input.switchType
    );

    // Subtract input secret key from sum: sum = sum - inputSecretKey
    // Use blindSum with input as negative blind
    const newSum = Secp256k1Zkp.blindSum([sum], [inputSecretKey]);
    inputSecretKey.fill(0);

    if (newSum === Secp256k1Zkp.OPERATION_FAILED) {
      sum.fill(0);
      throw new Error('Failed to compute blind sum');
    }

    sum.fill(0);
    sum = newSum;
  }

  // Apply offset to get final secret key
  // secretKey = sum - offset
  const offset = slate.getOffset();
  const secretKey = await slate.applyOffset(sum);
  sum.fill(0);

  // Generate secret nonce for participant
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    secretKey.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  // Add sender as participant
  await slate.addParticipant(
    secretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  // Encode as slatepack
  const serializedSlate = slate.serialize(
    true, // isMainnet
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    true  // preferBinary
  );

  // Get recipient public key for encryption if provided
  let recipientPublicKey: Uint8Array | null = null;
  if (recipientAddress) {
    const Slatepack = getSlatepack();
    recipientPublicKey = Slatepack.slatepackAddressToPublicKey(recipientAddress);
  }

  const Slatepack = getSlatepack();
  const slatepackString = await Slatepack.encodeSlatepack(
    serializedSlate,
    recipientPublicKey ? keys.addressKey : null,
    recipientPublicKey
  );

  // Verify inputs are still in the slate before returning
  const finalInputCount = slate.getInputs?.()?.length ?? 0;
  console.log('[createSendTransaction] Final slate input count before return:', finalInputCount);
  if (finalInputCount === 0) {
    console.error('[createSendTransaction] CRITICAL: Slate has no inputs at return time!');
  }

  return {
    slate: {
      id: slate.getId().value || slate.getId().toString(),
      amount,
      fee,
      state: 'S1',
      raw: slate,
      serialized: serializedSlate,
    },
    slatepack: slatepackString,
    secretNonce: new Uint8Array(secretNonce), // Copy to prevent mutation
    secretKey: new Uint8Array(secretKey), // Copy to prevent mutation
    inputIds: selectedOutputs.map(o => o.id),
    changeOutput: changeOutputInfo,
  };
}
