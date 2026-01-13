import { useState, useEffect } from 'preact/hooks';
import type { AssetType, BalanceResponse } from '@/types';
import { isLwsRawResponse } from '@/types';
import { calculateVerifiedBalance } from '@/lib/monero-crypto';
import {
  ASSETS,
  DISPLAY_DECIMALS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  type AddressData,
  type BalanceData,
  type WalletScreen,
} from '../shared';
import { ReceiveView } from './ReceiveView';
import { SendView } from './SendView';
import { SettingsView } from './SettingsView';

// Storage key for persisting active asset tab
const ACTIVE_ASSET_KEY = 'smirk_activeAsset';

// Transaction history entry
interface TxHistoryEntry {
  txid: string;
  height: number;
  fee?: number;
}

// Pending outgoing transaction (not yet confirmed)
interface PendingTx {
  txHash: string;
  asset: AssetType;
  amount: number;
  fee: number;
  timestamp: number;
}

export function WalletView({ onLock }: { onLock: () => void }) {
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const [screen, setScreen] = useState<WalletScreen>('main');
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
  const [history, setHistory] = useState<Record<AssetType, TxHistoryEntry[] | null>>({
    btc: null,
    ltc: null,
    xmr: null,
    wow: null,
    grin: null,
  });
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Pending outgoing amounts (for XMR/WOW - not yet confirmed txs)
  const [pendingOutgoing, setPendingOutgoing] = useState<Record<AssetType, number>>({
    btc: 0,
    ltc: 0,
    xmr: 0,
    wow: 0,
    grin: 0,
  });

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

  // Fetch balance and history when asset changes
  useEffect(() => {
    if (addresses[activeAsset]) {
      fetchBalance(activeAsset);
      // Only fetch history for BTC/LTC (supported assets)
      if (activeAsset === 'btc' || activeAsset === 'ltc') {
        fetchHistory(activeAsset);
      }
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

    // Note: For XMR/WOW, the backend now includes mempool spent_outputs in balance response,
    // so we don't need local pending tx tracking. Keep this for future BTC/LTC use.
    // if (asset === 'btc' || asset === 'ltc') {
    //   try {
    //     const pendingTxs = await sendMessage<PendingTx[]>({ type: 'GET_PENDING_TXS', asset });
    //     const totalPending = pendingTxs.reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
    //     setPendingOutgoing((prev) => ({ ...prev, [asset]: totalPending }));
    //   } catch (err) {
    //     console.error(`Failed to fetch pending txs for ${asset}:`, err);
    //   }
    // }

    try {
      const result = await sendMessage<BalanceResponse>({ type: 'GET_BALANCE', asset });

      // Check if this is LWS raw data that needs client-side verification
      if (isLwsRawResponse(result)) {
        // Run client-side key image verification for XMR/WOW spent outputs
        console.log(`[Balance] Verifying ${asset} spent outputs...`);

        // Calculate true balance:
        // total_received includes ALL receives (confirmed + mempool, including change)
        // spent_outputs includes ALL spends (confirmed + mempool)
        // verified_balance = total_received - verified_spent_amount
        const verified = await calculateVerifiedBalance(
          result.total_received,
          result.spent_outputs,
          result.viewKeyHex,
          result.publicSpendKey,
          result.spendKeyHex
        );

        // pending_balance from LWS is the NET change from mempool txs
        // Can be negative for outgoing (spent > change received)
        // Can be positive for incoming (received > 0)
        // For display, we show:
        // - confirmed = verified_balance - max(0, pending_balance) (exclude pending incoming)
        // - unconfirmed = pending_balance (can be negative for outgoing)
        //
        // Actually simpler: verified_balance already accounts for mempool spends,
        // so we just need to show the verified balance directly.
        // The pending_balance shows the net change that's still unconfirmed.

        console.log(`[Balance] ${asset} verified:`, {
          totalReceived: result.total_received,
          pendingBalance: result.pending_balance,
          lockedBalance: result.locked_balance,
          spentOutputsCount: result.spent_outputs.length,
          spentOutputsAmounts: result.spent_outputs.map(o => o.amount),
          verifiedSpentAmount: verified.verifiedSpentAmount,
          verifiedSpentCount: verified.verifiedSpentCount,
          verifiedBalance: verified.balance,
          hashToEcImplemented: verified.hashToEcImplemented,
        });

        // The verified.balance is the true spendable balance (total_received - verified_spends)
        // locked_balance from LWS represents outputs still in unlock period (10 blocks)
        // For cleaner UX, show:
        // - confirmed: unlocked balance (verified - locked)
        // - unconfirmed: pending net change from mempool
        const unlockedBalance = Math.max(0, verified.balance - result.locked_balance);

        setBalances((prev) => ({
          ...prev,
          [asset]: {
            confirmed: unlockedBalance,
            unconfirmed: result.pending_balance,
            total: verified.balance,
            error: verified.hashToEcImplemented ? undefined : 'Key image verification failed',
          },
        }));
      } else {
        // UTXO format (BTC/LTC/Grin) - use directly
        setBalances((prev) => ({
          ...prev,
          [asset]: {
            confirmed: result.confirmed,
            unconfirmed: result.unconfirmed,
            total: result.total,
            error: undefined,
          },
        }));
      }
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

  const fetchHistory = async (asset: 'btc' | 'ltc') => {
    if (loadingHistory) return;
    setLoadingHistory(true);

    try {
      const result = await sendMessage<{ transactions: TxHistoryEntry[] }>({
        type: 'GET_HISTORY',
        asset,
      });

      setHistory((prev) => ({
        ...prev,
        [asset]: result.transactions,
      }));
    } catch (err) {
      console.error(`Failed to fetch ${asset} history:`, err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const currentAddress = addresses[activeAsset];
  const currentBalance = balances[activeAsset];
  // Note: For XMR/WOW, the backend now includes mempool spent_outputs, so the confirmed
  // balance already accounts for pending outgoing transactions.
  // The local pendingOutgoing tracking is kept for future BTC/LTC use but not applied to XMR/WOW.
  const isXmrWow = activeAsset === 'xmr' || activeAsset === 'wow';
  const currentPendingOutgoing = isXmrWow ? 0 : (pendingOutgoing[activeAsset] || 0);
  const adjustedConfirmed = Math.max(0, (currentBalance?.confirmed ?? 0) - currentPendingOutgoing);

  // Show settings view
  if (screen === 'settings') {
    return <SettingsView onBack={() => setScreen('main')} />;
  }

  // Show receive view
  if (screen === 'receive') {
    return (
      <ReceiveView
        asset={activeAsset}
        address={currentAddress}
        onBack={() => setScreen('main')}
      />
    );
  }

  // Show send view
  if (screen === 'send') {
    // Pass adjusted balance (accounting for pending outgoing) to SendView
    const adjustedBalance: BalanceData | null = currentBalance
      ? {
          confirmed: adjustedConfirmed,
          unconfirmed: currentBalance.unconfirmed,
          total: adjustedConfirmed + currentBalance.unconfirmed,
          error: currentBalance.error,
        }
      : null;
    return (
      <SendView
        asset={activeAsset}
        balance={adjustedBalance}
        onBack={() => setScreen('main')}
        onSent={() => {
          setScreen('main');
          fetchBalance(activeAsset);
        }}
      />
    );
  }

  return (
    <>
      <header class="header">
        <h1>Smirk Wallet</h1>
        <div class="header-actions">
          <button class="btn btn-icon" onClick={() => setScreen('settings')} title="Settings">⚙️</button>
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
            <div class="balance-label">{ASSETS[activeAsset].name}</div>
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
          <div
            class="balance-amount"
            title={currentBalance ? `Total: ${formatBalanceFull(currentBalance.total, activeAsset)} ${ASSETS[activeAsset].symbol}\nConfirmed: ${formatBalanceFull(currentBalance.confirmed, activeAsset)}${currentPendingOutgoing > 0 ? `\nPending send: -${formatBalanceFull(currentPendingOutgoing, activeAsset)}` : ''}` : undefined}
            style={{ cursor: currentBalance ? 'help' : 'default' }}
          >
            {loadingBalance === activeAsset ? (
              <span class="spinner" style={{ width: '16px', height: '16px' }} />
            ) : currentBalance ? (
              `${formatBalance(adjustedConfirmed, activeAsset)} ${ASSETS[activeAsset].symbol}`
            ) : (
              `0.${'0'.repeat(DISPLAY_DECIMALS[activeAsset])} ${ASSETS[activeAsset].symbol}`
            )}
          </div>
          {currentBalance?.error && (
            <div class="balance-usd" style={{ fontSize: '11px', color: '#ef4444' }}>
              {currentBalance.error === 'Offline' ? 'Offline - cached value' : currentBalance.error}
            </div>
          )}
          {/* Show pending balance (can be positive for incoming or negative for outgoing) */}
          {currentBalance && !currentBalance.error && currentBalance.unconfirmed !== 0 && (
            <div
              class="balance-usd"
              style={{ fontSize: '11px', color: currentBalance.unconfirmed < 0 ? '#ef4444' : '#f59e0b' }}
              title={`${formatBalanceFull(Math.abs(currentBalance.unconfirmed), activeAsset)} ${ASSETS[activeAsset].symbol} ${currentBalance.unconfirmed < 0 ? 'outgoing' : 'incoming'}`}
            >
              {currentBalance.unconfirmed > 0 ? '+' : ''}
              {formatBalance(currentBalance.unconfirmed, activeAsset)} pending
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div class="action-grid">
          <button class="action-btn" onClick={() => setScreen('receive')}>
            <span class="action-icon">📥</span>
            <span class="action-label">Receive</span>
          </button>
          <button class="action-btn" onClick={() => setScreen('send')}>
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
        {loadingHistory ? (
          <div style={{ textAlign: 'center', padding: '16px' }}>
            <span class="spinner" style={{ width: '16px', height: '16px' }} />
          </div>
        ) : history[activeAsset] && history[activeAsset]!.length > 0 ? (
          <div class="tx-list">
            {history[activeAsset]!.slice(0, 10).map((tx) => (
              <div
                key={tx.txid}
                class="tx-item"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: '#27272a',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  // Copy txid to clipboard
                  navigator.clipboard.writeText(tx.txid);
                }}
                title={`Click to copy\n${tx.txid}`}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tx.txid.substring(0, 12)}...{tx.txid.substring(tx.txid.length - 8)}
                  </div>
                  <div style={{ fontSize: '10px', color: '#71717a' }}>
                    {tx.height > 0 ? `Block ${tx.height}` : 'Pending'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (activeAsset === 'btc' || activeAsset === 'ltc') ? (
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <div class="empty-title">No transactions yet</div>
            <div class="empty-text">Your transaction history will appear here</div>
          </div>
        ) : (
          <div class="empty-state">
            <div class="empty-icon">🔧</div>
            <div class="empty-title">History coming soon</div>
            <div class="empty-text">{ASSETS[activeAsset].name} transaction history not yet supported</div>
          </div>
        )}
      </div>
    </>
  );
}
