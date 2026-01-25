/**
 * Authentication API methods.
 */

import { ApiClient, ApiResponse } from './client';

export interface AuthMethods {
  telegramLogin(initData: string): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; telegramId: number; telegramUsername?: string };
  }>>;

  refreshToken(refreshToken: string): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>>;

  extensionRegister(params: {
    keys: Array<{
      asset: string;
      publicKey: string;
      publicSpendKey?: string;
    }>;
    username?: string;
    walletBirthday?: number;
    seedFingerprint?: string;
    xmrStartHeight?: number;
    wowStartHeight?: number;
  }): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; username?: string; isNew: boolean };
  }>>;

  checkRestore(params: {
    fingerprint: string;
    keys: Array<{
      asset: string;
      publicKey: string;
      publicSpendKey?: string;
    }>;
  }): Promise<ApiResponse<{
    exists: boolean;
    userId?: string;
    keysValid?: boolean;
    error?: string;
    xmrStartHeight?: number;
    wowStartHeight?: number;
  }>>;
}

export function createAuthMethods(client: ApiClient): AuthMethods {
  const request = client['request'].bind(client);

  return {
    async telegramLogin(initData: string) {
      return request('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: initData }),
      });
    },

    async refreshToken(refreshToken: string) {
      return request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    },

    async extensionRegister(params) {
      return request('/auth/extension', {
        method: 'POST',
        body: JSON.stringify({
          keys: params.keys.map(k => ({
            asset: k.asset,
            public_key: k.publicKey,
            public_spend_key: k.publicSpendKey,
          })),
          username: params.username,
          wallet_birthday: params.walletBirthday,
          seed_fingerprint: params.seedFingerprint,
          xmr_start_height: params.xmrStartHeight,
          wow_start_height: params.wowStartHeight,
        }),
      });
    },

    async checkRestore(params) {
      return request('/auth/check-restore', {
        method: 'POST',
        body: JSON.stringify({
          fingerprint: params.fingerprint,
          keys: params.keys.map(k => ({
            asset: k.asset,
            public_key: k.publicKey,
            public_spend_key: k.publicSpendKey,
          })),
        }),
      });
    },
  };
}
