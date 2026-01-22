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
  saveScreenState,
  restoreScreenState,
  type AddressData,
  type BalanceData,
  type WalletScreen,
} from '../shared';
import { ReceiveView } from './ReceiveView';
import { SendView } from './SendView';
import { SettingsView } from './SettingsView';
import { getGrinPendingReceive, type GrinPendingReceive } from '@/lib/storage';

// Storage key for persisting active asset tab
const ACTIVE_ASSET_KEY = 'smirk_activeAsset';

// Transaction history entry (common format for all assets)
interface TxHistoryEntry {
  txid: string;
  height: number;
  fee?: number;
  // XMR/WOW specific
  is_pending?: boolean;
  total_received?: number;
  total_sent?: number;
  // Grin specific - on-chain tx identifier (like txid for BTC)
  kernel_excess?: string;
  // Grin transaction status and metadata
  is_cancelled?: boolean;
  status?: string;
  direction?: 'send' | 'receive';
  input_ids?: string[]; // For cancelling pending sends
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
  // Pending Grin receive (signed slatepack waiting for sender to finalize)
  const [grinPendingReceive, setGrinPendingReceive] = useState<GrinPendingReceive | null>(null);
  // Track which Grin transaction is being cancelled
  const [cancellingTxId, setCancellingTxId] = useState<string | null>(null);

  const availableAssets: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

  // Restore screen state and active asset on mount
  useEffect(() => {
    const restore = async () => {
      // First try to restore full screen state (includes screen + asset)
      const savedState = await restoreScreenState();
      if (savedState) {
        setActiveAsset(savedState.asset);
        setScreen(savedState.screen);
      } else {
        // Fall back to just restoring the active asset
        const saved = localStorage.getItem(ACTIVE_ASSET_KEY);
        if (saved && availableAssets.includes(saved as AssetType)) {
          setActiveAsset(saved as AssetType);
        }
      }
    };
    restore();

    // Check for pending Grin receive
    getGrinPendingReceive().then(setGrinPendingReceive);
  }, []);

  // Persist active asset when it changes
  const handleAssetChange = (asset: AssetType) => {
    setActiveAsset(asset);
    localStorage.setItem(ACTIVE_ASSET_KEY, asset);
    // Save screen state so we can restore to same asset if popup closes
    saveScreenState(screen, asset);
  };

  // Save screen state whenever screen or asset changes
  useEffect(() => {
    saveScreenState(screen, activeAsset);
  }, [screen, activeAsset]);

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
      // Fetch history for all assets
      fetchHistory(activeAsset);
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

    // Track locally-recorded pending outgoing transactions.
    // For XMR/WOW, LWS may take a few seconds to see the tx in mempool after broadcast,
    // so we track pending txs locally to show correct balance immediately after send.
    try {
      const pendingResult = await sendMessage<{ pending: Array<{ amount: number; fee: number }> }>({
        type: 'GET_PENDING_TXS',
        asset,
      });
      const totalPending = pendingResult.pending.reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
      setPendingOutgoing((prev) => ({ ...prev, [asset]: totalPending }));
    } catch (err) {
      console.error(`Failed to fetch pending txs for ${asset}:`, err);
    }

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
        // locked_balance from LWS represents outputs still in unlock period (10 blocks XMR, 4 blocks WOW)
        // For cleaner UX, show:
        // - confirmed: unlocked balance (verified - locked)
        // - locked: outputs waiting for confirmations
        // - unconfirmed: pending net change from mempool
        const unlockedBalance = Math.max(0, verified.balance - result.locked_balance);

        setBalances((prev) => ({
          ...prev,
          [asset]: {
            confirmed: unlockedBalance,
            unconfirmed: result.pending_balance,
            total: verified.balance,
            locked: result.locked_balance,
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

  const fetchHistory = async (asset: AssetType) => {
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

  // Cancel a pending Grin send transaction
  const handleCancelGrinTx = async (tx: TxHistoryEntry, e: Event) => {
    e.stopPropagation(); // Don't trigger copy on parent click
    if (cancellingTxId) return; // Already cancelling something

    setCancellingTxId(tx.txid);
    try {
      await sendMessage<{ cancelled: boolean }>({
        type: 'GRIN_CANCEL_SEND',
        slateId: tx.txid,
        inputIds: tx.input_ids || [],
      });
      // Refresh history and balance after cancellation
      await fetchHistory('grin');
      await fetchBalance('grin');
    } catch (err) {
      console.error('Failed to cancel Grin transaction:', err);
    } finally {
      setCancellingTxId(null);
    }
  };

  const currentAddress = addresses[activeAsset];
  const currentBalance = balances[activeAsset];
  // Track locally-recorded pending outgoing (not yet seen by LWS/backend).
  // For XMR/WOW, LWS may take a few seconds to detect the tx in mempool,
  // so we subtract local pending from confirmed to show correct available balance.
  const currentPendingOutgoing = pendingOutgoing[activeAsset] || 0;
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
        onBack={() => {
          // Refresh pending state when returning from receive view
          getGrinPendingReceive().then(setGrinPendingReceive);
          setScreen('main');
        }}
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
          fetchHistory(activeAsset);
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
        {/* Pending Grin Receive Banner */}
        {grinPendingReceive && activeAsset === 'grin' && (
          <div
            style={{
              background: '#422006',
              border: '1px solid #f59e0b',
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 600 }}>
                Pending Receive
              </div>
              <div style={{ fontSize: '11px', color: '#fcd34d', marginTop: '2px' }}>
                Slatepack signed - send it back to finalize
              </div>
            </div>
            <button
              class="btn btn-primary"
              style={{ fontSize: '11px', padding: '6px 10px' }}
              onClick={() => {
                setActiveAsset('grin');
                setScreen('receive');
              }}
            >
              View
            </button>
          </div>
        )}

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
          {/* Show locked balance (outputs waiting for confirmations) */}
          {currentBalance && !currentBalance.error && (currentBalance.locked ?? 0) > 0 && (
            <div
              class="balance-usd"
              style={{ fontSize: '11px', color: '#f59e0b' }}
              title={`${formatBalanceFull(currentBalance.locked!, activeAsset)} ${ASSETS[activeAsset].symbol} waiting for confirmations`}
            >
              {formatBalance(currentBalance.locked!, activeAsset)} locked
            </div>
          )}
          {/* Show local pending outgoing (tx sent but not yet seen by LWS) */}
          {currentPendingOutgoing > 0 && (
            <div
              class="balance-usd"
              style={{ fontSize: '11px', color: '#f59e0b' }}
              title={`${formatBalanceFull(currentPendingOutgoing, activeAsset)} ${ASSETS[activeAsset].symbol} sending`}
            >
              -{formatBalance(currentPendingOutgoing, activeAsset)} sending
            </div>
          )}
          {/* Show pending balance from LWS (can be positive for incoming or negative for outgoing) */}
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
            {history[activeAsset]!.slice(0, 10).map((tx) => {
              // Determine if incoming or outgoing
              const isXmrWow = activeAsset === 'xmr' || activeAsset === 'wow';
              const isGrin = activeAsset === 'grin';
              const received = tx.total_received ?? 0;
              const sent = tx.total_sent ?? 0;
              const isIncoming = (isXmrWow || isGrin) ? received > sent : true; // BTC/LTC: we don't know direction yet
              const isPending = tx.is_pending || tx.height === 0;
              const isCancelled = (tx as any).is_cancelled === true;

              // For Grin, prefer kernel_excess as the copyable identifier
              const displayId = isGrin && tx.kernel_excess ? tx.kernel_excess : tx.txid;
              const idLabel = isGrin && tx.kernel_excess ? 'Kernel' : (isGrin ? 'Slate' : 'Txid');

              return (
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
                    // Copy identifier to clipboard
                    navigator.clipboard.writeText(displayId);
                  }}
                  title={`Click to copy ${idLabel.toLowerCase()}\n${displayId}`}
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
                      {displayId.substring(0, 12)}...{displayId.substring(displayId.length - 8)}
                    </div>
                    <div style={{ fontSize: '10px', color: isCancelled ? '#ef4444' : '#71717a' }}>
                      {isGrin ? (
                        <>
                          {tx.kernel_excess ? 'Kernel' : 'Slate'} &bull; {isCancelled ? 'Cancelled' : (isPending ? 'Pending' : 'Confirmed')}
                        </>
                      ) : (
                        isPending ? 'Pending' : `Block ${tx.height}`
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {(isXmrWow || isGrin) && (received > 0 || sent > 0) && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: isIncoming ? '#22c55e' : '#ef4444',
                          fontWeight: 500,
                        }}
                      >
                        {isIncoming ? '+' : '-'}
                        {formatBalance(isIncoming ? received : sent, activeAsset)}
                      </div>
                    )}
                    {/* Cancel button for pending Grin sends */}
                    {isGrin && isPending && !isCancelled && tx.direction === 'send' && (
                      <button
                        class="btn btn-secondary"
                        style={{
                          fontSize: '10px',
                          padding: '4px 8px',
                          minWidth: 'unset',
                        }}
                        onClick={(e) => handleCancelGrinTx(tx, e)}
                        disabled={cancellingTxId === tx.txid}
                        title="Cancel this pending transaction"
                      >
                        {cancellingTxId === tx.txid ? '...' : '✕'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (activeAsset === 'btc' || activeAsset === 'ltc' || activeAsset === 'xmr' || activeAsset === 'wow' || activeAsset === 'grin') ? (
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
