import { useState, useEffect } from 'preact/hooks';
import { ATOMIC_DIVISORS, formatBalance, sendMessage } from '../shared';

interface PendingSlatepack {
  id: string;
  slateId: string;
  senderUserId: string;
  amount: number;
  slatepack: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Grin Pending Slatepacks View
 *
 * Shows:
 * - Incoming slates waiting to be signed (we're the recipient)
 * - Outgoing slates waiting for finalization (we're the sender, recipient has signed)
 */
export function GrinPendingView({ onBack }: { onBack: () => void }) {
  const [pendingToSign, setPendingToSign] = useState<PendingSlatepack[]>([]);
  const [pendingToFinalize, setPendingToFinalize] = useState<PendingSlatepack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const divisor = ATOMIC_DIVISORS.grin;

  useEffect(() => {
    fetchPendingSlatepacks();
  }, []);

  const fetchPendingSlatepacks = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await sendMessage<{
        pendingToSign: PendingSlatepack[];
        pendingToFinalize: PendingSlatepack[];
      }>({ type: 'GET_GRIN_PENDING_SLATEPACKS' });
      setPendingToSign(result.pendingToSign);
      setPendingToFinalize(result.pendingToFinalize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pending slatepacks');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async (slate: PendingSlatepack) => {
    setActionInProgress(slate.id);
    try {
      await sendMessage({
        type: 'GRIN_SIGN_SLATE',
        relayId: slate.id,
        slatepack: slate.slatepack,
      });
      // Refresh the list
      await fetchPendingSlatepacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign slate');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleFinalize = async (slate: PendingSlatepack) => {
    setActionInProgress(slate.id);
    try {
      await sendMessage({
        type: 'GRIN_FINALIZE_SLATE',
        relayId: slate.id,
        slatepack: slate.slatepack,
      });
      // Refresh the list
      await fetchPendingSlatepacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize slate');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancel = async (slateId: string) => {
    setActionInProgress(slateId);
    try {
      await sendMessage({
        type: 'GRIN_CANCEL_SLATE',
        relayId: slateId,
      });
      // Refresh the list
      await fetchPendingSlatepacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel slate');
    } finally {
      setActionInProgress(null);
    }
  };

  const formatExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffMs < 0) return 'Expired';
    if (diffHours > 0) return `${diffHours}h ${diffMins}m`;
    return `${diffMins}m`;
  };

  const totalPending = pendingToSign.length + pendingToFinalize.length;

  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">
          ←
        </button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Pending Transactions</h1>
        <button
          class="btn btn-icon"
          onClick={fetchPendingSlatepacks}
          disabled={loading}
          title="Refresh"
        >
          ↻
        </button>
      </header>

      <div class="content">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <span class="spinner" style={{ width: '24px', height: '24px' }} />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '12px' }}>
              Loading pending transactions...
            </p>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
            <p style={{ color: '#ef4444', fontSize: '13px' }}>{error}</p>
            <button
              class="btn btn-secondary"
              style={{ marginTop: '12px' }}
              onClick={fetchPendingSlatepacks}
            >
              Retry
            </button>
          </div>
        ) : totalPending === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>✨</div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>No pending transactions</p>
          </div>
        ) : (
          <>
            {/* Incoming - need to sign */}
            {pendingToSign.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Incoming ({pendingToSign.length})
                </h3>
                {pendingToSign.map((slate) => (
                  <div
                    key={slate.id}
                    style={{
                      background: 'var(--color-bg-card)',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#22c55e' }}>
                          +{formatBalance(slate.amount, 'grin')} GRIN
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                          Expires in {formatExpiry(slate.expiresAt)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                          {new Date(slate.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        class="btn btn-primary"
                        style={{ flex: 1, fontSize: '11px', padding: '6px 8px' }}
                        onClick={() => handleSign(slate)}
                        disabled={actionInProgress === slate.id}
                      >
                        {actionInProgress === slate.id ? (
                          <span class="spinner" style={{ width: '12px', height: '12px' }} />
                        ) : (
                          'Accept & Sign'
                        )}
                      </button>
                      <button
                        class="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '6px 8px' }}
                        onClick={() => handleCancel(slate.id)}
                        disabled={actionInProgress === slate.id}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Outgoing - need to finalize */}
            {pendingToFinalize.length > 0 && (
              <div>
                <h3
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Ready to Finalize ({pendingToFinalize.length})
                </h3>
                {pendingToFinalize.map((slate) => (
                  <div
                    key={slate.id}
                    style={{
                      background: 'var(--color-bg-card)',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#f59e0b' }}>
                          -{formatBalance(slate.amount, 'grin')} GRIN
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                          Recipient signed - ready to broadcast
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
                          {new Date(slate.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        class="btn btn-primary"
                        style={{ flex: 1, fontSize: '11px', padding: '6px 8px' }}
                        onClick={() => handleFinalize(slate)}
                        disabled={actionInProgress === slate.id}
                      >
                        {actionInProgress === slate.id ? (
                          <span class="spinner" style={{ width: '12px', height: '12px' }} />
                        ) : (
                          'Finalize & Broadcast'
                        )}
                      </button>
                      <button
                        class="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '6px 8px' }}
                        onClick={() => handleCancel(slate.id)}
                        disabled={actionInProgress === slate.id}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
