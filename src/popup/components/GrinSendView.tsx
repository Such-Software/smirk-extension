import { useState, useEffect } from 'preact/hooks';
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
 * 1. Sender creates slate (S1) and posts to relay
 * 2. Recipient fetches, signs (S2), and posts response
 * 3. Sender fetches signed response, finalizes (S3), broadcasts
 *
 * This component handles step 1 - creating and posting the initial slate.
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
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [slatepack, setSlatepack] = useState<string | null>(null);
  const [relayId, setRelayId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [initializingWasm, setInitializingWasm] = useState(false);
  const [wasmReady, setWasmReady] = useState(false);

  const asset = 'grin';
  const availableBalance = balance?.confirmed ?? 0;
  const divisor = ATOMIC_DIVISORS[asset];

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

    if (!recipientAddress.trim()) {
      setError('Please enter a recipient slatepack address');
      return;
    }

    // Validate slatepack address format (grin1...)
    if (!recipientAddress.trim().startsWith('grin1')) {
      setError('Invalid slatepack address. Must start with grin1...');
      return;
    }

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // Convert to nanogrin
    const amountNanogrin = Math.round(amountFloat * divisor);

    if (amountNanogrin > availableBalance) {
      setError('Insufficient balance');
      return;
    }

    setCreating(true);

    try {
      // TODO: When WASM slate creation is implemented:
      // 1. Call createSendSlate() to build the slate
      // 2. Call encodeSlatepack() to encode it
      // 3. Post to relay via API

      // For now, show that the flow is not yet complete
      setError('Grin slate creation via WASM is not yet implemented. The infrastructure is in place - check back soon!');
      setCreating(false);
      return;

      // When implemented, this will look like:
      // const slate = await createSendSlate(grinKeys, amountNanogrin, fee, recipientAddress);
      // const encoded = await encodeSlatepack(grinKeys, slate, recipientAddress);
      // const result = await api.createGrinRelay({...});
      // setSlatepack(encoded);
      // setRelayId(result.id);
      // setExpiresAt(result.expires_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create slate');
    } finally {
      setCreating(false);
    }
  };

  const handleMax = () => {
    if (availableBalance > 0) {
      // Reserve some for fee (0.01 GRIN = 10000000 nanogrin)
      const maxAmount = Math.max(0, availableBalance - 10000000);
      setAmount(formatBalanceFull(maxAmount, asset));
    }
  };

  const copySlatepack = async () => {
    if (slatepack) {
      await navigator.clipboard.writeText(slatepack);
    }
  };

  // Success view - slatepack created and posted to relay
  if (slatepack && relayId) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={onBack} title="Back">
            ←
          </button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Slatepack Created</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📤</div>
            <h3 style={{ marginBottom: '8px' }}>Waiting for Recipient</h3>
            <p style={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '16px' }}>
              Your transaction request has been posted. The recipient needs to sign it within 24 hours.
            </p>

            {expiresAt && (
              <div
                style={{
                  background: '#27272a',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  marginBottom: '16px',
                  fontSize: '11px',
                  color: '#71717a',
                }}
              >
                Expires: {new Date(expiresAt).toLocaleString()}
              </div>
            )}

            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                cursor: 'pointer',
              }}
              onClick={copySlatepack}
              title="Click to copy"
            >
              <div style={{ fontSize: '10px', color: '#71717a', marginBottom: '4px' }}>
                Slatepack (click to copy for manual sharing)
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '9px',
                  wordBreak: 'break-all',
                  maxHeight: '80px',
                  overflow: 'auto',
                }}
              >
                {slatepack}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button class="btn btn-secondary" style={{ flex: 1 }} onClick={copySlatepack}>
                Copy Slatepack
              </button>
              <button class="btn btn-primary" style={{ flex: 1 }} onClick={onSlateCreated}>
                Done
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

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
                background: '#1e3a5f',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '11px',
                color: '#93c5fd',
              }}
            >
              <strong>Interactive Transaction</strong>
              <br />
              Grin transactions require the recipient to sign. Your request will be posted to our relay and expire in 24 hours.
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

            {/* Recipient Address */}
            <div class="form-group">
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                Recipient Slatepack Address
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
              Network fee: ~0.01 GRIN (calculated automatically)
            </div>

            {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

            <button
              type="submit"
              class="btn btn-primary"
              style={{ width: '100%' }}
              disabled={creating || !recipientAddress || !amount || !wasmReady}
            >
              {creating ? (
                <span class="spinner" style={{ margin: '0 auto' }} />
              ) : (
                'Create Transaction Request'
              )}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
