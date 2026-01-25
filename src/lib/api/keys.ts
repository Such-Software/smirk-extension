/**
 * User Keys API methods.
 */

import type { AssetType, UserKeysResponse } from '@/types';
import { ApiClient, ApiResponse } from './client';

export interface KeysMethods {
  registerKey(
    asset: AssetType,
    publicKey: string,
    publicSpendKey?: string
  ): Promise<ApiResponse<{ asset: AssetType; publicKey: string }>>;

  getUserKeys(userId: string): Promise<ApiResponse<UserKeysResponse>>;

  getUserKeyForAsset(
    userId: string,
    asset: AssetType
  ): Promise<ApiResponse<{ asset: AssetType; publicKey: string; publicSpendKey?: string }>>;
}

export function createKeysMethods(client: ApiClient): KeysMethods {
  const request = client['request'].bind(client);

  return {
    async registerKey(asset, publicKey, publicSpendKey) {
      return request('/keys', {
        method: 'POST',
        body: JSON.stringify({
          asset,
          public_key: publicKey,
          public_spend_key: publicSpendKey,
        }),
      });
    },

    async getUserKeys(userId: string) {
      return request(`/users/${userId}/keys`);
    },

    async getUserKeyForAsset(userId: string, asset: AssetType) {
      return request(`/users/${userId}/keys/${asset}`);
    },
  };
}
