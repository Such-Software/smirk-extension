/**
 * Main wallet view component.
 *
 * Displays wallet balance, transaction history, and navigation to
 * send/receive/settings screens.
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType, BalanceResponse } from '@/types';
import { isLwsRawResponse } from '@/types';
import { calculateVerifiedBalance } from '@/lib/monero-crypto';
import { windows, runtime } from '@/lib/browser';
import {
  ASSETS,
  sendMessage,
  saveScreenState,
  restoreScreenState,
  type AddressData,
  type BalanceData,
  type WalletScreen,
} from '../shared';
import { HistoryView } from './HistoryView';
import { ReceiveView } from './ReceiveView';
import { SendView } from './SendView';
import { SettingsView } from './SettingsView';
import { TipView } from './TipView';
import { useToast } from './Toast';
import { getGrinPendingReceive, type GrinPendingReceive } from '@/lib/storage';
import { BalanceCard, GrinPendingBanner } from './wallet';
import { InfoPanel } from './InfoPanel';
import { MigrationBanner } from './MigrationBanner';

// Check if we're already in a popped out window
const isPopup = window.location.search.includes('popup=true');

// Storage key for persisting active asset tab
const ACTIVE_ASSET_KEY = 'smirk_activeAsset';

const AVAILABLE_ASSETS: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

export function WalletView({ onLock }: { onLock: () => void }) {
  const { showToast } = useToast();
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const [screen, setScreen] = useState<WalletScreen>('main');
  const [historyInitialTab, setHistoryInitialTab] = useState<'transactions' | 'received' | 'sent'>('transactions');
  const [addresses, setAddresses] = useState<Record<AssetType, AddressData | null>>({
    btc: null, ltc: null, xmr: null, wow: null, grin: null,
  });
  const [balances, setBalances] = useState<Record<AssetType, BalanceData | null>>({
    btc: null, ltc: null, xmr: null, wow: null, grin: null,
  });
  const [loadingBalance, setLoadingBalance] = useState<AssetType | null>(null);
  // Pending outgoing amounts (for XMR/WOW - not yet confirmed txs)
  const [pendingOutgoing, setPendingOutgoing] = useState<Record<AssetType, number>>({
    btc: 0, ltc: 0, xmr: 0, wow: 0, grin: 0,
  });
  // Pending Grin receive (signed slatepack waiting for sender to finalize)
  const [grinPendingReceive, setGrinPendingReceive] = useState<GrinPendingReceive | null>(null);
  // Count of pending received tips (waiting for confirmations)
  const [pendingTipsCount, setPendingTipsCount] = useState(0);
  // Count of claimable tips (ready to claim)
  const [claimableTipsCount, setClaimableTipsCount] = useState(0);
  // Count of sent public tips ready to share (confirmed, link available)
  const [readyToShareCount, setReadyToShareCount] = useState(0);
  // Whether wallet needs migration (derivation version < v3)
  const [needsMigration, setNeedsMigration] = useState(false);
  // Show sync notice after recent migration
  const [recentlyMigrated, setRecentlyMigrated] = useState(false);

  // =========================================================================
  // Effects
  // =========================================================================

  // Restore screen state and active asset on mount
  useEffect(() => {
    const restore = async () => {
      const savedState = await restoreScreenState();
      if (savedState) {
        setActiveAsset(savedState.asset);
        setScreen(savedState.screen);
      } else {
        const saved = localStorage.getItem(ACTIVE_ASSET_KEY);
        if (saved && AVAILABLE_ASSETS.includes(saved as AssetType)) {
          setActiveAsset(saved as AssetType);
        }
      }
    };
    restore();
    getGrinPendingReceive().then(setGrinPendingReceive);
    // Check if wallet needs migration
    sendMessage<{ derivationVersion?: number }>({ type: 'GET_WALLET_STATE' })
      .then((state) => {
        if (!state.derivationVersion || state.derivationVersion < 3) {
          setNeedsMigration(true);
        }
      })
      .catch(() => {});
    // Show sync notice if recently migrated
    if (localStorage.getItem('smirk_recently_migrated')) {
      setRecentlyMigrated(true);
    }
  }, []);

  // Save screen state whenever screen or asset changes
  useEffect(() => {
    saveScreenState(screen, activeAsset);
  }, [screen, activeAsset]);

  // Reset auto-lock timer on user activity
  useEffect(() => {
    const resetTimer = () => {
      sendMessage({ type: 'RESET_AUTO_LOCK_TIMER' }).catch(() => {});
    };
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

  // Fetch pending tips (received count + sent ready-to-share count)
  const fetchPendingTips = async () => {
    try {
      // Fetch received tips (for notification badge)
      const received = await sendMessage<{ tips: Array<{ status: string; is_claimable: boolean }> }>({
        type: 'GET_RECEIVED_TIPS',
      });
      // Tips still waiting for confirmations (status 'pending' but not yet claimable)
      const pendingCount = received.tips.filter(
        (t) => t.status === 'pending' && !t.is_claimable
      ).length;
      setPendingTipsCount(pendingCount);
      // Tips ready to claim (status 'pending' and claimable)
      const claimableCount = received.tips.filter(
        (t) => t.status === 'pending' && t.is_claimable
      ).length;
      setClaimableTipsCount(claimableCount);

      // Fetch sent tips (for "ready to share" notification)
      const sent = await sendMessage<{ tips: Array<{ status: string; is_public: boolean; is_claimable: boolean }> }>({
        type: 'GET_SENT_SOCIAL_TIPS',
      });
      const readyCount = sent.tips.filter(
        (t) => t.is_public && t.is_claimable && t.status === 'pending'
      ).length;
      setReadyToShareCount(readyCount);
    } catch (err) {
      console.error('Failed to fetch pending tips:', err);
    }
  };

  // Fetch pending tips on mount and periodically
  useEffect(() => {
    fetchPendingTips();
    const interval = setInterval(fetchPendingTips, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch balance when asset changes
  useEffect(() => {
    if (addresses[activeAsset]) {
      fetchBalance(activeAsset);
    }
  }, [activeAsset, addresses[activeAsset]]);

  // =========================================================================
  // Data fetching
  // =========================================================================

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
    if (loadingBalance === asset) return;
    setLoadingBalance(asset);

    // Fetch local pending outgoing transactions
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

      if (isLwsRawResponse(result)) {
        // XMR/WOW - needs client-side key image verification
        const verified = await calculateVerifiedBalance(
          result.total_received,
          result.spent_outputs,
          result.viewKeyHex,
          result.publicSpendKey,
          result.spendKeyHex
        );
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
        // UTXO format (BTC/LTC/Grin)
        setBalances((prev) => ({
          ...prev,
          [asset]: {
            confirmed: result.confirmed,
            unconfirmed: result.unconfirmed,
            total: result.total,
            locked: result.locked,
            error: undefined,
          },
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch ${asset} balance:`, err);
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

  // =========================================================================
  // Event handlers
  // =========================================================================

  const handleAssetChange = (asset: AssetType) => {
    setActiveAsset(asset);
    localStorage.setItem(ACTIVE_ASSET_KEY, asset);
    saveScreenState(screen, asset);
  };

  const handlePopOut = async () => {
    try {
      const popupUrl = runtime.getURL('popup.html?popup=true');
      await windows.create({
        url: popupUrl,
        type: 'popup',
        width: 400,
        height: 600,
        focused: true,
      });
      window.close();
    } catch (err) {
      console.error('Failed to pop out:', err);
      showToast('Failed to pop out', 'error');
    }
  };

  // =========================================================================
  // Derived state
  // =========================================================================

  const currentAddress = addresses[activeAsset];
  const currentBalance = balances[activeAsset];
  const currentPendingOutgoing = pendingOutgoing[activeAsset] || 0;
  // For XMR/WOW: if locked_balance > 0, LWS has already detected our spend
  // (change output is locked). Don't also subtract pendingOutgoing or we double-count.
  const lwsDetectedSpend = (activeAsset === 'xmr' || activeAsset === 'wow')
    && currentBalance && (currentBalance.locked ?? 0) > 0;
  // Clear pendingOutgoing display when LWS has taken over tracking
  const displayPendingOutgoing = lwsDetectedSpend ? 0 : currentPendingOutgoing;
  const adjustedConfirmed = lwsDetectedSpend
    ? (currentBalance?.confirmed ?? 0)
    : Math.max(0, (currentBalance?.confirmed ?? 0) - currentPendingOutgoing);

  // =========================================================================
  // Sub-screens
  // =========================================================================

  if (screen === 'settings') {
    return <SettingsView onBack={() => setScreen('main')} />;
  }

  if (screen === 'receive') {
    return (
      <ReceiveView
        asset={activeAsset}
        address={currentAddress}
        onBack={() => {
          getGrinPendingReceive().then(setGrinPendingReceive);
          setScreen('main');
        }}
      />
    );
  }

  if (screen === 'send') {
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

  if (screen === 'tip') {
    const adjustedBalance: BalanceData | null = currentBalance
      ? {
          confirmed: adjustedConfirmed,
          unconfirmed: currentBalance.unconfirmed,
          total: adjustedConfirmed + currentBalance.unconfirmed,
          error: currentBalance.error,
        }
      : null;
    return (
      <TipView
        asset={activeAsset}
        balance={adjustedBalance}
        onBack={() => setScreen('main')}
        onTipSent={() => {
          setScreen('main');
          fetchBalance(activeAsset);
          fetchPendingTips();
        }}
      />
    );
  }

  if (screen === 'history') {
    return (
      <HistoryView
        activeAsset={activeAsset}
        initialTab={historyInitialTab}
        onBack={() => {
          setHistoryInitialTab('transactions'); // Reset for next time
          setScreen('main');
          fetchPendingTips();
          fetchBalance(activeAsset);
        }}
      />
    );
  }

  // =========================================================================
  // Main view
  // =========================================================================

  return (
    <>
      {/* Header */}
      <header class="header">
        <h1>Smirk Wallet</h1>
        <div class="header-actions">
          {!isPopup && (
            <button class="btn btn-icon" onClick={handlePopOut} title="Pop out">⧉</button>
          )}
          <button class="btn btn-icon" onClick={() => setScreen('settings')} title="Settings">⚙️</button>
          <button class="btn btn-icon" onClick={onLock} title="Lock">🔒</button>
        </div>
      </header>

      <div class="content">
        {/* Migration Banner (upgrade to v3 derivation) */}
        {needsMigration && (
          <MigrationBanner onComplete={() => {
            setNeedsMigration(false);
            localStorage.setItem('smirk_recently_migrated', '1');
            // Lock wallet so user re-unlocks into clean LWS state
            onLock();
          }} />
        )}

        {/* Post-migration sync notice */}
        {recentlyMigrated && (
          <div style={{
            padding: '10px 14px',
            background: 'var(--color-bg-input)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            fontSize: '12px',
            color: 'var(--color-text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>Syncing after upgrade. Balances may show zero for 5-10 minutes. Your funds are safe.</span>
            <button
              style={{
                background: 'none', border: 'none', color: 'var(--color-text-faint)',
                cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap',
              }}
              onClick={() => {
                setRecentlyMigrated(false);
                localStorage.removeItem('smirk_recently_migrated');
              }}
            >Dismiss</button>
          </div>
        )}

        {/* Pending Grin Receive Banner */}
        {grinPendingReceive && activeAsset === 'grin' && (
          <GrinPendingBanner
            pending={grinPendingReceive}
            onView={() => {
              setActiveAsset('grin');
              setScreen('receive');
            }}
          />
        )}

        {/* Asset Tabs */}
        <div class="asset-tabs">
          {AVAILABLE_ASSETS.map((asset) => (
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
        <BalanceCard
          asset={activeAsset}
          balance={currentBalance}
          adjustedConfirmed={adjustedConfirmed}
          pendingOutgoing={displayPendingOutgoing}
          loading={loadingBalance === activeAsset}
          onRefresh={() => fetchBalance(activeAsset)}
        />

        {/* Claimable Tips Banner */}
        {claimableTipsCount > 0 && (
          <div class="claimable-banner" onClick={() => {
            setHistoryInitialTab('received');
            setScreen('history');
          }}>
            🎁 You have {claimableTipsCount} tip{claimableTipsCount > 1 ? 's' : ''} ready to claim!
          </div>
        )}

        {/* Ready to Share Banner (sent public tips with enough confirmations) */}
        {readyToShareCount > 0 && (
          <div class="ready-to-share-banner" onClick={() => {
            setHistoryInitialTab('sent');
            setScreen('history');
          }}>
            🔗 {readyToShareCount} public tip{readyToShareCount > 1 ? 's' : ''} ready to share!
          </div>
        )}

        {/* Action Buttons */}
        <div class="action-grid action-grid-4">
          <button class="action-btn" onClick={() => setScreen('receive')}>
            <span class="action-icon">📥</span>
            <span class="action-label">Receive</span>
          </button>
          <button class="action-btn" onClick={() => setScreen('send')}>
            <span class="action-icon">📤</span>
            <span class="action-label">Send</span>
          </button>
          <button class="action-btn" onClick={() => setScreen('tip')}>
            <span class="action-icon">🎁</span>
            <span class="action-label">Tip</span>
          </button>
          <button class="action-btn" onClick={() => setScreen('history')}>
            <span class="action-icon">
              📜
              {(pendingTipsCount > 0 || readyToShareCount > 0) && <span class="action-badge">{pendingTipsCount + readyToShareCount}</span>}
            </span>
            <span class="action-label">History</span>
          </button>
        </div>

        {/* Info Panel - Prices & Stats */}
        <InfoPanel activeAsset={activeAsset} />
      </div>
    </>
  );
}
