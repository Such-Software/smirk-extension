/**
 * Legacy Fund Recovery
 *
 * Sweeps funds from old v1/v2 addresses to new v3 addresses.
 * Used after migration when the auto-sweep failed or was skipped.
 */

import type { MessageResponse } from '@/types';
import { deriveAllKeys } from '@/lib/hd';
import { xmrAddress, wowAddress } from '@/lib/address';
import { sendTransaction } from '@/lib/xmr-tx';
import { initGrinWallet, calculateGrinFee } from '@/lib/grin';
import { bytesToHex } from '@/lib/crypto';
import { api } from '@/lib/api';
import {
  unlockedMnemonic,
  setGrinWasmKeys,
} from './state';
import { handleGrinCreateSend, handleGrinFinalizeAndBroadcast, handleGrinSignSlatepack } from './grin';
import { getAuthenticatedUserId, fetchUnspentOutputs } from './grin/helpers';

interface RecoveryStatus {
  xmr: { status: string; balance?: number; txHash?: string; error?: string };
  wow: { status: string; balance?: number; txHash?: string; error?: string };
  grin: { status: string; balance?: number; txHash?: string; error?: string };
}

/**
 * Recover funds from old v1/v2 addresses to new v3 addresses.
 *
 * Tries sweeping from both v1 and v2 addresses to v3 destination.
 * Handles all migration paths: v1→v3 and v2→v3.
 */
export async function handleRecoverV1Funds(): Promise<MessageResponse<RecoveryStatus>> {
  if (!unlockedMnemonic) {
    return { success: false, error: 'Wallet must be unlocked' };
  }

  const v1Keys = deriveAllKeys(unlockedMnemonic, '', 1);
  const v2Keys = deriveAllKeys(unlockedMnemonic, '', 2);
  const v3Keys = deriveAllKeys(unlockedMnemonic, '', 3);

  const newXmrAddr = xmrAddress(v3Keys.xmr.publicSpendKey, v3Keys.xmr.publicViewKey);
  const newWowAddr = wowAddress(v3Keys.wow.publicSpendKey, v3Keys.wow.publicViewKey);

  // Build list of old address sources to try (v1 and v2)
  const oldSources = [
    { version: 1, keys: v1Keys },
    { version: 2, keys: v2Keys },
  ];

  console.log('[Recovery] New XMR (v3):', newXmrAddr);
  console.log('[Recovery] New WOW (v3):', newWowAddr);

  const status: RecoveryStatus = {
    xmr: { status: 'checking' },
    wow: { status: 'checking' },
    grin: { status: 'checking' },
  };

  // === XMR SWEEP (try v1 and v2 sources) ===
  for (const source of oldSources) {
    const oldXmrAddr = xmrAddress(source.keys.xmr.publicSpendKey, source.keys.xmr.publicViewKey);
    if (oldXmrAddr === newXmrAddr) continue; // Same address, skip

    try {
      const xmrBalResult = await api.getLwsBalance('xmr', oldXmrAddr, bytesToHex(source.keys.xmr.privateViewKey));
      const totalReceived = xmrBalResult.data?.total_received || 0;

      if (totalReceived > 0) {
        console.log(`[Recovery] XMR v${source.version} total_received at old address: ${totalReceived}`);
        status.xmr.balance = (status.xmr.balance || 0) + totalReceived;
        status.xmr.status = 'sweeping';

        try {
          const result = await sendTransaction(
            'xmr', oldXmrAddr,
            bytesToHex(source.keys.xmr.privateViewKey),
            bytesToHex(source.keys.xmr.privateSpendKey),
            newXmrAddr, 0, 'mainnet', true
          );
          status.xmr.txHash = result.txHash;
          status.xmr.status = 'swept';
          console.log(`[Recovery] XMR v${source.version} swept: ${result.txHash}`);
        } catch (err) {
          status.xmr.status = 'error';
          status.xmr.error = err instanceof Error ? err.message : 'Sweep failed';
          console.error(`[Recovery] XMR v${source.version} sweep failed:`, err);
        }
      } else if (status.xmr.status === 'checking') {
        status.xmr.status = 'no_balance';
      }
    } catch (err) {
      if (status.xmr.status === 'checking') {
        status.xmr.status = 'error';
        status.xmr.error = err instanceof Error ? err.message : 'Balance check failed';
      }
    }
  }

  // === WOW SWEEP (try v1 and v2 sources) ===
  for (const source of oldSources) {
    const oldWowAddr = wowAddress(source.keys.wow.publicSpendKey, source.keys.wow.publicViewKey);
    if (oldWowAddr === newWowAddr) continue; // Same address, skip

    try {
      const wowBalResult = await api.getLwsBalance('wow', oldWowAddr, bytesToHex(source.keys.wow.privateViewKey));
      const totalReceived = wowBalResult.data?.total_received || 0;

      if (totalReceived > 0) {
        console.log(`[Recovery] WOW v${source.version} total_received at old address: ${totalReceived}`);
        status.wow.balance = (status.wow.balance || 0) + totalReceived;
        status.wow.status = 'sweeping';

        try {
          const result = await sendTransaction(
            'wow', oldWowAddr,
            bytesToHex(source.keys.wow.privateViewKey),
            bytesToHex(source.keys.wow.privateSpendKey),
            newWowAddr, 0, 'mainnet', true
          );
          status.wow.txHash = result.txHash;
          status.wow.status = 'swept';
          console.log(`[Recovery] WOW v${source.version} swept: ${result.txHash}`);
        } catch (err) {
          status.wow.status = 'error';
          status.wow.error = err instanceof Error ? err.message : 'Sweep failed';
          console.error(`[Recovery] WOW v${source.version} sweep failed:`, err);
        }
      } else if (status.wow.status === 'checking') {
        status.wow.status = 'no_balance';
      }
    } catch (err) {
      if (status.wow.status === 'checking') {
        status.wow.status = 'error';
        status.wow.error = err instanceof Error ? err.message : 'Balance check failed';
      }
    }
  }

  // === GRIN SWEEP (old BIP39 keys → new raw-entropy keys) ===
  try {
    // Query unspent outputs from backend
    const userId = await getAuthenticatedUserId();
    const { outputs } = await fetchUnspentOutputs(userId);

    if (outputs.length === 0) {
      status.grin.status = 'no_balance';
      status.grin.balance = 0;
      console.log('[Recovery] Grin: no unspent outputs');
    } else {
      const totalBalance = outputs.reduce((sum, o) => sum + o.amount, BigInt(0));
      status.grin.balance = Number(totalBalance);
      console.log(`[Recovery] Grin balance: ${totalBalance} nanogrin (${outputs.length} outputs)`);
      status.grin.status = 'sweeping';

      try {
        // Calculate exact sweep amount (no change output)
        const fee = calculateGrinFee(outputs.length, 1, 1);
        const sendAmount = Number(totalBalance - fee);

        if (sendAmount <= 0) {
          status.grin.status = 'error';
          status.grin.error = 'Balance too small (less than fee)';
        } else {
          // Cross-wallet sweep: old BIP39 keys (sender) → new raw-entropy keys (receiver)
          // SRS flow: S1 create (old) → S2 sign (new) → S3 finalize+broadcast (old)

          // Step 1: Init OLD keys (useBip39=true) as sender
          const oldKeys = await initGrinWallet(unlockedMnemonic!, true);
          setGrinWasmKeys(oldKeys);
          console.log('[Recovery] Grin sender (old BIP39):', oldKeys.slatepackAddress);

          // Step 2: S1 create with old keys
          const sendResult = await handleGrinCreateSend(sendAmount, 0);
          if (!sendResult.success || !sendResult.data) {
            throw new Error(`S1 create failed: ${sendResult.success === false ? sendResult.error : 'no data'}`);
          }
          console.log('[Recovery] Grin S1 created:', sendResult.data.slateId);

          // Step 3: Init NEW keys (useBip39=false) as receiver
          const newKeys = await initGrinWallet(unlockedMnemonic!, false);
          setGrinWasmKeys(newKeys);
          console.log('[Recovery] Grin receiver (grin-wallet compat):', newKeys.slatepackAddress);

          // Step 4: S2 sign with new keys (cross-wallet receive)
          const signResult = await handleGrinSignSlatepack(sendResult.data.slatepack);
          if (!signResult.success || !signResult.data) {
            throw new Error(`S2 sign failed: ${signResult.success === false ? signResult.error : 'no data'}`);
          }
          console.log('[Recovery] Grin S2 signed (cross-wallet)');

          // Step 5: Restore OLD keys for finalization
          setGrinWasmKeys(oldKeys);

          // Step 6: S3 finalize and broadcast with old keys
          const finalizeResult = await handleGrinFinalizeAndBroadcast(
            signResult.data.signedSlatepack,
            sendResult.data.sendContext
          );

          if (finalizeResult.success) {
            status.grin.txHash = sendResult.data.slateId;
            status.grin.status = 'swept';
            console.log(`[Recovery] Grin swept: ${sendResult.data.slateId}`);
          } else {
            status.grin.status = 'error';
            status.grin.error = 'Failed to finalize/broadcast';
          }

          // Set NEW keys for ongoing use
          setGrinWasmKeys(newKeys);
        }
      } catch (err) {
        status.grin.status = 'error';
        status.grin.error = err instanceof Error ? err.message : 'Grin sweep failed';
        console.error('[Recovery] Grin sweep failed:', err);

        // Try to restore correct keys on error
        try {
          const newKeys = await initGrinWallet(unlockedMnemonic!, false);
          setGrinWasmKeys(newKeys);
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    status.grin.status = 'error';
    status.grin.error = err instanceof Error ? err.message : 'Balance check failed';
  }

  console.log('[Recovery] Complete:', JSON.stringify(status));
  return { success: true, data: status };
}
