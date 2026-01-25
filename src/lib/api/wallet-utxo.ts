/**
 * BTC/LTC wallet API methods (UTXO-based via Electrum).
 */

import { ApiClient, ApiResponse } from './client';

export interface WalletUtxoMethods {
  getUtxoBalance(
    asset: 'btc' | 'ltc',
    address: string
  ): Promise<ApiResponse<{
    asset: string;
    address: string;
    confirmed: number;
    unconfirmed: number;
    total: number;
  }>>;

  getUtxos(
    asset: 'btc' | 'ltc',
    address: string
  ): Promise<ApiResponse<{
    asset: string;
    address: string;
    utxos: Array<{
      txid: string;
      vout: number;
      value: number;
      height: number;
    }>;
  }>>;

  broadcastTx(
    asset: 'btc' | 'ltc',
    txHex: string
  ): Promise<ApiResponse<{
    asset: string;
    txid: string;
  }>>;

  getHistory(
    asset: 'btc' | 'ltc',
    address: string
  ): Promise<ApiResponse<{
    asset: string;
    address: string;
    transactions: Array<{
      txid: string;
      height: number;
      fee?: number;
    }>;
  }>>;

  estimateFee(asset: 'btc' | 'ltc'): Promise<ApiResponse<{
    asset: string;
    fast: number | null;
    normal: number | null;
    slow: number | null;
  }>>;
}

export function createWalletUtxoMethods(client: ApiClient): WalletUtxoMethods {
  const request = client['request'].bind(client);

  return {
    async getUtxoBalance(asset, address) {
      return request('/wallet/balance', {
        method: 'POST',
        body: JSON.stringify({ asset, address }),
      });
    },

    async getUtxos(asset, address) {
      return request('/wallet/utxos', {
        method: 'POST',
        body: JSON.stringify({ asset, address }),
      });
    },

    async broadcastTx(asset, txHex) {
      return request('/wallet/broadcast', {
        method: 'POST',
        body: JSON.stringify({ asset, tx_hex: txHex }),
      });
    },

    async getHistory(asset, address) {
      return request('/wallet/history', {
        method: 'POST',
        body: JSON.stringify({ asset, address }),
      });
    },

    async estimateFee(asset) {
      return request('/wallet/fees', {
        method: 'POST',
        body: JSON.stringify({ asset }),
      });
    },
  };
}
