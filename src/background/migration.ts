/**
 * Key Derivation Migration Handler
 *
 * Orchestrates the migration from v1 (custom) to v2 (BIP44/SLIP-10) derivation:
 * 1. Derive v2 keys from mnemonic
 * 2. Check balances for XMR/WOW (BTC/LTC don't change)
 * 3. Auto-sweep assets with balance from old → new address
 * 4. Update backend with new keys
 * 5. Update local wallet state
 */

import type { MessageResponse, AssetType } from '@/types';
import { deriveAllKeys } from '@/lib/hd';
import { xmrAddress, wowAddress } from '@/lib/address';
import { sendTransaction, type XmrAsset } from '@/lib/xmr-tx';
import { initGrinWallet } from '@/lib/grin';
import { handleGetBalance } from './balance';
import { registerWithLwsFromUnlockedKeys } from './wallet';
import { handleGrinCreateSend, handleGrinFinalizeAndBroadcast, handleGrinSignSlatepack } from './grin';
import { api } from '@/lib/api';
import { getWalletState, saveWalletState, getAuthState } from '@/lib/storage';
import { setGrinWasmKeys } from './state';
import { bytesToHex } from '@/lib/crypto';
import {
  unlockedKeys,
  unlockedViewKeys,
  unlockedMnemonic,
} from './state';

interface MigrationStep {
  asset: string;
  status: 'pending' | 'checking' | 'sweeping' | 'swept' | 'skipped' | 'error';
  oldAddress?: string;
  newAddress?: string;
  balance?: number;
  txHash?: string;
  error?: string;
}

interface MigrationStatus {
  steps: MigrationStep[];
  phase: 'checking' | 'sweeping' | 'updating' | 'complete' | 'error';
  error?: string;
}

let migrationStatus: MigrationStatus | null = null;

/**
 * Get current migration status (polled by popup).
 */
export function handleGetMigrationStatus(): MessageResponse<{ status: MigrationStatus | null }> {
  return { success: true, data: { status: migrationStatus } };
}

/**
 * Execute full migration flow.
 *
 * This is the main entry point called when user clicks "Upgrade Now".
 * It runs asynchronously — the popup polls handleGetMigrationStatus for progress.
 */
export async function handleStartMigration(): Promise<MessageResponse> {
  if (!unlockedMnemonic) {
    return { success: false, error: 'Wallet must be unlocked to migrate' };
  }

  const state = await getWalletState();
  if (state.derivationVersion === 2) {
    return { success: false, error: 'Already on v2 derivation' };
  }

  // Derive v2 keys
  const v2Keys = deriveAllKeys(unlockedMnemonic, '', 2);
  const v1Keys = deriveAllKeys(unlockedMnemonic, '', 1);

  // Build new addresses
  const newXmrAddr = xmrAddress(v2Keys.xmr.publicSpendKey, v2Keys.xmr.publicViewKey);
  const newWowAddr = wowAddress(v2Keys.wow.publicSpendKey, v2Keys.wow.publicViewKey);

  const oldXmrAddr = xmrAddress(v1Keys.xmr.publicSpendKey, v1Keys.xmr.publicViewKey);
  const oldWowAddr = wowAddress(v1Keys.wow.publicSpendKey, v1Keys.wow.publicViewKey);

  // Initialize status — auto-sweep for XMR, WOW, and Grin
  migrationStatus = {
    phase: 'checking',
    steps: [
      { asset: 'xmr', status: 'pending', oldAddress: oldXmrAddr, newAddress: newXmrAddr },
      { asset: 'wow', status: 'pending', oldAddress: oldWowAddr, newAddress: newWowAddr },
      { asset: 'grin', status: 'pending', oldAddress: 'old grin address', newAddress: 'new grin address' },
    ],
  };

  try {
    // Phase 1: Check balances
    for (const step of migrationStatus.steps) {
      step.status = 'checking';
      try {
        const balResult = await handleGetBalance(step.asset as AssetType);
        if (balResult.success && balResult.data) {
          const data = balResult.data as Record<string, unknown>;

          // XMR/WOW returns LWS format: { total_received, locked_balance, ... }
          // BTC/LTC/Grin returns: { confirmed, unconfirmed, total }
          // For XMR/WOW, use total_received as indicator (actual balance needs key image verification)
          let bal = 0;
          if ('total_received' in data) {
            // XMR/WOW: total_received > 0 means funds may exist, attempt sweep
            bal = (data.total_received as number) || 0;
          } else if ('total' in data) {
            bal = (data.total as number) || 0;
          } else if ('confirmed' in data) {
            bal = (data.confirmed as number) || 0;
          }

          step.balance = bal;
          if (bal <= 0) {
            step.status = 'skipped';
          }

          // Grin uses same-wallet SRS self-transaction for sweep.
          // initGrinWallet() produces correct keys — do NOT use initGrinWalletAtPath().
          // See TECHNICAL_DEBT.md item #9 for details.
        } else {
          step.balance = 0;
          step.status = 'skipped';
        }
      } catch {
        step.balance = 0;
        step.status = 'skipped';
      }
    }

    // Phase 2: Sweep assets with balance
    migrationStatus.phase = 'sweeping';

    for (const step of migrationStatus.steps) {
      if (step.status !== 'pending' || !step.balance || step.balance <= 0) continue;

      step.status = 'sweeping';

      try {
        if (step.asset === 'xmr' || step.asset === 'wow') {
          // XMR/WOW: sweep using sendTransaction with sweep=true
          const asset = step.asset as XmrAsset;
          const oldViewKey = unlockedViewKeys.get(asset);
          const oldSpendKey = unlockedKeys.get(asset);

          if (!oldViewKey || !oldSpendKey || !step.oldAddress || !step.newAddress) {
            step.status = 'error';
            step.error = 'Missing keys for sweep';
            continue;
          }

          const result = await sendTransaction(
            asset, step.oldAddress, bytesToHex(oldViewKey), bytesToHex(oldSpendKey),
            step.newAddress, 0, 'mainnet', true // sweep
          );

          step.txHash = result.txHash;
          step.status = 'swept';
          console.log(`[Migration] ${step.asset} swept: ${result.txHash}, fee: ${result.fee}`);

        } else if (step.asset === 'grin') {
          // Grin self-sweep: SRS transaction using same wallet keys
          // Uses initGrinWallet() which produces correct key material
          const grinKeys = await initGrinWallet(unlockedMnemonic!);
          setGrinWasmKeys(grinKeys);
          console.log('[Migration] Grin sweep: using initGrinWallet, addr:', grinKeys.slatepackAddress);

          const feeBuffer = 30000000; // 0.03 GRIN
          const sendAmount = step.balance - feeBuffer;

          if (sendAmount <= 0) {
            step.status = 'error';
            step.error = 'Grin balance too small (less than fee)';
          } else {
            // S1: create send slate
            const sendResult = await handleGrinCreateSend(sendAmount, feeBuffer, undefined);
            if (!sendResult.success || !sendResult.data) {
              throw new Error('Grin S1 create failed');
            }
            console.log('[Migration] Grin S1 created:', sendResult.data.slateId);

            // S2: sign (same wallet = self-send)
            const signResult = await handleGrinSignSlatepack(sendResult.data.slatepack);
            if (!signResult.success || !signResult.data) {
              throw new Error('Grin S2 sign failed');
            }
            console.log('[Migration] Grin S2 signed');

            // S3: finalize and broadcast
            const finalizeResult = await handleGrinFinalizeAndBroadcast(
              signResult.data.signedSlatepack,
              sendResult.data.sendContext
            );

            if (finalizeResult.success) {
              step.txHash = sendResult.data.slateId;
              step.status = 'swept';
              console.log('[Migration] Grin swept:', sendResult.data.slateId);
            } else {
              throw new Error('Grin finalize/broadcast failed');
            }
          }

          // Restore keys for normal wallet operations
          const freshKeys = await initGrinWallet(unlockedMnemonic!);
          setGrinWasmKeys(freshKeys);
        }
      } catch (err) {
        step.status = 'error';
        step.error = err instanceof Error ? err.message : 'Sweep failed';
        console.error(`[Migration] ${step.asset} sweep failed:`, err);
      }
    }

    // Check if any sweeps failed
    const failedSteps = migrationStatus.steps.filter(s => s.status === 'error');
    if (failedSteps.length > 0) {
      migrationStatus.phase = 'error';
      migrationStatus.error = `Sweep failed for: ${failedSteps.map(s => s.asset.toUpperCase()).join(', ')}. Your funds are safe — retry when ready.`;
      return { success: false, error: migrationStatus.error };
    }

    // Phase 3: Update backend with new keys
    migrationStatus.phase = 'updating';

    const migrateResult = await api.migrateKeys([
      {
        asset: 'xmr',
        public_key: bytesToHex(v2Keys.xmr.publicSpendKey),
        public_spend_key: bytesToHex(v2Keys.xmr.publicViewKey),
        address: newXmrAddr,
        view_key: bytesToHex(v2Keys.xmr.privateViewKey),
      },
      {
        asset: 'wow',
        public_key: bytesToHex(v2Keys.wow.publicSpendKey),
        public_spend_key: bytesToHex(v2Keys.wow.publicViewKey),
        address: newWowAddr,
        view_key: bytesToHex(v2Keys.wow.privateViewKey),
      },
      {
        asset: 'grin',
        public_key: bytesToHex(v2Keys.grin.publicKey),
      },
    ]);

    if (migrateResult.error) {
      migrationStatus.phase = 'error';
      migrationStatus.error = `Backend update failed: ${migrateResult.error}. Your funds are safe.`;
      return { success: false, error: migrationStatus.error };
    }

    // Phase 4: Update local wallet state
    state.derivationVersion = 2;

    // Update ALL public keys to v2 — including publicViewKey!
    // (Missing publicViewKey caused address/viewkey mismatch with LWS)
    if (state.keys.xmr) {
      state.keys.xmr.publicKey = bytesToHex(v2Keys.xmr.publicSpendKey);
      state.keys.xmr.publicSpendKey = bytesToHex(v2Keys.xmr.publicSpendKey);
      state.keys.xmr.publicViewKey = bytesToHex(v2Keys.xmr.publicViewKey);
    }
    if (state.keys.wow) {
      state.keys.wow.publicKey = bytesToHex(v2Keys.wow.publicSpendKey);
      state.keys.wow.publicSpendKey = bytesToHex(v2Keys.wow.publicSpendKey);
      state.keys.wow.publicViewKey = bytesToHex(v2Keys.wow.publicViewKey);
    }
    if (state.keys.grin) {
      state.keys.grin.publicKey = bytesToHex(v2Keys.grin.publicKey);
    }

    await saveWalletState(state);

    // Re-register new XMR/WOW addresses with LWS
    // This is critical — without it, balance queries return 403
    try {
      const authState = await getAuthState();
      if (authState?.userId) {
        const updatedState = await getWalletState();
        await registerWithLwsFromUnlockedKeys(authState.userId, updatedState);
        console.log('[Migration] LWS re-registration triggered for new addresses');
      }
    } catch (lwsErr) {
      console.warn('[Migration] LWS re-registration failed (will retry on next unlock):', lwsErr);
    }

    migrationStatus.phase = 'complete';
    console.log('[Migration] Complete — wallet upgraded to v2 derivation');

    return { success: true, data: { migrated: true } };
  } catch (err) {
    migrationStatus.phase = 'error';
    migrationStatus.error = err instanceof Error ? err.message : 'Migration failed';
    return { success: false, error: migrationStatus.error };
  }
}
