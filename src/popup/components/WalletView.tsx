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

// Check if we're already in a popped out window
const isPopup = window.location.search.includes('popup=true');

// Storage key for persisting active asset tab
const ACTIVE_ASSET_KEY = 'smirk_activeAsset';

const AVAILABLE_ASSETS: AssetType[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];

export function WalletView({ onLock }: { onLock: () => void }) {
  const { showToast } = useToast();
  const [activeAsset, setActiveAsset] = useState<AssetType>('btc');
  const [screen, setScreen] = useState<WalletScreen>('main');
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
  const adjustedConfirmed = Math.max(0, (currentBalance?.confirmed ?? 0) - currentPendingOutgoing);

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
          fetchHistory(activeAsset);
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
          fetchHistory(activeAsset);
        }}
      />
    );
  }

  if (screen === 'history') {
    return <HistoryView activeAsset={activeAsset} onBack={() => setScreen('main')} />;
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
          pendingOutgoing={currentPendingOutgoing}
          loading={loadingBalance === activeAsset}
          onRefresh={() => fetchBalance(activeAsset)}
        />

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
            <span class="action-icon">📜</span>
            <span class="action-label">History</span>
          </button>
        </div>

        {/* Info Panel - Prices & Stats */}
        <InfoPanel />
      </div>
    </>
  );
}
