/**
 * Grin slate signing and finalization functions.
 *
 * Handles the cryptographic operations for signing slates as receiver
 * and finalizing transactions as sender.
 */

import {
  initializeGrinWasm,
  getCrypto,
  getIdentifier,
  getBigNumber,
  getSlateOutput,
  getCommon,
  getSecp256k1Zkp,
  getConsensus,
  getBlake2b,
} from './loader';
import { decodeSlatepack } from './slatepack-codec';
import type { GrinKeys, GrinSlate } from './types';

/**
 * ProofBuilder for creating bulletproof range proofs.
 * Based on NewProofBuilder from MWC wallet.
 */
export class ProofBuilder {
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
  const Common = getCommon();

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
