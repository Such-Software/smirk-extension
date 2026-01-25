/**
 * Grin slate creation and manipulation functions.
 *
 * Handles creating send slates and adding inputs/outputs.
 */

import {
  initializeGrinWasm,
  getSlate,
  getBigNumber,
  getCommon,
  getSlateInput,
  getSlateOutput,
} from './loader';
import type { GrinKeys, GrinSlate } from './types';

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
