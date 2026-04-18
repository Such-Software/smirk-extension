/**
 * ApprovalView - Popup for approving/denying window.smirk API requests.
 *
 * Shows when a website calls:
 * - window.smirk.connect() - Request to share public keys
 * - window.smirk.signMessage() - Request to sign a message
 * - window.smirk.requestPayment() - Request to send funds
 */

import { useState, useEffect } from 'preact/hooks';
import { sendMessage } from '../shared';

interface PaymentDetails {
  asset: string;
  amount: string;
  address: string;
  memo?: string;
}

interface PendingApproval {
  id: string;
  type: 'connect' | 'sign' | 'payment';
  origin: string;
  siteName: string;
  favicon?: string;
  message?: string;
  payment?: PaymentDetails;
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
      {/* Site Info — origin is primary (trustworthy), siteName is secondary (spoofable) */}
      <div class="approval-site">
        <div class="approval-site-info">
          <div class="approval-site-origin">{new URL(approval.origin).hostname}</div>
          {approval.siteName && approval.siteName !== new URL(approval.origin).hostname && (
            <div class="approval-site-name">{approval.siteName}</div>
          )}
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
      ) : approval.type === 'payment' && approval.payment ? (
        <div class="approval-content">
          <h2 class="approval-title">Payment Request</h2>
          <p class="approval-description">
            This site is requesting a payment from your wallet.
          </p>

          {approval.payment.memo && (
            <div class="approval-payment-memo">
              {approval.payment.memo}
            </div>
          )}

          <div class="approval-payment-amount">
            {approval.payment.amount} {approval.payment.asset.toUpperCase()}
          </div>

          <div class="approval-payment-details">
            <div class="approval-payment-label">To address:</div>
            <div class="approval-payment-address" title={approval.payment.address}>
              {approval.payment.address}
            </div>
          </div>

          <div class="approval-warning">
            This will send funds from your wallet. This action cannot be undone.
            Verify the amount and address carefully.
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
          ) : approval.type === 'payment' && approval.payment ? (
            `Send ${approval.payment.amount} ${approval.payment.asset.toUpperCase()}`
          ) : (
            'Sign'
          )}
        </button>
      </div>
    </div>
  );
}
