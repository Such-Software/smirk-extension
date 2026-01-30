/**
 * Unified history view with tabs for transactions, received tips, and sent tips.
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, formatBalance, sendMessage } from '../shared';
import { useToast, copyToClipboard } from './Toast';
import { TxList, type TxHistoryEntry } from './wallet';

type TabType = 'transactions' | 'received' | 'sent';

interface ReceivedTip {
  id: string;
  asset: AssetType;
  amount: number;
  from_platform: string | null;
  created_at: string;
  encrypted_key: string | null;
  status: string;
  funding_confirmations: number;
  confirmations_required: number;
  is_claimable: boolean;
}

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

interface HistoryViewProps {
  activeAsset: AssetType;
  onBack: () => void;
}

export function HistoryView({ activeAsset, onBack }: HistoryViewProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  // Transaction state
  const [transactions, setTransactions] = useState<TxHistoryEntry[] | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [cancellingTxId, setCancellingTxId] = useState<string | null>(null);

  // Received tips state
  const [receivedTips, setReceivedTips] = useState<ReceivedTip[]>([]);
  const [loadingReceived, setLoadingReceived] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  // Sent tips state
  const [sentTips, setSentTips] = useState<SentTip[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [copyingTipId, setCopyingTipId] = useState<string | null>(null);
  const [clawingBackTipId, setClawingBackTipId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Fetch data based on active tab
  useEffect(() => {
    if (activeTab === 'transactions') {
      fetchTransactions();
    } else if (activeTab === 'received') {
      fetchReceivedTips();
    } else {
      fetchSentTips();
    }
  }, [activeTab, activeAsset]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === 'transactions') {
        fetchTransactions();
      } else if (activeTab === 'received') {
        fetchReceivedTips();
      } else {
        fetchSentTips();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, activeAsset]);

  const fetchTransactions = async () => {
    if (loadingTx) return;
    setLoadingTx(true);
    setError(null);
    try {
      const result = await sendMessage<{ transactions: TxHistoryEntry[] }>({
        type: 'GET_HISTORY',
        asset: activeAsset,
      });
      setTransactions(result.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoadingTx(false);
    }
  };

  const fetchReceivedTips = async () => {
    if (loadingReceived) return;
    setLoadingReceived(true);
    setError(null);
    try {
      const result = await sendMessage<{ tips: ReceivedTip[] }>({ type: 'GET_RECEIVED_TIPS' });
      const pendingTips = result.tips.filter(t => t.status === 'pending');
      setReceivedTips(pendingTips);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load received tips');
    } finally {
      setLoadingReceived(false);
    }
  };

  const fetchSentTips = async () => {
    if (loadingSent) return;
    setLoadingSent(true);
    setError(null);
    try {
      const result = await sendMessage<{ tips: SentTip[] }>({ type: 'GET_SENT_SOCIAL_TIPS' });
      const sorted = [...result.tips].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setSentTips(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sent tips');
    } finally {
      setLoadingSent(false);
    }
  };

  const handleCancelGrinTx = async (tx: TxHistoryEntry, e: Event) => {
    e.stopPropagation();
    if (cancellingTxId) return;
    setCancellingTxId(tx.txid);
    try {
      await sendMessage<{ cancelled: boolean }>({
        type: 'GRIN_CANCEL_SEND',
        slateId: tx.txid,
        inputIds: tx.input_ids || [],
      });
      await fetchTransactions();
    } catch (err) {
      console.error('Failed to cancel Grin transaction:', err);
    } finally {
      setCancellingTxId(null);
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
      setReceivedTips((prev) => prev.filter((t) => t.id !== tipId));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to claim tip';
      if (errorMsg.includes('confirmation') || errorMsg.includes('unspent')) {
        showToast('Tip is still confirming. Please wait.', 'error');
      } else {
        showToast(errorMsg, 'error');
      }
    } finally {
      setClaiming(null);
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

  const getConfirmationStatus = (tip: ReceivedTip) => {
    if (tip.confirmations_required === 0) {
      return { text: 'Ready', className: 'status-ready' };
    }
    if (tip.funding_confirmations >= tip.confirmations_required) {
      return { text: 'Confirmed', className: 'status-ready' };
    }
    return {
      text: `${tip.funding_confirmations}/${tip.confirmations_required} confs`,
      className: 'status-pending',
    };
  };

  const getSentStatusInfo = (tip: SentTip) => {
    if (tip.status === 'claimed' || tip.claimed_at) {
      return { text: 'Claimed', color: 'var(--color-success)' };
    }
    if (tip.status === 'clawed_back' || tip.clawed_back_at) {
      return { text: 'Clawed back', color: 'var(--color-text-muted)' };
    }
    if (tip.is_claimable) {
      return { text: 'Ready to claim', color: 'var(--color-yellow)' };
    }
    if (tip.confirmations_required > 0) {
      return {
        text: `${tip.funding_confirmations}/${tip.confirmations_required} confs`,
        color: 'var(--color-warning, #f59e0b)',
      };
    }
    return { text: 'Pending', color: 'var(--color-warning, #f59e0b)' };
  };

  const isLoading = activeTab === 'transactions' ? loadingTx :
                    activeTab === 'received' ? loadingReceived : loadingSent;

  const handleRefresh = () => {
    if (activeTab === 'transactions') fetchTransactions();
    else if (activeTab === 'received') fetchReceivedTips();
    else fetchSentTips();
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-back" onClick={onBack}>Back</button>
        <h1>History</h1>
        <button class="btn btn-icon" onClick={handleRefresh} disabled={isLoading} title="Refresh">
          {isLoading ? '...' : '\u21BB'}
        </button>
      </header>

      <div class="content history-content">
        {/* Tab Bar */}
        <div class="history-tabs">
          <button
            class={`history-tab ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            Activity
          </button>
          <button
            class={`history-tab ${activeTab === 'received' ? 'active' : ''}`}
            onClick={() => setActiveTab('received')}
          >
            Received
            {receivedTips.length > 0 && <span class="tab-badge">{receivedTips.length}</span>}
          </button>
          <button
            class={`history-tab ${activeTab === 'sent' ? 'active' : ''}`}
            onClick={() => setActiveTab('sent')}
          >
            Sent
          </button>
        </div>

        {/* Tab Content */}
        {error ? (
          <div class="error-state">
            <p>{error}</p>
            <button class="btn btn-secondary" onClick={handleRefresh}>Try Again</button>
          </div>
        ) : activeTab === 'transactions' ? (
          <TxList
            asset={activeAsset}
            transactions={transactions}
            loading={loadingTx}
            cancellingTxId={cancellingTxId}
            onCancel={handleCancelGrinTx}
            showToast={showToast}
          />
        ) : activeTab === 'received' ? (
          loadingReceived && receivedTips.length === 0 ? (
            <div class="loading-state">
              <div class="spinner" />
              <p>Loading tips...</p>
            </div>
          ) : receivedTips.length === 0 ? (
            <div class="empty-state">
              <div class="empty-icon">📭</div>
              <p class="empty-title">No pending tips</p>
              <p class="empty-text">Tips you receive will appear here</p>
            </div>
          ) : (
            <div class="tips-list">
              {receivedTips.map((tip) => {
                const asset = tip.asset as AssetType;
                const assetInfo = ASSETS[asset];
                const confirmStatus = getConfirmationStatus(tip);
                const canClaim = tip.is_claimable;

                return (
                  <div key={tip.id} class={`tip-card ${!canClaim ? 'tip-pending' : ''}`}>
                    <div class="tip-asset">
                      <img src={assetInfo.iconPath} alt={assetInfo.symbol} class="tip-asset-icon" />
                      <div class="tip-details">
                        <span class="tip-amount">
                          {formatBalance(tip.amount, asset)} {assetInfo.symbol}
                        </span>
                        <span class="tip-meta">
                          {tip.from_platform && <span>via {tip.from_platform}</span>}
                          <span>{formatDate(tip.created_at)}</span>
                        </span>
                        {tip.confirmations_required > 0 && (
                          <span class={`tip-status ${confirmStatus.className}`}>
                            {confirmStatus.text}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      class={`btn ${canClaim ? 'btn-primary' : 'btn-secondary'} btn-small`}
                      onClick={() => handleClaim(tip.id, asset)}
                      disabled={claiming === tip.id || !canClaim}
                    >
                      {claiming === tip.id ? '...' : canClaim ? 'Claim' : 'Pending'}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // Sent tips tab
          loadingSent && sentTips.length === 0 ? (
            <div class="loading-state">
              <div class="spinner" />
              <p>Loading tips...</p>
            </div>
          ) : sentTips.length === 0 ? (
            <div class="empty-state">
              <div class="empty-icon">📤</div>
              <p class="empty-title">No tips sent</p>
              <p class="empty-text">Tips you send will appear here</p>
            </div>
          ) : (
            <div class="tips-list">
              {sentTips.map((tip) => {
                const asset = tip.asset as AssetType;
                const assetInfo = ASSETS[asset];
                const statusInfo = getSentStatusInfo(tip);
                const canCopyLink = tip.is_public && tip.is_claimable && tip.status === 'pending';
                const canClawback = tip.status === 'pending' && tip.is_claimable;

                return (
                  <div key={tip.id} class="tip-card">
                    <div class="tip-asset">
                      <img src={assetInfo.iconPath} alt={assetInfo.symbol} class="tip-asset-icon" />
                      <div class="tip-details">
                        <span class="tip-amount">
                          {formatBalance(tip.amount, asset)} {assetInfo.symbol}
                        </span>
                        <span class="tip-meta">
                          {tip.is_public ? (
                            <span class="tip-type-public">Public</span>
                          ) : tip.recipient_username ? (
                            <span>@{tip.recipient_username}</span>
                          ) : (
                            <span>Direct</span>
                          )}
                          <span>{formatDate(tip.created_at)}</span>
                        </span>
                        <span class="tip-status" style={{ color: statusInfo.color }}>
                          {statusInfo.text}
                        </span>
                      </div>
                    </div>
                    <div class="tip-actions">
                      {canCopyLink && (
                        <button
                          class="btn btn-primary btn-small"
                          onClick={() => handleCopyLink(tip.id)}
                          disabled={copyingTipId === tip.id}
                        >
                          {copyingTipId === tip.id ? '...' : 'Link'}
                        </button>
                      )}
                      {canClawback && !canCopyLink && (
                        <button
                          class="btn btn-secondary btn-small"
                          onClick={() => handleClawback(tip.id)}
                          disabled={clawingBackTipId === tip.id}
                        >
                          {clawingBackTipId === tip.id ? '...' : 'Clawback'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      <style>{`
        .history-content {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .history-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 12px;
          background: var(--color-bg-input);
          padding: 4px;
          border-radius: 10px;
        }

        .history-tab {
          flex: 1;
          padding: 8px 12px;
          border: none;
          background: transparent;
          color: var(--color-text-muted);
          font-size: 13px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .history-tab:hover {
          color: var(--color-text);
        }

        .history-tab.active {
          background: var(--color-bg-card);
          color: var(--color-yellow);
        }

        .tab-badge {
          background: var(--color-yellow);
          color: #000;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        }

        .loading-state,
        .error-state,
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          text-align: center;
        }

        .tips-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tip-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          background: var(--color-bg-card);
          border-radius: 10px;
          border: 1px solid var(--color-border);
        }

        .tip-card.tip-pending {
          opacity: 0.8;
          border-style: dashed;
        }

        .tip-asset {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }

        .tip-asset-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
        }

        .tip-details {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }

        .tip-amount {
          font-weight: 600;
          font-size: 14px;
        }

        .tip-meta {
          display: flex;
          gap: 6px;
          font-size: 11px;
          color: var(--color-text-muted);
        }

        .tip-type-public {
          color: var(--color-yellow);
        }

        .tip-status {
          font-size: 10px;
          font-weight: 500;
        }

        .status-pending {
          color: var(--color-warning, #f59e0b);
        }

        .status-ready {
          color: var(--color-success);
        }

        .tip-actions {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .btn-small {
          padding: 6px 10px;
          font-size: 11px;
        }

        .btn-back {
          background: transparent;
          border: none;
          color: var(--color-text-muted);
          font-size: 14px;
          padding: 8px 0;
        }

        .btn-back:hover {
          color: var(--color-text);
        }
      `}</style>
    </>
  );
}
