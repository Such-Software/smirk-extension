import { useState, useEffect } from 'preact/hooks';
import type { GrinSendContext } from '@/types';
import {
  ASSETS,
  ATOMIC_DIVISORS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  saveGrinSendState,
  restoreGrinSendState,
  clearGrinSendState,
  type BalanceData,
} from '../shared';
import { useToast, copyToClipboard } from './Toast';

// Invoice payment context for RSR flow (paying an invoice)
interface InvoicePaymentContext {
  signedSlatepack: string;
  amount: number;
  fee: number;
  slateId: string;
  inputIds: string[];
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: number;
    commitment: string;
    proof: string;
  };
}

/**
 * Grin Send View - Interactive Slatepack Flow
 *
 * Grin uses Mimblewimble with interactive transactions:
 * 1. Sender creates slate (S1) and gives slatepack to receiver
 * 2. Receiver signs (S2) and returns the signed slatepack
 * 3. Sender finalizes (S3), broadcasts, and transaction completes
 *
 * This component handles the full send flow with manual slatepack exchange.
 */
export function GrinSendView({
  balance,
  onBack,
  onSlateCreated,
}: {
  balance: BalanceData | null;
  onBack: () => void;
  onSlateCreated: () => void;
}) {
  const { showToast } = useToast();

  // Form state
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Step 1: S1 slatepack created
  const [slatepack, setSlatepack] = useState<string | null>(null);
  const [sendContext, setSendContext] = useState<GrinSendContext | null>(null);

  // Step 2: Waiting for S2 response
  const [responseSlatepack, setResponseSlatepack] = useState('');

  // Step 3: Finalizing and broadcasting
  const [finalizing, setFinalizing] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Track the amount in nanogrin for persistence
  const [amountNanogrin, setAmountNanogrin] = useState(0);

  // WASM initialization
  const [initializingWasm, setInitializingWasm] = useState(false);
  const [wasmReady, setWasmReady] = useState(false);

  // RSR Invoice payment mode
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [invoiceInput, setInvoiceInput] = useState('');
  const [invoicePayment, setInvoicePayment] = useState<InvoicePaymentContext | null>(null);
  const [signingInvoice, setSigningInvoice] = useState(false);

  const asset = 'grin';
  const availableBalance = balance?.confirmed ?? 0;
  const divisor = ATOMIC_DIVISORS[asset];

  // Estimated fee for display - actual fee calculated dynamically based on inputs
  // Grin fee = weight * baseFee (500,000 nanogrin)
  // Weight = inputs*1 + outputs*21 + kernels*3
  // For 1 input, 2 outputs, 1 kernel: 1 + 42 + 3 = 46 => 23M nanogrin (~0.023 GRIN)
  const ESTIMATED_FEE = 25000000; // 0.025 GRIN - conservative estimate for balance check

  // Initialize Grin WASM wallet and restore any pending send state on mount
  useEffect(() => {
    initializeGrinWallet();
    restoreSendState();
  }, []);

  // Restore pending send state from session storage
  const restoreSendState = async () => {
    const savedState = await restoreGrinSendState();
    if (savedState) {
      console.log('[GrinSendView] Restoring saved send state for slate:', savedState.sendContext.slateId);
      setSlatepack(savedState.slatepack);
      setSendContext(savedState.sendContext);
      setAmountNanogrin(savedState.amount);
    }
  };

  const initializeGrinWallet = async () => {
    setInitializingWasm(true);
    try {
      const result = await sendMessage<{ slatepackAddress: string }>({
        type: 'INIT_GRIN_WALLET',
      });
      setWasmReady(true);
      console.log('Grin WASM wallet initialized, address:', result.slatepackAddress);
    } catch (err) {
      console.error('Failed to initialize Grin WASM:', err);
      setError('Failed to initialize Grin wallet. Please try again.');
    } finally {
      setInitializingWasm(false);
    }
  };

  const handleSend = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (!wasmReady) {
      setError('Grin wallet not initialized. Please wait...');
      return;
    }

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // Convert to nanogrin
    const amountNano = Math.round(amountFloat * divisor);
    const totalRequired = amountNano + ESTIMATED_FEE;

    if (totalRequired > availableBalance) {
      setError('Insufficient balance (including fee)');
      return;
    }

    setCreating(true);

    try {
      // Create the send transaction (unencrypted slatepack)
      const result = await sendMessage<{
        slatepack: string;
        slateId: string;
        sendContext: GrinSendContext;
      }>({
        type: 'GRIN_CREATE_SEND',
        amount: amountNano,
        fee: ESTIMATED_FEE,
      });

      setSlatepack(result.slatepack);
      setSendContext(result.sendContext);
      setAmountNanogrin(amountNano);
      console.log('Created send slate:', result.slateId);

      // Persist state so it survives popup close
      await saveGrinSendState({
        slatepack: result.slatepack,
        sendContext: result.sendContext,
        amount: amountNano,
        fee: ESTIMATED_FEE,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create transaction');
    } finally {
      setCreating(false);
    }
  };

  const handleMax = () => {
    if (availableBalance > 0) {
      // Reserve for fee
      const maxAmount = Math.max(0, availableBalance - ESTIMATED_FEE);
      setAmount(formatBalanceFull(maxAmount, asset));
    }
  };

  const copySlatepack = async () => {
    if (slatepack) {
      await copyToClipboard(slatepack, showToast, 'Slatepack copied');
    }
  };

  const handleFinalize = async () => {
    if (!responseSlatepack.trim() || !sendContext) {
      setError('Please paste the signed slatepack from the recipient');
      return;
    }

    setFinalizing(true);
    setError('');

    try {
      await sendMessage<{ broadcast: boolean }>({
        type: 'GRIN_FINALIZE_AND_BROADCAST',
        slatepack: responseSlatepack.trim(),
        sendContext,
      });

      // Clear persisted state on success
      await clearGrinSendState();
      setBroadcast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize transaction');
    } finally {
      setFinalizing(false);
    }
  };

  // Handle paying an invoice (RSR flow)
  const handlePayInvoice = async () => {
    const trimmedInput = invoiceInput.trim();
    // Accept standard slatepack format
    if (!trimmedInput.includes('BEGINSLATEPACK') || !trimmedInput.includes('ENDSLATEPACK')) {
      setError('Please paste a valid slatepack invoice');
      return;
    }

    setSigningInvoice(true);
    setError('');

    try {
      const result = await sendMessage<{
        slatepack: string;
        slateId: string;
        amount: number;
        fee: number;
        inputIds: string[];
        changeOutput?: {
          keyId: string;
          nChild: number;
          amount: number;
          commitment: string;
          proof: string;
        };
      }>({
        type: 'GRIN_SIGN_INVOICE',
        invoiceSlatepack: trimmedInput,
      });

      // Store the context for display
      setInvoicePayment({
        signedSlatepack: result.slatepack,
        amount: result.amount,
        fee: result.fee,
        slateId: result.slateId,
        inputIds: result.inputIds,
        changeOutput: result.changeOutput,
      });

      // Copy signed response to clipboard
      await copyToClipboard(result.slatepack, showToast, 'Signed slatepack copied');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign invoice');
    } finally {
      setSigningInvoice(false);
    }
  };

  // Clear invoice payment state
  const handleClearInvoicePayment = () => {
    setInvoicePayment(null);
    setInvoiceInput('');
    setInvoiceMode(false);
  };

  // Cancel an in-progress send (unlocks outputs on backend)
  const handleCancel = async () => {
    if (!sendContext) return;

    setCancelling(true);
    setError('');

    try {
      await sendMessage<{ cancelled: boolean }>({
        type: 'GRIN_CANCEL_SEND',
        slateId: sendContext.slateId,
        inputIds: sendContext.inputIds,
      });

      // Clear persisted state
      await clearGrinSendState();

      // Go back to main screen and refresh balance/history
      // Use onSlateCreated since it triggers balance refresh (unlike onBack which just changes screen)
      onSlateCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel transaction');
      setCancelling(false);
    }
  };

  // Step 3: Success - transaction broadcast
  if (broadcast) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={onBack} title="Back">
            ←
          </button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Transaction Sent</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h3 style={{ marginBottom: '8px', color: 'var(--color-success)' }}>Success!</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginBottom: '24px' }}>
              Your transaction has been finalized and broadcast to the Grin network.
            </p>
            <button class="btn btn-primary" style={{ width: '100%' }} onClick={onSlateCreated}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  // Invoice payment: Show signed response sent confirmation
  if (invoicePayment) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={handleClearInvoicePayment} title="Back">
            ←
          </button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Invoice Signed</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h3 style={{ marginBottom: '8px', color: 'var(--color-success)' }}>Signed!</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              The signed slatepack has been copied to your clipboard.
            </p>
            <div
              style={{
                background: 'var(--color-bg-card)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Amount</div>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>
                {formatBalance(invoicePayment.amount, 'grin')} GRIN
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px', marginBottom: '4px' }}>Fee</div>
              <div style={{ fontSize: '14px' }}>
                {formatBalance(invoicePayment.fee, 'grin')} GRIN
              </div>
            </div>
            <div
              style={{
                background: 'var(--color-info-bg)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '24px',
                fontSize: '12px',
                color: 'var(--color-info-text)',
                textAlign: 'left',
              }}
            >
              Send the signed slatepack back to the invoicer. They will finalize and broadcast the transaction.
            </div>
            <button class="btn btn-primary" style={{ width: '100%' }} onClick={handleClearInvoicePayment}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  // Step 2: S1 created, waiting for S2 response
  if (slatepack && sendContext) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={onBack} title="Back">
            ←
          </button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Complete Transaction</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          {/* Instructions */}
          <div
            style={{
              background: 'var(--color-info-bg)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '12px',
              color: 'var(--color-info-text)',
              lineHeight: '1.5',
            }}
          >
            <strong>Step 1:</strong> Copy and send this slatepack to the recipient
            <br />
            <strong>Step 2:</strong> Paste their signed response below to complete
          </div>

          {/* S1 Slatepack to send */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
              Send this to the recipient:
            </label>
            <div
              style={{
                background: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                padding: '10px',
                marginBottom: '8px',
                maxHeight: '100px',
                overflow: 'auto',
                cursor: 'pointer',
              }}
              onClick={copySlatepack}
            >
              <pre
                style={{
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                  color: 'var(--color-text-muted)',
                }}
              >
                {slatepack}
              </pre>
            </div>
            <button class="btn btn-secondary" style={{ width: '100%' }} onClick={copySlatepack}>
              Copy Slatepack
            </button>
          </div>

          {/* S2 Response input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
              Paste signed response from recipient:
            </label>
            <textarea
              value={responseSlatepack}
              onInput={(e) => setResponseSlatepack((e.target as HTMLTextAreaElement).value)}
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
              disabled={finalizing}
            />
          </div>

          {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

          <button
            class="btn btn-primary"
            style={{ width: '100%', marginBottom: '8px' }}
            onClick={handleFinalize}
            disabled={!responseSlatepack.trim() || finalizing || cancelling}
          >
            {finalizing ? 'Finalizing...' : 'Finalize & Broadcast'}
          </button>

          <button
            class="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={handleCancel}
            disabled={finalizing || cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel Transaction'}
          </button>
        </div>
      </>
    );
  }

  // Step 1: Initial form
  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">
          ←
        </button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Send GRIN</h1>
        <div style={{ width: '32px' }} />
      </header>

      <div class="content">
        {initializingWasm ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <span class="spinner" style={{ width: '24px', height: '24px', marginBottom: '12px' }} />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Initializing Grin wallet...</p>
          </div>
        ) : (
          <>
            {/* Mode Toggle */}
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
                class={!invoiceMode ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                onClick={() => setInvoiceMode(false)}
              >
                Send
              </button>
              <button
                class={invoiceMode ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                onClick={() => setInvoiceMode(true)}
              >
                Pay Invoice
              </button>
            </div>

            {invoiceMode ? (
              /* Invoice Payment Mode */
              <div>
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
                    <strong style={{ color: 'var(--color-text)' }}>Pay a Grin invoice.</strong>
                  </p>
                  <p style={{ marginTop: '8px' }}>
                    1. Paste the invoice slatepack from the recipient<br />
                    2. Review and sign<br />
                    3. Send the response back to complete payment
                  </p>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
                    Paste invoice slatepack:
                  </label>
                  <textarea
                    value={invoiceInput}
                    onInput={(e) => setInvoiceInput((e.target as HTMLTextAreaElement).value)}
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
                    disabled={signingInvoice}
                  />
                </div>

                {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

                <button
                  class="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={handlePayInvoice}
                  disabled={!invoiceInput.trim() || signingInvoice || !wasmReady}
                >
                  {signingInvoice ? 'Signing...' : 'Sign & Pay Invoice'}
                </button>
              </div>
            ) : (
              /* Regular Send Mode */
              <form onSubmit={handleSend}>
                {/* Available Balance */}
                <div
                  style={{
                    background: 'var(--color-bg-card)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '4px' }}>
                    Available Balance
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 600 }}>
                    {formatBalance(availableBalance, asset)} {ASSETS[asset].symbol}
                  </div>
                </div>

                {/* Amount */}
                <div class="form-group">
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                    Amount (GRIN)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      class="form-input"
                      placeholder="0.000000000"
                      value={amount}
                      onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
                      disabled={creating}
                      style={{ flex: 1, fontFamily: 'monospace' }}
                    />
                    <button
                      type="button"
                      class="btn btn-secondary"
                      onClick={handleMax}
                      disabled={creating || availableBalance === 0}
                      style={{ padding: '8px 12px', fontSize: '12px' }}
                    >
                      Max
                    </button>
                  </div>
                </div>

                {/* Fee notice */}
                <div
                  style={{
                    background: 'var(--color-bg-card)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  Network fee: ~0.02-0.05 GRIN (varies by inputs)
                </div>

                {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

                <button
                  type="submit"
                  class="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={creating || !amount || !wasmReady}
                >
                  {creating ? (
                    <span class="spinner" style={{ margin: '0 auto' }} />
                  ) : (
                    'Create Slatepack'
                  )}
                </button>

                {/* Info about interactive transactions */}
                <div
                  style={{
                    marginTop: '16px',
                    fontSize: '11px',
                    color: 'var(--color-text-faint)',
                    lineHeight: '1.5',
                    textAlign: 'center',
                  }}
                >
                  You'll get a slatepack to share with the recipient.
                  <br />
                  They sign it and return - then you finalize.
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
