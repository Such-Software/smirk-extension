/**
 * Grin Send Operations
 *
 * Create and finalize send transactions (SRS flow).
 */

import type { MessageResponse, GrinSendContext } from '@/types';
import { bytesToHex, hexToBytes } from '@/lib/crypto';
import { getAuthState } from '@/lib/storage';
import { isUnlocked } from '../state';
import {
  getGrinModule,
  ensureGrinKeysInitialized,
  getAuthenticatedUserId,
  fetchUnspentOutputs,
  getCurrentBlockHeight,
} from './helpers';
import {
  recordGrinOutput,
  recordGrinTransaction,
  lockGrinOutputs,
  unlockGrinOutputs,
  spendGrinOutputs,
  broadcastGrinTransaction,
  updateGrinTransactionStatus,
} from './backend';

// =============================================================================
// Send Flow - Create
// =============================================================================

/**
 * Create a Grin send transaction (S1 slatepack).
 *
 * This is the sender's first step in the SRS flow:
 * 1. Fetches available UTXOs from backend
 * 2. Selects inputs to cover amount + fee
 * 3. Creates change output (if any)
 * 4. Builds S1 slate with partial signature
 * 5. Encodes as slatepack for recipient
 * 6. Records transaction and locks inputs on backend
 * 7. Returns sendContext needed for finalization
 *
 * The sendContext contains secret data (secretKey, secretNonce) needed
 * to finalize the transaction after receiving S2 from recipient.
 *
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param recipientAddress - Optional slatepack address for relay routing
 * @returns S1 slatepack and sendContext for finalization
 */
export async function handleGrinCreateSend(
  amount: number,
  fee: number,
  recipientAddress?: string
): Promise<MessageResponse<{
  slatepack: string;
  slateId: string;
  sendContext: GrinSendContext;
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

    // Create the send transaction (builds S1 slate)
    const grinModule = await getGrinModule();
    const result = await grinModule.createSendTransaction(
      keys,
      outputs,
      BigInt(amount),
      BigInt(fee),
      currentHeight,
      nextChildIndex,
      recipientAddress
    );

    // Record the transaction and lock inputs
    // If either fails, roll back to prevent orphaned locked outputs
    try {
      await recordGrinTransaction(userId, result.slate.id, amount, fee, 'send', recipientAddress);
      await lockGrinOutputs(userId, result.inputIds, result.slate.id);

      // Record change output now, before broadcast — if the service worker dies
      // between broadcast and recording, the change output would be lost forever.
      // If broadcast later fails, reconciliation will clean up the unconfirmed output.
      if (result.changeOutput) {
        await recordGrinOutput(userId, {
          keyId: result.changeOutput.keyId,
          nChild: result.changeOutput.nChild,
          amount: Number(result.changeOutput.amount),
          commitment: result.changeOutput.commitment,
        }, result.slate.id);
      }
    } catch (backendErr) {
      console.error('[Grin] Failed to record/lock, rolling back:', backendErr);
      try {
        await unlockGrinOutputs(userId, result.slate.id);
        await updateGrinTransactionStatus(userId, result.slate.id, 'cancelled');
      } catch (rollbackErr) {
        console.error('[Grin] Rollback also failed:', rollbackErr);
      }
      throw backendErr;
    }

    // Build send context for later finalization
    // Include serialized S1 slate - needed to decode compact S2 response
    const serializedS1Base64 = result.slate.serialized
      ? btoa(String.fromCharCode(...result.slate.serialized))
      : '';

    // Extract inputs from the raw slate - needed for finalization
    // (compact S2 doesn't include inputs)
    console.log('[Grin] result.slate.raw type:', typeof result.slate.raw);
    console.log('[Grin] result.slate.raw.getInputs type:', typeof result.slate.raw.getInputs);
    const rawInputs = result.slate.raw.getInputs?.() || [];
    console.log('[Grin] rawInputs from slate:', rawInputs, 'length:', rawInputs.length);
    if (rawInputs.length === 0) {
      console.error('[Grin] CRITICAL: No inputs extracted from slate.raw.getInputs()!');
    }
    const inputs = rawInputs.map((input: any) => ({
      commitment: bytesToHex(input.getCommit()),
      features: input.getFeatures(),
    }));
    console.log(`[Grin] Storing ${inputs.length} inputs in sendContext for finalization`);

    // Extract offset from slate
    const rawOffset = result.slate.raw.getOffset?.();
    const senderOffset = rawOffset ? bytesToHex(rawOffset) : '';
    console.log(`[Grin] Storing sender offset: ${senderOffset.substring(0, 16)}...`);

    const sendContext: GrinSendContext = {
      slateId: result.slate.id,
      secretKey: bytesToHex(result.secretKey),
      secretNonce: bytesToHex(result.secretNonce),
      inputIds: result.inputIds,
      serializedS1Slate: serializedS1Base64,
      inputs,
      senderOffset,
      changeOutput: result.changeOutput ? {
        keyId: result.changeOutput.keyId,
        nChild: result.changeOutput.nChild,
        amount: Number(result.changeOutput.amount),
        commitment: result.changeOutput.commitment,
        proof: result.changeOutput.proof,
      } : undefined,
    };

    // Clear sensitive data from memory
    result.secretKey.fill(0);
    result.secretNonce.fill(0);

    console.log(`[Grin] Created send slate ${result.slate.id}, amount: ${amount} nanogrin`);

    return {
      success: true,
      data: {
        slatepack: result.slatepack,
        slateId: result.slate.id,
        sendContext,
      },
    };
  } catch (err) {
    console.error('[Grin] Failed to create send transaction:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create send transaction',
    };
  }
}

// =============================================================================
// Send Flow - Finalize and Broadcast
// =============================================================================

/**
 * Finalize a Grin transaction and broadcast it.
 *
 * This is the sender's final step in the SRS flow:
 * 1. Receives S2 slatepack from recipient
 * 2. Reconstructs S1 slate from sendContext
 * 3. Adds stored inputs/outputs to reconstructed slate
 * 4. Finalizes to S3 (combines signatures, builds kernel)
 * 5. Broadcasts transaction to network
 * 6. Updates backend records (mark inputs spent, record change)
 *
 * @param slatepackString - S2 slatepack from recipient
 * @param sendContext - Context from handleGrinCreateSend
 * @returns Broadcast status
 */
export async function handleGrinFinalizeAndBroadcast(
  slatepackString: string,
  sendContext: GrinSendContext
): Promise<MessageResponse<{ broadcast: boolean; txid?: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();

    // Decode sendContext secrets
    const secretKey = hexToBytes(sendContext.secretKey);
    const secretNonce = hexToBytes(sendContext.secretNonce);

    // Reconstruct the S1 slate from serialized data
    // Needed because compact S2 doesn't include all fields
    if (!sendContext.serializedS1Slate) {
      return { success: false, error: 'Missing serialized S1 slate - cannot finalize' };
    }

    // Decode base64 to Uint8Array
    const grinModule = await getGrinModule();
    const serializedBytes = Uint8Array.from(atob(sendContext.serializedS1Slate), c => c.charCodeAt(0));
    const initialSlate = await grinModule.reconstructSlateFromSerialized(serializedBytes);
    console.log('[Grin] Reconstructed S1 slate for finalization, id:', initialSlate.id);

    // Add inputs to the reconstructed slate
    console.log('[Grin] sendContext.inputs:', sendContext.inputs);
    if (sendContext.inputs && sendContext.inputs.length > 0) {
      console.log('[Grin] Adding', sendContext.inputs.length, 'inputs to reconstructed S1 slate');
      console.log('[Grin] Input commitments:', sendContext.inputs.map(i => i.commitment.substring(0, 16) + '...'));
      await grinModule.addInputsToSlate(initialSlate, sendContext.inputs);
      const inputCount = initialSlate.raw.getInputs?.()?.length ?? 0;
      console.log('[Grin] Inputs added to S1 slate, verified count:', inputCount);
      if (inputCount === 0) {
        console.error('[Grin] CRITICAL: addInputsToSlate did not add inputs to slate!');
      }
    } else {
      console.error('[Grin] CRITICAL: No inputs in sendContext! This sendContext was created before the fix.');
      return { success: false, error: 'Transaction state is outdated. Please cancel and create a new send.' };
    }

    // Add change output to the reconstructed slate
    if (sendContext.changeOutput?.proof) {
      console.log('[Grin] Adding change output to reconstructed S1 slate');
      console.log('[Grin] Change commitment:', sendContext.changeOutput.commitment.substring(0, 16) + '...');
      await grinModule.addOutputsToSlate(initialSlate, [{
        commitment: sendContext.changeOutput.commitment,
        proof: sendContext.changeOutput.proof,
      }]);
      const outputCount = initialSlate.raw.getOutputs?.()?.length ?? 0;
      console.log('[Grin] Outputs added to S1 slate, verified count:', outputCount);
    } else if (sendContext.changeOutput) {
      console.error('[Grin] CRITICAL: sendContext.changeOutput missing proof. Created before fix.');
      return { success: false, error: 'Transaction state is outdated (missing output proof). Please cancel and create a new send.' };
    } else {
      console.log('[Grin] No change output (exact amount send)');
    }

    // Check sender's offset
    if (sendContext.senderOffset) {
      const isZeroOffset = sendContext.senderOffset === '0'.repeat(64);
      console.log('[Grin] Sender offset:', isZeroOffset ? 'zero (correct)' : sendContext.senderOffset.substring(0, 16) + '... (non-zero)');
      if (!isZeroOffset) {
        console.warn('[Grin] Non-zero offset detected. This transaction may have been created before the fix.');
      }
    }

    // Finalize the slate (S2 -> S3)
    const finalizedSlate = await grinModule.finalizeSlate(
      keys,
      slatepackString,
      initialSlate,
      secretKey,
      secretNonce
    );

    // Clear sensitive data
    secretKey.fill(0);
    secretNonce.fill(0);

    // Get the transaction JSON for broadcast
    const txJson = grinModule.getTransactionJson(finalizedSlate);
    console.log('[Grin] Transaction JSON for broadcast:', JSON.stringify(txJson).substring(0, 100) + '...');

    // Broadcast to network via backend
    const broadcastResult = await broadcastGrinTransaction(userId, sendContext.slateId, txJson);

    if (!broadcastResult.success) {
      // Unlock inputs on failure
      await unlockGrinOutputs(userId, sendContext.slateId);
      return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
    }

    // Mark inputs as spent
    await spendGrinOutputs(userId, sendContext.slateId);

    // Change output was already recorded in handleGrinCreateSend (before broadcast)
    // to prevent loss if the service worker dies between broadcast and recording.

    // Update transaction status
    await updateGrinTransactionStatus(userId, sendContext.slateId, 'finalized');

    console.log(`[Grin] Finalized and broadcast slate ${sendContext.slateId}`);

    return {
      success: true,
      data: { broadcast: true },
    };
  } catch (err) {
    console.error('[Grin] Failed to finalize and broadcast:', err);

    // Try to unlock inputs on error
    try {
      const auth = await getAuthState();
      if (auth?.userId) {
        await unlockGrinOutputs(auth.userId, sendContext.slateId);
      }
    } catch {
      // Ignore unlock errors
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize transaction',
    };
  }
}
