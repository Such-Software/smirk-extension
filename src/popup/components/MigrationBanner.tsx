/**
 * Migration banner + upgrade flow for BIP44/SLIP-10 key derivation.
 *
 * Shows a banner when wallet uses v1 (legacy) derivation.
 * When user clicks "Upgrade", runs auto-sweep and re-keys.
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { sendMessage } from '../shared';

interface MigrationStep {
  asset: string;
  status: 'pending' | 'checking' | 'sweeping' | 'swept' | 'skipped' | 'error';
  balance?: number;
  txHash?: string;
  error?: string;
}

interface MigrationStatus {
  steps: MigrationStep[];
  phase: 'checking' | 'sweeping' | 'updating' | 'complete' | 'error';
  error?: string;
}

export function MigrationBanner({ onComplete }: { onComplete: () => void }) {
  const [migrating, setMigrating] = useState(false);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Poll migration status while migrating
  useEffect(() => {
    if (!migrating) return;
    const interval = setInterval(async () => {
      try {
        const result = await sendMessage<{ status: MigrationStatus | null }>({
          type: 'GET_MIGRATION_STATUS',
        });
        if (result.status) {
          setStatus(result.status);
          if (result.status.phase === 'complete' || result.status.phase === 'error') {
            setMigrating(false);
          }
        }
      } catch { /* ignore polling errors */ }
    }, 500);
    return () => clearInterval(interval);
  }, [migrating]);

  const startMigration = useCallback(async () => {
    setMigrating(true);
    setStatus({ steps: [], phase: 'checking' });
    try {
      await sendMessage({ type: 'START_MIGRATION' });
      // Final status will be picked up by polling
    } catch (err) {
      setStatus({
        steps: [],
        phase: 'error',
        error: err instanceof Error ? err.message : 'Migration failed',
      });
      setMigrating(false);
    }
  }, []);

  if (dismissed) return null;

  // Show upgrade flow
  if (status) {
    return (
      <div class="migration-overlay">
        <div class="migration-modal">
          <h2 class="migration-title">
            {status.phase === 'complete' ? 'Upgrade Complete' :
             status.phase === 'error' ? 'Upgrade Issue' :
             'Upgrading Wallet'}
          </h2>

          {status.phase === 'checking' && (
            <p class="migration-desc">Checking balances...</p>
          )}

          {status.phase === 'sweeping' && (
            <p class="migration-desc">Moving funds to new addresses...</p>
          )}

          {status.phase === 'updating' && (
            <p class="migration-desc">Updating wallet keys...</p>
          )}

          {/* Step progress */}
          {status.steps.length > 0 && (
            <div class="migration-steps">
              {status.steps.map((step) => (
                <div key={step.asset} class={`migration-step ${step.status}`}>
                  <span class="migration-step-asset">{step.asset.toUpperCase()}</span>
                  <span class="migration-step-status">
                    {step.status === 'checking' && 'Checking...'}
                    {step.status === 'sweeping' && 'Sweeping...'}
                    {step.status === 'swept' && `Sent (${step.txHash?.slice(0, 8)}...)`}
                    {step.status === 'skipped' && 'No balance'}
                    {step.status === 'error' && step.error}
                    {step.status === 'pending' && 'Waiting...'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {status.phase === 'complete' && (
            <div class="migration-success">
              <p>Your wallet now uses standard key derivation compatible with Cake Wallet, Exodus, and other wallets.</p>
              <button class="btn btn-primary" onClick={onComplete}>Done</button>
            </div>
          )}

          {status.phase === 'error' && (
            <div class="migration-error">
              <p>{status.error}</p>
              <div class="migration-error-actions">
                <button class="btn btn-primary" onClick={startMigration}>Retry</button>
                <button class="btn btn-secondary" onClick={() => { setStatus(null); setDismissed(true); }}>Later</button>
              </div>
            </div>
          )}

          {(status.phase === 'checking' || status.phase === 'sweeping' || status.phase === 'updating') && (
            <div class="migration-spinner"><div class="spinner" /></div>
          )}
        </div>

        <style>{`
          .migration-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 16px;
          }

          .migration-modal {
            background: var(--color-bg-card);
            border: 1px solid var(--color-border);
            border-radius: 16px;
            padding: 24px;
            max-width: 340px;
            width: 100%;
            text-align: center;
          }

          .migration-title {
            font-size: 18px;
            font-weight: 700;
            margin: 0 0 12px;
            color: var(--color-text);
          }

          .migration-desc {
            font-size: 13px;
            color: var(--color-text-muted);
            margin: 0 0 16px;
          }

          .migration-steps {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 16px 0;
          }

          .migration-step {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: var(--color-bg-input);
            border-radius: 8px;
            font-size: 13px;
          }

          .migration-step-asset {
            font-weight: 600;
            color: var(--color-text);
          }

          .migration-step-status {
            color: var(--color-text-muted);
            font-size: 12px;
          }

          .migration-step.swept .migration-step-status { color: #4ade80; }
          .migration-step.skipped .migration-step-status { color: var(--color-text-faint); }
          .migration-step.error .migration-step-status { color: #f87171; }
          .migration-step.sweeping .migration-step-status { color: var(--color-yellow); }

          .migration-success p, .migration-error p {
            font-size: 13px;
            color: var(--color-text-muted);
            margin: 0 0 16px;
          }

          .migration-error-actions {
            display: flex;
            gap: 8px;
            justify-content: center;
          }

          .migration-spinner {
            display: flex;
            justify-content: center;
            margin-top: 16px;
          }
        `}</style>
      </div>
    );
  }

  // Show banner
  return (
    <div class="migration-banner" onClick={startMigration}>
      <div class="migration-banner-text">
        <strong>Wallet Upgrade Available</strong>
        <span>Tap to improve wallet compatibility</span>
      </div>
      <button
        class="migration-banner-dismiss"
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
      >
        Later
      </button>

      <style>{`
        .migration-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: linear-gradient(135deg, #2d2a1e, #1e1e2d);
          border: 1px solid var(--color-yellow);
          border-radius: 10px;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .migration-banner:hover { opacity: 0.9; }

        .migration-banner-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .migration-banner-text strong {
          font-size: 13px;
          color: var(--color-yellow);
        }

        .migration-banner-text span {
          font-size: 11px;
          color: var(--color-text-muted);
        }

        .migration-banner-dismiss {
          background: none;
          border: none;
          color: var(--color-text-faint);
          font-size: 11px;
          cursor: pointer;
          padding: 4px 8px;
        }

        .migration-banner-dismiss:hover { color: var(--color-text-muted); }
      `}</style>
    </div>
  );
}
