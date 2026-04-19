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
import { deriveAllKeys, type DerivedKeys } from '@/lib/hd';
import { xmrAddress, wowAddress } from '@/lib/address';
import { sendTransaction, type XmrAsset } from '@/lib/xmr-tx';
import { handleSendTx } from './send';
import { handleGetBalance } from './balance';
import { api } from '@/lib/api';
import { getWalletState, saveWalletState } from '@/lib/storage';
import { bytesToHex } from '@/lib/crypto';
import { getPublicKey } from '@/lib/crypto';
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

  // Initialize status — XMR, WOW auto-sweep; Grin balance check only
  // (Grin can't auto-sweep because WASM wallet path already changed)
  migrationStatus = {
    phase: 'checking',
    steps: [
      { asset: 'xmr', status: 'pending', oldAddress: oldXmrAddr, newAddress: newXmrAddr },
      { asset: 'wow', status: 'pending', oldAddress: oldWowAddr, newAddress: newWowAddr },
      { asset: 'grin', status: 'pending' },
    ],
  };

  try {
    // Phase 1: Check balances
    for (const step of migrationStatus.steps) {
      step.status = 'checking';
      try {
        const balResult = await handleGetBalance(step.asset as AssetType);
        if (balResult.success && balResult.data) {
          const bal = (balResult.data as { confirmed?: number; total?: number }).total ||
                      (balResult.data as { confirmed?: number }).confirmed || 0;
          step.balance = bal;
          if (bal <= 0) {
            step.status = 'skipped';
          }
          // Grin with balance can't be auto-swept — block migration
          if (step.asset === 'grin' && bal > 0) {
            step.status = 'error';
            step.error = 'Send your GRIN first, then retry';
            migrationStatus.phase = 'error';
            migrationStatus.error = 'Please send your GRIN balance to another wallet before upgrading. The Grin address will change and auto-sweep is not yet supported for Grin.';
            return { success: false, error: migrationStatus.error };
          }
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
      const asset = step.asset as XmrAsset;

      try {
        // Get old keys for this asset
        const oldViewKey = unlockedViewKeys.get(asset);
        const oldSpendKey = unlockedKeys.get(asset);

        if (!oldViewKey || !oldSpendKey || !step.oldAddress || !step.newAddress) {
          step.status = 'error';
          step.error = 'Missing keys for sweep';
          continue;
        }

        // Sweep all funds from old address → new address
        const result = await sendTransaction(
          asset,
          step.oldAddress,
          bytesToHex(oldViewKey),
          bytesToHex(oldSpendKey),
          step.newAddress,
          0, // amount 0 = sweep mode decides
          'mainnet',
          true // sweep = true (send everything)
        );

        step.txHash = result.txHash;
        step.status = 'swept';
        console.log(`[Migration] ${asset} swept: ${result.txHash}, fee: ${result.fee}`);
      } catch (err) {
        step.status = 'error';
        step.error = err instanceof Error ? err.message : 'Sweep failed';
        console.error(`[Migration] ${asset} sweep failed:`, err);
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

    // Update stored keys to v2 (they'll be re-encrypted on next unlock cycle)
    // For now just update the public keys and addresses in the state
    if (state.keys.xmr) {
      state.keys.xmr.publicKey = bytesToHex(v2Keys.xmr.publicSpendKey);
      state.keys.xmr.publicSpendKey = bytesToHex(v2Keys.xmr.publicSpendKey);
    }
    if (state.keys.wow) {
      state.keys.wow.publicKey = bytesToHex(v2Keys.wow.publicSpendKey);
      state.keys.wow.publicSpendKey = bytesToHex(v2Keys.wow.publicSpendKey);
    }
    if (state.keys.grin) {
      state.keys.grin.publicKey = bytesToHex(v2Keys.grin.publicKey);
    }

    await saveWalletState(state);

    migrationStatus.phase = 'complete';
    console.log('[Migration] Complete — wallet upgraded to v2 derivation');

    return { success: true, data: { migrated: true } };
  } catch (err) {
    migrationStatus.phase = 'error';
    migrationStatus.error = err instanceof Error ? err.message : 'Migration failed';
    return { success: false, error: migrationStatus.error };
  }
}
