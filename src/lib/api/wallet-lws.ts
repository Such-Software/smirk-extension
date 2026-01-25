/**
 * XMR/WOW wallet API methods (via Light Wallet Server).
 */

import { ApiClient, ApiResponse } from './client';

export interface WalletLwsMethods {
  getLwsBalance(
    asset: 'xmr' | 'wow',
    address: string,
    viewKey: string
  ): Promise<ApiResponse<{
    total_received: number;
    locked_balance: number;
    pending_balance: number;
    transaction_count: number;
    blockchain_height: number;
    start_height: number;
    scanned_height: number;
    spent_outputs: Array<{
      amount: number;
      key_image: string;
      tx_pub_key: string;
      out_index: number;
    }>;
  }>>;

  getUnspentOuts(
    asset: 'xmr' | 'wow',
    address: string,
    viewKey: string
  ): Promise<ApiResponse<{
    outputs: Array<{
      amount: number;
      public_key: string;
      tx_pub_key: string;
      index: number;
      global_index: number;
      height: number;
      rct: string;
      spend_key_images: string[];
    }>;
    per_byte_fee: number;
    fee_mask: number;
  }>>;

  getRandomOuts(
    asset: 'xmr' | 'wow',
    count: number
  ): Promise<ApiResponse<{
    outputs: Array<{
      global_index: number;
      public_key: string;
      rct: string;
    }>;
  }>>;

  submitLwsTx(
    asset: 'xmr' | 'wow',
    txHex: string
  ): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>>;

  getLwsHistory(
    asset: 'xmr' | 'wow',
    address: string,
    viewKey: string
  ): Promise<ApiResponse<{
    asset: string;
    transactions: Array<{
      txid: string;
      height: number;
      timestamp: string;
      is_pending: boolean;
      total_received: number;
      total_sent: number;
      payment_id?: string;
    }>;
    scanned_height: number;
    blockchain_height: number;
  }>>;

  registerLws(
    userId: string,
    asset: 'xmr' | 'wow',
    address: string,
    viewKey: string,
    startHeight?: number
  ): Promise<ApiResponse<{
    success: boolean;
    message: string;
    start_height?: number;
  }>>;
}

export function createWalletLwsMethods(client: ApiClient): WalletLwsMethods {
  const request = client['request'].bind(client);

  return {
    async getLwsBalance(asset, address, viewKey) {
      return request('/wallet/lws/balance', {
        method: 'POST',
        body: JSON.stringify({ asset, address, view_key: viewKey }),
      });
    },

    async getUnspentOuts(asset, address, viewKey) {
      return request('/wallet/lws/unspent', {
        method: 'POST',
        body: JSON.stringify({ asset, address, view_key: viewKey }),
      });
    },

    async getRandomOuts(asset, count) {
      return request('/wallet/lws/decoys', {
        method: 'POST',
        body: JSON.stringify({ asset, count }),
      });
    },

    async submitLwsTx(asset, txHex) {
      return request('/wallet/lws/submit', {
        method: 'POST',
        body: JSON.stringify({ asset, tx_hex: txHex }),
      });
    },

    async getLwsHistory(asset, address, viewKey) {
      return request('/wallet/lws/history', {
        method: 'POST',
        body: JSON.stringify({ asset, address, view_key: viewKey }),
      });
    },

    async registerLws(userId, asset, address, viewKey, startHeight) {
      return request('/wallet/lws/register', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          asset,
          address,
          view_key: viewKey,
          start_height: startHeight,
        }),
      });
    },
  };
}
