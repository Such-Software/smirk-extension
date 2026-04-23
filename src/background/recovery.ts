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
import { initGrinWallet } from '@/lib/grin';
import { bytesToHex } from '@/lib/crypto';
import { api } from '@/lib/api';
import {
  unlockedMnemonic,
  setGrinWasmKeys,
} from './state';
import { handleGrinCreateSend, handleGrinFinalizeAndBroadcast, handleGrinSignSlatepack } from './grin';
import { handleGetBalance } from './balance';

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

  // === GRIN SWEEP ===
  try {
    // Check Grin balance from backend (uses DB, not LWS)
    const grinBal = await handleGetBalance('grin');
    let grinBalance = 0;
    if (grinBal.success) {
      const d = grinBal as { success: true; data: unknown };
      const obj = d.data as { confirmed?: number; total?: number } | null;
      grinBalance = obj?.confirmed || obj?.total || 0;
    }
    status.grin.balance = grinBalance;

    if (grinBalance > 0) {
      console.log(`[Recovery] Grin balance: ${grinBalance} nanogrin`);
      status.grin.status = 'sweeping';

      try {
        const feeBuffer = 30000000;
        const sendAmount = grinBalance - feeBuffer;

        if (sendAmount <= 0) {
          status.grin.status = 'error';
          status.grin.error = 'Balance too small (less than fee)';
        } else {
          // Use the NORMAL initGrinWallet (through wallet.ts) — NOT initGrinWalletAtPath!
          // initGrinWalletAtPath produces a different key despite same path prefix.
          // The normal initGrinWallet goes through the correct MWC code path.
          const grinKeys = await initGrinWallet(unlockedMnemonic!);
          setGrinWasmKeys(grinKeys);
          console.log('[Recovery] Grin S1: using initGrinWallet, addr:', grinKeys.slatepackAddress);

          const sendResult = await handleGrinCreateSend(sendAmount, feeBuffer, undefined);
          if (!sendResult.success || !sendResult.data) {
            throw new Error('S1 create failed');
          }
          console.log('[Recovery] Grin S1 created:', sendResult.data.slateId);

          // S2: use same keys (same wallet, self-send)
          // No need to reinit — keys are already correct

          const signResult = await handleGrinSignSlatepack(sendResult.data.slatepack);
          if (!signResult.success || !signResult.data) {
            throw new Error('S2 sign failed');
          }
          console.log('[Recovery] Grin S2 signed');

          // S3: same keys, just finalize
          console.log('[Recovery] Grin S3: finalizing with same keys');

          const finalizeResult = await handleGrinFinalizeAndBroadcast(
            signResult.data.signedSlatepack,
            sendResult.data.sendContext
          );

          if (finalizeResult.success) {
            status.grin.txHash = sendResult.data.slateId;
            status.grin.status = 'swept';
            console.log(`[Recovery] Grin swept and broadcast: ${sendResult.data.slateId}`);
          } else {
            status.grin.status = 'error';
            status.grin.error = 'Failed to finalize/broadcast';
          }
        }

        // Restore new path keys
        const finalKeys = await initGrinWallet(unlockedMnemonic!);
        setGrinWasmKeys(finalKeys);
        console.log('[Recovery] Grin WASM restored to new path');
      } catch (err) {
        status.grin.status = 'error';
        status.grin.error = err instanceof Error ? err.message : 'Grin sweep failed';
        console.error('[Recovery] Grin sweep failed:', err);

        // Try to restore new path keys on error
        try {
          const newKeys = await initGrinWallet(unlockedMnemonic!);
          setGrinWasmKeys(newKeys);
        } catch { /* ignore */ }
      }
    } else {
      status.grin.status = 'no_balance';
      console.log('[Recovery] No Grin balance');
    }
  } catch (err) {
    status.grin.status = 'error';
    status.grin.error = err instanceof Error ? err.message : 'Balance check failed';
  }

  console.log('[Recovery] Complete:', JSON.stringify(status));
  return { success: true, data: status };
}
