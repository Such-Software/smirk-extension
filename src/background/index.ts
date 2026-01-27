/**
 * Background Service Worker - Main Entry Point
 *
 * This is the main entry point for the Smirk extension's background script.
 * It handles:
 * - Message routing between popup/content scripts and handlers
 * - Service worker lifecycle (initialization, alarms)
 * - Authentication token management
 *
 * Architecture:
 * The background script is split into modules for maintainability:
 * - state.ts: Global state, session persistence, pending transactions
 * - settings.ts: User settings, auto-lock timer
 * - wallet.ts: Wallet creation, restore, unlock/lock
 * - balance.ts: Balance queries for all assets
 * - send.ts: BTC/LTC transaction building and sending
 * - grin-handlers.ts: Grin WASM operations (receive, send, finalize)
 * - tips.ts: Tip decryption and claiming
 * - smirk-api.ts: window.smirk website integration API
 *
 * Message Flow:
 * 1. Popup/content script sends message via chrome.runtime.sendMessage
 * 2. runtime.onMessage listener receives message
 * 3. handleMessage routes to appropriate handler based on message.type
 * 4. Handler returns response
 * 5. Response sent back to caller
 */

// =============================================================================
// Service Worker Polyfill
// =============================================================================

// Polyfill window for WASM modules that expect browser context
// Service workers don't have window, but some WASM modules require it
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

// =============================================================================
// Imports
// =============================================================================

import type { MessageType, MessageResponse, TipInfo, OnboardingState, UserSettings } from '@/types';
import { runtime, alarms } from '@/lib/browser';
import { getAuthState, saveAuthState, getWalletState } from '@/lib/storage';
import { api } from '@/lib/api';

// State management
import {
  initializationPromise,
  setInitializationPromise,
  restoreSessionKeys,
  cachedAutoLockMinutes,
  setCachedAutoLockMinutes,
  AUTO_LOCK_ALARM,
} from './state';

// Settings and auto-lock
import {
  handleGetSettings,
  handleUpdateSettings,
  handleResetAutoLockTimer,
  resetAutoLockTimer,
  handleAutoLockAlarm,
} from './settings';

// Wallet operations
import {
  handleGetWalletState,
  handleGenerateMnemonic,
  handleConfirmMnemonic,
  handleRestoreWallet,
  handleCreateWallet,
  handleUnlockWallet,
  handleLockWallet,
  handleRevealSeed,
  handleGetOnboardingState,
  handleSaveOnboardingState,
  handleClearOnboardingState,
  handleGetAddresses,
} from './wallet';

// Balance operations
import {
  handleGetBalance,
  handleGetHistory,
  handleEstimateFee,
  handleGetWalletKeys,
} from './balance';

// Send operations
import {
  handleGetUtxos,
  handleMaxSendableUtxo,
  handleSendTx,
  handleAddPendingTx,
  handleGetPendingTxs,
} from './send';

// Grin operations
import {
  handleInitGrinWallet,
  handleGetGrinPendingSlatepacks,
  handleGrinSignSlate,
  handleGrinFinalizeSlate,
  handleGrinSignSlatepack,
  handleGrinCancelSlate,
  handleGrinCreateSend,
  handleGrinFinalizeAndBroadcast,
  handleGrinCancelSend,
  handleGrinCreateInvoice,
  handleGrinSignInvoice,
  handleGrinFinalizeInvoice,
} from './grin-handlers';

// Tips operations
import {
  handleDecryptTip,
  handleOpenClaimPopup,
  handleGetPendingClaim,
  handleClearPendingClaim,
  handleGetTipInfo,
  handleClaimTip,
} from './tips';

// window.smirk API operations
import {
  handleSmirkApi,
  handleApprovalResponse,
  handleGetPendingApproval,
  handleGetConnectedSites,
  handleDisconnectSite,
} from './smirk-api';

// Social tipping operations
import {
  handleLookupSocial,
  handleCreateSocialTip,
  handleGetClaimableTips,
  handleGetReceivedTips,
  handleClaimSocialTip,
  handleGetSentSocialTips,
  handleClawbackSocialTip,
} from './social';

// =============================================================================
// Message Handler
// =============================================================================

/**
 * Main message router.
 *
 * Routes incoming messages to appropriate handlers based on message.type.
 * All handlers return a MessageResponse with success status and data/error.
 *
 * @param message - Message from popup or content script
 * @returns Handler response
 */
async function handleMessage(message: MessageType): Promise<MessageResponse> {
  switch (message.type) {
    // =========================================================================
    // Wallet State
    // =========================================================================
    case 'GET_WALLET_STATE':
      return handleGetWalletState();

    // =========================================================================
    // Wallet Creation
    // =========================================================================
    case 'GENERATE_MNEMONIC':
      return handleGenerateMnemonic();

    case 'CONFIRM_MNEMONIC':
      return handleConfirmMnemonic(message.password, message.verifiedWords, message.words);

    case 'RESTORE_WALLET':
      return handleRestoreWallet(message.mnemonic, message.password);

    case 'CREATE_WALLET':
      return handleCreateWallet(message.password);

    // =========================================================================
    // Wallet Lock/Unlock
    // =========================================================================
    case 'UNLOCK_WALLET':
      return handleUnlockWallet(message.password);

    case 'LOCK_WALLET':
      return handleLockWallet();

    case 'REVEAL_SEED':
      return handleRevealSeed(message.password);

    // =========================================================================
    // Onboarding State
    // =========================================================================
    case 'GET_ONBOARDING_STATE':
      return handleGetOnboardingState();

    case 'SAVE_ONBOARDING_STATE':
      return handleSaveOnboardingState(message.state as OnboardingState);

    case 'CLEAR_ONBOARDING_STATE':
      return handleClearOnboardingState();

    // =========================================================================
    // Settings
    // =========================================================================
    case 'GET_SETTINGS':
      return handleGetSettings();

    case 'UPDATE_SETTINGS':
      return handleUpdateSettings(message.settings as Partial<UserSettings>);

    case 'RESET_AUTO_LOCK_TIMER':
      return handleResetAutoLockTimer();

    case 'GET_CONNECTED_SITES':
      return handleGetConnectedSites();

    case 'DISCONNECT_SITE':
      return handleDisconnectSite(message.origin as string);

    // =========================================================================
    // Addresses
    // =========================================================================
    case 'GET_ADDRESSES':
      return handleGetAddresses();

    // =========================================================================
    // Balance & History
    // =========================================================================
    case 'GET_BALANCE':
      return handleGetBalance(message.asset);

    case 'GET_HISTORY':
      return handleGetHistory(message.asset);

    case 'GET_WALLET_KEYS':
      return handleGetWalletKeys(message.asset);

    case 'ESTIMATE_FEE':
      return handleEstimateFee(message.asset);

    // =========================================================================
    // BTC/LTC Send Operations
    // =========================================================================
    case 'GET_UTXOS':
      return handleGetUtxos(message.asset, message.address);

    case 'MAX_SENDABLE_UTXO':
      return handleMaxSendableUtxo(message.asset, message.feeRate);

    case 'SEND_TX':
      return handleSendTx(message.asset, message.recipientAddress, message.amount, message.feeRate, message.sweep);

    case 'ADD_PENDING_TX':
      return handleAddPendingTx(message.txHash, message.asset, message.amount, message.fee);

    case 'GET_PENDING_TXS':
      return handleGetPendingTxs(message.asset);

    // =========================================================================
    // Grin WASM Operations
    // =========================================================================
    case 'INIT_GRIN_WALLET':
      return handleInitGrinWallet();

    case 'GET_GRIN_PENDING_SLATEPACKS':
      return handleGetGrinPendingSlatepacks();

    case 'GRIN_SIGN_SLATE':
      return handleGrinSignSlate(message.relayId, message.slatepack);

    case 'GRIN_FINALIZE_SLATE':
      return handleGrinFinalizeSlate(message.relayId, message.slatepack);

    case 'GRIN_SIGN_SLATEPACK':
      return handleGrinSignSlatepack(message.slatepack);

    case 'GRIN_CANCEL_SLATE':
      return handleGrinCancelSlate(message.relayId);

    case 'GRIN_CREATE_SEND':
      return handleGrinCreateSend(message.amount, message.fee, message.recipientAddress);

    case 'GRIN_FINALIZE_AND_BROADCAST':
      return handleGrinFinalizeAndBroadcast(message.slatepack, message.sendContext);

    case 'GRIN_CANCEL_SEND':
      return handleGrinCancelSend(message.slateId, message.inputIds);

    // =========================================================================
    // Grin RSR Invoice Flow
    // =========================================================================
    case 'GRIN_CREATE_INVOICE':
      return handleGrinCreateInvoice(message.amount);

    case 'GRIN_SIGN_INVOICE':
      return handleGrinSignInvoice(message.invoiceSlatepack);

    case 'GRIN_FINALIZE_INVOICE':
      return handleGrinFinalizeInvoice(
        message.signedSlatepack,
        message.originalSlatepack,
        message.slateId,
        message.secretKeyHex,
        message.secretNonceHex,
        message.outputInfo,
        message.publicBlindExcess,
        message.publicNonce,
        message.receiverAddress,
        message.amount
      );

    // =========================================================================
    // Tips
    // =========================================================================
    case 'DECRYPT_TIP':
      return handleDecryptTip(message.tipInfo as TipInfo);

    case 'OPEN_CLAIM_POPUP':
      return handleOpenClaimPopup(message.linkId, message.fragmentKey);

    case 'GET_TIP_INFO':
      return handleGetTipInfo(message.linkId);

    case 'CLAIM_TIP':
      return handleClaimTip(message.linkId, message.fragmentKey);

    case 'GET_PENDING_CLAIM':
      return handleGetPendingClaim();

    case 'CLEAR_PENDING_CLAIM':
      return handleClearPendingClaim();

    // =========================================================================
    // window.smirk API
    // =========================================================================
    case 'SMIRK_API':
      return handleSmirkApi(message.method, message.params, message.origin, message.siteName, message.favicon);

    case 'SMIRK_APPROVAL_RESPONSE':
      return handleApprovalResponse(message.requestId, message.approved);

    case 'GET_PENDING_APPROVAL':
      return handleGetPendingApproval(message.requestId);

    // =========================================================================
    // Social Tipping
    // =========================================================================
    case 'LOOKUP_SOCIAL':
      return handleLookupSocial(message.platform, message.username);

    case 'CREATE_SOCIAL_TIP':
      return handleCreateSocialTip(message.platform, message.username, message.asset, message.amount, message.recipientBtcPubkey);

    case 'GET_CLAIMABLE_TIPS':
      return handleGetClaimableTips();

    case 'GET_RECEIVED_TIPS':
      return handleGetReceivedTips();

    case 'CLAIM_SOCIAL_TIP':
      return handleClaimSocialTip(message.tipId, message.asset);

    case 'GET_SENT_SOCIAL_TIPS':
      return handleGetSentSocialTips();

    case 'CLAWBACK_SOCIAL_TIP':
      return handleClawbackSocialTip(message.tipId);

    // =========================================================================
    // Unknown
    // =========================================================================
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// =============================================================================
// Message Listener
// =============================================================================

/**
 * Main message listener.
 *
 * Waits for initialization to complete before processing messages
 * to avoid race conditions with session restoration.
 */
runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    // Wait for initialization before processing messages
    const process = async () => {
      if (initializationPromise) {
        await initializationPromise;
      }
      return handleMessage(message as MessageType);
    };

    process()
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ success: false, error: err.message }));

    // Return true to indicate async response
    return true;
  }
);

// =============================================================================
// Auto-Lock Alarm Handler
// =============================================================================

/**
 * Handle auto-lock alarm firing.
 *
 * Note: This runs when service worker wakes from the alarm, potentially before
 * initializeBackground() restores session state. We must clear session storage
 * directly to ensure the wallet stays locked even if the handler runs early.
 */
alarms.onAlarm.addListener(async (alarm) => {
  console.log('[AutoLock] Alarm fired:', alarm.name);
  if (alarm.name === AUTO_LOCK_ALARM) {
    await handleAutoLockAlarm();
  }
});

// =============================================================================
// Installation Handler
// =============================================================================

/**
 * Handle extension installation.
 */
runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Smirk Wallet installed');
  }
});

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize background service worker.
 *
 * Called on startup to:
 * 1. Restore unlock state from session storage (if any)
 * 2. Restore auto-lock timer if wallet was unlocked
 * 3. Refresh authentication token if expired
 */
async function initializeBackground(): Promise<void> {
  // Try to restore unlock state from session storage (survives service worker restarts)
  const restored = await restoreSessionKeys();
  if (restored) {
    // Also restore cached auto-lock minutes so timer works correctly
    const walletState = await getWalletState();
    setCachedAutoLockMinutes(walletState.settings.autoLockMinutes);
    console.log('[Session] Restored unlock state, cachedAutoLockMinutes:', cachedAutoLockMinutes);

    // Check if there's already an alarm set; if not, create one
    // This handles the case where the service worker restarted but wasn't triggered by the alarm
    const existingAlarm = await alarms.get(AUTO_LOCK_ALARM);
    if (!existingAlarm && cachedAutoLockMinutes && cachedAutoLockMinutes > 0) {
      console.log('[AutoLock] No existing alarm found after restore, creating new one');
      resetAutoLockTimer();
    } else if (existingAlarm) {
      console.log('[AutoLock] Existing alarm found, scheduled for:', new Date(existingAlarm.scheduledTime));
    }
  }

  // Restore authentication state
  const authState = await getAuthState();
  if (authState) {
    // Check if token is expired
    if (authState.expiresAt > Date.now()) {
      api.setAccessToken(authState.accessToken);
      console.log('Auth state restored');
    } else {
      // Try to refresh
      const result = await api.refreshToken(authState.refreshToken);
      if (result.data) {
        await saveAuthState({
          accessToken: result.data.accessToken,
          refreshToken: result.data.refreshToken,
          expiresAt: Date.now() + result.data.expiresIn * 1000,
          userId: authState.userId,
        });
        api.setAccessToken(result.data.accessToken);
        console.log('Auth token refreshed');
      } else {
        console.warn('Failed to refresh auth token, user may need to re-register');
      }
    }
  }
}

// =============================================================================
// Start
// =============================================================================

// Start initialization and store the promise so message handlers can wait for it
setInitializationPromise(
  initializeBackground().catch((err) => {
    console.error('Background initialization failed:', err);
  })
);

console.log('Smirk Wallet background service worker started');
