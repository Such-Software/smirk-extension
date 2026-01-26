import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, ATOMIC_DIVISORS, sendMessage, type AddressData } from '../shared';
import { useToast, copyToClipboard } from './Toast';
import {
  getGrinPendingReceive,
  saveGrinPendingReceive,
  clearGrinPendingReceive,
  type GrinPendingReceive,
  getGrinPendingInvoice,
  saveGrinPendingInvoice,
  clearGrinPendingInvoice,
  type GrinPendingInvoice,
} from '@/lib/storage';

export function ReceiveView({
  asset,
  address,
  onBack,
}: {
  asset: AssetType;
  address: AddressData | null;
  onBack: () => void;
}) {
  const { showToast } = useToast();

  // Grin-specific state
  const [grinLoading, setGrinLoading] = useState(false);
  const [grinError, setGrinError] = useState<string | null>(null);
  const [grinInitialized, setGrinInitialized] = useState(false);

  // Slatepack input/output for Grin (SRS flow - receiving from sender)
  const [inputSlatepack, setInputSlatepack] = useState('');
  const [outputSlatepack, setOutputSlatepack] = useState('');
  const [signing, setSigning] = useState(false);
  const [pendingReceive, setPendingReceive] = useState<GrinPendingReceive | null>(null);

  // Invoice mode (RSR flow - requesting payment)
  const [mode, setMode] = useState<'srs' | 'rsr'>('srs');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [pendingInvoice, setPendingInvoice] = useState<GrinPendingInvoice | null>(null);
  const [signedResponse, setSignedResponse] = useState('');
  const [finalizingInvoice, setFinalizingInvoice] = useState(false);
  const [invoiceBroadcast, setInvoiceBroadcast] = useState(false);

  // Initialize Grin WASM wallet and restore any pending receive/invoice
  useEffect(() => {
    if (asset === 'grin') {
      setGrinLoading(true);
      setGrinError(null);

      // Load any pending receive from storage (SRS flow)
      getGrinPendingReceive().then((pending) => {
        if (pending) {
          setPendingReceive(pending);
          setInputSlatepack(pending.inputSlatepack);
          setOutputSlatepack(pending.signedSlatepack);
          setMode('srs');
        }
      });

      // Load any pending invoice from storage (RSR flow)
      getGrinPendingInvoice().then((pending) => {
        if (pending) {
          setPendingInvoice(pending);
          setMode('rsr');
        }
      });

      sendMessage<{ slatepackAddress: string }>({ type: 'INIT_GRIN_WALLET' })
        .then(() => {
          setGrinInitialized(true);
        })
        .catch((err) => {
          console.error('Failed to init Grin wallet:', err);
          setGrinError(err instanceof Error ? err.message : 'Failed to initialize');
        })
        .finally(() => {
          setGrinLoading(false);
        });
    }
  }, [asset]);

  // Handle signing the incoming S1 slatepack
  const handleSignSlatepack = async () => {
    if (!inputSlatepack.trim()) return;

    setSigning(true);
    setGrinError(null);
    setOutputSlatepack('');

    try {
      // Sign the slatepack - this creates S2 response
      const result = await sendMessage<{ signedSlatepack: string; slateId?: string; amount?: number }>({
        type: 'GRIN_SIGN_SLATEPACK',
        slatepack: inputSlatepack.trim(),
      });
      setOutputSlatepack(result.signedSlatepack);

      // Save to storage so it persists across popup closes
      const pending: GrinPendingReceive = {
        slateId: result.slateId || 'unknown',
        inputSlatepack: inputSlatepack.trim(),
        signedSlatepack: result.signedSlatepack,
        amount: result.amount || 0,
        createdAt: Date.now(),
      };
      await saveGrinPendingReceive(pending);
      setPendingReceive(pending);
    } catch (err) {
      console.error('Failed to sign slatepack:', err);
      setGrinError(err instanceof Error ? err.message : 'Failed to sign slatepack');
    } finally {
      setSigning(false);
    }
  };

  // Clear the pending receive (user acknowledges they've sent slatepack back)
  const handleClearPending = async () => {
    await clearGrinPendingReceive();
    setPendingReceive(null);
    setInputSlatepack('');
    setOutputSlatepack('');
  };

  // Copy output slatepack to clipboard
  const handleCopyOutput = async () => {
    if (!outputSlatepack) return;
    await copyToClipboard(outputSlatepack, showToast, 'Slatepack copied');
  };

  // === RSR Invoice Flow ===

  // Create an invoice (I1)
  const handleCreateInvoice = async () => {
    if (!invoiceAmount.trim()) return;

    const amountFloat = parseFloat(invoiceAmount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setGrinError('Please enter a valid amount');
      return;
    }

    setCreatingInvoice(true);
    setGrinError(null);

    try {
      const amountNano = Math.round(amountFloat * ATOMIC_DIVISORS.grin);

      const result = await sendMessage<{
        slatepack: string;
        slateId: string;
        secretKeyHex: string;
        secretNonceHex: string;
        outputInfo: { keyId: string; nChild: number; commitment: string; proof: string };
        publicBlindExcess: string;
        publicNonce: string;
        receiverAddress: string;
      }>({
        type: 'GRIN_CREATE_INVOICE',
        amount: amountNano,
      });

      // Save to storage for persistence (includes all data needed for finalization)
      const pending: GrinPendingInvoice = {
        slateId: result.slateId,
        slatepack: result.slatepack,
        amount: amountNano,
        secretKeyHex: result.secretKeyHex,
        secretNonceHex: result.secretNonceHex,
        outputInfo: result.outputInfo,
        publicBlindExcess: result.publicBlindExcess,
        publicNonce: result.publicNonce,
        receiverAddress: result.receiverAddress,
        createdAt: Date.now(),
      };
      await saveGrinPendingInvoice(pending);
      setPendingInvoice(pending);
    } catch (err) {
      console.error('Failed to create invoice:', err);
      setGrinError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setCreatingInvoice(false);
    }
  };

  // Copy invoice to clipboard
  const handleCopyInvoice = async () => {
    if (!pendingInvoice) return;
    await copyToClipboard(pendingInvoice.slatepack, showToast, 'Invoice copied');
  };

  // Finalize a signed invoice response
  const handleFinalizeInvoice = async () => {
    if (!signedResponse.trim() || !pendingInvoice) {
      setGrinError('Please paste the signed response from the sender');
      return;
    }

    setFinalizingInvoice(true);
    setGrinError(null);

    try {
      await sendMessage<{ broadcast: boolean }>({
        type: 'GRIN_FINALIZE_INVOICE',
        signedSlatepack: signedResponse.trim(),
        originalSlatepack: pendingInvoice.slatepack, // Original I1 needed to parse compact I2
        slateId: pendingInvoice.slateId,
        secretKeyHex: pendingInvoice.secretKeyHex,
        secretNonceHex: pendingInvoice.secretNonceHex,
        outputInfo: pendingInvoice.outputInfo,
        publicBlindExcess: pendingInvoice.publicBlindExcess,
        publicNonce: pendingInvoice.publicNonce,
        receiverAddress: pendingInvoice.receiverAddress,
        amount: pendingInvoice.amount,
      });

      // Clear storage on success
      await clearGrinPendingInvoice();
      setInvoiceBroadcast(true);
    } catch (err) {
      console.error('Failed to finalize invoice:', err);
      setGrinError(err instanceof Error ? err.message : 'Failed to finalize invoice');
    } finally {
      setFinalizingInvoice(false);
    }
  };

  // Cancel/clear the pending invoice
  const handleClearInvoice = async () => {
    await clearGrinPendingInvoice();
    setPendingInvoice(null);
    setInvoiceAmount('');
    setSignedResponse('');
    setInvoiceBroadcast(false);
  };

  // For non-Grin assets, use the provided address
  const displayAddress = asset !== 'grin' ? address?.address : null;

  const handleCopy = async () => {
    if (!displayAddress) return;
    await copyToClipboard(displayAddress, showToast, 'Address copied');
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Receive {ASSETS[asset].symbol}</h1>
        <div style={{ width: '32px' }} />
      </header>

      <div class="content">
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <img
            src={ASSETS[asset].iconPath}
            alt={ASSETS[asset].symbol}
            style={{ width: '48px', height: '48px', marginBottom: '8px' }}
          />
          {asset !== 'grin' && (
            <div style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
              Your {ASSETS[asset].name} Address
            </div>
          )}
        </div>

        {/* Grin-specific UI: Interactive slatepack signing or invoice creation */}
        {asset === 'grin' ? (
          grinLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <span class="spinner" style={{ width: '24px', height: '24px' }} />
              <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '12px' }}>
                Initializing...
              </p>
            </div>
          ) : grinError && !grinInitialized ? (
            <div style={{ textAlign: 'center', color: '#ef4444', padding: '16px' }}>
              {grinError}
            </div>
          ) : invoiceBroadcast ? (
            /* Invoice Success Screen */
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
              <h3 style={{ marginBottom: '8px', color: 'var(--color-success)' }}>Payment Received!</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginBottom: '24px' }}>
                Your invoice has been finalized and broadcast to the Grin network.
              </p>
              <button class="btn btn-primary" style={{ width: '100%' }} onClick={handleClearInvoice}>
                Done
              </button>
            </div>
          ) : (
            <div>
              {/* Mode Toggle (only show if no pending state) */}
              {!pendingReceive && !pendingInvoice && (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '16px',
                    background: 'var(--color-bg-card)',
                    borderRadius: '8px',
                    padding: '4px',
                  }}
                >
                  <button
                    class={mode === 'srs' ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                    onClick={() => setMode('srs')}
                  >
                    Receive
                  </button>
                  <button
                    class={mode === 'rsr' ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                    onClick={() => setMode('rsr')}
                  >
                    Request
                  </button>
                </div>
              )}

              {/* SRS Mode: Sign slatepack from sender */}
              {mode === 'srs' && (
                <>
                  {/* Explanation */}
                  <div
                    style={{
                      background: 'var(--color-bg-card)',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '16px',
                      fontSize: '13px',
                      color: 'var(--color-text-muted)',
                      lineHeight: '1.5',
                    }}
                  >
                    <p>
                      <strong style={{ color: 'var(--color-text)' }}>Grin uses interactive transactions.</strong>
                    </p>
                    <p style={{ marginTop: '8px' }}>
                      1. Ask the sender to create a slatepack and share it with you<br />
                      2. Paste it below and click "Sign"<br />
                      3. Copy the response slatepack and send it back<br />
                      4. The sender will finalize and broadcast
                    </p>
                  </div>

                  {/* Input: Paste S1 slatepack from sender */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                      Paste slatepack from sender:
                    </label>
                    <textarea
                      value={inputSlatepack}
                      onInput={(e) => setInputSlatepack((e.target as HTMLTextAreaElement).value)}
                      placeholder="BEGINSLATEPACK. ... ENDSLATEPACK."
                      style={{
                        width: '100%',
                        minHeight: '80px',
                        background: 'var(--color-bg-input)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        padding: '10px',
                        color: 'var(--color-text)',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                      }}
                      disabled={signing}
                    />
                  </div>

                  {/* Sign button */}
                  <button
                    class="btn btn-primary"
                    style={{ width: '100%', marginBottom: '16px' }}
                    onClick={handleSignSlatepack}
                    disabled={!inputSlatepack.trim() || signing}
                  >
                    {signing ? 'Signing...' : 'Sign Slatepack'}
                  </button>

                  {/* Error display */}
                  {grinError && (
                    <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
                      {grinError}
                    </div>
                  )}

                  {/* Output: Signed S2 slatepack to give back */}
                  {outputSlatepack && (
                    <div>
                      {pendingReceive && (
                        <div
                          style={{
                            background: 'var(--color-warning-bg)',
                            border: '1px solid var(--color-yellow)',
                            borderRadius: '6px',
                            padding: '10px',
                            marginBottom: '12px',
                            fontSize: '12px',
                            color: 'var(--color-warning-text)',
                          }}
                        >
                          Waiting for sender to finalize. Keep this slatepack until the transaction confirms.
                        </div>
                      )}
                      <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                        Send this response back to the sender:
                      </label>
                      <div
                        style={{
                          background: 'var(--color-bg-input)',
                          border: '1px solid var(--color-success)',
                          borderRadius: '6px',
                          padding: '10px',
                          marginBottom: '8px',
                          maxHeight: '120px',
                          overflow: 'auto',
                        }}
                      >
                        <pre
                          style={{
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            color: 'var(--color-success)',
                          }}
                        >
                          {outputSlatepack}
                        </pre>
                      </div>
                      <button
                        class="btn btn-primary"
                        style={{ width: '100%', marginBottom: '8px' }}
                        onClick={handleCopyOutput}
                      >
                        Copy Response Slatepack
                      </button>
                      {pendingReceive && (
                        <button
                          class="btn btn-secondary"
                          style={{ width: '100%', fontSize: '12px' }}
                          onClick={handleClearPending}
                        >
                          Done - I've sent it back
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* RSR Mode: Create invoice to request payment */}
              {mode === 'rsr' && (
                <>
                  {!pendingInvoice ? (
                    /* Invoice Creation Form */
                    <>
                      <div
                        style={{
                          background: 'var(--color-bg-card)',
                          borderRadius: '8px',
                          padding: '12px',
                          marginBottom: '16px',
                          fontSize: '13px',
                          color: 'var(--color-text-muted)',
                          lineHeight: '1.5',
                        }}
                      >
                        <p>
                          <strong style={{ color: 'var(--color-text)' }}>Request a specific amount.</strong>
                        </p>
                        <p style={{ marginTop: '8px' }}>
                          1. Enter the amount you want to receive<br />
                          2. Share the invoice with the sender<br />
                          3. They'll sign it and send back a response<br />
                          4. Paste the response to finalize
                        </p>
                      </div>

                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                          Amount to request (GRIN):
                        </label>
                        <input
                          type="text"
                          class="form-input"
                          value={invoiceAmount}
                          onInput={(e) => setInvoiceAmount((e.target as HTMLInputElement).value)}
                          placeholder="0.000000000"
                          style={{
                            width: '100%',
                            fontFamily: 'monospace',
                          }}
                          disabled={creatingInvoice}
                        />
                      </div>

                      {grinError && (
                        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
                          {grinError}
                        </div>
                      )}

                      <button
                        class="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={handleCreateInvoice}
                        disabled={!invoiceAmount.trim() || creatingInvoice}
                      >
                        {creatingInvoice ? 'Creating...' : 'Create Invoice'}
                      </button>
                    </>
                  ) : (
                    /* Pending Invoice - Waiting for Sender Response */
                    <>
                      <div
                        style={{
                          background: 'var(--color-warning-bg)',
                          border: '1px solid var(--color-yellow)',
                          borderRadius: '6px',
                          padding: '10px',
                          marginBottom: '12px',
                          fontSize: '12px',
                          color: 'var(--color-warning-text)',
                        }}
                      >
                        Invoice for {(pendingInvoice.amount / ATOMIC_DIVISORS.grin).toFixed(9)} GRIN
                      </div>

                      <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                        Send this invoice to the sender:
                      </label>
                      <div
                        style={{
                          background: 'var(--color-bg-input)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '10px',
                          marginBottom: '8px',
                          maxHeight: '80px',
                          overflow: 'auto',
                        }}
                      >
                        <pre
                          style={{
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {pendingInvoice.slatepack}
                        </pre>
                      </div>
                      <button
                        class="btn btn-secondary"
                        style={{ width: '100%', marginBottom: '16px' }}
                        onClick={handleCopyInvoice}
                      >
                        Copy Invoice
                      </button>

                      <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                        Paste signed slatepack from sender:
                      </label>
                      <textarea
                        value={signedResponse}
                        onInput={(e) => setSignedResponse((e.target as HTMLTextAreaElement).value)}
                        placeholder="BEGINSLATEPACK. ... ENDSLATEPACK."
                        style={{
                          width: '100%',
                          minHeight: '80px',
                          background: 'var(--color-bg-input)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '10px',
                          color: 'var(--color-text)',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          resize: 'vertical',
                        }}
                        disabled={finalizingInvoice}
                      />

                      {grinError && (
                        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', marginTop: '12px', textAlign: 'center' }}>
                          {grinError}
                        </div>
                      )}

                      <button
                        class="btn btn-primary"
                        style={{ width: '100%', marginTop: '12px', marginBottom: '8px' }}
                        onClick={handleFinalizeInvoice}
                        disabled={!signedResponse.trim() || finalizingInvoice}
                      >
                        {finalizingInvoice ? 'Finalizing...' : 'Finalize & Broadcast'}
                      </button>

                      <button
                        class="btn btn-secondary"
                        style={{ width: '100%', fontSize: '12px' }}
                        onClick={handleClearInvoice}
                        disabled={finalizingInvoice}
                      >
                        Cancel Invoice
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )
        ) : displayAddress ? (
          /* Non-Grin: Show address */
          <div
            style={{
              background: 'var(--color-bg-card)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                wordBreak: 'break-all',
                textAlign: 'center',
                lineHeight: '1.6',
                marginBottom: '16px',
              }}
            >
              {displayAddress}
            </div>

            <button
              class="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleCopy}
            >
              Copy Address
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#ef4444' }}>
            Address not available
          </div>
        )}

        {/* Footer text for non-Grin assets */}
        {asset !== 'grin' && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-faint)',
              textAlign: 'center',
              padding: '0 16px',
            }}
          >
            Send only {ASSETS[asset].name} ({ASSETS[asset].symbol}) to this address.
            Sending other assets may result in permanent loss.
          </div>
        )}
      </div>
    </>
  );
}
