import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { AssetType, TipInfo, MessageResponse, OnboardingState } from '@/types';
import { runtime } from '@/lib/browser';

// Asset display info with SVG icon paths
const ASSETS: Record<AssetType, { name: string; symbol: string; iconPath: string }> = {
  btc: { name: 'Bitcoin', symbol: 'BTC', iconPath: 'icons/coins/bitcoin.svg' },
  ltc: { name: 'Litecoin', symbol: 'LTC', iconPath: 'icons/coins/litecoin.svg' },
  xmr: { name: 'Monero', symbol: 'XMR', iconPath: 'icons/coins/monero.svg' },
  wow: { name: 'Wownero', symbol: 'WOW', iconPath: 'icons/coins/wownero.svg' },
  grin: { name: 'Grin', symbol: 'GRIN', iconPath: 'icons/coins/grin.svg' },
};

// Send message to background
async function sendMessage<T>(message: unknown): Promise<T> {
  const response = await runtime.sendMessage<MessageResponse<T>>(message);
  if (response?.success) {
    return response.data as T;
  }
  throw new Error(response?.error || 'Unknown error');
}

// ============================================================================
// Onboarding Flow Components
// ============================================================================

type OnboardingStep = 'choice' | 'generate' | 'verify' | 'password' | 'restore' | 'creating';

function OnboardingChoice({
  onCreateNew,
  onRestore,
}: {
  onCreateNew: () => void;
  onRestore: () => void;
}) {
  return (
    <div class="lock-screen">
      <img src="icons/logo_256.png" alt="Smirk" style={{ width: '80px', height: '80px', marginBottom: '16px' }} />
      <h2 class="lock-title">Welcome to Smirk</h2>
      <p class="lock-text">Non-custodial multi-currency tip wallet</p>

      <div style={{ width: '100%', maxWidth: '280px', marginTop: '24px' }}>
        <button class="btn btn-primary" style={{ width: '100%', marginBottom: '12px' }} onClick={onCreateNew}>
          Create New Wallet
        </button>
        <button class="btn btn-secondary" style={{ width: '100%' }} onClick={onRestore}>
          Restore from Seed
        </button>
      </div>
    </div>
  );
}

function SeedDisplay({
  words,
  onContinue,
  onBack,
}: {
  words: string[];
  onContinue: () => void;
  onBack: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

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
          marginBottom: '12px',
        }}
      >
        {words.map((word, i) => (
          <div key={i} class="seed-word">
            <span class="seed-word-number">{i + 1}.</span>
            {word}
          </div>
        ))}
      </div>

      <button
        class="btn btn-secondary"
        style={{ width: '100%', marginBottom: '16px' }}
        onClick={handleCopy}
      >
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>

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

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          type="button"
          class="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={onBack}
        >
          Back
        </button>
        <button
          class="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!confirmed}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
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
            class="btn btn-secondary"
            style={{ flex: 1 }}
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
  const [loadingMessage, setLoadingMessage] = useState('');

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
    setLoadingMessage('Creating wallet...');

    try {
      // Show progress messages
      setLoadingMessage('Deriving keys...');
      await new Promise((r) => setTimeout(r, 100)); // Let UI update

      setLoadingMessage('Encrypting wallet...');
      await sendMessage({
        type: 'CONFIRM_MNEMONIC',
        password,
        verifiedWords,
      });

      setLoadingMessage('Done!');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Show full-screen loading state when creating wallet
  if (loading) {
    return (
      <div class="lock-screen">
        <div class="spinner" style={{ width: '48px', height: '48px', marginBottom: '24px' }} />
        <h2 class="lock-title" style={{ marginBottom: '8px' }}>Creating Wallet</h2>
        <p class="lock-text">{loadingMessage}</p>
        <p class="lock-text" style={{ fontSize: '12px', marginTop: '16px', color: '#71717a' }}>
          Please wait, this may take a moment...
        </p>
      </div>
    );
  }

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
          />
        </div>
        <div class="form-group">
          <input
            type="password"
            class="form-input"
            placeholder="Confirm Password"
            value={confirmPassword}
            onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
          />
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{error}</p>
        )}

        <button type="submit" class="btn btn-primary" style={{ width: '100%' }}>
          Create Wallet
        </button>
      </form>
    </div>
  );
}

/**
 * Screen shown when wallet creation is in progress.
 * This handles the case where user clicks away during creation and reopens popup.
 */
function WalletCreatingScreen({ onComplete }: { onComplete: () => void }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if wallet was created while popup was closed
    const checkWalletState = async () => {
      try {
        const result = await sendMessage<{ hasWallet: boolean; isUnlocked: boolean }>({
          type: 'GET_WALLET_STATE',
        });

        if (result.hasWallet) {
          // Wallet was created successfully, complete onboarding
          onComplete();
        } else {
          // Still creating... keep showing this screen
          setChecking(false);
        }
      } catch (err) {
        console.error('Failed to check wallet state:', err);
        setChecking(false);
      }
    };

    checkWalletState();

    // Poll periodically in case creation finishes
    const interval = setInterval(checkWalletState, 1000);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div class="lock-screen">
      <div class="spinner" style={{ width: '48px', height: '48px', marginBottom: '24px' }} />
      <h2 class="lock-title" style={{ marginBottom: '8px' }}>
        {checking ? 'Checking...' : 'Creating Wallet'}
      </h2>
      <p class="lock-text">
        {checking ? 'Please wait...' : 'Your wallet is being created. This may take a moment...'}
      </p>
      <p class="lock-text" style={{ fontSize: '12px', marginTop: '16px', color: '#71717a' }}>
        Please keep this window open.
      </p>
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
            class="btn btn-secondary"
            style={{ flex: 1 }}
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
  const [words, setWords] = useState<string[]>([]);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifiedWords, setVerifiedWords] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  // Load persisted onboarding state on mount
  useEffect(() => {
    loadOnboardingState();
  }, []);

  const loadOnboardingState = async () => {
    try {
      const result = await sendMessage<{ state: OnboardingState | null }>({
        type: 'GET_ONBOARDING_STATE',
      });

      if (result.state) {
        // Restore previous state
        if (result.state.step === 'restore') {
          setStep('choice'); // Show restore option from choice screen
        } else {
          setStep(result.state.step);
        }
        if (result.state.words) setWords(result.state.words);
        if (result.state.verifyIndices) setVerifyIndices(result.state.verifyIndices);
      }
    } catch (err) {
      console.error('Failed to load onboarding state:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveState = async (newStep: OnboardingStep, newWords?: string[], newIndices?: number[]) => {
    const state: OnboardingState = {
      step: newStep,
      words: newWords ?? words,
      verifyIndices: newIndices ?? verifyIndices,
      createdAt: Date.now(),
    };
    await sendMessage({ type: 'SAVE_ONBOARDING_STATE', state });
  };

  const clearState = async () => {
    await sendMessage({ type: 'CLEAR_ONBOARDING_STATE' });
  };

  const handleCreateNew = async () => {
    try {
      const result = await sendMessage<{ words: string[]; verifyIndices: number[] }>({
        type: 'GENERATE_MNEMONIC',
      });
      setWords(result.words);
      setVerifyIndices(result.verifyIndices);
      setStep('generate');
      // Persist state so user can click away and come back
      await saveState('generate', result.words, result.verifyIndices);
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
    }
  };

  const handleRestore = async () => {
    setStep('restore' as OnboardingStep);
    await saveState('restore' as OnboardingStep);
  };

  const handleComplete = async () => {
    await clearState();
    onComplete();
  };

  const handleBackToChoice = async () => {
    setStep('choice');
    await clearState();
  };

  if (loading) {
    return (
      <div class="lock-screen">
        <div class="spinner" />
      </div>
    );
  }

  if (step === 'restore') {
    return <RestoreWallet onComplete={handleComplete} onBack={handleBackToChoice} />;
  }

  switch (step) {
    case 'choice':
      return <OnboardingChoice onCreateNew={handleCreateNew} onRestore={handleRestore} />;
    case 'generate':
      return (
        <SeedDisplay
          words={words}
          onContinue={async () => {
            setStep('verify');
            await saveState('verify');
          }}
          onBack={handleBackToChoice}
        />
      );
    case 'verify':
      return (
        <SeedVerify
          words={words}
          verifyIndices={verifyIndices}
          onVerified={async (verified) => {
            setVerifiedWords(verified);
            setStep('password');
            await saveState('password');
          }}
          onBack={async () => {
            setStep('generate');
            await saveState('generate');
          }}
        />
      );
    case 'password':
      return <PasswordSetup verifiedWords={verifiedWords} onComplete={handleComplete} />;
    case 'creating':
      return <WalletCreatingScreen onComplete={handleComplete} />;
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

// Format satoshis to display string (8 decimal places for BTC/LTC)
function formatBalance(satoshis: number, asset: AssetType): string {
  if (asset === 'btc' || asset === 'ltc') {
    return (satoshis / 100_000_000).toFixed(8);
  } else if (asset === 'xmr' || asset === 'wow') {
    // Piconero - 12 decimal places
    return (satoshis / 1_000_000_000_000).toFixed(12);
  } else if (asset === 'grin') {
    // Nanogrin - 9 decimal places
    return (satoshis / 1_000_000_000).toFixed(9);
  }
  return satoshis.toString();
}

// Truncate address for display
function truncateAddress(address: string, startChars = 10, endChars = 8): string {
  if (address.length <= startChars + endChars + 3) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

interface AddressData {
  asset: AssetType;
  address: string;
  publicKey: string;
}

interface BalanceData {
  confirmed: number;
  unconfirmed: number;
  total: number;
  error?: string;
}

// Storage key for persisting active asset tab
const ACTIVE_ASSET_KEY = 'smirk_activeAsset';

function WalletView({ onLock }: { onLock: () => void }) {
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const [showReceive, setShowReceive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [addresses, setAddresses] = useState<Record<AssetType, AddressData | null>>({
    btc: null,
    ltc: null,
    xmr: null,
    wow: null,
    grin: null,
  });
  const [balances, setBalances] = useState<Record<AssetType, BalanceData | null>>({
    btc: null,
    ltc: null,
    xmr: null,
    wow: null,
    grin: null,
  });
  const [loadingBalance, setLoadingBalance] = useState<AssetType | null>(null);
  const [copied, setCopied] = useState(false);

  const availableAssets: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

  // Restore active asset from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_ASSET_KEY);
    if (saved && availableAssets.includes(saved as AssetType)) {
      setActiveAsset(saved as AssetType);
    }
  }, []);

  // Persist active asset when it changes
  const handleAssetChange = (asset: AssetType) => {
    setActiveAsset(asset);
    localStorage.setItem(ACTIVE_ASSET_KEY, asset);
  };

  // Reset auto-lock timer on user activity
  useEffect(() => {
    const resetTimer = () => {
      sendMessage({ type: 'RESET_AUTO_LOCK_TIMER' }).catch(() => {});
    };

    // Reset on any user interaction
    window.addEventListener('click', resetTimer);
    window.addEventListener('keydown', resetTimer);

    return () => {
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, []);

  // Fetch addresses on mount
  useEffect(() => {
    fetchAddresses();
  }, []);

  // Fetch balance when asset changes
  useEffect(() => {
    if (addresses[activeAsset]) {
      fetchBalance(activeAsset);
    }
  }, [activeAsset, addresses[activeAsset]]);

  const fetchAddresses = async () => {
    try {
      const result = await sendMessage<{ addresses: AddressData[] }>({ type: 'GET_ADDRESSES' });
      const newAddresses: Record<AssetType, AddressData | null> = {
        btc: null, ltc: null, xmr: null, wow: null, grin: null,
      };
      for (const addr of result.addresses) {
        newAddresses[addr.asset] = addr;
      }
      setAddresses(newAddresses);
    } catch (err) {
      console.error('Failed to fetch addresses:', err);
    }
  };

  const fetchBalance = async (asset: AssetType) => {
    if (loadingBalance === asset) return; // Already loading
    setLoadingBalance(asset);

    try {
      const result = await sendMessage<{
        asset: AssetType;
        confirmed: number;
        unconfirmed: number;
        total: number;
      }>({ type: 'GET_BALANCE', asset });

      setBalances((prev) => ({
        ...prev,
        [asset]: {
          confirmed: result.confirmed,
          unconfirmed: result.unconfirmed,
          total: result.total,
          error: undefined,
        },
      }));
    } catch (err) {
      console.error(`Failed to fetch ${asset} balance:`, err);
      // Keep previous balance if available, but mark as error
      setBalances((prev) => ({
        ...prev,
        [asset]: {
          confirmed: prev[asset]?.confirmed ?? 0,
          unconfirmed: prev[asset]?.unconfirmed ?? 0,
          total: prev[asset]?.total ?? 0,
          error: err instanceof Error ? err.message : 'Offline',
        },
      }));
    } finally {
      setLoadingBalance(null);
    }
  };

  const handleCopyAddress = async () => {
    const addr = addresses[activeAsset];
    if (!addr) return;

    try {
      await navigator.clipboard.writeText(addr.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const currentAddress = addresses[activeAsset];
  const currentBalance = balances[activeAsset];

  // Show settings view
  if (showSettings) {
    return <SettingsView onBack={() => setShowSettings(false)} />;
  }

  return (
    <>
      <header class="header">
        <h1>Smirk Wallet</h1>
        <div class="header-actions">
          <button class="btn btn-icon" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
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
              onClick={() => handleAssetChange(asset)}
              title={ASSETS[asset].name}
            >
              <img
                src={ASSETS[asset].iconPath}
                alt={ASSETS[asset].symbol}
                style={{ width: '20px', height: '20px' }}
              />
            </button>
          ))}
        </div>

        {/* Balance Card */}
        <div class="balance-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div class="balance-label">{ASSETS[activeAsset].name} Balance</div>
            <button
              class="btn btn-icon"
              style={{ fontSize: '12px', padding: '2px 6px', marginTop: '-4px' }}
              onClick={() => fetchBalance(activeAsset)}
              title="Refresh balance"
              disabled={loadingBalance === activeAsset}
            >
              🔄
            </button>
          </div>
          <div class="balance-amount">
            {loadingBalance === activeAsset ? (
              <span class="spinner" style={{ width: '16px', height: '16px' }} />
            ) : currentBalance ? (
              `${formatBalance(currentBalance.total, activeAsset)} ${ASSETS[activeAsset].symbol}`
            ) : (
              `0.00000000 ${ASSETS[activeAsset].symbol}`
            )}
          </div>
          {currentBalance?.error && (
            <div class="balance-usd" style={{ fontSize: '11px', color: '#ef4444' }}>
              ⚠️ {currentBalance.error === 'Offline' ? 'Offline - cached value' : currentBalance.error}
            </div>
          )}
          {currentBalance && !currentBalance.error && currentBalance.unconfirmed !== 0 && (
            <div class="balance-usd" style={{ fontSize: '11px', color: '#f59e0b' }}>
              {currentBalance.unconfirmed > 0 ? '+' : ''}
              {formatBalance(currentBalance.unconfirmed, activeAsset)} unconfirmed
            </div>
          )}
        </div>

        {/* Address Display */}
        {currentAddress && (
          <div
            class="address-display"
            style={{
              background: '#27272a',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#a1a1aa', marginBottom: '4px' }}>
              Your {ASSETS[activeAsset].name} Address
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                wordBreak: 'break-all',
                marginBottom: '8px',
              }}
            >
              {showReceive ? currentAddress.address : truncateAddress(currentAddress.address)}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                class="btn btn-secondary"
                style={{ flex: 1, fontSize: '12px', padding: '6px 12px' }}
                onClick={handleCopyAddress}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                class="btn btn-secondary"
                style={{ flex: 1, fontSize: '12px', padding: '6px 12px' }}
                onClick={() => setShowReceive(!showReceive)}
              >
                {showReceive ? 'Hide' : 'Show Full'}
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div class="action-grid">
          <button class="action-btn" onClick={() => setShowReceive(true)}>
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
// Settings View
// ============================================================================

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 0, label: 'Never' },
];

interface UserSettings {
  autoSweep: boolean;
  notifyOnTip: boolean;
  defaultAsset: AssetType;
  autoLockMinutes: number;
}

function SettingsView({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await sendMessage<{ settings: UserSettings }>({ type: 'GET_SETTINGS' });
      setSettings(result.settings);
    } catch (err) {
      setError('Failed to load settings');
    }
  };

  const updateSetting = async <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    if (!settings) return;

    setSaving(true);
    setError('');

    try {
      const result = await sendMessage<{ settings: UserSettings }>({
        type: 'UPDATE_SETTINGS',
        settings: { [key]: value },
      });
      setSettings(result.settings);
    } catch (err) {
      setError('Failed to save setting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Settings</h1>
        <div style={{ width: '32px' }} /> {/* Spacer for centering */}
      </header>

      <div class="content">
        {error && (
          <div class="error-box" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {!settings ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <span class="spinner" />
          </div>
        ) : (
          <>
            {/* Security Section */}
            <div class="section-title">Security</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                  Auto-lock after inactivity
                </label>
                <select
                  value={settings.autoLockMinutes}
                  onChange={(e) => updateSetting('autoLockMinutes', parseInt((e.target as HTMLSelectElement).value))}
                  disabled={saving}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #3f3f46',
                    background: '#18181b',
                    color: '#fff',
                    fontSize: '14px',
                  }}
                >
                  {AUTO_LOCK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>
                  Wallet will lock automatically after this period of inactivity
                </div>
              </div>
            </div>

            {/* Notifications Section */}
            <div class="section-title">Notifications</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '13px' }}>Notify on incoming tips</span>
                <input
                  type="checkbox"
                  checked={settings.notifyOnTip}
                  onChange={(e) => updateSetting('notifyOnTip', (e.target as HTMLInputElement).checked)}
                  disabled={saving}
                  style={{ width: '18px', height: '18px' }}
                />
              </label>
            </div>

            {/* Default Asset Section */}
            <div class="section-title">Default Asset</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <select
                value={settings.defaultAsset}
                onChange={(e) => updateSetting('defaultAsset', (e.target as HTMLSelectElement).value as AssetType)}
                disabled={saving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #3f3f46',
                  background: '#18181b',
                  color: '#fff',
                  fontSize: '14px',
                }}
              >
                {(['btc', 'ltc', 'xmr', 'wow', 'grin'] as AssetType[]).map((asset) => (
                  <option key={asset} value={asset}>
                    {ASSETS[asset].name} ({ASSETS[asset].symbol})
                  </option>
                ))}
              </select>
            </div>

            {/* Version Info */}
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#71717a', marginTop: '24px' }}>
              Smirk Wallet v0.1.0
            </div>
          </>
        )}
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
          class="btn btn-secondary"
          style={{ flex: 1 }}
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
