import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { AssetType, TipInfo } from '@/types';
import { sendMessage, clearScreenState } from './shared';
import {
  ClaimView,
  Onboarding,
  UnlockScreen,
  WalletView,
} from './components';

function App() {
  const [loading, setLoading] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [pendingClaim, setPendingClaim] = useState<{
    tipInfo: TipInfo;
    fragmentKey?: string;
  } | null>(null);

  useEffect(() => {
    checkWalletState();
  }, []);

  const checkWalletState = async () => {
    try {
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

// Mount the app
render(<App />, document.getElementById('app')!);
