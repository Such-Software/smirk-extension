/**
 * Grin Invoice Operations (RSR Flow)
 *
 * Receiver-initiated transactions:
 * - Create invoice (I1)
 * - Sign invoice as sender (I2)
 * - Finalize and broadcast (I3)
 */

import type { MessageResponse } from '@/types';
import { bytesToHex, hexToBytes } from '@/lib/crypto';
import { isUnlocked } from '../state';
import {
  getGrinModule,
  ensureGrinKeysInitialized,
  getAuthenticatedUserId,
  getNextChildIndex,
  fetchUnspentOutputs,
  getCurrentBlockHeight,
} from './helpers';
import {
  recordGrinOutput,
  recordGrinTransaction,
  lockGrinOutputs,
  unlockGrinOutputs,
  broadcastGrinTransaction,
  updateGrinTransactionStatus,
} from './backend';

// =============================================================================
// RSR Invoice Flow - Create Invoice (I1)
// =============================================================================

/**
 * Create a Grin invoice (I1) requesting payment.
 *
 * This is the receiver's first step in the RSR flow:
 * 1. Creates output commitment and proof for requested amount
 * 2. Generates participant data (public blind excess, public nonce)
 * 3. Returns invoice string to send to payer
 * 4. Returns secrets needed to finalize later (stored locally)
 *
 * NOTE: The output is NOT recorded on the backend until finalization.
 * This prevents balance from showing uncommitted funds.
 *
 * @param amount - Amount to request in nanogrin
 * @returns Invoice data and secrets for finalization
 */
export async function handleGrinCreateInvoice(
  amount: number
): Promise<MessageResponse<{
  slatepack: string;
  slateId: string;
  secretKeyHex: string;
  secretNonceHex: string;
  outputInfo: { keyId: string; nChild: number; commitment: string; proof: string };
  publicBlindExcess: string;
  publicNonce: string;
  receiverAddress: string;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();
    const nextChildIndex = await getNextChildIndex(userId);
    console.log(`[Grin Invoice] Using next_child_index: ${nextChildIndex}`);

    // Create the invoice (standard slatepack format)
    const grinModule = await getGrinModule();
    const result = await grinModule.createInvoice(
      keys,
      BigInt(amount),
      nextChildIndex
    );

    console.log(`[Grin Invoice] Created invoice ${result.slateId} for ${amount} nanogrin`);

    return {
      success: true,
      data: {
        slatepack: result.slatepack,
        slateId: result.slateId,
        secretKeyHex: bytesToHex(result.secretKey),
        secretNonceHex: bytesToHex(result.secretNonce),
        outputInfo: {
          keyId: result.outputInfo.keyId,
          nChild: result.outputInfo.nChild,
          commitment: result.outputInfo.commitment,
          proof: result.outputInfo.proof,
        },
        publicBlindExcess: result.publicBlindExcess,
        publicNonce: result.publicNonce,
        receiverAddress: result.receiverAddress,
      },
    };
  } catch (err) {
    console.error('[Grin Invoice] Failed to create invoice:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create invoice',
    };
  }
}

// =============================================================================
// RSR Invoice Flow - Sign Invoice (I2)
// =============================================================================

/**
 * Sign a Grin invoice as sender (pay the invoice).
 *
 * The sender receives an invoice slatepack and creates a signed response:
 * 1. Selects inputs to cover amount + fee
 * 2. Creates change output (if needed)
 * 3. Signs the transaction
 * 4. Returns signed slatepack (I2) to send back to receiver
 *
 * This locks inputs on the backend to prevent double-spend.
 * If cancelled, inputs are unlocked.
 *
 * @param invoiceSlatepack - The invoice slatepack (BEGINSLATEPACK...ENDSLATEPACK format)
 * @returns Signed I2 slatepack and context for tracking
 */
export async function handleGrinSignInvoice(
  invoiceSlatepack: string
): Promise<MessageResponse<{
  slatepack: string;
  slateId: string;
  amount: number;
  fee: number;
  inputIds: string[];
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: number;
    commitment: string;
    proof: string;
  };
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();
    const { outputs, nextChildIndex } = await fetchUnspentOutputs(userId);

    if (outputs.length === 0) {
      return { success: false, error: 'No unspent outputs available' };
    }

    const currentHeight = await getCurrentBlockHeight();

    // Sign the invoice (takes slatepack string directly)
    const grinModule = await getGrinModule();
    const result = await grinModule.signInvoice(
      keys,
      invoiceSlatepack,
      outputs,
      currentHeight,
      nextChildIndex
    );

    console.log(`[Grin Invoice] Signing invoice ${result.slateId} for ${result.amount} nanogrin`);

    // Record the send transaction and lock inputs
    // If either fails, roll back to prevent orphaned locked outputs
    try {
      await recordGrinTransaction(
        userId,
        result.slateId,
        Number(result.amount),
        Number(result.fee),
        'send',
        keys.slatepackAddress // TODO: Get from invoice once we parse it
      );

      await lockGrinOutputs(userId, result.inputIds, result.slateId);

      // Record change output now — in the invoice flow, the receiver finalizes,
      // so the sender must record their change output at signing time.
      if (result.changeOutput) {
        await recordGrinOutput(userId, {
          keyId: result.changeOutput.keyId,
          nChild: result.changeOutput.nChild,
          amount: Number(result.changeOutput.amount),
          commitment: result.changeOutput.commitment,
        }, result.slateId);
      }
    } catch (backendErr) {
      console.error('[Grin Invoice] Failed to record/lock, rolling back:', backendErr);
      // Best-effort rollback — unlock outputs and cancel transaction
      try {
        await unlockGrinOutputs(userId, result.slateId);
        await updateGrinTransactionStatus(userId, result.slateId, 'cancelled');
      } catch (rollbackErr) {
        console.error('[Grin Invoice] Rollback also failed:', rollbackErr);
      }
      throw backendErr;
    }

    console.log(`[Grin Invoice] Signed invoice, slate ${result.slateId}`);

    return {
      success: true,
      data: {
        slatepack: result.slatepack,
        slateId: result.slateId,
        amount: Number(result.amount),
        fee: Number(result.fee),
        inputIds: result.inputIds,
        changeOutput: result.changeOutput ? {
          keyId: result.changeOutput.keyId,
          nChild: result.changeOutput.nChild,
          amount: Number(result.changeOutput.amount),
          commitment: result.changeOutput.commitment,
          proof: result.changeOutput.proof,
        } : undefined,
      },
    };
  } catch (err) {
    console.error('[Grin Invoice] Failed to sign invoice:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign invoice',
    };
  }
}

// =============================================================================
// RSR Invoice Flow - Finalize Invoice (I3)
// =============================================================================

/**
 * Finalize an invoice transaction and broadcast it.
 *
 * The receiver calls this after getting the signed slatepack (I2) back:
 * 1. Parses the I2 slatepack
 * 2. Adds receiver's partial signature (using stored secrets)
 * 3. Finalizes the transaction
 * 4. Broadcasts to network
 * 5. Records output and transaction on backend
 *
 * @param signedSlatepack - The I2 slatepack (BEGINSLATEPACK...ENDSLATEPACK format)
 * @param originalSlatepack - The I1 slatepack we created (needed to parse compact I2)
 * @param slateId - Original slate ID (for verification)
 * @param secretKeyHex - Receiver's secret key from invoice creation
 * @param secretNonceHex - Receiver's secret nonce from invoice creation
 * @param outputInfo - Output info from invoice creation (includes proof)
 * @param publicBlindExcess - Receiver's public blind excess (hex)
 * @param publicNonce - Receiver's public nonce (hex)
 * @param receiverAddress - Receiver's slatepack address
 * @param amount - Invoice amount in nanogrin
 * @returns Broadcast status
 */
export async function handleGrinFinalizeInvoice(
  signedSlatepack: string,
  originalSlatepack: string,
  slateId: string,
  secretKeyHex: string,
  secretNonceHex: string,
  outputInfo: { keyId: string; nChild: number; commitment: string; proof: string },
  publicBlindExcess: string,
  publicNonce: string,
  receiverAddress: string,
  amount: number
): Promise<MessageResponse<{ broadcast: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();

    console.log(`[Grin Invoice] Finalizing invoice ${slateId}`);

    // Decode secrets
    const secretKey = hexToBytes(secretKeyHex);
    const secretNonce = hexToBytes(secretNonceHex);

    // Finalize the invoice transaction
    const grinModule = await getGrinModule();
    const finalizedSlate = await grinModule.finalizeInvoice(
      keys,
      signedSlatepack,
      originalSlatepack,
      {
        slateId,
        secretKey,
        secretNonce,
        amount: BigInt(amount),
        outputInfo: {
          keyId: outputInfo.keyId,
          nChild: outputInfo.nChild,
          amount: BigInt(amount),
          commitment: outputInfo.commitment,
          proof: outputInfo.proof,
        },
        publicBlindExcess,
        publicNonce,
        receiverAddress,
      }
    );

    // Record the receive transaction FIRST so broadcastGrinTransaction can update it with kernel_excess
    await recordGrinTransaction(
      userId,
      finalizedSlate.id,
      amount,
      0, // Receiver doesn't pay fee
      'receive'
    );

    // Get the transaction JSON for broadcast
    const txJson = grinModule.getTransactionJson(finalizedSlate);
    console.log('[Grin Invoice] Transaction JSON for broadcast');

    // Broadcast to network (this will UPDATE the record with kernel_excess)
    const broadcastResult = await broadcastGrinTransaction(userId, finalizedSlate.id, txJson);

    if (!broadcastResult.success) {
      return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
    }

    // Record the received output
    await recordGrinOutput(userId, {
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: amount,
      commitment: outputInfo.commitment,
    }, finalizedSlate.id);

    // Update transaction status to finalized
    await updateGrinTransactionStatus(userId, finalizedSlate.id, 'finalized');

    console.log(`[Grin Invoice] Invoice ${slateId} finalized and broadcast`);

    return {
      success: true,
      data: { broadcast: true },
    };

  } catch (err) {
    console.error('[Grin Invoice] Failed to finalize invoice:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize invoice',
    };
  }
}
