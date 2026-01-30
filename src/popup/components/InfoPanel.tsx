/**
 * Info panel component with Stats and Prices tabs.
 * Displays tipping stats and current cryptocurrency prices.
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, sendMessage, formatBalance } from '../shared';

type TabType = 'stats' | 'prices';

interface TipStats {
  sent_count: number;
  sent_total_usd: number;
  received_count: number;
  received_total_usd: number;
}

interface Prices {
  btc: number | null;
  ltc: number | null;
  xmr: number | null;
  wow: number | null;
  grin: number | null;
  updated_at: string;
}

export function InfoPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('prices');
  const [stats, setStats] = useState<TipStats | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);

  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStats();
    } else {
      fetchPrices();
    }
  }, [activeTab]);

  // Auto-refresh prices every 5 minutes
  useEffect(() => {
    if (activeTab === 'prices') {
      const interval = setInterval(fetchPrices, 300000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const fetchStats = async () => {
    if (loadingStats) return;
    setLoadingStats(true);
    try {
      const [sent, received] = await Promise.all([
        sendMessage<{ tips: Array<{ amount: number; asset: string }> }>({ type: 'GET_SENT_SOCIAL_TIPS' }),
        sendMessage<{ tips: Array<{ amount: number; asset: string }> }>({ type: 'GET_RECEIVED_TIPS' }),
      ]);

      // Calculate totals (simplified - would need prices for accurate USD)
      setStats({
        sent_count: sent.tips.length,
        sent_total_usd: 0, // Would need price conversion
        received_count: received.tips.length,
        received_total_usd: 0,
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchPrices = async () => {
    if (loadingPrices) return;
    setLoadingPrices(true);
    try {
      const result = await sendMessage<Prices>({ type: 'GET_PRICES' });
      setPrices(result);
    } catch (err) {
      console.error('Failed to fetch prices:', err);
    } finally {
      setLoadingPrices(false);
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

  const assetOrder: AssetType[] = ['btc', 'ltc', 'xmr', 'grin', 'wow'];

  return (
    <div class="info-panel">
      {/* Tab Bar */}
      <div class="info-tabs">
        <button
          class={`info-tab ${activeTab === 'prices' ? 'active' : ''}`}
          onClick={() => setActiveTab('prices')}
        >
          Prices
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
          <div class="prices-content">
            {loadingPrices && !prices ? (
              <div class="info-loading"><div class="spinner" /></div>
            ) : (
              <>
                <div class="price-list">
                  {assetOrder.map((asset) => {
                    const assetInfo = ASSETS[asset];
                    const price = prices?.[asset];
                    return (
                      <div key={asset} class="price-row">
                        <div class="price-asset">
                          <img
                            src={assetInfo.iconPath}
                            alt={assetInfo.symbol}
                            class="price-icon"
                          />
                          <span class="price-symbol">{assetInfo.symbol}</span>
                        </div>
                        <span class="price-value">{formatPrice(price)}</span>
                      </div>
                    );
                  })}
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
            {loadingStats && !stats ? (
              <div class="info-loading"><div class="spinner" /></div>
            ) : stats ? (
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-value">{stats.sent_count}</span>
                  <span class="stat-label">Tips Sent</span>
                </div>
                <div class="stat-item">
                  <span class="stat-value">{stats.received_count}</span>
                  <span class="stat-label">Tips Received</span>
                </div>
              </div>
            ) : (
              <div class="stats-empty">No stats available</div>
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
          padding: 10px 12px;
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
          min-height: 120px;
        }

        .info-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100px;
        }

        .price-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .price-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 0;
        }

        .price-asset {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .price-icon {
          width: 20px;
          height: 20px;
        }

        .price-symbol {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-muted);
        }

        .price-value {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text);
        }

        .price-updated {
          margin-top: 8px;
          font-size: 11px;
          color: var(--color-text-faint);
          text-align: center;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 16px;
          background: var(--color-bg-input);
          border-radius: 8px;
        }

        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--color-yellow);
        }

        .stat-label {
          font-size: 12px;
          color: var(--color-text-muted);
        }

        .stats-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100px;
          color: var(--color-text-muted);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
