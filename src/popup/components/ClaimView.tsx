import { useState } from 'preact/hooks';
import type { TipInfo } from '@/types';
import { ASSETS, sendMessage } from '../shared';

export function ClaimView({
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
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
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
