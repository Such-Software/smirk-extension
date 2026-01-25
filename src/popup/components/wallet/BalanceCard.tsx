/**
 * Balance display card with refresh button.
 */

import type { AssetType } from '@/types';
import {
  ASSETS,
  DISPLAY_DECIMALS,
  formatBalance,
  formatBalanceFull,
  type BalanceData,
} from '../../shared';

interface Props {
  asset: AssetType;
  balance: BalanceData | null;
  adjustedConfirmed: number;
  pendingOutgoing: number;
  loading: boolean;
  onRefresh: () => void;
}

export function BalanceCard({
  asset,
  balance,
  adjustedConfirmed,
  pendingOutgoing,
  loading,
  onRefresh,
}: Props) {
  const assetInfo = ASSETS[asset];

  return (
    <div class="balance-card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div class="balance-label">{assetInfo.name}</div>
        <button
          class="btn btn-icon"
          style={{ fontSize: '12px', padding: '2px 6px', marginTop: '-4px' }}
          onClick={onRefresh}
          title="Refresh balance"
          disabled={loading}
        >
          🔄
        </button>
      </div>

      {/* Main balance amount */}
      <div
        class="balance-amount"
        title={balance ? `Total: ${formatBalanceFull(balance.total, asset)} ${assetInfo.symbol}\nConfirmed: ${formatBalanceFull(balance.confirmed, asset)}${pendingOutgoing > 0 ? `\nPending send: -${formatBalanceFull(pendingOutgoing, asset)}` : ''}` : undefined}
        style={{ cursor: balance ? 'help' : 'default' }}
      >
        {loading && !balance ? (
          <div class="skeleton skeleton-balance" />
        ) : balance ? (
          `${formatBalance(adjustedConfirmed, asset)} ${assetInfo.symbol}`
        ) : (
          `0.${'0'.repeat(DISPLAY_DECIMALS[asset])} ${assetInfo.symbol}`
        )}
      </div>

      {/* Error message */}
      {balance?.error && (
        <div class="balance-usd" style={{ fontSize: '11px', color: 'var(--color-error)' }}>
          {balance.error === 'Offline' ? 'Offline - cached value' : balance.error}
        </div>
      )}

      {/* Locked balance (outputs waiting for confirmations) */}
      {balance && !balance.error && (balance.locked ?? 0) > 0 && (
        <div
          class="balance-usd"
          style={{ fontSize: '11px', color: 'var(--color-yellow)' }}
          title={`${formatBalanceFull(balance.locked!, asset)} ${assetInfo.symbol} waiting for confirmations`}
        >
          {formatBalance(balance.locked!, asset)} locked
        </div>
      )}

      {/* Local pending outgoing (tx sent but not yet seen by backend) */}
      {pendingOutgoing > 0 && (
        <div
          class="balance-usd"
          style={{ fontSize: '11px', color: 'var(--color-yellow)' }}
          title={`${formatBalanceFull(pendingOutgoing, asset)} ${assetInfo.symbol} sending`}
        >
          -{formatBalance(pendingOutgoing, asset)} sending
        </div>
      )}

      {/* Pending balance from backend (can be positive incoming or negative outgoing) */}
      {balance && !balance.error && balance.unconfirmed !== 0 && (
        <div
          class="balance-usd"
          style={{
            fontSize: '11px',
            color: balance.unconfirmed < 0 ? 'var(--color-error)' : 'var(--color-yellow)',
          }}
          title={`${formatBalanceFull(Math.abs(balance.unconfirmed), asset)} ${assetInfo.symbol} ${balance.unconfirmed < 0 ? 'outgoing' : 'incoming'}`}
        >
          {balance.unconfirmed > 0 ? '+' : ''}
          {formatBalance(balance.unconfirmed, asset)} pending
        </div>
      )}
    </div>
  );
}
