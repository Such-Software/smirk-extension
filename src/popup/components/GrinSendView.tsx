import { useState, useEffect } from 'preact/hooks';
import type { GrinSendContext } from '@/types';
import {
  ASSETS,
  ATOMIC_DIVISORS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  type BalanceData,
} from '../shared';

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
  // Form state
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Step 1: S1 slatepack created
  const [slatepack, setSlatepack] = useState<string | null>(null);
  const [sendContext, setSendContext] = useState<GrinSendContext | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 2: Waiting for S2 response
  const [responseSlatepack, setResponseSlatepack] = useState('');

  // Step 3: Finalizing and broadcasting
  const [finalizing, setFinalizing] = useState(false);
  const [broadcast, setBroadcast] = useState(false);

  // WASM initialization
  const [initializingWasm, setInitializingWasm] = useState(false);
  const [wasmReady, setWasmReady] = useState(false);

  const asset = 'grin';
  const availableBalance = balance?.confirmed ?? 0;
  const divisor = ATOMIC_DIVISORS[asset];

  // Default fee: 0.01 GRIN = 10,000,000 nanogrin
  const DEFAULT_FEE = 10000000;

  // Initialize Grin WASM wallet on mount
  useEffect(() => {
    initializeGrinWallet();
  }, []);

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
    const amountNanogrin = Math.round(amountFloat * divisor);
    const totalRequired = amountNanogrin + DEFAULT_FEE;

    if (totalRequired > availableBalance) {
      setError('Insufficient balance (including fee)');
      return;
    }

    setCreating(true);

    try {
      // Validate recipient address if provided (optional for encryption)
      const recipient = recipientAddress.trim() || undefined;
      if (recipient && !recipient.startsWith('grin1')) {
        setError('Invalid slatepack address. Must start with grin1...');
        setCreating(false);
        return;
      }

      // Create the send transaction
      const result = await sendMessage<{
        slatepack: string;
        slateId: string;
        sendContext: GrinSendContext;
      }>({
        type: 'GRIN_CREATE_SEND',
        amount: amountNanogrin,
        fee: DEFAULT_FEE,
        recipientAddress: recipient,
      });

      setSlatepack(result.slatepack);
      setSendContext(result.sendContext);
      console.log('Created send slate:', result.slateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create transaction');
    } finally {
      setCreating(false);
    }
  };

  const handleMax = () => {
    if (availableBalance > 0) {
      // Reserve for fee
      const maxAmount = Math.max(0, availableBalance - DEFAULT_FEE);
      setAmount(formatBalanceFull(maxAmount, asset));
    }
  };

  const copySlatepack = async () => {
    if (slatepack) {
      await navigator.clipboard.writeText(slatepack);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

      setBroadcast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize transaction');
    } finally {
      setFinalizing(false);
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
            <h3 style={{ marginBottom: '8px', color: '#22c55e' }}>Success!</h3>
            <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '24px' }}>
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
              background: '#1e3a5f',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '12px',
              color: '#93c5fd',
              lineHeight: '1.5',
            }}
          >
            <strong>Step 1:</strong> Copy and send this slatepack to the recipient
            <br />
            <strong>Step 2:</strong> Paste their signed response below to complete
          </div>

          {/* S1 Slatepack to send */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '6px' }}>
              Send this to the recipient:
            </label>
            <div
              style={{
                background: '#18181b',
                border: '1px solid #3f3f46',
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
                  color: '#a1a1aa',
                }}
              >
                {slatepack}
              </pre>
            </div>
            <button class="btn btn-secondary" style={{ width: '100%' }} onClick={copySlatepack}>
              {copied ? 'Copied!' : 'Copy Slatepack'}
            </button>
          </div>

          {/* S2 Response input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '6px' }}>
              Paste signed response from recipient:
            </label>
            <textarea
              value={responseSlatepack}
              onInput={(e) => setResponseSlatepack((e.target as HTMLTextAreaElement).value)}
              placeholder="BEGINSLATEPACK. ... ENDSLATEPACK."
              style={{
                width: '100%',
                minHeight: '80px',
                background: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                padding: '10px',
                color: '#fff',
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
            style={{ width: '100%' }}
            onClick={handleFinalize}
            disabled={!responseSlatepack.trim() || finalizing}
          >
            {finalizing ? 'Finalizing...' : 'Finalize & Broadcast'}
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
            <p style={{ color: '#a1a1aa', fontSize: '13px' }}>Initializing Grin wallet...</p>
          </div>
        ) : (
          <form onSubmit={handleSend}>
            {/* Info about interactive transactions */}
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '12px',
                color: '#a1a1aa',
                lineHeight: '1.5',
              }}
            >
              <strong style={{ color: '#fff' }}>Interactive Transaction</strong>
              <br />
              Grin transactions require the recipient to sign. You'll receive a
              slatepack to share with them, then paste their response to complete.
            </div>

            {/* Available Balance */}
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>
                Available Balance
              </div>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>
                {formatBalance(availableBalance, asset)} {ASSETS[asset].symbol}
              </div>
            </div>

            {/* Recipient Address (optional) */}
            <div class="form-group">
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                Recipient Address <span style={{ color: '#71717a' }}>(optional, for encryption)</span>
              </label>
              <input
                type="text"
                class="form-input"
                placeholder="grin1..."
                value={recipientAddress}
                onInput={(e) => setRecipientAddress((e.target as HTMLInputElement).value)}
                disabled={creating}
                style={{ fontFamily: 'monospace', fontSize: '11px' }}
              />
            </div>

            {/* Amount */}
            <div class="form-group">
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
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
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '12px',
                color: '#a1a1aa',
              }}
            >
              Network fee: ~0.01 GRIN
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
                'Create Transaction'
              )}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
