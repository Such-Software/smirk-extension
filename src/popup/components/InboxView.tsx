/**
 * Inbox view for claimable social tips.
 *
 * Displays incoming tips that the user can claim.
 * For targeted tips, claims and credits the user's account.
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, formatBalance, sendMessage } from '../shared';
import { useToast } from './Toast';

interface ClaimableTip {
  id: string;
  asset: AssetType;
  amount: number;
  from_platform: string | null;
  created_at: string;
  encrypted_key: string | null;
}

interface InboxViewProps {
  onBack: () => void;
}

export function InboxView({ onBack }: InboxViewProps) {
  const { showToast } = useToast();
  const [tips, setTips] = useState<ClaimableTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClaimableTips();
  }, []);

  const fetchClaimableTips = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await sendMessage<{ tips: ClaimableTip[] }>({ type: 'GET_CLAIMABLE_TIPS' });
      setTips(result.tips);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tips');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (tipId: string, asset: AssetType) => {
    if (claiming) return;
    setClaiming(tipId);

    try {
      await sendMessage<{ success: boolean; encryptedKey: string | null; txid?: string }>({
        type: 'CLAIM_SOCIAL_TIP',
        tipId,
        asset,
      });

      showToast('Tip claimed successfully!', 'success');

      // Remove the claimed tip from the list
      setTips((prev) => prev.filter((t) => t.id !== tipId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to claim tip', 'error');
    } finally {
      setClaiming(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-back" onClick={onBack}>
          Back
        </button>
        <h1>Inbox</h1>
        <button class="btn btn-icon" onClick={fetchClaimableTips} disabled={loading} title="Refresh">
          {loading ? '...' : '↻'}
        </button>
      </header>

      <div class="content">
        {loading && tips.length === 0 ? (
          <div class="loading-state">
            <div class="spinner" />
            <p>Loading tips...</p>
          </div>
        ) : error ? (
          <div class="error-state">
            <p>{error}</p>
            <button class="btn btn-secondary" onClick={fetchClaimableTips}>
              Try Again
            </button>
          </div>
        ) : tips.length === 0 ? (
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p>No pending tips</p>
            <p class="empty-hint">Tips you receive will appear here</p>
          </div>
        ) : (
          <div class="tips-list">
            {tips.map((tip) => {
              const asset = tip.asset as AssetType;
              const assetInfo = ASSETS[asset];

              return (
                <div key={tip.id} class="tip-card">
                  <div class="tip-asset">
                    <img
                      src={assetInfo.iconPath}
                      alt={assetInfo.symbol}
                      class="tip-asset-icon"
                    />
                    <div class="tip-details">
                      <span class="tip-amount">
                        {formatBalance(tip.amount, asset)} {assetInfo.symbol}
                      </span>
                      <span class="tip-meta">
                        {tip.from_platform && (
                          <span class="tip-platform">via {tip.from_platform}</span>
                        )}
                        <span class="tip-time">{formatDate(tip.created_at)}</span>
                      </span>
                    </div>
                  </div>
                  <button
                    class="btn btn-primary btn-claim"
                    onClick={() => handleClaim(tip.id, asset)}
                    disabled={claiming === tip.id}
                  >
                    {claiming === tip.id ? 'Claiming...' : 'Claim'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .loading-state,
        .error-state,
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          text-align: center;
        }

        .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .empty-hint {
          color: var(--text-secondary);
          font-size: 14px;
          margin-top: 8px;
        }

        .tips-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 8px 0;
        }

        .tip-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: var(--card-bg);
          border-radius: 12px;
          border: 1px solid var(--border-color);
        }

        .tip-asset {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .tip-asset-icon {
          width: 36px;
          height: 36px;
        }

        .tip-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .tip-amount {
          font-weight: 600;
          font-size: 16px;
        }

        .tip-meta {
          display: flex;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .tip-platform {
          text-transform: capitalize;
        }

        .btn-claim {
          padding: 8px 16px;
          font-size: 14px;
          min-width: 80px;
        }
      `}</style>
    </>
  );
}
