/**
 * Grin Voucher Implementation for Social Tips
 *
 * Grin uses Mimblewimble's interactive transaction model where both sender
 * and receiver must participate in building a transaction. This makes
 * traditional "send to address" tips impossible.
 *
 * The voucher model solves this by:
 * 1. Creating a funded output that can be spent by whoever knows the blinding factor
 * 2. Storing the blinding factor encrypted with the recipient's public key
 * 3. Allowing the recipient to sweep the funds using a self-signed transaction
 *
 * Key insight: In Grin, "ownership" of an output is determined by knowing
 * its blinding factor. If you have the blinding factor, you can spend it.
 *
 * Voucher Creation Flow:
 * ======================
 * 1. Sender creates a normal transaction sending to themselves
 *    - Uses existing handleGrinCreateSend flow
 *    - Creates an output with commitment = amount*H + blind*G
 *
 * 2. After tx confirms, extract the output details:
 *    - commitment (public - identifies the UTXO)
 *    - proof (public - range proof)
 *    - amount (public - for verification)
 *    - blinding_factor (SECRET - proves ownership)
 *    - n_child (for derivation reference)
 *
 * 3. Create voucher data structure:
 *    - Encrypt blinding_factor with recipient's BTC public key (ECIES)
 *    - Store all data on backend
 *
 * Voucher Claiming Flow (Non-Interactive Sweep):
 * ==============================================
 * 1. Recipient decrypts blinding_factor using their BTC private key
 *
 * 2. Build a "voucher sweep" transaction:
 *    - Input: voucher output (commitment, features)
 *      - Blinding contribution: -voucher_blind (spending)
 *    - Output: recipient's new output (their key derivation)
 *      - Blinding contribution: +recipient_blind (receiving)
 *    - Fee deducted from amount
 *
 * 3. Compute kernel excess:
 *    - excess = recipient_blind - voucher_blind
 *    - Note: recipient controls BOTH values!
 *
 * 4. Sign the kernel:
 *    - Since recipient knows both blinding factors, they can
 *      generate the full Schnorr signature themselves
 *    - No interaction with original sender needed
 *
 * 5. Build and broadcast transaction
 *
 * Key WASM functions used:
 * - Secp256k1Zkp.pedersenCommit(blind, amount) - Create commitment from raw blind
 * - Secp256k1Zkp.publicKeyFromSecretKey(blind) - Get public key from blind
 * - Secp256k1Zkp.blindSum(positives, negatives) - Sum blinding factors
 * - Secp256k1Zkp.createSingleSignerSignature() - Sign with a blinding factor
 * - Secp256k1Zkp.isValidSecretKey(blind) - Validate blinding factor
 */

import {
  initializeGrinWasm,
  getSecp256k1Zkp,
  getSlate,
  getSlateInput,
  getSlateOutput,
  getBigNumber,
  getCrypto,
  getCommon,
  getIdentifier,
  getConsensus,
} from './loader';
import { calculateGrinFee } from './constants';
import { ProofBuilder } from './signing';
import type { GrinKeys, GrinSlate, GrinOutput } from './types';

/**
 * Grin voucher data structure.
 * Contains everything needed to claim the voucher.
 */
export interface GrinVoucher {
  /** Output commitment (hex) - identifies the UTXO on chain */
  commitment: string;

  /** Range proof (hex) - needed for slate input creation */
  proof: string;

  /** Amount in nanogrin */
  amount: number;

  /** Raw blinding factor (hex, 32 bytes) - ENCRYPTED with recipient's pubkey */
  encryptedBlindingFactor: string;

  /** Ephemeral pubkey used for ECIES encryption */
  ephemeralPubkey: string;

  /** Transaction ID that created this output (for confirmation tracking) */
  txSlateId: string;

  /** Output features (0 = plain, 1 = coinbase) */
  features: number;

  /** Key ID used for derivation (hex) */
  keyId: string;

  /** n_child index used */
  nChild: number;

  /** Unix timestamp when created */
  createdAt: number;
}

/**
 * Data stored in PendingSocialTip for Grin vouchers.
 */
export interface GrinVoucherPendingTip {
  /** The voucher data (commitment, proof, etc.) */
  voucher: GrinVoucher;

  /** Raw blinding factor (hex) - stored locally for clawback */
  blindingFactorHex: string;
}

/**
 * Extract the blinding factor for an output.
 *
 * This derives the blinding factor from wallet keys using:
 *   Crypto.deriveSecretKey(extendedPrivateKey, amount, identifier, switchType)
 *
 * @param keys - Wallet keys
 * @param keyId - Output's key ID (hex)
 * @param amount - Output amount in nanogrin
 * @returns Raw blinding factor (32 bytes)
 */
export async function extractBlindingFactor(
  keys: GrinKeys,
  keyId: string,
  amount: bigint
): Promise<Uint8Array> {
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Identifier = getIdentifier();
  const BigNumber = getBigNumber();
  const Common = getCommon();

  // Reconstruct the identifier from the key ID
  const identifier = new Identifier(keyId);

  const amountBN = new BigNumber(amount.toString());

  // Derive the blinding factor using the same method as output creation
  const blindingFactor = await Crypto.deriveSecretKey(
    keys.extendedPrivateKey,
    amountBN,
    identifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  console.log('[extractBlindingFactor] Derived blinding factor for keyId:', keyId);
  console.log('[extractBlindingFactor] Amount:', amount.toString());

  return blindingFactor;
}

/**
 * Create a Grin voucher by sending funds to self and extracting the blinding factor.
 *
 * This is called AFTER a normal send transaction to self has been created and confirmed.
 * It extracts the blinding factor from the sender's output to create the voucher.
 *
 * @param keys - Sender's Grin wallet keys
 * @param outputCommitment - The commitment of the output to voucherize
 * @param outputProof - The range proof of the output
 * @param keyId - The key ID used to derive the output
 * @param nChild - The n_child index used
 * @param amount - Amount in nanogrin
 * @param txSlateId - Transaction slate ID that created the output
 * @returns Voucher data with the raw blinding factor
 */
export async function createGrinVoucher(
  keys: GrinKeys,
  outputCommitment: string,
  outputProof: string,
  keyId: string,
  nChild: number,
  amount: bigint,
  txSlateId: string
): Promise<{
  voucher: Omit<GrinVoucher, 'encryptedBlindingFactor' | 'ephemeralPubkey'>;
  blindingFactor: Uint8Array;
}> {
  await initializeGrinWasm();

  // Extract the blinding factor for this output
  const blindingFactor = await extractBlindingFactor(keys, keyId, amount);

  // Validate it's a valid secret key
  const Secp256k1Zkp = getSecp256k1Zkp();
  if (Secp256k1Zkp.isValidSecretKey(blindingFactor) !== true) {
    throw new Error('Extracted blinding factor is not a valid secret key');
  }

  console.log('[createGrinVoucher] Created voucher for commitment:', outputCommitment.slice(0, 16) + '...');

  return {
    voucher: {
      commitment: outputCommitment,
      proof: outputProof,
      amount: Number(amount),
      txSlateId,
      features: 0, // Plain output
      keyId,
      nChild,
      createdAt: Date.now(),
    },
    blindingFactor,
  };
}

/**
 * Claim a Grin voucher by sweeping funds to recipient's wallet.
 *
 * This builds a non-interactive transaction where the claimer controls both
 * the input (voucher) and output (their own wallet) blinding factors.
 *
 * @param keys - Claimer's Grin wallet keys
 * @param voucher - The voucher to claim (without encrypted fields)
 * @param voucherBlindingFactor - Decrypted blinding factor (32 bytes)
 * @param nextChildIndex - Next n_child for output creation
 * @param currentHeight - Current blockchain height
 * @returns Finalized slate ready for broadcast, plus output info to record
 */
export async function claimGrinVoucher(
  keys: GrinKeys,
  voucher: Omit<GrinVoucher, 'encryptedBlindingFactor' | 'ephemeralPubkey'>,
  voucherBlindingFactor: Uint8Array,
  nextChildIndex: number,
  currentHeight: bigint
): Promise<{
  slate: GrinSlate;
  outputInfo: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
  };
}> {
  await initializeGrinWasm();

  const Secp256k1Zkp = getSecp256k1Zkp();
  const Slate = getSlate();
  const SlateInput = getSlateInput();
  const SlateOutput = getSlateOutput();
  const BigNumber = getBigNumber();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Consensus = getConsensus();

  // Validate the voucher blinding factor
  if (Secp256k1Zkp.isValidSecretKey(voucherBlindingFactor) !== true) {
    throw new Error('Invalid voucher blinding factor');
  }

  // Calculate fee (1 input, 1 output, 1 kernel)
  const fee = calculateGrinFee(1, 1, 1);
  const outputAmount = BigInt(voucher.amount) - fee;

  if (outputAmount <= BigInt(0)) {
    throw new Error(`Voucher amount ${voucher.amount} is less than minimum fee ${fee}`);
  }

  console.log('[claimGrinVoucher] Voucher amount:', voucher.amount);
  console.log('[claimGrinVoucher] Fee:', fee.toString());
  console.log('[claimGrinVoucher] Output amount:', outputAmount.toString());

  // Create the slate
  const amountBN = new BigNumber(outputAmount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(currentHeight.toString());

  const slate = new Slate(
    amountBN,
    true, // isMainnet
    feeBN,
    heightBN.plus(1),
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    keys.slatepackAddress, // sender (claimer)
    keys.slatepackAddress  // receiver (also claimer - self-transfer)
  );

  // === Add the voucher as input ===
  const voucherCommitBytes = Common.fromHexString(voucher.commitment);
  const voucherInput = new SlateInput(voucher.features, voucherCommitBytes);
  slate.addInputs([voucherInput], true, 1); // updateKernel=true, expectedOutputs=1

  console.log('[claimGrinVoucher] Added voucher input:', voucher.commitment.slice(0, 16) + '...');

  // === Create claimer's output ===
  const outputIdentifier = new Identifier();
  outputIdentifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]));

  const outputCommit = await Crypto.commit(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // Create bulletproof range proof
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

  const claimerOutput = new SlateOutput(
    SlateOutput.PLAIN_FEATURES,
    outputCommit,
    outputProof
  );

  const addOutputResult = slate.addOutputs([claimerOutput]);
  if (addOutputResult === false) {
    throw new Error('Failed to add claimer output to slate');
  }

  console.log('[claimGrinVoucher] Added claimer output:', Common.toHexString(outputCommit).slice(0, 16) + '...');

  // === Derive claimer's blinding factor ===
  const claimerBlind = await Crypto.deriveSecretKey(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // === Compute excess: claimer_blind - voucher_blind ===
  // In Mimblewimble: sum(output_blinds) - sum(input_blinds) = kernel_excess
  // Here: claimerBlind - voucherBlindingFactor = excess
  const excessBlind = Secp256k1Zkp.blindSum([claimerBlind], [voucherBlindingFactor]);
  if (excessBlind === Secp256k1Zkp.OPERATION_FAILED) {
    claimerBlind.fill(0);
    throw new Error('Failed to compute excess blinding factor');
  }

  console.log('[claimGrinVoucher] Computed kernel excess blind');

  // === Generate nonces for signing ===
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    claimerBlind.fill(0);
    excessBlind.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  // === Add participant with excess as the secret key ===
  // Since we control both sides, we only need one participant
  // The excess IS our contribution to the kernel
  await slate.addParticipant(
    excessBlind,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  console.log('[claimGrinVoucher] Added participant');

  // === Finalize the transaction ===
  // Since we're the only participant, finalize will complete the kernel
  const baseFee = Consensus.getBaseFee(true);

  await slate.finalize(
    excessBlind,
    secretNonce,
    baseFee,
    true // isMainnet
  );

  console.log('[claimGrinVoucher] Transaction finalized');

  // Verify the kernel is complete
  const kernel = slate.getKernels?.()?.[0];
  if (!kernel?.isComplete?.()) {
    throw new Error('Kernel finalization failed');
  }

  console.log('[claimGrinVoucher] Kernel excess:', Common.toHexString(kernel.getExcess()));

  // Clean up sensitive data
  claimerBlind.fill(0);
  excessBlind.fill(0);
  secretNonce.fill(0);

  return {
    slate: {
      id: slate.getId().value || slate.getId().toString(),
      amount: outputAmount,
      fee,
      state: 'S3',
      raw: slate,
    },
    outputInfo: {
      keyId: Common.toHexString(outputIdentifier.getValue()),
      nChild: nextChildIndex,
      amount: outputAmount,
      commitment: Common.toHexString(outputCommit),
    },
  };
}

/**
 * Result from creating a voucher transaction.
 */
export interface CreateVoucherTransactionResult {
  /** Finalized slate ready for broadcast */
  slate: GrinSlate;

  /** Voucher output info (the output that becomes the voucher) */
  voucherOutput: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
    proof: string;
  };

  /** Change output info (if any) */
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
  };

  /** Blinding factor for the voucher output (32 bytes) - needed for encryption */
  voucherBlindingFactor: Uint8Array;

  /** IDs of inputs used (for marking as spent) */
  inputIds: string[];
}

/**
 * Create a Grin voucher transaction (single-party, non-interactive).
 *
 * Unlike normal Grin sends which require both parties to sign, this creates
 * a complete transaction that the sender can sign entirely themselves.
 * The "voucher output" can later be spent by whoever has the blinding factor.
 *
 * Flow:
 * 1. Select UTXOs to cover voucherAmount + fee
 * 2. Create voucher output (amount = voucherAmount)
 * 3. Create change output if needed
 * 4. Build kernel: excess = sum(output_blinds) - sum(input_blinds)
 * 5. Sign the kernel (single-party since we control all blinds)
 * 6. Return finalized transaction ready for broadcast
 *
 * @param keys - Sender's Grin wallet keys
 * @param outputs - Available UTXOs from the backend
 * @param voucherAmount - Amount for the voucher in nanogrin
 * @param currentHeight - Current blockchain height
 * @param nextChildIndex - Next available n_child for key derivation
 * @returns Finalized transaction and voucher data
 */
export async function createGrinVoucherTransaction(
  keys: GrinKeys,
  outputs: GrinOutput[],
  voucherAmount: bigint,
  currentHeight: bigint,
  nextChildIndex: number
): Promise<CreateVoucherTransactionResult> {
  await initializeGrinWasm();

  const Secp256k1Zkp = getSecp256k1Zkp();
  const Slate = getSlate();
  const SlateInput = getSlateInput();
  const SlateOutput = getSlateOutput();
  const BigNumber = getBigNumber();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Consensus = getConsensus();

  // Sort outputs by amount (smallest first for efficient selection)
  const sortedOutputs = [...outputs].sort((a, b) =>
    a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
  );

  // Calculate fee based on expected transaction size
  // Start with estimate: 1 input, 2 outputs (voucher + change), 1 kernel
  let estimatedInputs = 1;
  let selectedOutputs: GrinOutput[] = [];
  let totalSelected = BigInt(0);
  let fee = BigInt(0);

  const MAX_ITERATIONS = 10;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Worst case: voucher output + change output = 2 outputs
    fee = calculateGrinFee(estimatedInputs, 2, 1);

    const requiredAmount = voucherAmount + fee;
    selectedOutputs = [];
    totalSelected = BigInt(0);

    for (const output of sortedOutputs) {
      selectedOutputs.push(output);
      totalSelected += output.amount;
      if (totalSelected >= requiredAmount) break;
    }

    if (totalSelected < requiredAmount) {
      throw new Error(
        `Insufficient balance: have ${totalSelected}, need ${requiredAmount} (voucher: ${voucherAmount}, fee: ${fee})`
      );
    }

    if (selectedOutputs.length > estimatedInputs) {
      estimatedInputs = selectedOutputs.length;
      continue;
    }

    break;
  }

  // Calculate change
  const changeAmount = totalSelected - voucherAmount - fee;
  const hasChange = changeAmount > BigInt(0);
  const actualOutputs = hasChange ? 2 : 1;

  // Recalculate fee with actual counts
  fee = calculateGrinFee(selectedOutputs.length, actualOutputs, 1);
  const finalChangeAmount = totalSelected - voucherAmount - fee;
  const finalHasChange = finalChangeAmount > BigInt(0);

  console.log('[createGrinVoucherTransaction] Selection complete:');
  console.log('  - Inputs:', selectedOutputs.length);
  console.log('  - Voucher amount:', voucherAmount.toString());
  console.log('  - Fee:', fee.toString());
  console.log('  - Change:', finalChangeAmount.toString());

  // Create the slate
  const amountBN = new BigNumber(voucherAmount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(currentHeight.toString());

  const slate = new Slate(
    amountBN,
    true, // isMainnet
    feeBN,
    heightBN.plus(1),
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    keys.slatepackAddress, // sender = self
    keys.slatepackAddress  // receiver = self (voucher transaction)
  );

  // === Create SlateInputs from selected UTXOs ===
  const slateInputs = selectedOutputs.map(output => {
    const commitBytes = Common.fromHexString(output.commitment);
    const features = output.isCoinbase ? SlateInput.COINBASE_FEATURES : SlateInput.PLAIN_FEATURES;
    return new SlateInput(features, commitBytes);
  });

  slate.addInputs(slateInputs, true, actualOutputs);

  // Track blinding factors for kernel excess calculation
  const inputBlinds: Uint8Array[] = [];
  const outputBlinds: Uint8Array[] = [];

  // === Derive input blinding factors ===
  for (const output of selectedOutputs) {
    const identifier = new Identifier(output.keyId);
    const inputBlind = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      new BigNumber(output.amount.toString()),
      identifier,
      Crypto.SWITCH_TYPE_REGULAR
    );
    inputBlinds.push(inputBlind);
  }

  // === Create voucher output ===
  // Use the next available child index for the voucher
  const voucherIdentifier = new Identifier();
  voucherIdentifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]));

  const voucherCommit = await Crypto.commit(
    keys.extendedPrivateKey,
    amountBN,
    voucherIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // Create bulletproof range proof for voucher output
  const proofBuilder = new ProofBuilder();
  await proofBuilder.initialize(keys.extendedPrivateKey);

  const voucherProof = await Crypto.proof(
    keys.extendedPrivateKey,
    amountBN,
    voucherIdentifier,
    Crypto.SWITCH_TYPE_REGULAR,
    proofBuilder
  );

  // Derive voucher blinding factor
  const voucherBlind = await Crypto.deriveSecretKey(
    keys.extendedPrivateKey,
    amountBN,
    voucherIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );
  outputBlinds.push(voucherBlind);

  // Create SlateOutput for voucher
  const voucherSlateOutput = new SlateOutput(
    SlateOutput.PLAIN_FEATURES,
    voucherCommit,
    voucherProof
  );

  // Store voucher output info
  const voucherOutput = {
    keyId: Common.toHexString(voucherIdentifier.getValue()),
    nChild: nextChildIndex,
    amount: voucherAmount,
    commitment: Common.toHexString(voucherCommit),
    proof: Common.toHexString(voucherProof),
  };

  // === Create change output if needed ===
  let changeOutput: CreateVoucherTransactionResult['changeOutput'] | undefined;
  let changeSlateOutput: any;

  if (finalHasChange) {
    // Use next child index after voucher
    const changeChildIndex = nextChildIndex + 1;
    const changeIdentifier = new Identifier();
    changeIdentifier.setValue(3, new Uint32Array([0, 0, changeChildIndex, 0]));

    const changeAmountBN = new BigNumber(finalChangeAmount.toString());

    const changeCommit = await Crypto.commit(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR
    );

    const changeProof = await Crypto.proof(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR,
      proofBuilder
    );

    // Derive change blinding factor
    const changeBlind = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR
    );
    outputBlinds.push(changeBlind);

    changeSlateOutput = new SlateOutput(
      SlateOutput.PLAIN_FEATURES,
      changeCommit,
      changeProof
    );

    changeOutput = {
      keyId: Common.toHexString(changeIdentifier.getValue()),
      nChild: changeChildIndex,
      amount: finalChangeAmount,
      commitment: Common.toHexString(changeCommit),
    };
  }

  proofBuilder.uninitialize();

  // Add outputs to slate (voucher first, then change if any)
  const outputsToAdd = changeSlateOutput
    ? [voucherSlateOutput, changeSlateOutput]
    : [voucherSlateOutput];
  const addOutputResult = slate.addOutputs(outputsToAdd);
  if (addOutputResult === false) {
    throw new Error('Failed to add outputs to slate');
  }

  console.log('[createGrinVoucherTransaction] Added voucher output:', voucherOutput.commitment.slice(0, 16) + '...');
  if (changeOutput) {
    console.log('[createGrinVoucherTransaction] Added change output:', changeOutput.commitment.slice(0, 16) + '...');
  }

  // === Compute kernel excess ===
  // excess = sum(output_blinds) - sum(input_blinds)
  const excessBlind = Secp256k1Zkp.blindSum(outputBlinds, inputBlinds);

  // Clean up input blinds (no longer needed)
  for (const blind of inputBlinds) {
    blind.fill(0);
  }

  if (excessBlind === Secp256k1Zkp.OPERATION_FAILED) {
    for (const blind of outputBlinds) {
      blind.fill(0);
    }
    throw new Error('Failed to compute excess blinding factor');
  }

  console.log('[createGrinVoucherTransaction] Computed kernel excess');

  // === Generate nonce and add participant ===
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    excessBlind.fill(0);
    for (const blind of outputBlinds) {
      blind.fill(0);
    }
    throw new Error('Failed to create secret nonce');
  }

  // Add ourselves as the only participant
  await slate.addParticipant(
    excessBlind,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  console.log('[createGrinVoucherTransaction] Added participant');

  // === Finalize the transaction ===
  const baseFee = Consensus.getBaseFee(true);

  await slate.finalize(
    excessBlind,
    secretNonce,
    baseFee,
    true // isMainnet
  );

  console.log('[createGrinVoucherTransaction] Transaction finalized');

  // Verify kernel is complete
  const kernel = slate.getKernels?.()?.[0];
  if (!kernel?.isComplete?.()) {
    throw new Error('Kernel finalization failed');
  }

  console.log('[createGrinVoucherTransaction] Kernel excess:', Common.toHexString(kernel.getExcess()));

  // Copy voucher blind before cleanup (we need to return it)
  const voucherBlindingFactor = new Uint8Array(voucherBlind);

  // Clean up sensitive data
  excessBlind.fill(0);
  secretNonce.fill(0);
  for (const blind of outputBlinds) {
    blind.fill(0);
  }

  return {
    slate: {
      id: slate.getId().value || slate.getId().toString(),
      amount: voucherAmount,
      fee,
      state: 'S3',
      raw: slate,
    },
    voucherOutput,
    changeOutput,
    voucherBlindingFactor,
    inputIds: selectedOutputs.map(o => o.id),
  };
}
