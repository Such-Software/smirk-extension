/**
 * Info panel component with Stats and Prices tabs.
 * Shows current asset's price and tip statistics.
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, sendMessage } from '../shared';

type TabType = 'prices' | 'stats';

interface Prices {
  btc: number | null;
  ltc: number | null;
  xmr: number | null;
  wow: number | null;
  grin: number | null;
  updated_at: string;
}

interface SocialTip {
  id: string;
  asset: string;
  amount: number;
  status: string;
}

interface Props {
  activeAsset: AssetType;
}

export function InfoPanel({ activeAsset }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('prices');
  const [prices, setPrices] = useState<Prices | null>(null);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [sentTips, setSentTips] = useState<SocialTip[]>([]);
  const [receivedTips, setReceivedTips] = useState<SocialTip[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Fetch prices on mount and when switching to prices tab
  useEffect(() => {
    if (activeTab === 'prices') {
      fetchPrices();
    }
  }, [activeTab]);

  // Fetch stats when switching to stats tab or when asset changes
  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStats();
    }
  }, [activeTab, activeAsset]);

  // Auto-refresh prices every 5 minutes
  useEffect(() => {
    if (activeTab === 'prices') {
      const interval = setInterval(fetchPrices, 300000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const fetchPrices = async () => {
    if (loadingPrices) return;
    setLoadingPrices(true);
    try {
      console.log('[InfoPanel] Fetching prices...');
      const result = await sendMessage<Prices>({ type: 'GET_PRICES' });
      console.log('[InfoPanel] Prices result:', result);
      setPrices(result);
    } catch (err) {
      console.error('[InfoPanel] Failed to fetch prices:', err);
    } finally {
      setLoadingPrices(false);
    }
  };

  const fetchStats = async () => {
    if (loadingStats) return;
    setLoadingStats(true);
    try {
      const [sent, received] = await Promise.all([
        sendMessage<{ tips: SocialTip[] }>({ type: 'GET_SENT_SOCIAL_TIPS' }),
        sendMessage<{ tips: SocialTip[] }>({ type: 'GET_RECEIVED_TIPS' }),
      ]);
      setSentTips(sent.tips || []);
      setReceivedTips(received.tips || []);
    } catch (err) {
      console.error('[InfoPanel] Failed to fetch stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const formatPrice = (price: number | null | undefined): string => {
    if (price === null || price === undefined) return '--';
    if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.01) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  };

  const formatUpdatedAt = (dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins === 1) return '1 min ago';
    return `${diffMins} mins ago`;
  };

  // Filter tips for current asset
  const assetSentTips = sentTips.filter(t => t.asset === activeAsset);
  const assetReceivedTips = receivedTips.filter(t => t.asset === activeAsset);

  const assetInfo = ASSETS[activeAsset];
  const currentPrice = prices?.[activeAsset];

  return (
    <div class="info-panel">
      {/* Tab Bar */}
      <div class="info-tabs">
        <button
          class={`info-tab ${activeTab === 'prices' ? 'active' : ''}`}
          onClick={() => setActiveTab('prices')}
        >
          Price
        </button>
        <button
          class={`info-tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Stats
        </button>
      </div>

      {/* Tab Content */}
      <div class="info-content">
        {activeTab === 'prices' ? (
          <div class="price-single">
            {loadingPrices && !prices ? (
              <div class="info-loading"><div class="spinner" /></div>
            ) : (
              <>
                <div class="price-main">
                  <img
                    src={assetInfo.iconPath}
                    alt={assetInfo.symbol}
                    class="price-main-icon"
                  />
                  <div class="price-main-info">
                    <span class="price-main-symbol">{assetInfo.symbol}</span>
                    <span class="price-main-value">{formatPrice(currentPrice)}</span>
                  </div>
                </div>
                {prices?.updated_at && (
                  <div class="price-updated">
                    Updated {formatUpdatedAt(prices.updated_at)}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div class="stats-content">
            {loadingStats ? (
              <div class="info-loading"><div class="spinner" /></div>
            ) : (
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-value">{assetReceivedTips.length}</span>
                  <span class="stat-label">Received</span>
                </div>
                <div class="stat-item">
                  <span class="stat-value">{assetSentTips.length}</span>
                  <span class="stat-label">Sent</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .info-panel {
          background: var(--color-bg-card);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          overflow: hidden;
        }

        .info-tabs {
          display: flex;
          border-bottom: 1px solid var(--color-border);
        }

        .info-tab {
          flex: 1;
          padding: 8px 12px;
          border: none;
          background: transparent;
          color: var(--color-text-muted);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .info-tab:hover {
          color: var(--color-text);
        }

        .info-tab.active {
          color: var(--color-yellow);
          border-bottom: 2px solid var(--color-yellow);
          margin-bottom: -1px;
        }

        .info-content {
          padding: 12px;
          min-height: 80px;
        }

        .info-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 60px;
        }

        .price-single {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .price-main {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .price-main-icon {
          width: 32px;
          height: 32px;
        }

        .price-main-info {
          display: flex;
          flex-direction: column;
        }

        .price-main-symbol {
          font-size: 12px;
          color: var(--color-text-muted);
          text-transform: uppercase;
        }

        .price-main-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--color-text);
        }

        .price-updated {
          font-size: 11px;
          color: var(--color-text-faint);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 12px 8px;
          background: var(--color-bg-input);
          border-radius: 8px;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--color-yellow);
        }

        .stat-label {
          font-size: 11px;
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
}
