/**
 * Banner showing pending Grin receive that needs sender to finalize.
 */

import type { GrinPendingReceive } from '@/lib/storage';

interface Props {
  pending: GrinPendingReceive;
  onView: () => void;
}

export function GrinPendingBanner({ pending, onView }: Props) {
  return (
    <div
      style={{
        background: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid var(--color-yellow)',
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
        <div style={{ fontSize: '12px', color: 'var(--color-yellow)', fontWeight: 600 }}>
          Pending Receive
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-yellow)', marginTop: '2px', opacity: 0.8 }}>
          Slatepack signed - send it back to finalize
        </div>
      </div>
      <button
        class="btn btn-primary"
        style={{ fontSize: '11px', padding: '6px 10px' }}
        onClick={onView}
      >
        View
      </button>
    </div>
  );
}
