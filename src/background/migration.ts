/**
 * Key Derivation Migration Handler
 *
 * Orchestrates migration to v3 (BIP32 secp256k1, Cake Wallet compatible):
 * - v1 (custom SHA256) → v3 (BIP32 secp256k1 at m/44'/coin'/0'/0/0)
 * - v2 (buggy 3-level SLIP-10) → v3 (BIP32 secp256k1 at m/44'/coin'/0'/0/0)
 *
 * Steps:
 * 1. Derive old keys (v1 or v2) and new v3 keys from mnemonic
 * 2. Check balances for XMR/WOW (BTC/LTC don't change)
 * 3. Auto-sweep assets with balance from old → new address
 * 4. Update backend with new keys
 * 5. Update local wallet state
 */

import type { MessageResponse, AssetType } from '@/types';
import { deriveAllKeys } from '@/lib/hd';
import { xmrAddress, wowAddress } from '@/lib/address';
import { sendTransaction, type XmrAsset } from '@/lib/xmr-tx';
import { initGrinWallet, calculateGrinFee } from '@/lib/grin';
import { handleGetBalance } from './balance';
import { registerWithLwsFromUnlockedKeys } from './wallet';
import { handleGrinCreateSend, handleGrinFinalizeAndBroadcast, handleGrinSignSlatepack } from './grin';
import { getAuthenticatedUserId, fetchUnspentOutputs } from './grin/helpers';
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

  if (migrationStatus && migrationStatus.phase !== 'complete' && migrationStatus.phase !== 'error') {
    return { success: false, error: 'Migration already in progress' };
  }

  const state = await getWalletState();
  if (state.derivationVersion === 3) {
    return { success: false, error: 'Already on v3 derivation' };
  }

  // Derive keys based on current version and target v3
  const currentVersion = (state.derivationVersion || 1) as 1 | 2 | 3;
  const oldKeys = deriveAllKeys(unlockedMnemonic, '', currentVersion);
  const newKeys = deriveAllKeys(unlockedMnemonic, '', 3);

  // Build new addresses
  const newXmrAddr = xmrAddress(newKeys.xmr.publicSpendKey, newKeys.xmr.publicViewKey);
  const newWowAddr = wowAddress(newKeys.wow.publicSpendKey, newKeys.wow.publicViewKey);

  const oldXmrAddr = xmrAddress(oldKeys.xmr.publicSpendKey, oldKeys.xmr.publicViewKey);
  const oldWowAddr = wowAddress(oldKeys.wow.publicSpendKey, oldKeys.wow.publicViewKey);

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
      if (step.status !== 'checking' || !step.balance || step.balance <= 0) continue;

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
          // Grin cross-wallet sweep: old BIP39 keys → new raw-entropy keys
          //
          // Old keys (useBip39=true): MWC-style PBKDF2 → HMAC. Used by pre-v3 Smirk wallets.
          // New keys (useBip39=false): raw entropy → HMAC. Matches grin-wallet/Grim.
          //
          // SRS flow: S1 create (old) → S2 sign (new) → S3 finalize+broadcast (old)

          // Query outputs to calculate exact sweep amount (avoid change with old keys)
          const userId = await getAuthenticatedUserId();
          const { outputs } = await fetchUnspentOutputs(userId);

          if (outputs.length === 0) {
            step.status = 'skipped';
            console.log('[Migration] Grin: no unspent outputs, skipping');
            continue;
          }

          const totalBalance = outputs.reduce((sum, o) => sum + o.amount, BigInt(0));
          // Fee for N inputs, 1 output (receiver only, no change), 1 kernel
          const fee = calculateGrinFee(outputs.length, 1, 1);
          const sendAmount = Number(totalBalance - fee);

          if (sendAmount <= 0) {
            // Unsweepable Grin dust — same class as the XMR/WOW dust skip below.
            // Block migration on this would strand v3 upgrade forever.
            step.status = 'skipped';
            console.log('[Migration] Grin: balance below fee, treating as nothing to sweep');
            continue;
          }

          // Step 1: Init OLD keys (useBip39=true) as sender
          const oldKeys = await initGrinWallet(unlockedMnemonic!, true);
          setGrinWasmKeys(oldKeys);
          step.oldAddress = oldKeys.slatepackAddress;
          console.log('[Migration] Grin sender (old BIP39):', oldKeys.slatepackAddress);

          // Step 2: S1 create with old keys
          const sendResult = await handleGrinCreateSend(sendAmount, 0);
          if (!sendResult.success || !sendResult.data) {
            throw new Error(`Grin S1 create failed: ${sendResult.success === false ? sendResult.error : 'no data'}`);
          }
          console.log('[Migration] Grin S1 created:', sendResult.data.slateId);

          // Step 3: Init NEW keys (useBip39=false) as receiver
          const newKeys = await initGrinWallet(unlockedMnemonic!, false);
          setGrinWasmKeys(newKeys);
          step.newAddress = newKeys.slatepackAddress;
          console.log('[Migration] Grin receiver (grin-wallet compat):', newKeys.slatepackAddress);

          // Step 4: S2 sign with new keys (CROSS-WALLET receive)
          const signResult = await handleGrinSignSlatepack(sendResult.data.slatepack);
          if (!signResult.success || !signResult.data) {
            throw new Error(`Grin S2 sign failed: ${signResult.success === false ? signResult.error : 'no data'}`);
          }
          console.log('[Migration] Grin S2 signed (cross-wallet)');

          // Step 5: Restore OLD keys for finalization
          setGrinWasmKeys(oldKeys);

          // Step 6: S3 finalize and broadcast with old keys
          const finalizeResult = await handleGrinFinalizeAndBroadcast(
            signResult.data.signedSlatepack,
            sendResult.data.sendContext
          );

          if (finalizeResult.success) {
            step.txHash = sendResult.data.slateId;
            step.status = 'swept';
            console.log('[Migration] Grin swept:', sendResult.data.slateId);
          } else {
            throw new Error(`Grin finalize/broadcast failed: ${finalizeResult.success === false ? finalizeResult.error : ''}`);
          }

          // Set NEW keys for ongoing wallet use (grin-wallet/Grim compatible)
          setGrinWasmKeys(newKeys);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Sweep failed';
        // Treat as "skipped" (not error) when there is nothing recoverable in the
        // old address: already-swept outputs, or remaining outputs whose sum is
        // below the network fee (dust). Blocking migration on unspendable dust
        // would strand the user on the old derivation forever.
        const nothingToSweep =
          errMsg.includes('No unspent outputs') ||
          errMsg.includes('have been spent') ||
          errMsg.includes('Balance too low to cover network fee') ||
          errMsg.includes('Insufficient funds');
        if (nothingToSweep) {
          step.status = 'skipped';
          console.log(`[Migration] ${step.asset}: nothing sweepable (${errMsg})`);
        } else {
          step.status = 'error';
          step.error = errMsg;
          console.error(`[Migration] ${step.asset} sweep failed:`, err);
        }
      }
    }

    // Check if any sweeps failed (skipped = already done, not a failure)
    const failedSteps = migrationStatus.steps.filter(s => s.status === 'error');
    if (failedSteps.length > 0) {
      migrationStatus.phase = 'error';
      migrationStatus.error = `Sweep failed for: ${failedSteps.map(s => s.asset.toUpperCase()).join(', ')}. Your funds are safe — retry when ready.`;
      return { success: false, error: migrationStatus.error };
    }

    // Phase 3: Persist v3 locally FIRST, then push to backend.
    //
    // Order matters for crash-safety. If we updated the backend first and
    // the service worker died before saving local state, on the next unlock
    // session.ts would re-derive v1/v2 keys from `derivationVersion`, then
    // reconcileUserKeys would see local≠backend and "fix" it by uploading
    // the v1/v2 keys — un-migrating the wallet while funds sit at v3.
    //
    // Saving local first means a crash in this window leaves local on v3
    // and backend on v1/v2; reconcileUserKeys forward-converges on next
    // unlock by pushing v3 to the backend. LWS re-registration on unlock
    // also covers the address re-registration if we crash before line ~340.
    migrationStatus.phase = 'updating';

    state.derivationVersion = 3;

    // Update ALL public keys to v3 — including publicViewKey!
    if (state.keys.xmr) {
      state.keys.xmr.publicKey = bytesToHex(newKeys.xmr.publicSpendKey);
      state.keys.xmr.publicSpendKey = bytesToHex(newKeys.xmr.publicSpendKey);
      state.keys.xmr.publicViewKey = bytesToHex(newKeys.xmr.publicViewKey);
    }
    if (state.keys.wow) {
      state.keys.wow.publicKey = bytesToHex(newKeys.wow.publicSpendKey);
      state.keys.wow.publicSpendKey = bytesToHex(newKeys.wow.publicSpendKey);
      state.keys.wow.publicViewKey = bytesToHex(newKeys.wow.publicViewKey);
    }
    if (state.keys.grin) {
      state.keys.grin.publicKey = bytesToHex(newKeys.grin.publicKey);
    }

    await saveWalletState(state);

    // Update in-memory keys to v3 so LWS re-registration uses correct view keys
    unlockedKeys.set('xmr', newKeys.xmr.privateSpendKey);
    unlockedKeys.set('wow', newKeys.wow.privateSpendKey);
    unlockedViewKeys.set('xmr', newKeys.xmr.privateViewKey);
    unlockedViewKeys.set('wow', newKeys.wow.privateViewKey);

    const migrateResult = await api.migrateKeys([
      {
        asset: 'xmr',
        public_key: bytesToHex(newKeys.xmr.publicSpendKey),
        address: newXmrAddr,
        view_key: bytesToHex(newKeys.xmr.privateViewKey),
      },
      {
        asset: 'wow',
        public_key: bytesToHex(newKeys.wow.publicSpendKey),
        address: newWowAddr,
        view_key: bytesToHex(newKeys.wow.privateViewKey),
      },
      {
        asset: 'grin',
        public_key: bytesToHex(newKeys.grin.publicKey),
      },
    ]);

    if (migrateResult.error) {
      // Local state is already on v3 — reconcileUserKeys will push our v3
      // public keys to the backend on the next unlock. We do NOT roll back
      // the local save: rolling back would re-create the original hazard
      // where backend update could land while local stays on v1/v2.
      migrationStatus.phase = 'error';
      migrationStatus.error = `Backend update failed: ${migrateResult.error}. Your funds are safe and will sync on next unlock.`;
      return { success: false, error: migrationStatus.error };
    }

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
    console.log(`[Migration] Complete — wallet upgraded from v${currentVersion} to v3 derivation`);

    return { success: true, data: { migrated: true } };
  } catch (err) {
    migrationStatus.phase = 'error';
    migrationStatus.error = err instanceof Error ? err.message : 'Migration failed';
    return { success: false, error: migrationStatus.error };
  }
}
