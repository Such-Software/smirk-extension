/**
 * Transaction history list component.
 */

import type { AssetType } from '@/types';
import type { TxHistoryEntry } from './types';
import { ASSETS, formatBalance } from '../../shared';
import { copyToClipboard } from '../Toast';

interface Props {
  asset: AssetType;
  transactions: TxHistoryEntry[] | null;
  loading: boolean;
  cancellingTxId: string | null;
  onCancel: (tx: TxHistoryEntry, e: Event) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function TxList({
  asset,
  transactions,
  loading,
  cancellingTxId,
  onCancel,
  showToast,
}: Props) {
  const isXmrWow = asset === 'xmr' || asset === 'wow';
  const isGrin = asset === 'grin';

  // Loading skeleton
  if (loading && !transactions) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div class="skeleton skeleton-tx" />
        <div class="skeleton skeleton-tx" />
        <div class="skeleton skeleton-tx" />
      </div>
    );
  }

  // Has transactions
  if (transactions && transactions.length > 0) {
    return (
      <div class="tx-list">
        {transactions.slice(0, 10).map((tx) => (
          <TxItem
            key={tx.txid}
            tx={tx}
            asset={asset}
            isXmrWow={isXmrWow}
            isGrin={isGrin}
            cancellingTxId={cancellingTxId}
            onCancel={onCancel}
            showToast={showToast}
          />
        ))}
      </div>
    );
  }

  // Empty state
  return (
    <div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">No transactions yet</div>
      <div class="empty-text">Your transaction history will appear here</div>
    </div>
  );
}

/**
 * Single transaction item in the list.
 */
function TxItem({
  tx,
  asset,
  isXmrWow,
  isGrin,
  cancellingTxId,
  onCancel,
  showToast,
}: {
  tx: TxHistoryEntry;
  asset: AssetType;
  isXmrWow: boolean;
  isGrin: boolean;
  cancellingTxId: string | null;
  onCancel: (tx: TxHistoryEntry, e: Event) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const received = tx.total_received ?? 0;
  const sent = tx.total_sent ?? 0;
  const isIncoming = (isXmrWow || isGrin) ? received > sent : true;
  const isPending = tx.is_pending || tx.height === 0;
  const isCancelled = tx.is_cancelled === true;

  // For Grin, prefer kernel_excess as the copyable identifier
  const displayId = isGrin && tx.kernel_excess ? tx.kernel_excess : tx.txid;
  const idLabel = isGrin && tx.kernel_excess ? 'Kernel' : (isGrin ? 'Slate' : 'Txid');

  return (
    <div
      class="tx-item"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: '6px',
        marginBottom: '6px',
        cursor: 'pointer',
      }}
      onClick={() => copyToClipboard(displayId, showToast, `${idLabel} copied`)}
      title={`Click to copy ${idLabel.toLowerCase()}\n${displayId}`}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Truncated ID */}
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

        {/* Status line */}
        <div
          style={{
            fontSize: '10px',
            color: isCancelled ? 'var(--color-error)' : 'var(--color-text-muted)',
          }}
        >
          {isGrin ? (
            <>
              {tx.kernel_excess ? 'Kernel' : 'Slate'} &bull;{' '}
              {isCancelled ? 'Cancelled' : isPending ? 'Pending' : 'Confirmed'}
            </>
          ) : (
            isPending ? 'Pending' : `Block ${tx.height}`
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Amount for XMR/WOW/Grin */}
        {(isXmrWow || isGrin) && (received > 0 || sent > 0) && (
          <div
            style={{
              fontSize: '11px',
              color: isIncoming ? 'var(--color-success)' : 'var(--color-error)',
              fontWeight: 500,
            }}
          >
            {isIncoming ? '+' : '-'}
            {formatBalance(isIncoming ? received : sent, asset)}
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
            onClick={(e) => onCancel(tx, e)}
            disabled={cancellingTxId === tx.txid}
            title="Cancel this pending transaction"
          >
            {cancellingTxId === tx.txid ? '...' : '✕'}
          </button>
        )}
      </div>
    </div>
  );
}
