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

// ============================================================================
// Onboarding Flow Components
// ============================================================================

type OnboardingStep = 'choice' | 'generate' | 'verify' | 'password';

function OnboardingChoice({
  onCreateNew,
  onRestore,
}: {
  onCreateNew: () => void;
  onRestore: () => void;
}) {
  return (
    <div class="lock-screen">
      <div class="lock-icon">🦊</div>
      <h2 class="lock-title">Welcome to Smirk</h2>
      <p class="lock-text">Non-custodial multi-currency tip wallet</p>

      <div style={{ width: '100%', maxWidth: '280px', marginTop: '24px' }}>
        <button class="btn btn-primary" style={{ width: '100%', marginBottom: '12px' }} onClick={onCreateNew}>
          Create New Wallet
        </button>
        <button class="btn" style={{ width: '100%', background: '#3f3f46' }} onClick={onRestore}>
          Restore from Seed
        </button>
      </div>
    </div>
  );
}

function SeedDisplay({
  words,
  onContinue,
}: {
  words: string[];
  onContinue: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div class="lock-screen" style={{ padding: '16px' }}>
      <h2 class="lock-title" style={{ fontSize: '18px', marginBottom: '8px' }}>
        Write Down Your Recovery Phrase
      </h2>
      <p class="lock-text" style={{ fontSize: '12px', marginBottom: '16px' }}>
        These 12 words are the ONLY way to recover your wallet. Write them down and store safely offline.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          width: '100%',
          marginBottom: '16px',
        }}
      >
        {words.map((word, i) => (
          <div
            key={i}
            style={{
              background: '#27272a',
              padding: '8px',
              borderRadius: '6px',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            <span style={{ color: '#71717a', marginRight: '4px' }}>{i + 1}.</span>
            {word}
          </div>
        ))}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          marginBottom: '16px',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed((e.target as HTMLInputElement).checked)}
        />
        I have written down my recovery phrase
      </label>

      <button
        class="btn btn-primary"
        style={{ width: '100%' }}
        disabled={!confirmed}
        onClick={onContinue}
      >
        Continue
      </button>
    </div>
  );
}

function SeedVerify({
  words,
  verifyIndices,
  onVerified,
  onBack,
}: {
  words: string[];
  verifyIndices: number[];
  onVerified: (verifiedWords: Record<number, string>) => void;
  onBack: () => void;
}) {
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    setError('');

    // Check each word
    for (const idx of verifyIndices) {
      const input = (inputs[idx] || '').toLowerCase().trim();
      if (input !== words[idx]) {
        setError(`Word #${idx + 1} is incorrect. Please check your backup.`);
        return;
      }
    }

    onVerified(inputs);
  };

  return (
    <div class="lock-screen" style={{ padding: '16px' }}>
      <h2 class="lock-title" style={{ fontSize: '18px', marginBottom: '8px' }}>
        Verify Your Backup
      </h2>
      <p class="lock-text" style={{ fontSize: '12px', marginBottom: '16px' }}>
        Enter the following words from your recovery phrase to confirm you saved it.
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        {verifyIndices.map((idx) => (
          <div key={idx} class="form-group" style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px', display: 'block' }}>
              Word #{idx + 1}
            </label>
            <input
              type="text"
              class="form-input"
              placeholder={`Enter word #${idx + 1}`}
              value={inputs[idx] || ''}
              onInput={(e) =>
                setInputs({ ...inputs, [idx]: (e.target as HTMLInputElement).value })
              }
              autoComplete="off"
              autoCapitalize="off"
            />
          </div>
        ))}

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            class="btn"
            style={{ flex: 1, background: '#3f3f46' }}
            onClick={onBack}
          >
            Back
          </button>
          <button type="submit" class="btn btn-primary" style={{ flex: 1 }}>
            Verify
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordSetup({
  onComplete,
  verifiedWords,
}: {
  onComplete: () => void;
  verifiedWords: Record<number, string>;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await sendMessage({
        type: 'CONFIRM_MNEMONIC',
        password,
        verifiedWords,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="lock-screen">
      <div class="lock-icon">🔐</div>
      <h2 class="lock-title">Set Password</h2>
      <p class="lock-text">This password encrypts your wallet on this device.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '280px' }}>
        <div class="form-group">
          <input
            type="password"
            class="form-input"
            placeholder="Password (min 8 characters)"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            disabled={loading}
          />
        </div>
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

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
        )}

        <button type="submit" class="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
          {loading ? <span class="spinner" style={{ margin: '0 auto' }} /> : 'Create Wallet'}
        </button>
      </form>
    </div>
  );
}

function RestoreWallet({ onComplete, onBack }: { onComplete: () => void; onBack: () => void }) {
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');

    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) {
      setError('Recovery phrase must be exactly 12 words');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await sendMessage({
        type: 'RESTORE_WALLET',
        mnemonic: words.join(' '),
        password,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="lock-screen" style={{ padding: '16px' }}>
      <h2 class="lock-title" style={{ fontSize: '18px', marginBottom: '8px' }}>
        Restore Wallet
      </h2>
      <p class="lock-text" style={{ fontSize: '12px', marginBottom: '16px' }}>
        Enter your 12-word recovery phrase to restore your wallet.
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <div class="form-group">
          <textarea
            class="form-input"
            placeholder="Enter your 12-word recovery phrase..."
            value={mnemonic}
            onInput={(e) => setMnemonic((e.target as HTMLTextAreaElement).value)}
            disabled={loading}
            rows={3}
            style={{ resize: 'none', fontFamily: 'monospace' }}
          />
        </div>
        <div class="form-group">
          <input
            type="password"
            class="form-input"
            placeholder="New Password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            disabled={loading}
          />
        </div>
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

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            class="btn"
            style={{ flex: 1, background: '#3f3f46' }}
            onClick={onBack}
            disabled={loading}
          >
            Back
          </button>
          <button type="submit" class="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
            {loading ? <span class="spinner" style={{ margin: '0 auto' }} /> : 'Restore'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<OnboardingStep>('choice');
  const [isRestoring, setIsRestoring] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifiedWords, setVerifiedWords] = useState<Record<number, string>>({});

  const handleCreateNew = async () => {
    try {
      const result = await sendMessage<{ words: string[]; verifyIndices: number[] }>({
        type: 'GENERATE_MNEMONIC',
      });
      setWords(result.words);
      setVerifyIndices(result.verifyIndices);
      setStep('generate');
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
    }
  };

  const handleRestore = () => {
    setIsRestoring(true);
  };

  if (isRestoring) {
    return <RestoreWallet onComplete={onComplete} onBack={() => setIsRestoring(false)} />;
  }

  switch (step) {
    case 'choice':
      return <OnboardingChoice onCreateNew={handleCreateNew} onRestore={handleRestore} />;
    case 'generate':
      return <SeedDisplay words={words} onContinue={() => setStep('verify')} />;
    case 'verify':
      return (
        <SeedVerify
          words={words}
          verifyIndices={verifyIndices}
          onVerified={(verified) => {
            setVerifiedWords(verified);
            setStep('password');
          }}
          onBack={() => setStep('generate')}
        />
      );
    case 'password':
      return <PasswordSetup verifiedWords={verifiedWords} onComplete={onComplete} />;
  }
}

// ============================================================================
// Unlock Screen (for existing wallets)
// ============================================================================

function UnlockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await sendMessage({ type: 'UNLOCK_WALLET', password });
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="lock-screen">
      <div class="lock-icon">🔐</div>
      <h2 class="lock-title">Unlock Wallet</h2>
      <p class="lock-text">Enter your password to unlock</p>

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

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
        )}

        <button type="submit" class="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
          {loading ? <span class="spinner" style={{ margin: '0 auto' }} /> : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// Main Wallet View
// ============================================================================

function WalletView({ onLock }: { onLock: () => void }) {
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const availableAssets: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

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
          <div class="balance-amount">0.00000000 {ASSETS[activeAsset].symbol}</div>
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
          <div class="empty-text">Your transaction history will appear here</div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Claim View
// ============================================================================

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
        {tipInfo.recipientHint && <div class="balance-usd">From: {tipInfo.recipientHint}</div>}
      </div>

      {tipInfo.isEncrypted && (
        <p style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '16px' }}>
          🔒 This tip was encrypted specifically for you
        </p>
      )}

      {error && (
        <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
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

// ============================================================================
// Main App
// ============================================================================

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
