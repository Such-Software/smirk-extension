/**
 * Grin WASM Wallet Handlers
 *
 * This module handles all Grin-specific operations using client-side WASM:
 * - Wallet initialization from mnemonic
 * - Receive flow (sign incoming slatepacks)
 * - Send flow (create, finalize, broadcast transactions)
 * - Output management (record, lock, spend)
 *
 * Grin Transaction Model (Mimblewimble):
 * Unlike BTC/LTC, Grin uses interactive transactions requiring both parties
 * to participate in building the transaction. This is called "slates".
 *
 * SRS Flow (Standard Send):
 * 1. Sender creates S1 slate (selects inputs, creates partial signature)
 * 2. Sender sends S1 slatepack to Recipient
 * 3. Recipient signs S2 (adds output, partial signature)
 * 4. Recipient sends S2 slatepack back to Sender
 * 5. Sender finalizes S3 (combines signatures, builds kernel)
 * 6. Sender broadcasts transaction to network
 *
 * Key Derivation:
 * - Uses MWC Wallet library (WebAssembly)
 * - Derives keys from BIP39 mnemonic using HMAC key "IamVoldemort"
 * - Each output gets a unique n_child index (MUST never be reused!)
 * - Commitment = amount*H + blind*G (Pedersen commitment)
 *
 * Security Note:
 * The n_child index MUST be unique across ALL outputs (including spent).
 * Reusing n_child would create duplicate commitments, which the network
 * rejects as a double-spend attempt.
 */

import type { MessageResponse, GrinSendContext } from '@/types';
import { bytesToHex, hexToBytes } from '@/lib/crypto';
import { getAuthState } from '@/lib/storage';
import { api } from '@/lib/api';
import {
  initGrinWallet,
  signSlate,
  encodeSlatepack,
  createSendTransaction,
  finalizeSlate,
  reconstructSlateFromSerialized,
  addInputsToSlate,
  addOutputsToSlate,
  getTransactionJson,
  createInvoice,
  signInvoice,
  finalizeInvoice,
  type GrinKeys,
  type GrinOutput,
} from '@/lib/grin';
import {
  isUnlocked,
  grinWasmKeys,
  setGrinWasmKeys,
  unlockedMnemonic,
  persistSessionKeys,
} from './state';

// =============================================================================
// Wallet Initialization
// =============================================================================

/**
 * Initialize the Grin WASM wallet and return the slatepack address.
 *
 * The Grin wallet uses MWC's WebAssembly implementation for all
 * cryptographic operations. Keys are derived from the BIP39 mnemonic
 * using the MWC Seed class.
 *
 * Keys can be initialized from:
 * 1. Cached grinWasmKeys (already initialized this session)
 * 2. Session storage (restored after service worker restart)
 * 3. Mnemonic (fresh unlock - derives keys and persists to session)
 *
 * @returns Slatepack address (bech32-encoded ed25519 pubkey for receiving)
 */
export async function handleInitGrinWallet(): Promise<MessageResponse<{
  slatepackAddress: string;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  // Return cached keys if already initialized (or restored from session)
  if (grinWasmKeys) {
    return {
      success: true,
      data: { slatepackAddress: grinWasmKeys.slatepackAddress },
    };
  }

  // MWC Seed class requires the mnemonic string, not the 64-byte BIP39 seed
  // Valid seed lengths for MWC are 16/20/24/28/32 bytes (raw entropy), not 64 bytes
  if (!unlockedMnemonic) {
    return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
  }

  try {
    // Initialize Grin WASM wallet with mnemonic
    const keys = await initGrinWallet(unlockedMnemonic);
    setGrinWasmKeys(keys);

    // Persist the extended key to session storage so it survives service worker restarts
    // NOTE: We only store the extended key, NOT the mnemonic - this limits exposure to Grin only
    await persistSessionKeys();

    return {
      success: true,
      data: { slatepackAddress: keys.slatepackAddress },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to initialize Grin wallet',
    };
  }
}

// =============================================================================
// Pending Slatepacks (Relay)
// =============================================================================

/**
 * Get pending slatepacks for the current user.
 *
 * Returns two lists:
 * - pendingToSign: S1 slatepacks waiting for us to sign (as recipient)
 * - pendingToFinalize: S2 slatepacks waiting for us to finalize (as sender)
 *
 * The relay system allows Smirk-to-Smirk transfers without manual
 * slatepack copying.
 *
 * @returns Lists of pending slatepacks
 */
export async function handleGetGrinPendingSlatepacks(): Promise<MessageResponse<{
  pendingToSign: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
  pendingToFinalize: Array<{
    id: string;
    slateId: string;
    senderUserId: string;
    amount: number;
    slatepack: string;
    createdAt: string;
    expiresAt: string;
  }>;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await api.getGrinPendingSlatepacks(authState.userId);
    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        pendingToSign: result.data!.pending_to_sign.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
        pendingToFinalize: result.data!.pending_to_finalize.map(s => ({
          id: s.id,
          slateId: s.slate_id,
          senderUserId: s.sender_user_id,
          amount: s.amount,
          slatepack: s.slatepack,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch pending slatepacks',
    };
  }
}

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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the next available child index for key derivation
    // CRITICAL: This ensures we don't reuse blinding factors
    // Reusing n_child would create duplicate commitments (network rejects)
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }
    const nextChildIndex = outputsResult.data?.next_child_index ?? 0;
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes S1, adds our signature, returns S2 slate and output info)
    const { slate: signedSlate, outputInfo } = await signSlate(keys, slatepack, nextChildIndex);

    // Encode the signed slate as a slatepack response for the sender
    const signedSlatepack = await encodeSlatepack(keys, signedSlate, 'response');

    // Submit signed slatepack to relay
    const result = await api.signGrinSlatepack({
      relayId,
      userId: authState.userId,
      signedSlatepack,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Record the received output to backend (updates balance)
    try {
      const recordResult = await api.recordGrinOutput({
        userId: authState.userId,
        keyId: outputInfo.keyId,
        nChild: outputInfo.nChild,
        amount: Number(outputInfo.amount),
        commitment: outputInfo.commitment,
        txSlateId: signedSlate.id,
      });
      if (recordResult.error) {
        console.warn('[Grin] Failed to record output (non-fatal):', recordResult.error);
      } else {
        console.log(`[Grin] Recorded output ${outputInfo.commitment} for ${outputInfo.amount} nanogrin`);
      }
    } catch (recordErr) {
      console.warn('[Grin] Failed to record output (non-fatal):', recordErr);
    }

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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID (needed to record output)
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the next available child index
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }
    const nextChildIndex = outputsResult.data?.next_child_index ?? 0;
    console.log(`[Grin] Using next_child_index: ${nextChildIndex}`);

    // Sign the slate (decodes S1, adds our signature, returns S2)
    const { slate: signedSlate, outputInfo } = await signSlate(keys, slatepackString, nextChildIndex);

    // Encode the signed slate as a slatepack response
    const signedSlatepack = await encodeSlatepack(keys, signedSlate, 'response');

    console.log(`[Grin] Signed slatepack, amount: ${signedSlate.amount} nanogrin, output: ${outputInfo.commitment}`);

    // Record the received output to backend
    console.log('[Grin] Recording output to backend...', {
      userId: authState.userId,
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: Number(outputInfo.amount),
      commitment: outputInfo.commitment,
      txSlateId: signedSlate.id,
    });
    try {
      const recordResult = await api.recordGrinOutput({
        userId: authState.userId,
        keyId: outputInfo.keyId,
        nChild: outputInfo.nChild,
        amount: Number(outputInfo.amount),
        commitment: outputInfo.commitment,
        txSlateId: signedSlate.id,
      });
      console.log('[Grin] recordGrinOutput result:', JSON.stringify(recordResult));
      if (recordResult.error) {
        console.error('[Grin] Failed to record output:', recordResult.error);
      } else {
        console.log(`[Grin] Recorded output ${outputInfo.commitment} for ${outputInfo.amount} nanogrin, id: ${recordResult.data?.id}`);
      }
    } catch (recordErr) {
      // Non-fatal - the signing worked, we just couldn't record the output
      console.error('[Grin] Exception recording output:', recordErr);
    }

    // Record the transaction for history/balance
    console.log('[Grin] Recording transaction to backend...', {
      userId: authState.userId,
      slateId: signedSlate.id,
      amount: Number(signedSlate.amount),
      direction: 'receive',
    });
    try {
      const txResult = await api.recordGrinTransaction({
        userId: authState.userId,
        slateId: signedSlate.id,
        amount: Number(signedSlate.amount),
        fee: 0, // Receiver doesn't pay fee
        direction: 'receive',
      });
      console.log('[Grin] recordGrinTransaction result:', JSON.stringify(txResult));
      if (txResult.error) {
        console.error('[Grin] Failed to record transaction:', txResult.error);
      } else {
        console.log(`[Grin] Recorded receive transaction ${signedSlate.id}, id: ${txResult.data?.id}`);
      }
    } catch (txErr) {
      console.error('[Grin] Exception recording transaction:', txErr);
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

// =============================================================================
// Send Flow
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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch UTXOs from backend
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }

    const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

    // Filter to only unspent outputs and convert to GrinOutput format
    const outputs: GrinOutput[] = rawOutputs
      .filter(o => o.status === 'unspent')
      .map(o => ({
        id: o.id,
        keyId: o.key_id,
        nChild: o.n_child,
        amount: BigInt(o.amount),
        commitment: o.commitment,
        isCoinbase: o.is_coinbase,
        blockHeight: o.block_height ?? undefined,
      }));

    if (outputs.length === 0) {
      return { success: false, error: 'No unspent outputs available' };
    }

    // Get current blockchain height (for lock height calculations)
    const heightsResult = await api.getBlockchainHeights();
    if (heightsResult.error || !heightsResult.data?.grin) {
      return { success: false, error: 'Failed to get blockchain height' };
    }
    const currentHeight = BigInt(heightsResult.data.grin);

    // Create the send transaction (builds S1 slate)
    const result = await createSendTransaction(
      keys,
      outputs,
      BigInt(amount),
      BigInt(fee),
      currentHeight,
      nextChildIndex,
      recipientAddress
    );

    // Record the transaction FIRST (so lock can reference it)
    await api.recordGrinTransaction({
      userId: authState.userId,
      slateId: result.slate.id,
      amount,
      fee,
      direction: 'send',
      counterpartyAddress: recipientAddress,
    });

    // Lock the inputs on the backend
    // This prevents double-spending and links outputs to the transaction
    await api.lockGrinOutputs({
      userId: authState.userId,
      outputIds: result.inputIds,
      txSlateId: result.slate.id,
    });

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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Decode sendContext secrets
    const secretKey = hexToBytes(sendContext.secretKey);
    const secretNonce = hexToBytes(sendContext.secretNonce);

    // Reconstruct the S1 slate from serialized data
    // Needed because compact S2 doesn't include all fields
    if (!sendContext.serializedS1Slate) {
      return { success: false, error: 'Missing serialized S1 slate - cannot finalize' };
    }

    // Decode base64 to Uint8Array
    const serializedBytes = Uint8Array.from(atob(sendContext.serializedS1Slate), c => c.charCodeAt(0));
    const initialSlate = await reconstructSlateFromSerialized(serializedBytes);
    console.log('[Grin] Reconstructed S1 slate for finalization, id:', initialSlate.id);

    // Add inputs to the reconstructed slate
    console.log('[Grin] sendContext.inputs:', sendContext.inputs);
    if (sendContext.inputs && sendContext.inputs.length > 0) {
      console.log('[Grin] Adding', sendContext.inputs.length, 'inputs to reconstructed S1 slate');
      console.log('[Grin] Input commitments:', sendContext.inputs.map(i => i.commitment.substring(0, 16) + '...'));
      await addInputsToSlate(initialSlate, sendContext.inputs);
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
      await addOutputsToSlate(initialSlate, [{
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
    const finalizedSlate = await finalizeSlate(
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
    const txJson = getTransactionJson(finalizedSlate);
    console.log('[Grin] Transaction JSON for broadcast:', JSON.stringify(txJson).substring(0, 100) + '...');

    // Broadcast to network via backend
    const broadcastResult = await api.broadcastGrinTransaction({
      userId: authState.userId,
      slateId: sendContext.slateId,
      tx: txJson,
    });

    if (broadcastResult.error) {
      // Unlock inputs on failure
      await api.unlockGrinOutputs({ userId: authState.userId, txSlateId: sendContext.slateId });
      return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
    }

    // Mark inputs as spent
    await api.spendGrinOutputs({
      userId: authState.userId,
      txSlateId: sendContext.slateId,
    });

    // Record change output if any
    if (sendContext.changeOutput) {
      await api.recordGrinOutput({
        userId: authState.userId,
        keyId: sendContext.changeOutput.keyId,
        nChild: sendContext.changeOutput.nChild,
        amount: sendContext.changeOutput.amount,
        commitment: sendContext.changeOutput.commitment,
        txSlateId: sendContext.slateId,
      });
    }

    // Update transaction status
    await api.updateGrinTransaction({
      userId: authState.userId,
      slateId: sendContext.slateId,
      status: 'finalized',
    });

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
        await api.unlockGrinOutputs({ userId: auth.userId, txSlateId: sendContext.slateId });
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

// =============================================================================
// Cancel Operations
// =============================================================================

/**
 * Cancel a pending slatepack (relay).
 *
 * Removes the slatepack from the relay system. Used when:
 * - Recipient declines to sign
 * - Transaction times out
 * - User manually cancels
 *
 * @param relayId - ID of the pending relay slatepack
 * @returns Cancel status
 */
export async function handleGrinCancelSlate(
  relayId: string
): Promise<MessageResponse<{ success: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  try {
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const result = await api.cancelGrinSlatepack({
      relayId,
      userId: authState.userId,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    return { success: true, data: { success: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel slatepack',
    };
  }
}

/**
 * Cancel a Grin send transaction.
 *
 * Unlocks the inputs and marks the transaction as cancelled.
 * Used when sender decides not to complete the transaction
 * (e.g., recipient never signs S2).
 *
 * @param slateId - Slate ID of the transaction
 * @param _inputIds - Deprecated, backend now looks up outputs by slate_id
 * @returns Cancel status
 */
export async function handleGrinCancelSend(
  slateId: string,
  _inputIds: string[] // Deprecated
): Promise<MessageResponse<{ cancelled: boolean }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const authState = await getAuthState();
  if (!authState?.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Unlock the inputs (backend finds them by slate_id)
    await api.unlockGrinOutputs({ userId: authState.userId, txSlateId: slateId });

    // Mark transaction as cancelled
    await api.updateGrinTransaction({
      userId: authState.userId,
      slateId,
      status: 'cancelled',
    });

    console.log(`[Grin] Cancelled send slate ${slateId}`);

    return {
      success: true,
      data: { cancelled: true },
    };
  } catch (err) {
    console.error('[Grin] Failed to cancel send:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel transaction',
    };
  }
}

/**
 * Finalize a slate via relay (deprecated).
 *
 * This flow requires storing slate state which isn't currently implemented.
 * Use handleGrinFinalizeAndBroadcast with sendContext instead.
 */
export async function handleGrinFinalizeSlate(
  _relayId: string,
  _slatepack: string
): Promise<MessageResponse<{ broadcast: boolean; txid?: string }>> {
  return {
    success: false,
    error: 'Grin send/finalize flow not yet implemented. Use receive flow for now.',
  };
}

// =============================================================================
// RSR Invoice Flow (Receive-Sign-Return)
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
 * @param expiryHours - Hours until invoice expires (default: 24)
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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get next child index (must be unique!)
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }
    const nextChildIndex = outputsResult.data?.next_child_index ?? 0;
    console.log(`[Grin Invoice] Using next_child_index: ${nextChildIndex}`);

    // Create the invoice (standard slatepack format)
    const result = await createInvoice(
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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch UTXOs from backend
    const outputsResult = await api.getGrinOutputs(authState.userId);
    if (outputsResult.error) {
      return { success: false, error: `Failed to fetch outputs: ${outputsResult.error}` };
    }

    const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

    // Filter to only unspent outputs
    const outputs: GrinOutput[] = rawOutputs
      .filter(o => o.status === 'unspent')
      .map(o => ({
        id: o.id,
        keyId: o.key_id,
        nChild: o.n_child,
        amount: BigInt(o.amount),
        commitment: o.commitment,
        isCoinbase: o.is_coinbase,
        blockHeight: o.block_height ?? undefined,
      }));

    if (outputs.length === 0) {
      return { success: false, error: 'No unspent outputs available' };
    }

    // Get current blockchain height
    const heightsResult = await api.getBlockchainHeights();
    if (heightsResult.error || !heightsResult.data?.grin) {
      return { success: false, error: 'Failed to get blockchain height' };
    }
    const currentHeight = BigInt(heightsResult.data.grin);

    // Sign the invoice (takes slatepack string directly)
    const result = await signInvoice(
      keys,
      invoiceSlatepack,
      outputs,
      currentHeight,
      nextChildIndex
    );

    console.log(`[Grin Invoice] Signing invoice ${result.slateId} for ${result.amount} nanogrin`);

    // Record the send transaction
    await api.recordGrinTransaction({
      userId: authState.userId,
      slateId: result.slateId,
      amount: Number(result.amount),
      fee: Number(result.fee),
      direction: 'send',
      counterpartyAddress: keys.slatepackAddress, // TODO: Get from invoice once we parse it
    });

    // Lock the inputs
    await api.lockGrinOutputs({
      userId: authState.userId,
      outputIds: result.inputIds,
      txSlateId: result.slateId,
    });

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
 * @param slateId - Original slate ID (for verification)
 * @param originalSlatepack - The I1 slatepack we created (needed to parse compact I2)
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
    // Ensure Grin WASM wallet is initialized
    let keys = grinWasmKeys;
    if (!keys) {
      if (!unlockedMnemonic) {
        return { success: false, error: 'Mnemonic not available - please re-unlock wallet' };
      }
      keys = await initGrinWallet(unlockedMnemonic);
      setGrinWasmKeys(keys);
    }

    // Get auth state for user ID
    const authState = await getAuthState();
    if (!authState?.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log(`[Grin Invoice] Finalizing invoice ${slateId}`);

    // Decode secrets
    const secretKey = hexToBytes(secretKeyHex);
    const secretNonce = hexToBytes(secretNonceHex);

    // Finalize the invoice transaction
    const finalizedSlate = await finalizeInvoice(
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
    await api.recordGrinTransaction({
      userId: authState.userId,
      slateId: finalizedSlate.id,
      amount: amount,
      fee: 0, // Receiver doesn't pay fee
      direction: 'receive',
      counterpartyAddress: '', // TODO: Get from parsed I2 slatepack
    });

    // Get the transaction JSON for broadcast
    const txJson = getTransactionJson(finalizedSlate);
    console.log('[Grin Invoice] Transaction JSON for broadcast');

    // Broadcast to network (this will UPDATE the record with kernel_excess)
    const broadcastResult = await api.broadcastGrinTransaction({
      userId: authState.userId,
      slateId: finalizedSlate.id,
      tx: txJson,
    });

    if (broadcastResult.error) {
      return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
    }

    // Record the received output
    await api.recordGrinOutput({
      userId: authState.userId,
      keyId: outputInfo.keyId,
      nChild: outputInfo.nChild,
      amount: amount,
      commitment: outputInfo.commitment,
      txSlateId: finalizedSlate.id,
    });

    // Update transaction status to finalized
    await api.updateGrinTransaction({
      userId: authState.userId,
      slateId: finalizedSlate.id,
      status: 'finalized',
    });

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
