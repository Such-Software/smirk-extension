/**
 * V1 Fund Recovery
 *
 * Sweeps funds from old v1 addresses to new v2 addresses.
 * Used after migration when the auto-sweep failed or was skipped.
 */

import type { MessageResponse } from '@/types';
import { deriveAllKeys } from '@/lib/hd';
import { xmrAddress, wowAddress } from '@/lib/address';
import { sendTransaction, type XmrAsset } from '@/lib/xmr-tx';
import { initGrinWalletAtPath, LEGACY_MWC_PATH } from './grin/helpers';
import { initGrinWallet } from '@/lib/grin';
import { bytesToHex } from '@/lib/crypto';
import { api } from '@/lib/api';
import {
  unlockedMnemonic,
  unlockedKeys,
  unlockedViewKeys,
  grinWasmKeys,
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
 * Recover funds from old v1 addresses to new v2 addresses.
 *
 * Derives v1 keys from mnemonic, checks balances at old addresses,
 * and sweeps any remaining funds to the current v2 addresses.
 */
export async function handleRecoverV1Funds(): Promise<MessageResponse<RecoveryStatus>> {
  if (!unlockedMnemonic) {
    return { success: false, error: 'Wallet must be unlocked' };
  }

  const v1Keys = deriveAllKeys(unlockedMnemonic, '', 1);
  const v2Keys = deriveAllKeys(unlockedMnemonic, '', 2);

  const oldXmrAddr = xmrAddress(v1Keys.xmr.publicSpendKey, v1Keys.xmr.publicViewKey);
  const oldWowAddr = wowAddress(v1Keys.wow.publicSpendKey, v1Keys.wow.publicViewKey);
  const newXmrAddr = xmrAddress(v2Keys.xmr.publicSpendKey, v2Keys.xmr.publicViewKey);
  const newWowAddr = wowAddress(v2Keys.wow.publicSpendKey, v2Keys.wow.publicViewKey);

  console.log('[Recovery] Old XMR:', oldXmrAddr);
  console.log('[Recovery] New XMR:', newXmrAddr);
  console.log('[Recovery] Old WOW:', oldWowAddr);
  console.log('[Recovery] New WOW:', newWowAddr);

  const status: RecoveryStatus = {
    xmr: { status: 'checking' },
    wow: { status: 'checking' },
    grin: { status: 'checking' },
  };

  // === XMR SWEEP ===
  try {
    // Query old XMR address via LWS directly
    const xmrBalResult = await api.getLwsBalance('xmr', oldXmrAddr, bytesToHex(v1Keys.xmr.privateViewKey));
    const totalReceived = xmrBalResult.data?.total_received || 0;
    status.xmr.balance = totalReceived;

    if (totalReceived > 0) {
      console.log(`[Recovery] XMR total_received at old address: ${totalReceived}`);
      status.xmr.status = 'sweeping';

      try {
        const result = await sendTransaction(
          'xmr', oldXmrAddr,
          bytesToHex(v1Keys.xmr.privateViewKey),
          bytesToHex(v1Keys.xmr.privateSpendKey),
          newXmrAddr, 0, 'mainnet', true
        );
        status.xmr.txHash = result.txHash;
        status.xmr.status = 'swept';
        console.log(`[Recovery] XMR swept: ${result.txHash}`);
      } catch (err) {
        status.xmr.status = 'error';
        status.xmr.error = err instanceof Error ? err.message : 'Sweep failed';
        console.error('[Recovery] XMR sweep failed:', err);
      }
    } else {
      status.xmr.status = 'no_balance';
      console.log('[Recovery] No XMR at old address');
    }
  } catch (err) {
    status.xmr.status = 'error';
    status.xmr.error = err instanceof Error ? err.message : 'Balance check failed';
  }

  // === WOW SWEEP ===
  try {
    const wowBalResult = await api.getLwsBalance('wow', oldWowAddr, bytesToHex(v1Keys.wow.privateViewKey));
    const totalReceived = wowBalResult.data?.total_received || 0;
    status.wow.balance = totalReceived;

    if (totalReceived > 0) {
      console.log(`[Recovery] WOW total_received at old address: ${totalReceived}`);
      status.wow.status = 'sweeping';

      try {
        const result = await sendTransaction(
          'wow', oldWowAddr,
          bytesToHex(v1Keys.wow.privateViewKey),
          bytesToHex(v1Keys.wow.privateSpendKey),
          newWowAddr, 0, 'mainnet', true
        );
        status.wow.txHash = result.txHash;
        status.wow.status = 'swept';
        console.log(`[Recovery] WOW swept: ${result.txHash}`);
      } catch (err) {
        status.wow.status = 'error';
        status.wow.error = err instanceof Error ? err.message : 'Sweep failed';
        console.error('[Recovery] WOW sweep failed:', err);
      }
    } else {
      status.wow.status = 'no_balance';
      console.log('[Recovery] No WOW at old address');
    }
  } catch (err) {
    status.wow.status = 'error';
    status.wow.error = err instanceof Error ? err.message : 'Balance check failed';
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
          // STEP 1: Init at OLD path and create S1
          // Must FULLY reinit WASM for each step — the Seed internal state
          // determines blinding factors, not just the keys object
          const oldGrinKeys = await initGrinWalletAtPath(unlockedMnemonic!, LEGACY_MWC_PATH);
          setGrinWasmKeys(oldGrinKeys);
          const oldKeyHex = bytesToHex(new Uint8Array(oldGrinKeys.extendedPrivateKey.subarray(0, 16)));
          console.log('[Recovery] Grin S1: OLD path, extKey prefix:', oldKeyHex, 'addr:', oldGrinKeys.slatepackAddress);

          const sendResult = await handleGrinCreateSend(sendAmount, feeBuffer, undefined);
          if (!sendResult.success || !sendResult.data) {
            throw new Error('S1 create failed');
          }
          console.log('[Recovery] Grin S1 created:', sendResult.data.slateId);

          // STEP 2: FULLY reinit at NEW path and sign S2
          const newGrinKeys = await initGrinWallet(unlockedMnemonic!);
          setGrinWasmKeys(newGrinKeys);
          const newKeyHex = bytesToHex(new Uint8Array(newGrinKeys.extendedPrivateKey.subarray(0, 16)));
          console.log('[Recovery] Grin S2: NEW path, extKey prefix:', newKeyHex, 'addr:', newGrinKeys.slatepackAddress);
          console.log('[Recovery] Keys different?', oldKeyHex !== newKeyHex);

          const signResult = await handleGrinSignSlatepack(sendResult.data.slatepack);
          if (!signResult.success || !signResult.data) {
            throw new Error('S2 sign failed');
          }
          console.log('[Recovery] Grin S2 signed');

          // STEP 3: FULLY reinit at OLD path and finalize S3
          const oldGrinKeys2 = await initGrinWalletAtPath(unlockedMnemonic!, LEGACY_MWC_PATH);
          setGrinWasmKeys(oldGrinKeys2);
          console.log('[Recovery] Grin S3: WASM reinit at OLD path for finalize');

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
