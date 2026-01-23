/**
 * ApprovalView - Popup for approving/denying window.smirk API requests.
 *
 * Shows when a website calls:
 * - window.smirk.connect() - Request to share public keys
 * - window.smirk.signMessage() - Request to sign a message
 */

import { useState, useEffect } from 'preact/hooks';
import { sendMessage } from '../shared';

interface PendingApproval {
  id: string;
  type: 'connect' | 'sign';
  origin: string;
  siteName: string;
  favicon?: string;
  message?: string;
}

interface ApprovalViewProps {
  requestId: string;
  onComplete: () => void;
}

export function ApprovalView({ requestId, onComplete }: ApprovalViewProps) {
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApprovalRequest();
  }, [requestId]);

  const loadApprovalRequest = async () => {
    try {
      const result = await sendMessage<PendingApproval>({
        type: 'GET_PENDING_APPROVAL',
        requestId,
      });
      setApproval(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request');
    } finally {
      setLoading(false);
    }
  };

  const handleResponse = async (approved: boolean) => {
    setResponding(true);
    try {
      await sendMessage({
        type: 'SMIRK_APPROVAL_RESPONSE',
        requestId,
        approved,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to respond');
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div class="approval-container">
        <div class="approval-loading">
          <span class="spinner" />
          <p>Loading request...</p>
        </div>
      </div>
    );
  }

  if (error || !approval) {
    return (
      <div class="approval-container">
        <div class="approval-error">
          <div class="approval-error-icon">!</div>
          <h2>Error</h2>
          <p>{error || 'Request not found'}</p>
          <button class="btn btn-secondary" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="approval-container">
      {/* Site Info */}
      <div class="approval-site">
        {approval.favicon ? (
          <img
            src={approval.favicon}
            alt=""
            class="approval-favicon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div class="approval-favicon-placeholder">
            {approval.origin.charAt(8).toUpperCase()}
          </div>
        )}
        <div class="approval-site-info">
          <div class="approval-site-name">{approval.siteName}</div>
          <div class="approval-site-origin">{approval.origin}</div>
        </div>
      </div>

      {/* Request Type */}
      {approval.type === 'connect' ? (
        <div class="approval-content">
          <h2 class="approval-title">Connect Request</h2>
          <p class="approval-description">
            This site wants to view your public wallet addresses.
          </p>

          <div class="approval-permissions">
            <div class="approval-permission">
              <span class="approval-permission-icon">&#10003;</span>
              <span>View your public addresses</span>
            </div>
            <div class="approval-permission">
              <span class="approval-permission-icon">&#10003;</span>
              <span>Request signatures for messages</span>
            </div>
            <div class="approval-permission warning">
              <span class="approval-permission-icon">&#10007;</span>
              <span>Cannot access your private keys</span>
            </div>
            <div class="approval-permission warning">
              <span class="approval-permission-icon">&#10007;</span>
              <span>Cannot send transactions without approval</span>
            </div>
          </div>
        </div>
      ) : (
        <div class="approval-content">
          <h2 class="approval-title">Signature Request</h2>
          <p class="approval-description">
            This site wants you to sign a message.
          </p>

          <div class="approval-message-box">
            <div class="approval-message-label">Message to sign:</div>
            <div class="approval-message-content">
              {approval.message}
            </div>
          </div>

          <div class="approval-warning">
            Only sign messages you understand. Signing can be used to prove your
            identity or authorize actions on this site.
          </div>
        </div>
      )}

      {/* Actions */}
      <div class="approval-actions">
        <button
          class="btn btn-secondary"
          onClick={() => handleResponse(false)}
          disabled={responding}
        >
          Deny
        </button>
        <button
          class="btn btn-primary"
          onClick={() => handleResponse(true)}
          disabled={responding}
        >
          {responding ? (
            <span class="spinner" style={{ width: '16px', height: '16px' }} />
          ) : approval.type === 'connect' ? (
            'Connect'
          ) : (
            'Sign'
          )}
        </button>
      </div>
    </div>
  );
}
