import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { AssetType, TipInfo, UserSettings } from '@/types';
import { sendMessage, clearScreenState } from './shared';
import {
  ApprovalView,
  ClaimView,
  Onboarding,
  ToastProvider,
  UnlockScreen,
  WalletView,
} from './components';
import { applyTheme } from './components/SettingsView';

// Parse URL parameters
function getUrlParams(): { mode?: string; requestId?: string; popup?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('mode') || undefined,
    requestId: params.get('requestId') || undefined,
    popup: params.get('popup') || undefined,
  };
}

function App() {
  const [loading, setLoading] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [pendingClaim, setPendingClaim] = useState<{
    tipInfo: TipInfo;
    fragmentKey?: string;
  } | null>(null);

  // Check if this is an approval popup
  const urlParams = getUrlParams();
  const isApprovalMode = urlParams.mode === 'approve' && urlParams.requestId;

  useEffect(() => {
    // Always check wallet state - approval mode needs to know if locked
    checkWalletState();
  }, []);

  const loadTheme = async () => {
    try {
      const { settings } = await sendMessage<{ settings: UserSettings }>({ type: 'GET_SETTINGS' });
      if (settings?.theme) {
        applyTheme(settings.theme);
      }
    } catch {
      // Ignore theme load errors
    }
  };

  const checkWalletState = async () => {
    try {
      // Load and apply theme immediately
      try {
        const { settings } = await sendMessage<{ settings: UserSettings }>({ type: 'GET_SETTINGS' });
        if (settings?.theme) {
          applyTheme(settings.theme);
        }
      } catch {
        // Settings may not exist yet for new wallets
      }

      const state = await sendMessage<{
        isUnlocked: boolean;
        hasWallet: boolean;
        assets: AssetType[];
        needsBackup: boolean;
      }>({ type: 'GET_WALLET_STATE' });

      setIsUnlocked(state.isUnlocked);
      setHasWallet(state.hasWallet);

      if (state.isUnlocked) {
        await checkPendingClaim();
      }
    } catch (err) {
      console.error('Failed to get wallet state:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkPendingClaim = async () => {
    try {
      const pending = await sendMessage<{
        pending: boolean;
        linkId?: string;
        fragmentKey?: string;
      }>({ type: 'GET_PENDING_CLAIM' });

      if (pending.pending && pending.linkId) {
        const tipResult = await sendMessage<{ tip: TipInfo }>({
          type: 'GET_TIP_INFO',
          linkId: pending.linkId,
        });

        setPendingClaim({
          tipInfo: tipResult.tip,
          fragmentKey: pending.fragmentKey,
        });
      }
    } catch (err) {
      console.error('Failed to check pending claim:', err);
    }
  };

  const handleUnlock = async () => {
    setIsUnlocked(true);
    setHasWallet(true);
    await checkPendingClaim();
  };

  const handleLock = async () => {
    try {
      await sendMessage({ type: 'LOCK_WALLET' });
      setIsUnlocked(false);
      setPendingClaim(null);
      // Clear saved screen state when locking
      await clearScreenState();
    } catch (err) {
      console.error('Failed to lock:', err);
    }
  };

  const handleClaimComplete = async () => {
    await sendMessage({ type: 'CLEAR_PENDING_CLAIM' });
    setPendingClaim(null);
  };

  const handleClaimCancel = async () => {
    await sendMessage({ type: 'CLEAR_PENDING_CLAIM' });
    setPendingClaim(null);
  };

  if (loading) {
    return (
      <div class="lock-screen">
        <div class="spinner" />
      </div>
    );
  }

  // Approval mode handling
  if (isApprovalMode && urlParams.requestId) {
    // Need wallet first
    if (!hasWallet) {
      return <Onboarding onComplete={handleUnlock} />;
    }
    // Need to unlock first
    if (!isUnlocked) {
      return <UnlockScreen onUnlock={handleUnlock} />;
    }
    // Wallet unlocked - show approval
    return (
      <ApprovalView
        requestId={urlParams.requestId}
        onComplete={() => window.close()}
      />
    );
  }

  // No wallet yet - show onboarding
  if (!hasWallet) {
    return <Onboarding onComplete={handleUnlock} />;
  }

  // Wallet exists but locked
  if (!isUnlocked) {
    return <UnlockScreen onUnlock={handleUnlock} />;
  }

  // Show claim view if there's a pending claim
  if (pendingClaim) {
    return (
      <ClaimView
        tipInfo={pendingClaim.tipInfo}
        fragmentKey={pendingClaim.fragmentKey}
        onClaimed={handleClaimComplete}
        onCancel={handleClaimCancel}
      />
    );
  }

  return <WalletView onLock={handleLock} />;
}

// Mount the app with ToastProvider
render(
  <ToastProvider>
    <App />
  </ToastProvider>,
  document.getElementById('app')!
);
