/**
 * Grin consensus constants and fee calculation.
 */

// Grin consensus constants for fee calculation
export const GRIN_BASE_FEE = BigInt(500000); // 0.0005 GRIN per weight unit
export const GRIN_INPUT_WEIGHT = BigInt(1);
export const GRIN_OUTPUT_WEIGHT = BigInt(21);
export const GRIN_KERNEL_WEIGHT = BigInt(3);

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
