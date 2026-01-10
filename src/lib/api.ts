/**
 * API client for Smirk backend.
 */

import type {
  AssetType,
  TipInfo,
  CreateTipResponse,
  UserKeysResponse,
  ApiResponse,
} from '@/types';

const API_BASE = 'https://backend.smirk.cash/api/v1';

/**
 * API client class with authentication support.
 */
export class SmirkApi {
  private accessToken: string | null = null;

  constructor(private baseUrl: string = API_BASE) {}

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return { error: error.error || `HTTP ${response.status}` };
      }

      const data = await response.json();
      return { data };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  // =========================================================================
  // Authentication
  // =========================================================================

  /**
   * Authenticate via Telegram initData.
   */
  async telegramLogin(initData: string): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; telegramId: number; telegramUsername?: string };
  }>> {
    return this.request('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ init_data: initData }),
    });
  }

  /**
   * Refresh access token.
   */
  async refreshToken(refreshToken: string): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>> {
    return this.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }

  // =========================================================================
  // User Keys
  // =========================================================================

  /**
   * Register a public key for receiving encrypted tips.
   */
  async registerKey(
    asset: AssetType,
    publicKey: string,
    publicSpendKey?: string
  ): Promise<ApiResponse<{ asset: AssetType; publicKey: string }>> {
    return this.request('/keys', {
      method: 'POST',
      body: JSON.stringify({
        asset,
        public_key: publicKey,
        public_spend_key: publicSpendKey,
      }),
    });
  }

  /**
   * Get a user's public keys.
   */
  async getUserKeys(userId: string): Promise<ApiResponse<UserKeysResponse>> {
    return this.request(`/users/${userId}/keys`);
  }

  /**
   * Get a user's public key for a specific asset.
   */
  async getUserKeyForAsset(
    userId: string,
    asset: AssetType
  ): Promise<ApiResponse<{ asset: AssetType; publicKey: string; publicSpendKey?: string }>> {
    return this.request(`/users/${userId}/keys/${asset}`);
  }

  // =========================================================================
  // Tips
  // =========================================================================

  /**
   * Create a new tip.
   */
  async createTip(params: {
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
  }): Promise<ApiResponse<CreateTipResponse>> {
    return this.request('/tips', {
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
  }

  /**
   * Get tip info by link ID.
   */
  async getTip(linkId: string): Promise<ApiResponse<TipInfo>> {
    return this.request(`/tips/${linkId}`);
  }

  /**
   * Quick status check for a tip.
   */
  async getTipStatus(linkId: string): Promise<ApiResponse<{
    linkId: string;
    status: string;
    isClaimable: boolean;
  }>> {
    return this.request(`/tips/${linkId}/status`);
  }

  /**
   * Mark a tip as claimed.
   */
  async claimTip(linkId: string, txHash?: string): Promise<ApiResponse<TipInfo>> {
    return this.request(`/tips/${linkId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ tx_hash: txHash }),
    });
  }

  /**
   * Get tips sent by the current user.
   */
  async getSentTips(): Promise<ApiResponse<{ tips: TipInfo[]; total: number }>> {
    return this.request('/tips/sent');
  }

  /**
   * Get tips received by the current user.
   */
  async getReceivedTips(): Promise<ApiResponse<{ tips: TipInfo[]; total: number }>> {
    return this.request('/tips/received');
  }

  // =========================================================================
  // Health
  // =========================================================================

  /**
   * Check backend health.
   */
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request('/health', { method: 'GET' });
  }
}

// Default API instance
export const api = new SmirkApi();
