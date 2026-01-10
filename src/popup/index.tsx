import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { AssetType, TipInfo } from '@/types';

// Asset display info
const ASSETS: Record<AssetType, { name: string; symbol: string; icon: string }> = {
  btc: { name: 'Bitcoin', symbol: 'BTC', icon: '₿' },
  ltc: { name: 'Litecoin', symbol: 'LTC', icon: 'Ł' },
  xmr: { name: 'Monero', symbol: 'XMR', icon: 'ɱ' },
  wow: { name: 'Wownero', symbol: 'WOW', icon: '🐕' },
  grin: { name: 'Grin', symbol: 'GRIN', icon: '😊' },
};

// Send message to background
async function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// Lock Screen Component
function LockScreen({ onUnlock, hasWallet }: { onUnlock: () => void; hasWallet: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (hasWallet) {
        await sendMessage({ type: 'UNLOCK_WALLET', password });
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters');
          setLoading(false);
          return;
        }
        await sendMessage({ type: 'CREATE_WALLET', password });
      }
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="lock-screen">
      <div class="lock-icon">🔐</div>
      <h2 class="lock-title">
        {hasWallet ? 'Unlock Wallet' : 'Create Wallet'}
      </h2>
      <p class="lock-text">
        {hasWallet
          ? 'Enter your password to unlock'
          : 'Create a password to secure your wallet'}
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '280px' }}>
        <div class="form-group">
          <input
            type="password"
            class="form-input"
            placeholder="Password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            disabled={loading}
          />
        </div>

        {!hasWallet && (
          <div class="form-group">
            <input
              type="password"
              class="form-input"
              placeholder="Confirm Password"
              value={confirmPassword}
              onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
          </div>
        )}

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>
            {error}
          </p>
        )}

        <button type="submit" class="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
          {loading ? (
            <span class="spinner" style={{ margin: '0 auto' }} />
          ) : hasWallet ? (
            'Unlock'
          ) : (
            'Create Wallet'
          )}
        </button>
      </form>
    </div>
  );
}

// Main Wallet View
function WalletView({ onLock }: { onLock: () => void }) {
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const [availableAssets] = useState<AssetType[]>(['btc', 'ltc']);

  return (
    <>
      <header class="header">
        <h1>Smirk Wallet</h1>
        <div class="header-actions">
          <button class="btn btn-icon" title="Settings">⚙️</button>
          <button class="btn btn-icon" onClick={onLock} title="Lock">🔒</button>
        </div>
      </header>

      <div class="content">
        {/* Asset Tabs */}
        <div class="asset-tabs">
          {availableAssets.map((asset) => (
            <button
              key={asset}
              class={`asset-tab ${activeAsset === asset ? 'active' : ''}`}
              onClick={() => setActiveAsset(asset)}
            >
              {ASSETS[asset].icon} {ASSETS[asset].symbol}
            </button>
          ))}
        </div>

        {/* Balance Card */}
        <div class="balance-card">
          <div class="balance-label">Total Balance</div>
          <div class="balance-amount">
            0.00000000 {ASSETS[activeAsset].symbol}
          </div>
          <div class="balance-usd">≈ $0.00 USD</div>
        </div>

        {/* Action Buttons */}
        <div class="action-grid">
          <button class="action-btn">
            <span class="action-icon">📥</span>
            <span class="action-label">Receive</span>
          </button>
          <button class="action-btn">
            <span class="action-icon">📤</span>
            <span class="action-label">Send</span>
          </button>
          <button class="action-btn">
            <span class="action-icon">🎁</span>
            <span class="action-label">Tip</span>
          </button>
        </div>

        {/* Recent Activity */}
        <div class="section-title">Recent Activity</div>
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">No transactions yet</div>
          <div class="empty-text">
            Your transaction history will appear here
          </div>
        </div>
      </div>
    </>
  );
}

// Claim View Component
function ClaimView({
  tipInfo,
  fragmentKey,
  onClaimed,
  onCancel,
}: {
  tipInfo: TipInfo;
  fragmentKey?: string;
  onClaimed: () => void;
  onCancel: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleClaim = async () => {
    setClaiming(true);
    setError('');

    try {
      await sendMessage({
        type: 'CLAIM_TIP',
        linkId: tipInfo.linkId,
        fragmentKey,
      });
      setSuccess(true);
      setTimeout(onClaimed, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim tip');
    } finally {
      setClaiming(false);
    }
  };

  const asset = ASSETS[tipInfo.asset];

  if (success) {
    return (
      <div class="lock-screen">
        <div class="lock-icon">🎉</div>
        <h2 class="lock-title">Tip Claimed!</h2>
        <p class="lock-text">
          {tipInfo.amountDisplay} {asset.symbol} has been added to your wallet.
        </p>
      </div>
    );
  }

  return (
    <div class="lock-screen">
      <div class="lock-icon">🎁</div>
      <h2 class="lock-title">Claim Tip</h2>

      <div class="balance-card" style={{ marginBottom: '16px' }}>
        <div class="balance-label">You received</div>
        <div class="balance-amount">
          {tipInfo.amountDisplay} {asset.symbol}
        </div>
        {tipInfo.recipientHint && (
          <div class="balance-usd">From: {tipInfo.recipientHint}</div>
        )}
      </div>

      {tipInfo.isEncrypted && (
        <p style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '16px' }}>
          🔒 This tip was encrypted specifically for you
        </p>
      )}

      {error && (
        <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '280px' }}>
        <button
          class="btn"
          style={{ flex: 1, background: '#3f3f46' }}
          onClick={onCancel}
          disabled={claiming}
        >
          Cancel
        </button>
        <button
          class="btn btn-primary"
          style={{ flex: 1 }}
          onClick={handleClaim}
          disabled={claiming}
        >
          {claiming ? <span class="spinner" style={{ margin: '0 auto' }} /> : 'Claim'}
        </button>
      </div>
    </div>
  );
}

// Main App Component
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
      }>({ type: 'GET_WALLET_STATE' });

      setIsUnlocked(state.isUnlocked);
      setHasWallet(state.hasWallet);

      // Check for pending claim after wallet state
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
        // Fetch tip info
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
    // Check for pending claims after unlock
    await checkPendingClaim();
  };

  const handleLock = async () => {
    try {
      await sendMessage({ type: 'LOCK_WALLET' });
      setIsUnlocked(false);
      setPendingClaim(null);
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

  if (!isUnlocked) {
    return <LockScreen onUnlock={handleUnlock} hasWallet={hasWallet} />;
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
