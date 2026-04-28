/**
 * Grin Receive Operations
 *
 * Sign incoming slatepacks as recipient.
 */

import type { MessageResponse } from '@/types';
import { api } from '@/lib/api';
import { isUnlocked } from '../state';
import {
  getGrinModule,
  ensureGrinKeysInitialized,
  getAuthenticatedUserId,
  getNextChildIndex,
} from './helpers';
import { recordGrinOutput, recordGrinTransaction, setGrinKernelExcess } from './backend';

// =============================================================================
// Receive Flow (Sign Slate)
// =============================================================================

/**
 * Sign an incoming slate as recipient (via relay).
 *
 * This is the receiver's step in the SRS flow:
 * 1. Decodes the S1 slatepack from sender
 * 2. Creates our output commitment using next available n_child
 * 3. Adds our partial signature
 * 4. Encodes S2 slatepack response
 * 5. Submits to relay for sender to finalize
 * 6. Records output and transaction to backend
 *
 * @param relayId - ID of the pending relay slatepack
 * @param slatepack - S1 slatepack string from sender
 * @returns Sign status
 */
export async function handleGrinSignSlate(
  relayId: string,
  slatepack: string
): Promise<MessageResponse<{ signed: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();
    const nextChildIndex = await getNextChildIndex(userId);
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes S1, adds our signature, returns S2 slate and output info)
    const grinModule = await getGrinModule();
    const { slate: signedSlate, outputInfo } = await grinModule.signSlate(keys, slatepack, nextChildIndex);

    // Encode the signed slate as a slatepack response for the sender
    const signedSlatepack = await grinModule.encodeSlatepack(keys, signedSlate, 'response');

    // Submit signed slatepack to relay
    const result = await api.signGrinSlatepack({
      relayId,
      userId,
      signedSlatepack,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Record the received output to backend (updates balance)
    await recordGrinOutput(userId, {
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: Number(outputInfo.amount),
      commitment: outputInfo.commitment,
    }, signedSlate.id);

    console.log(`[Grin] Signed slate ${signedSlate.id}, amount: ${signedSlate.amount} nanogrin`);

    return { success: true, data: { signed: true } };
  } catch (err) {
    console.error('[Grin] Failed to sign slate:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign slate',
    };
  }
}

/**
 * Sign a slatepack directly (no relay).
 *
 * This is the standard Grin receive flow for out-of-band slatepack exchange:
 * 1. Sender creates S1 slatepack and gives it to receiver (paste, QR, etc.)
 * 2. Receiver calls this function with S1, gets S2 slatepack back
 * 3. Receiver gives S2 back to sender (paste, QR, etc.)
 * 4. Sender finalizes and broadcasts
 *
 * @param slatepackString - S1 slatepack from sender
 * @returns Signed S2 slatepack and transaction info
 */
export async function handleGrinSignSlatepack(
  slatepackString: string
): Promise<MessageResponse<{ signedSlatepack: string; slateId: string; amount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const keys = await ensureGrinKeysInitialized();
    const userId = await getAuthenticatedUserId();
    const nextChildIndex = await getNextChildIndex(userId);
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes S1, adds our signature, returns S2)
    const grinModule = await getGrinModule();
    const { slate: signedSlate, outputInfo, kernelExcess } = await grinModule.signSlate(keys, slatepackString, nextChildIndex);

    // Encode the signed slate as a slatepack response
    const signedSlatepack = await grinModule.encodeSlatepack(keys, signedSlate, 'response');

    console.log(`[Grin] Signed slatepack, amount: ${signedSlate.amount} nanogrin, output: ${outputInfo.commitment}`);

    // Record the received output to backend
    console.log('[Grin] Recording output to backend...', {
      userId,
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: Number(outputInfo.amount),
      commitment: outputInfo.commitment,
      txSlateId: signedSlate.id,
    });
    await recordGrinOutput(userId, {
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: Number(outputInfo.amount),
      commitment: outputInfo.commitment,
    }, signedSlate.id);

    // Record the transaction for history/balance
    console.log('[Grin] Recording transaction to backend...');
    await recordGrinTransaction(
      userId,
      signedSlate.id,
      Number(signedSlate.amount),
      0, // Receiver doesn't pay fee
      'receive'
    );

    // Stamp the kernel excess on the receive row. The on-chain kernel id
    // is determined at S2; without this step, receives from non-Smirk
    // senders (grin-wallet/Grim) end up confirmed but with no kernel id
    // in our DB — block-explorer links break and history shows the slate
    // id (which can't be searched on chain).
    if (kernelExcess) {
      try {
        await setGrinKernelExcess(userId, signedSlate.id, kernelExcess);
      } catch (err) {
        console.warn('[Grin] Failed to stamp kernel excess (non-fatal):', err);
      }
    }

    return {
      success: true,
      data: {
        signedSlatepack,
        slateId: signedSlate.id,
        amount: Number(signedSlate.amount),
      },
    };
  } catch (err) {
    console.error('[Grin] Failed to sign slatepack:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to sign slatepack',
    };
  }
}
