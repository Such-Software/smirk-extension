import { useState } from 'preact/hooks';
import { sendMessage } from '../shared';

export function UnlockScreen({ onUnlock }: { onUnlock: () => void }) {
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
