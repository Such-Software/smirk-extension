/**
 * Smirk API client - combines all domain-specific methods.
 */

import { ApiClient, ApiResponse } from './client';
import { createAuthMethods, AuthMethods } from './auth';
import { createKeysMethods, KeysMethods } from './keys';
import { createTipsMethods, TipsMethods } from './tips';
import { createSocialMethods, SocialMethods } from './social';
import { createWalletUtxoMethods, WalletUtxoMethods } from './wallet-utxo';
import { createWalletLwsMethods, WalletLwsMethods } from './wallet-lws';
import { createGrinMethods, GrinMethods } from './grin';

// Re-export types
export type { ApiResponse } from './client';

/**
 * Combined Smirk API client with all methods.
 */
export class SmirkApi extends ApiClient implements
  AuthMethods,
  KeysMethods,
  TipsMethods,
  SocialMethods,
  WalletUtxoMethods,
  WalletLwsMethods,
  GrinMethods
{
  // Auth methods
  telegramLogin: AuthMethods['telegramLogin'];
  refreshToken: AuthMethods['refreshToken'];
  extensionRegister: AuthMethods['extensionRegister'];
  checkRestore: AuthMethods['checkRestore'];

  // Keys methods
  registerKey: KeysMethods['registerKey'];
  getUserKeys: KeysMethods['getUserKeys'];
  getUserKeyForAsset: KeysMethods['getUserKeyForAsset'];

  // Tips methods
  createTip: TipsMethods['createTip'];
  getTip: TipsMethods['getTip'];
  getTipStatus: TipsMethods['getTipStatus'];
  claimTip: TipsMethods['claimTip'];
  getSentTips: TipsMethods['getSentTips'];
  getReceivedTips: TipsMethods['getReceivedTips'];

  // Social tipping methods
  lookupSocial: SocialMethods['lookupSocial'];
  createSocialTip: SocialMethods['createSocialTip'];
  getClaimableTips: SocialMethods['getClaimableTips'];
  getReceivedSocialTips: SocialMethods['getReceivedTips'];
  getSentSocialTips: SocialMethods['getSentSocialTips'];
  claimSocialTip: SocialMethods['claimSocialTip'];
  clawbackSocialTip: SocialMethods['clawbackSocialTip'];
  getPublicSocialTip: SocialMethods['getPublicSocialTip'];

  // Wallet UTXO methods (BTC/LTC)
  getUtxoBalance: WalletUtxoMethods['getUtxoBalance'];
  getUtxos: WalletUtxoMethods['getUtxos'];
  broadcastTx: WalletUtxoMethods['broadcastTx'];
  getHistory: WalletUtxoMethods['getHistory'];
  estimateFee: WalletUtxoMethods['estimateFee'];

  // Wallet LWS methods (XMR/WOW)
  getLwsBalance: WalletLwsMethods['getLwsBalance'];
  getUnspentOuts: WalletLwsMethods['getUnspentOuts'];
  getRandomOuts: WalletLwsMethods['getRandomOuts'];
  submitLwsTx: WalletLwsMethods['submitLwsTx'];
  getLwsHistory: WalletLwsMethods['getLwsHistory'];
  registerLws: WalletLwsMethods['registerLws'];
  deactivateLws: WalletLwsMethods['deactivateLws'];

  // Grin methods
  createGrinRelay: GrinMethods['createGrinRelay'];
  getGrinPendingSlatepacks: GrinMethods['getGrinPendingSlatepacks'];
  signGrinSlatepack: GrinMethods['signGrinSlatepack'];
  finalizeGrinSlatepack: GrinMethods['finalizeGrinSlatepack'];
  cancelGrinSlatepack: GrinMethods['cancelGrinSlatepack'];
  getGrinUserBalance: GrinMethods['getGrinUserBalance'];
  getGrinUserHistory: GrinMethods['getGrinUserHistory'];
  getGrinOutputs: GrinMethods['getGrinOutputs'];
  recordGrinOutput: GrinMethods['recordGrinOutput'];
  lockGrinOutputs: GrinMethods['lockGrinOutputs'];
  unlockGrinOutputs: GrinMethods['unlockGrinOutputs'];
  spendGrinOutputs: GrinMethods['spendGrinOutputs'];
  recordGrinTransaction: GrinMethods['recordGrinTransaction'];
  updateGrinTransaction: GrinMethods['updateGrinTransaction'];
  broadcastGrinTransaction: GrinMethods['broadcastGrinTransaction'];

  constructor(baseUrl?: string) {
    super(baseUrl);

    // Initialize all method groups
    const auth = createAuthMethods(this);
    const keys = createKeysMethods(this);
    const tips = createTipsMethods(this);
    const social = createSocialMethods(this);
    const utxo = createWalletUtxoMethods(this);
    const lws = createWalletLwsMethods(this);
    const grin = createGrinMethods(this);

    // Assign auth methods
    this.telegramLogin = auth.telegramLogin;
    this.refreshToken = auth.refreshToken;
    this.extensionRegister = auth.extensionRegister;
    this.checkRestore = auth.checkRestore;

    // Assign keys methods
    this.registerKey = keys.registerKey;
    this.getUserKeys = keys.getUserKeys;
    this.getUserKeyForAsset = keys.getUserKeyForAsset;

    // Assign tips methods
    this.createTip = tips.createTip;
    this.getTip = tips.getTip;
    this.getTipStatus = tips.getTipStatus;
    this.claimTip = tips.claimTip;
    this.getSentTips = tips.getSentTips;
    this.getReceivedTips = tips.getReceivedTips;

    // Assign social tipping methods
    this.lookupSocial = social.lookupSocial;
    this.createSocialTip = social.createSocialTip;
    this.getClaimableTips = social.getClaimableTips;
    this.getReceivedSocialTips = social.getReceivedTips;
    this.getSentSocialTips = social.getSentSocialTips;
    this.claimSocialTip = social.claimSocialTip;
    this.clawbackSocialTip = social.clawbackSocialTip;
    this.getPublicSocialTip = social.getPublicSocialTip;

    // Assign wallet UTXO methods
    this.getUtxoBalance = utxo.getUtxoBalance;
    this.getUtxos = utxo.getUtxos;
    this.broadcastTx = utxo.broadcastTx;
    this.getHistory = utxo.getHistory;
    this.estimateFee = utxo.estimateFee;

    // Assign wallet LWS methods
    this.getLwsBalance = lws.getLwsBalance;
    this.getUnspentOuts = lws.getUnspentOuts;
    this.getRandomOuts = lws.getRandomOuts;
    this.submitLwsTx = lws.submitLwsTx;
    this.getLwsHistory = lws.getLwsHistory;
    this.registerLws = lws.registerLws;
    this.deactivateLws = lws.deactivateLws;

    // Assign grin methods
    this.createGrinRelay = grin.createGrinRelay;
    this.getGrinPendingSlatepacks = grin.getGrinPendingSlatepacks;
    this.signGrinSlatepack = grin.signGrinSlatepack;
    this.finalizeGrinSlatepack = grin.finalizeGrinSlatepack;
    this.cancelGrinSlatepack = grin.cancelGrinSlatepack;
    this.getGrinUserBalance = grin.getGrinUserBalance;
    this.getGrinUserHistory = grin.getGrinUserHistory;
    this.getGrinOutputs = grin.getGrinOutputs;
    this.recordGrinOutput = grin.recordGrinOutput;
    this.lockGrinOutputs = grin.lockGrinOutputs;
    this.unlockGrinOutputs = grin.unlockGrinOutputs;
    this.spendGrinOutputs = grin.spendGrinOutputs;
    this.recordGrinTransaction = grin.recordGrinTransaction;
    this.updateGrinTransaction = grin.updateGrinTransaction;
    this.broadcastGrinTransaction = grin.broadcastGrinTransaction;
  }

  /**
   * Get current blockchain heights for all networks.
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

  /**
   * Check backend health.
   */
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request('/health', { method: 'GET' });
  }

  /**
   * Get current cryptocurrency prices.
   */
  async getPrices(): Promise<ApiResponse<{
    btc: number | null;
    ltc: number | null;
    xmr: number | null;
    wow: number | null;
    grin: number | null;
    updated_at: string;
  }>> {
    return this.request('/prices', { method: 'GET' });
  }

  /**
   * Get sparkline data for an asset (2-week history, downsampled).
   */
  async getSparkline(asset: string): Promise<ApiResponse<{
    prices: number[];
    min: number;
    max: number;
    change_pct: number;
  }>> {
    return this.request(`/prices/sparkline/${asset}`, { method: 'GET' });
  }
}

// Default API instance
export const api = new SmirkApi();
