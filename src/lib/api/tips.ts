/**
 * Tips API methods.
 */

import type { AssetType, TipInfo, CreateTipResponse } from '@/types';
import { ApiClient, ApiResponse } from './client';

export interface TipsMethods {
  createTip(params: {
    asset: AssetType;
    amountRaw: number;
    tipAddress: string;
    encryptedKey: string;
    tipViewKey?: string;
    grinCommitment?: string;
    recipientUserId?: string;
    ephemeralPubkey?: string;
    recipientHint?: string;
    senderWalletId: string;
    expiryHours?: number;
  }): Promise<ApiResponse<CreateTipResponse>>;

  getTip(linkId: string): Promise<ApiResponse<TipInfo>>;

  getTipStatus(linkId: string): Promise<ApiResponse<{
    linkId: string;
    status: string;
    isClaimable: boolean;
  }>>;

  claimTip(linkId: string, txHash?: string): Promise<ApiResponse<TipInfo>>;

  getSentTips(): Promise<ApiResponse<{ tips: TipInfo[]; total: number }>>;

  getReceivedTips(): Promise<ApiResponse<{ tips: TipInfo[]; total: number }>>;
}

export function createTipsMethods(client: ApiClient): TipsMethods {
  const request = client['request'].bind(client);

  return {
    async createTip(params) {
      return request('/tips', {
        method: 'POST',
        body: JSON.stringify({
          asset: params.asset,
          amount_raw: params.amountRaw,
          tip_address: params.tipAddress,
          encrypted_key: params.encryptedKey,
          tip_view_key: params.tipViewKey,
          grin_commitment: params.grinCommitment,
          recipient_user_id: params.recipientUserId,
          ephemeral_pubkey: params.ephemeralPubkey,
          recipient_hint: params.recipientHint,
          sender_wallet_id: params.senderWalletId,
          expiry_hours: params.expiryHours,
        }),
      });
    },

    async getTip(linkId: string) {
      return request(`/tips/${linkId}`);
    },

    async getTipStatus(linkId: string) {
      return request(`/tips/${linkId}/status`);
    },

    async claimTip(linkId: string, txHash?: string) {
      return request(`/tips/${linkId}/claim`, {
        method: 'POST',
        body: JSON.stringify({ tx_hash: txHash }),
      });
    },

    async getSentTips() {
      return request('/tips/sent');
    },

    async getReceivedTips() {
      return request('/tips/received');
    },
  };
}
