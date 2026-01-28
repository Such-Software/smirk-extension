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
    /** Unix timestamp (seconds) that was signed */
    signedTimestamp: number;
    /** Bitcoin message signature of "smirk-auth-{timestamp}" using BTC private key */
    signature: string;
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

// Transform snake_case auth response to camelCase
interface RawAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    telegram_id?: number;
    telegram_username?: string;
    username?: string;
    is_new?: boolean;
  };
}

function transformAuthResponse(raw: RawAuthResponse) {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresIn: raw.expires_in,
    user: {
      id: raw.user.id,
      telegramId: raw.user.telegram_id,
      telegramUsername: raw.user.telegram_username,
      username: raw.user.username,
      isNew: raw.user.is_new,
    },
  };
}

// Transform snake_case check-restore response to camelCase
interface RawCheckRestoreResponse {
  exists: boolean;
  user_id?: string;
  keys_valid?: boolean;
  error?: string;
  xmr_start_height?: number;
  wow_start_height?: number;
}

function transformCheckRestoreResponse(raw: RawCheckRestoreResponse) {
  return {
    exists: raw.exists,
    userId: raw.user_id,
    keysValid: raw.keys_valid,
    error: raw.error,
    xmrStartHeight: raw.xmr_start_height,
    wowStartHeight: raw.wow_start_height,
  };
}

export function createAuthMethods(client: ApiClient): AuthMethods {
  return {
    async telegramLogin(initData: string) {
      const result = await client.request<RawAuthResponse>('/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ init_data: initData }),
      });
      if (result.data) {
        return { data: transformAuthResponse(result.data) };
      }
      return { error: result.error };
    },

    async refreshToken(refreshToken: string) {
      const result = await client.request<RawAuthResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (result.data) {
        return { data: transformAuthResponse(result.data) };
      }
      return { error: result.error };
    },

    async extensionRegister(params) {
      const result = await client.request<RawAuthResponse>('/auth/extension', {
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
          signed_timestamp: params.signedTimestamp,
          signature: params.signature,
        }),
      });
      if (result.data) {
        return { data: transformAuthResponse(result.data) };
      }
      return { error: result.error };
    },

    async checkRestore(params) {
      const result = await client.request<RawCheckRestoreResponse>('/auth/check-restore', {
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
      if (result.data) {
        return { data: transformCheckRestoreResponse(result.data) };
      }
      return { error: result.error };
    },
  };
}
