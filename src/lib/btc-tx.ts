/**
 * Bitcoin/Litecoin transaction construction and signing.
 *
 * Uses @scure/btc-signer for transaction building with our existing
 * @scure/bip32 derived keys.
 */

import { Transaction, p2wpkh, NETWORK } from '@scure/btc-signer';
import { hex } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';

// Network configurations
const BTC_NETWORK = {
  bech32: 'bc',
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};

const LTC_NETWORK = {
  bech32: 'ltc',
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export type UtxoAsset = 'btc' | 'ltc';

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // in satoshis
  height: number;
}

/**
 * Get network config for asset.
 */
function getNetwork(asset: UtxoAsset) {
  return asset === 'btc' ? BTC_NETWORK : LTC_NETWORK;
}

// Minimum fee rates to ensure transactions meet relay requirements
const MIN_FEE_RATE = 1.1; // Slightly above 1 sat/vbyte to avoid edge cases

/**
 * Select UTXOs for a transaction using simple "largest first" strategy.
 *
 * @param utxos - Available UTXOs
 * @param targetAmount - Amount to send (in satoshis)
 * @param feeRate - Fee rate in sat/vbyte
 * @returns Selected UTXOs and estimated fee
 */
export function selectUtxos(
  utxos: Utxo[],
  targetAmount: number,
  feeRate: number = 10
): { selected: Utxo[]; fee: number; change: number } {
  // Ensure minimum fee rate to meet relay requirements
  const effectiveFeeRate = Math.max(feeRate, MIN_FEE_RATE);

  // Sort by value descending (largest first)
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  const selected: Utxo[] = [];
  let totalInput = 0;

  // Estimate tx size: ~10 + 68*inputs + 31*outputs bytes for P2WPKH
  // We'll have 2 outputs (recipient + change)
  const baseSize = 10 + 31 * 2;
  const inputSize = 68;

  for (const utxo of sorted) {
    selected.push(utxo);
    totalInput += utxo.value;

    const estimatedSize = baseSize + inputSize * selected.length;
    // Add +1 satoshi buffer to ensure we meet minimum relay fee
    const estimatedFee = Math.ceil(estimatedSize * effectiveFeeRate) + 1;

    if (totalInput >= targetAmount + estimatedFee) {
      const change = totalInput - targetAmount - estimatedFee;
      return { selected, fee: estimatedFee, change };
    }
  }

  // Not enough funds
  throw new Error(
    `Insufficient funds: need ${targetAmount} + fee, have ${totalInput}`
  );
}

/**
 * Create a complete signed transaction.
 *
 * @param asset - 'btc' or 'ltc'
 * @param utxos - Available UTXOs
 * @param recipientAddress - Where to send funds
 * @param amount - Amount to send in satoshis (ignored if sweep=true)
 * @param changeAddress - Address for change (unused if sweep=true)
 * @param privateKey - Private key for signing (32 bytes)
 * @param feeRate - Fee rate in sat/vbyte
 * @param sweep - If true, sends all UTXOs with no change output (amount is calculated)
 * @returns Signed transaction hex, fee, txid, and actual amount sent
 */
export function createSignedTransaction(
  asset: UtxoAsset,
  utxos: Utxo[],
  recipientAddress: string,
  amount: number,
  changeAddress: string,
  privateKey: Uint8Array,
  feeRate: number = 10,
  sweep: boolean = false
): { txHex: string; fee: number; txid: string; actualAmount: number } {
  const network = getNetwork(asset);

  // Get public key from private key
  const publicKey = secp256k1.getPublicKey(privateKey, true);

  // Create P2WPKH payment for our inputs
  const p2wpkhPayment = p2wpkh(publicKey, network);

  let selected: Utxo[];
  let fee: number;
  let change: number;
  let actualAmount: number;

  // Ensure minimum fee rate to meet relay requirements
  const effectiveFeeRate = Math.max(feeRate, MIN_FEE_RATE);

  if (sweep) {
    // Sweep mode: use all UTXOs, no change output
    selected = utxos;
    const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);

    // Estimate tx size with all inputs and 1 output (no change)
    const estimatedSize = 10 + 68 * utxos.length + 31;
    // Add +1 satoshi buffer to ensure we meet minimum relay fee
    fee = Math.ceil(estimatedSize * effectiveFeeRate) + 1;

    actualAmount = totalValue - fee;
    change = 0;

    if (actualAmount <= 0) {
      throw new Error(`Insufficient funds for sweep: total ${totalValue}, fee ${fee}`);
    }

    // Check dust threshold
    if (actualAmount < 546) {
      throw new Error(`Sweep amount ${actualAmount} is below dust threshold`);
    }
  } else {
    // Normal mode: select UTXOs for specific amount
    const selection = selectUtxos(utxos, amount, feeRate);
    selected = selection.selected;
    fee = selection.fee;
    change = selection.change;
    actualAmount = amount;
  }

  // Create transaction
  const tx = new Transaction();

  // Add inputs
  for (const utxo of selected) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: p2wpkhPayment.script,
        amount: BigInt(utxo.value),
      },
    });
  }

  // Add recipient output
  tx.addOutputAddress(recipientAddress, BigInt(actualAmount), network);

  // Add change output if significant (dust threshold ~546 sats) and not sweeping
  if (!sweep && change > 546) {
    tx.addOutputAddress(changeAddress, BigInt(change), network);
  }

  // Sign all inputs
  tx.sign(privateKey);

  // Finalize
  tx.finalize();

  return {
    txHex: hex.encode(tx.extract()),
    fee,
    txid: tx.id,
    actualAmount,
  };
}

/**
 * Estimate transaction fee for a given amount.
 *
 * @param utxos - Available UTXOs
 * @param amount - Amount to send in satoshis
 * @param feeRate - Fee rate in sat/vbyte
 * @returns Estimated fee in satoshis
 */
export function estimateFee(
  utxos: Utxo[],
  amount: number,
  feeRate: number = 10
): number {
  const { fee } = selectUtxos(utxos, amount, feeRate);
  return fee;
}

/**
 * Calculate maximum sendable amount given UTXOs and fee rate.
 *
 * Uses the same fee calculation as createSignedTransaction() sweep mode
 * to ensure the returned amount can actually be sent.
 *
 * @param utxos - Available UTXOs
 * @param feeRate - Fee rate in sat/vbyte
 * @returns Maximum amount that can be sent
 */
export function maxSendable(utxos: Utxo[], feeRate: number = 10): number {
  const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);

  // Use same fee calculation as createSignedTransaction sweep mode:
  // - Enforce minimum fee rate
  // - Add +1 satoshi buffer
  const effectiveFeeRate = Math.max(feeRate, MIN_FEE_RATE);

  // Estimate tx size with all inputs and 1 output (no change needed for max send)
  const estimatedSize = 10 + 68 * utxos.length + 31;
  const estimatedFee = Math.ceil(estimatedSize * effectiveFeeRate) + 1;

  return Math.max(0, totalValue - estimatedFee);
}
