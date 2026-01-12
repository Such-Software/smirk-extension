import { useState } from 'preact/hooks';
import { sendMessage } from '../../shared';

export function RestoreWallet({ onComplete, onBack }: { onComplete: () => void; onBack: () => void }) {
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
