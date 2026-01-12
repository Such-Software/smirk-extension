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

  // Fetch balance when asset changes
  useEffect(() => {
    if (addresses[activeAsset]) {
      fetchBalance(activeAsset);
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

    try {
      const result = await sendMessage<BalanceResponse>({ type: 'GET_BALANCE', asset });

      // Check if this is LWS raw data that needs client-side verification
      if (isLwsRawResponse(result)) {
        // Run client-side key image verification for XMR/WOW spent outputs
        console.log(`[Balance] Verifying ${asset} spent outputs...`);

        // NOTE: total_received from LWS includes mempool transactions!
        // We need to subtract pending_balance to get confirmed-only for verification
        const confirmedReceived = result.total_received - result.pending_balance;

        const verified = await calculateVerifiedBalance(
          confirmedReceived,
          result.spent_outputs,
          result.viewKeyHex,
          result.publicSpendKey,
          result.spendKeyHex
        );

        console.log(`[Balance] ${asset} verified:`, {
          totalReceived: result.total_received,
          confirmedReceived,
          pendingBalance: result.pending_balance,
          verifiedSpentAmount: verified.verifiedSpentAmount,
          verifiedSpentCount: verified.verifiedSpentCount,
          confirmedBalance: verified.balance,
          hashToEcImplemented: verified.hashToEcImplemented,
        });

        setBalances((prev) => ({
          ...prev,
          [asset]: {
            confirmed: verified.balance,
            unconfirmed: result.pending_balance,
            total: verified.balance + result.pending_balance,
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

  const currentAddress = addresses[activeAsset];
  const currentBalance = balances[activeAsset];

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
    return (
      <SendView
        asset={activeAsset}
        balance={currentBalance}
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
            <div class="balance-label">{ASSETS[activeAsset].name} (Confirmed)</div>
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
            title={currentBalance ? `Total: ${formatBalanceFull(currentBalance.total, activeAsset)} ${ASSETS[activeAsset].symbol}\nConfirmed: ${formatBalanceFull(currentBalance.confirmed, activeAsset)}` : undefined}
            style={{ cursor: currentBalance ? 'help' : 'default' }}
          >
            {loadingBalance === activeAsset ? (
              <span class="spinner" style={{ width: '16px', height: '16px' }} />
            ) : currentBalance ? (
              `${formatBalance(currentBalance.confirmed, activeAsset)} ${ASSETS[activeAsset].symbol}`
            ) : (
              `0.${'0'.repeat(DISPLAY_DECIMALS[activeAsset])} ${ASSETS[activeAsset].symbol}`
            )}
          </div>
          {currentBalance?.error && (
            <div class="balance-usd" style={{ fontSize: '11px', color: '#ef4444' }}>
              {currentBalance.error === 'Offline' ? 'Offline - cached value' : currentBalance.error}
            </div>
          )}
          {currentBalance && !currentBalance.error && currentBalance.unconfirmed !== 0 && (
            <div
              class="balance-usd"
              style={{ fontSize: '11px', color: '#f59e0b' }}
              title={`${formatBalanceFull(currentBalance.unconfirmed, activeAsset)} ${ASSETS[activeAsset].symbol}`}
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
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">No transactions yet</div>
          <div class="empty-text">Your transaction history will appear here</div>
        </div>
      </div>
    </>
  );
}
