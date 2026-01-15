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

// Vite environment variable type
declare const import_meta_env: { VITE_API_BASE?: string };

// API base URL - set via environment or default to production server
const API_BASE = (import.meta as unknown as { env: typeof import_meta_env }).env.VITE_API_BASE || 'http://45.84.59.17:8080/api/v1';

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

  /**
   * Register extension wallet and authenticate.
   * Uses BTC public key hash as identity.
   */
  async extensionRegister(params: {
    keys: Array<{
      asset: string;
      publicKey: string;
      publicSpendKey?: string;
    }>;
    username?: string;
    walletBirthday?: number;
  }): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; username?: string; isNew: boolean };
  }>> {
    return this.request('/auth/extension', {
      method: 'POST',
      body: JSON.stringify({
        keys: params.keys.map(k => ({
          asset: k.asset,
          public_key: k.publicKey,
          public_spend_key: k.publicSpendKey,
        })),
        username: params.username,
        wallet_birthday: params.walletBirthday,
      }),
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
  // Wallet Balance
  // =========================================================================

  /**
   * Get UTXO balance for BTC or LTC address via Electrum.
   */
  async getUtxoBalance(
    asset: 'btc' | 'ltc',
    address: string
  ): Promise<ApiResponse<{
    asset: string;
    address: string;
    confirmed: number;
    unconfirmed: number;
    total: number;
  }>> {
    return this.request('/wallet/balance', {
      method: 'POST',
      body: JSON.stringify({ asset, address }),
    });
  }

  /**
   * Get LWS balance for XMR or WOW address.
   *
   * Returns total_received (view-only) and spent_outputs (candidate spends).
   * Client must verify spent_outputs using spend key to compute true balance:
   *   true_balance = total_received - sum(verified_spent_amounts)
   */
  async getLwsBalance(
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
  }>> {
    return this.request('/wallet/lws/balance', {
      method: 'POST',
      body: JSON.stringify({ asset, address, view_key: viewKey }),
    });
  }

  /**
   * Get unspent outputs for transaction construction (XMR/WOW).
   * Returns spendable outputs with their details for tx building.
   */
  async getUnspentOuts(
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
  }>> {
    return this.request('/wallet/lws/unspent', {
      method: 'POST',
      body: JSON.stringify({ asset, address, view_key: viewKey }),
    });
  }

  /**
   * Get random outputs for decoy selection in ring signatures (XMR/WOW).
   * @param count - Number of decoys needed (typically 15 for ring size 16)
   */
  async getRandomOuts(
    asset: 'xmr' | 'wow',
    count: number
  ): Promise<ApiResponse<{
    outputs: Array<{
      global_index: number;
      public_key: string;
      rct: string;
    }>;
  }>> {
    return this.request('/wallet/lws/decoys', {
      method: 'POST',
      body: JSON.stringify({ asset, count }),
    });
  }

  /**
   * Submit a signed XMR/WOW transaction for broadcast.
   * @param txHex - The fully signed transaction hex from smirk-wasm
   */
  async submitLwsTx(
    asset: 'xmr' | 'wow',
    txHex: string
  ): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>> {
    return this.request('/wallet/lws/submit', {
      method: 'POST',
      body: JSON.stringify({ asset, tx_hex: txHex }),
    });
  }

  /**
   * Register wallet with LWS for balance scanning.
   * @param asset - 'xmr' or 'wow'
   * @param address - Primary address
   * @param viewKey - Private view key (hex)
   * @param startHeight - Optional start height (for wallets created in the past)
   */
  async registerLws(
    asset: 'xmr' | 'wow',
    address: string,
    viewKey: string,
    startHeight?: number
  ): Promise<ApiResponse<{
    success: boolean;
    message: string;
    start_height?: number;
  }>> {
    return this.request('/wallet/lws/register', {
      method: 'POST',
      body: JSON.stringify({
        asset,
        address,
        view_key: viewKey,
        start_height: startHeight,
      }),
    });
  }

  /**
   * Get UTXOs for a BTC or LTC address.
   * Used for constructing transactions client-side.
   */
  async getUtxos(
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
  }>> {
    return this.request('/wallet/utxos', {
      method: 'POST',
      body: JSON.stringify({ asset, address }),
    });
  }

  /**
   * Broadcast a signed BTC or LTC transaction.
   * @param asset - 'btc' or 'ltc'
   * @param txHex - The fully signed raw transaction hex
   * @returns Transaction ID (hash) if successful
   */
  async broadcastTx(
    asset: 'btc' | 'ltc',
    txHex: string
  ): Promise<ApiResponse<{
    asset: string;
    txid: string;
  }>> {
    return this.request('/wallet/broadcast', {
      method: 'POST',
      body: JSON.stringify({ asset, tx_hex: txHex }),
    });
  }

  /**
   * Get transaction history for a BTC or LTC address.
   * Returns transactions touching this address, newest first.
   */
  async getHistory(
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
  }>> {
    return this.request('/wallet/history', {
      method: 'POST',
      body: JSON.stringify({ asset, address }),
    });
  }

  /**
   * Estimate fee rates for BTC or LTC.
   * Returns rates in sat/vB for different confirmation speeds.
   */
  async estimateFee(asset: 'btc' | 'ltc'): Promise<ApiResponse<{
    asset: string;
    fast: number | null; // 1-2 blocks
    normal: number | null; // 3-6 blocks
    slow: number | null; // 12-24 blocks
  }>> {
    return this.request('/wallet/fees', {
      method: 'POST',
      body: JSON.stringify({ asset }),
    });
  }

  /**
   * Get Grin wallet balance from backend.
   * Note: Grin uses a shared wallet on the backend due to Mimblewimble's
   * interactive transaction nature.
   */
  async getGrinBalance(): Promise<ApiResponse<{
    spendable: number;
    awaiting_confirmation: number;
    awaiting_finalization: number;
    locked: number;
    immature: number;
    total: number;
  }>> {
    return this.request('/wallet/grin/balance', { method: 'GET' });
  }

  // =========================================================================
  // Blockchain Info
  // =========================================================================

  /**
   * Get current blockchain heights for all networks.
   * Useful for wallet creation to determine start heights.
   */
  async getBlockchainHeights(): Promise<ApiResponse<{
    btc: number | null;
    ltc: number | null;
    xmr: number | null;
    wow: number | null;
    grin: number | null;
  }>> {
    return this.request('/wallet/heights', { method: 'GET' });
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
