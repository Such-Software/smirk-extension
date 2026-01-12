import { useState } from 'preact/hooks';
import { sendMessage } from '../../shared';

export function PasswordSetup({
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
