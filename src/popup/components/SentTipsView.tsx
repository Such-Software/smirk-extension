/**
 * Sent tips view component.
 *
 * Displays tips sent by the current user with:
 * - Confirmation status for pending tips
 * - "Copy Link" button for confirmed public tips
 * - Clawback option for unclaimed tips
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, formatBalance, sendMessage } from '../shared';
import { useToast, copyToClipboard } from './Toast';

interface SentTip {
  id: string;
  sender_user_id: string;
  recipient_platform: string | null;
  recipient_username: string | null;
  asset: AssetType;
  amount: number;
  is_public: boolean;
  status: string;
  created_at: string;
  claimed_at: string | null;
  clawed_back_at: string | null;
  funding_confirmations: number;
  confirmations_required: number;
  is_claimable: boolean;
}

interface SentTipsViewProps {
  onBack: () => void;
}

export function SentTipsView({ onBack }: SentTipsViewProps) {
  const { showToast } = useToast();
  const [tips, setTips] = useState<SentTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyingTipId, setCopyingTipId] = useState<string | null>(null);
  const [clawingBackTipId, setClawingBackTipId] = useState<string | null>(null);

  useEffect(() => {
    fetchSentTips();
    // Poll for confirmation updates every 30 seconds
    const interval = setInterval(fetchSentTips, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchSentTips = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await sendMessage<{ tips: SentTip[] }>({ type: 'GET_SENT_SOCIAL_TIPS' });
      // Sort by created_at descending (newest first)
      const sorted = [...result.tips].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setTips(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sent tips');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async (tipId: string) => {
    if (copyingTipId) return;
    setCopyingTipId(tipId);

    try {
      const result = await sendMessage<{ shareUrl: string | null; isPublic: boolean }>({
        type: 'GET_PUBLIC_TIP_SHARE_URL',
        tipId,
      });

      if (result.shareUrl) {
        await copyToClipboard(result.shareUrl, showToast, 'Share link copied!');
      } else {
        showToast('Share link not available yet', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to get share link', 'error');
    } finally {
      setCopyingTipId(null);
    }
  };

  const handleClawback = async (tipId: string) => {
    if (clawingBackTipId) return;
    setClawingBackTipId(tipId);

    try {
      await sendMessage<{ success: boolean; txid?: string }>({
        type: 'CLAWBACK_SOCIAL_TIP',
        tipId,
      });
      showToast('Tip clawed back successfully!', 'success');
      // Refresh the list
      await fetchSentTips();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to claw back tip', 'error');
    } finally {
      setClawingBackTipId(null);
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

  const getStatusInfo = (tip: SentTip) => {
    if (tip.status === 'claimed' || tip.claimed_at) {
      return { text: 'Claimed', className: 'status-claimed', color: 'var(--color-success)' };
    }
    if (tip.status === 'clawed_back' || tip.clawed_back_at) {
      return { text: 'Clawed back', className: 'status-clawedback', color: 'var(--color-text-muted)' };
    }
    if (tip.is_claimable) {
      return { text: 'Ready to claim', className: 'status-ready', color: 'var(--color-primary)' };
    }
    if (tip.confirmations_required > 0) {
      return {
        text: `${tip.funding_confirmations}/${tip.confirmations_required} confirmations`,
        className: 'status-pending',
        color: 'var(--color-warning)',
      };
    }
    return { text: 'Pending', className: 'status-pending', color: 'var(--color-warning)' };
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-back" onClick={onBack}>
          Back
        </button>
        <h1>Sent Tips</h1>
        <button class="btn btn-icon" onClick={fetchSentTips} disabled={loading} title="Refresh">
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
            <button class="btn btn-secondary" onClick={fetchSentTips}>
              Try Again
            </button>
          </div>
        ) : tips.length === 0 ? (
          <div class="empty-state">
            <div class="empty-icon">📤</div>
            <p>No tips sent yet</p>
            <p class="empty-hint">Tips you send will appear here</p>
          </div>
        ) : (
          <div class="tips-list">
            {tips.map((tip) => {
              const asset = tip.asset as AssetType;
              const assetInfo = ASSETS[asset];
              const statusInfo = getStatusInfo(tip);
              const canCopyLink = tip.is_public && tip.is_claimable && tip.status === 'pending';
              const canClawback = tip.status === 'pending' && tip.is_claimable;

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
                        {tip.is_public ? (
                          <span class="tip-type">Public tip</span>
                        ) : tip.recipient_username ? (
                          <span class="tip-recipient">
                            to @{tip.recipient_username}
                            {tip.recipient_platform && ` (${tip.recipient_platform})`}
                          </span>
                        ) : (
                          <span class="tip-type">Direct tip</span>
                        )}
                        <span class="tip-time">{formatDate(tip.created_at)}</span>
                      </span>
                      <span class="tip-status" style={{ color: statusInfo.color }}>
                        {statusInfo.text}
                      </span>
                    </div>
                  </div>

                  <div class="tip-actions">
                    {/* Copy Link button for confirmed public tips */}
                    {canCopyLink && (
                      <button
                        class="btn btn-primary btn-small"
                        onClick={() => handleCopyLink(tip.id)}
                        disabled={copyingTipId === tip.id}
                        title="Copy share link"
                      >
                        {copyingTipId === tip.id ? '...' : 'Copy Link'}
                      </button>
                    )}

                    {/* Clawback button for unclaimed tips */}
                    {canClawback && !canCopyLink && (
                      <button
                        class="btn btn-secondary btn-small"
                        onClick={() => handleClawback(tip.id)}
                        disabled={clawingBackTipId === tip.id}
                        title="Claw back unclaimed funds"
                      >
                        {clawingBackTipId === tip.id ? '...' : 'Clawback'}
                      </button>
                    )}
                  </div>
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
          flex: 1;
          min-width: 0;
        }

        .tip-asset-icon {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
        }

        .tip-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
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
          flex-wrap: wrap;
        }

        .tip-type {
          color: var(--color-primary);
        }

        .tip-recipient {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tip-status {
          font-size: 11px;
          font-weight: 500;
          margin-top: 2px;
        }

        .tip-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .btn-small {
          padding: 6px 12px;
          font-size: 12px;
          min-width: unset;
        }
      `}</style>
    </>
  );
}
