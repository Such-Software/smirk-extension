/**
 * Grin Backend API Wrappers
 *
 * Thin wrappers around api.* calls for Grin operations.
 * These simplify the calling code and centralize error handling.
 */

import { api } from '@/lib/api';

// =============================================================================
// Output Recording
// =============================================================================

/**
 * Record a Grin output to the backend.
 *
 * @param userId - User ID
 * @param outputInfo - Output details
 * @param txSlateId - Transaction slate ID
 */
export async function recordGrinOutput(
  userId: string,
  outputInfo: {
    keyId: string;
    nChild: number;
    amount: number;
    commitment: string;
  },
  txSlateId: string
): Promise<void> {
  try {
    const result = await api.recordGrinOutput({
      userId,
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: outputInfo.amount,
      commitment: outputInfo.commitment,
      txSlateId,
    });
    if (result.error) {
      console.warn('[Grin] Failed to record output (non-fatal):', result.error);
    } else {
      console.log(`[Grin] Recorded output ${outputInfo.commitment.substring(0, 16)}... for ${outputInfo.amount} nanogrin`);
    }
  } catch (err) {
    console.warn('[Grin] Failed to record output (non-fatal):', err);
  }
}

// =============================================================================
// Transaction Recording
// =============================================================================

/**
 * Record a Grin transaction to the backend.
 *
 * @param userId - User ID
 * @param slateId - Slate ID
 * @param amount - Amount in nanogrin
 * @param fee - Fee in nanogrin
 * @param direction - 'send' or 'receive'
 * @param counterpartyAddress - Optional recipient/sender address
 */
export async function recordGrinTransaction(
  userId: string,
  slateId: string,
  amount: number,
  fee: number,
  direction: 'send' | 'receive',
  counterpartyAddress?: string
): Promise<void> {
  try {
    const result = await api.recordGrinTransaction({
      userId,
      slateId,
      amount,
      fee,
      direction,
      counterpartyAddress,
    });
    if (result.error) {
      console.warn('[Grin] Failed to record transaction:', result.error);
    } else {
      console.log(`[Grin] Recorded ${direction} transaction ${slateId}`);
    }
  } catch (err) {
    console.warn('[Grin] Failed to record transaction:', err);
  }
}

// =============================================================================
// Output Locking
// =============================================================================

/**
 * Lock Grin outputs for a pending transaction.
 *
 * @param userId - User ID
 * @param outputIds - IDs of outputs to lock
 * @param txSlateId - Transaction slate ID
 */
export async function lockGrinOutputs(
  userId: string,
  outputIds: string[],
  txSlateId: string
): Promise<void> {
  await api.lockGrinOutputs({
    userId,
    outputIds,
    txSlateId,
  });
}

/**
 * Unlock Grin outputs (on transaction cancellation).
 *
 * @param userId - User ID
 * @param txSlateId - Transaction slate ID
 */
export async function unlockGrinOutputs(
  userId: string,
  txSlateId: string
): Promise<void> {
  await api.unlockGrinOutputs({
    userId,
    txSlateId,
  });
}

/**
 * Mark Grin outputs as spent (after broadcast).
 *
 * @param userId - User ID
 * @param txSlateId - Transaction slate ID
 */
export async function spendGrinOutputs(
  userId: string,
  txSlateId: string
): Promise<void> {
  await api.spendGrinOutputs({
    userId,
    txSlateId,
  });
}

// =============================================================================
// Transaction Broadcast
// =============================================================================

/**
 * Broadcast a Grin transaction to the network.
 *
 * @param userId - User ID
 * @param slateId - Slate ID
 * @param txJson - Transaction JSON
 * @returns Broadcast result
 */
export async function broadcastGrinTransaction(
  userId: string,
  slateId: string,
  txJson: object
): Promise<{ success: boolean; error?: string }> {
  const result = await api.broadcastGrinTransaction({
    userId,
    slateId,
    tx: txJson,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }
  return { success: true };
}

// =============================================================================
// Transaction Status
// =============================================================================

/**
 * Update Grin transaction status.
 *
 * @param userId - User ID
 * @param slateId - Slate ID
 * @param status - New status
 */
export async function updateGrinTransactionStatus(
  userId: string,
  slateId: string,
  status: 'pending' | 'finalized' | 'cancelled'
): Promise<void> {
  await api.updateGrinTransaction({
    userId,
    slateId,
    status,
  });
}

/**
 * Stamp the kernel excess on an already-recorded grin transaction.
 *
 * Receivers compute the kernel excess at S2; it's the same value that will
 * appear on-chain and the same value `broadcastGrinTransaction` would write
 * if the sender were a Smirk user. Calling this from the receive flow
 * means external-sender (grin-wallet/Grim) tips still get a kernel id
 * recorded so history can link out to a block explorer.
 *
 * Status is preserved by passing 'pending' (matches what
 * `recordGrinTransaction` just inserted; the confirmation poller will
 * advance it to 'confirmed' later).
 */
export async function setGrinKernelExcess(
  userId: string,
  slateId: string,
  kernelExcess: string,
): Promise<void> {
  await api.updateGrinTransaction({
    userId,
    slateId,
    status: 'pending',
    kernelExcess,
  });
}
