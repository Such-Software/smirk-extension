/**
 * Social tipping API methods.
 */

import type { ApiClient, ApiResponse } from './client';
import type { AssetType } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface SocialLookupResponse {
  registered: boolean;
  user_id: string | null;
  public_keys: {
    btc: string | null;
    ltc: string | null;
    xmr: string | null;
    wow: string | null;
    grin: string | null;
  } | null;
}

export interface CreateSocialTipRequest {
  platform?: string;
  username?: string;
  asset: AssetType;
  amount: number;
  encrypted_key?: string;
  is_public: boolean;
  claim_key_hash?: string;
  tip_address?: string;
  funding_txid?: string;
}

export interface CreateSocialTipResponse {
  tip_id: string;
  status: string;
  share_url: string | null;
}

export interface ClaimableTip {
  id: string;
  asset: AssetType;
  amount: number;
  from_platform: string | null;
  created_at: string;
  encrypted_key: string | null;
  tip_address: string | null;
  /** Current number of confirmations for funding tx */
  funding_confirmations: number;
  /** Required confirmations before tip is claimable (XMR/GRIN=10, WOW=4, BTC/LTC=0) */
  confirmations_required: number;
}

export interface SentTip {
  id: string;
  sender_user_id: string;
  recipient_platform: string | null;
  recipient_username: string | null;
  asset: AssetType;
  amount: number;
  is_public: boolean;
  status: string;
  created_at: string;
  claimed_at: string | null;
  clawed_back_at: string | null;
  /** Current number of confirmations for funding tx */
  funding_confirmations: number;
  /** Required confirmations before tip is claimable (XMR/GRIN=10, WOW=4, BTC/LTC=0) */
  confirmations_required: number;
  /** Whether the tip has enough confirmations to be claimed */
  is_claimable: boolean;
}

// ============================================================================
// Methods interface
// ============================================================================

/** Received tip (includes confirmation status for pending tips) */
export interface ReceivedTip {
  id: string;
  sender_user_id: string;
  recipient_platform: string | null;
  recipient_username: string | null;
  asset: AssetType;
  amount: number;
  is_public: boolean;
  status: string;
  created_at: string;
  claimed_at: string | null;
  clawed_back_at: string | null;
  /** Current number of confirmations for funding tx */
  funding_confirmations: number;
  /** Required confirmations before tip is claimable (XMR/GRIN=10, WOW=4, BTC/LTC=0) */
  confirmations_required: number;
  /** Whether the tip has enough confirmations to be claimed */
  is_claimable: boolean;
}

export interface PublicTipInfo {
  id: string;
  asset: AssetType;
  amount: number;
  status: string;
  created_at: string;
  is_public: boolean;
  funding_confirmations: number;
  confirmations_required: number;
}

export interface SocialMethods {
  /**
   * Look up if a username is registered for social tipping.
   * Returns their public keys if registered.
   */
  lookupSocial(
    platform: string,
    username: string
  ): Promise<ApiResponse<SocialLookupResponse>>;

  /**
   * Create a social tip (targeted or public).
   */
  createSocialTip(
    request: CreateSocialTipRequest
  ): Promise<ApiResponse<CreateSocialTipResponse>>;

  /**
   * Get tips the current user can claim (only confirmed tips).
   */
  getClaimableTips(): Promise<ApiResponse<{ tips: ClaimableTip[] }>>;

  /**
   * Get all received tips (full history, includes unconfirmed).
   * Use this to show tips waiting for confirmations.
   */
  getReceivedTips(): Promise<ApiResponse<{ tips: ReceivedTip[] }>>;

  /**
   * Get tips sent by the current user.
   */
  getSentSocialTips(): Promise<ApiResponse<{ tips: SentTip[] }>>;

  /**
   * Claim a social tip.
   */
  claimSocialTip(
    tipId: string
  ): Promise<ApiResponse<{ success: boolean; encrypted_key: string | null; tip_address: string | null }>>;

  /**
   * Clawback a tip (sender reclaims unclaimed funds).
   */
  clawbackSocialTip(tipId: string): Promise<ApiResponse<{ success: boolean }>>;

  /**
   * Get public tip info (unauthenticated).
   * Only works for public tips - returns 404 for targeted tips.
   */
  getPublicSocialTip(tipId: string): Promise<ApiResponse<PublicTipInfo>>;
}

// ============================================================================
// Factory
// ============================================================================

export function createSocialMethods(client: ApiClient): SocialMethods {
  return {
    async lookupSocial(platform: string, username: string) {
      return client.request<SocialLookupResponse>(
        `/socials/lookup?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(username)}`,
        { method: 'GET' }
      );
    },

    async createSocialTip(request: CreateSocialTipRequest) {
      return client.request<CreateSocialTipResponse>('/tips/social', {
        method: 'POST',
        body: JSON.stringify(request),
      });
    },

    async getClaimableTips() {
      return client.request<{ tips: ClaimableTip[] }>('/tips/social/claimable', {
        method: 'GET',
      });
    },

    async getReceivedTips() {
      return client.request<{ tips: ReceivedTip[] }>('/tips/social/received', {
        method: 'GET',
      });
    },

    async getSentSocialTips() {
      return client.request<{ tips: SentTip[] }>('/tips/social/sent', {
        method: 'GET',
      });
    },

    async claimSocialTip(tipId: string) {
      return client.request<{ success: boolean; encrypted_key: string | null; tip_address: string | null }>(
        `/tips/social/${tipId}/claim`,
        { method: 'POST' }
      );
    },

    async clawbackSocialTip(tipId: string) {
      return client.request<{ success: boolean }>(
        `/tips/social/${tipId}/clawback`,
        { method: 'POST' }
      );
    },

    async getPublicSocialTip(tipId: string) {
      return client.request<PublicTipInfo>(
        `/tips/social/${tipId}/public`,
        { method: 'GET' },
        false // No auth required
      );
    },
  };
}
