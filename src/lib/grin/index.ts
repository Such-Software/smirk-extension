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

// Re-export types
export type { GrinKeys, GrinSlate, GrinOutput, SendTransactionResult } from './types';

// Re-export constants and fee calculation
export { calculateGrinFee, GRIN_BASE_FEE } from './constants';

// Re-export wallet initialization
export { initGrinWallet, initGrinWalletFromExtendedKey } from './wallet';

// Re-export slate functions
export { createSendSlate, addInputsToSlate, addOutputsToSlate } from './slate-build';

// Re-export slatepack functions
export { decodeSlatepack, reconstructSlateFromSerialized, encodeSlatepack } from './slatepack-codec';

// Re-export signing functions
export { signSlate, finalizeSlate, ProofBuilder } from './signing';

// Re-export invoice functions (RSR flow - standard slatepack format)
export {
  createInvoice,
  signInvoice,
  finalizeInvoice,
  isInvoiceSlate,
  type CreateInvoiceResult,
  type SignInvoiceResult,
} from './invoice';

// Re-export utilities
export {
  getTransactionJson,
  getTransactionHex,
  slatepackAddressToPublicKey,
  publicKeyToSlatepackAddress,
} from './utils';

// Re-export WASM initialization from loader
export { initializeGrinWasm, isGrinWasmInitialized } from './loader';

// Import everything needed for createSendTransaction
import {
  initializeGrinWasm,
  getSlate,
  getSlateInput,
  getSlateOutput,
  getBigNumber,
  getCrypto,
  getCommon,
  getIdentifier,
  getSecp256k1Zkp,
  getSlatepack,
} from './loader';
import { calculateGrinFee } from './constants';
import { ProofBuilder } from './signing';
import type { GrinKeys, GrinOutput, SendTransactionResult } from './types';

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
 * @param fee - Transaction fee in nanogrin (ignored - calculated dynamically)
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
