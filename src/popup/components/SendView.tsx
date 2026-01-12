import { useState } from 'preact/hooks';
import type { AssetType } from '@/types';
import {
  ASSETS,
  ATOMIC_DIVISORS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  type BalanceData,
} from '../shared';

export function SendView({
  asset,
  balance,
  onBack,
  onSent,
}: {
  asset: AssetType;
  balance: BalanceData | null;
  onBack: () => void;
  onSent: () => void;
}) {
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('10'); // sat/vbyte default
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState<string | null>(null);

  // Only BTC/LTC supported for now
  const isSupportedAsset = asset === 'btc' || asset === 'ltc';

  const availableBalance = balance?.confirmed ?? 0;
  const divisor = ATOMIC_DIVISORS[asset];

  const handleSend = async (e: Event) => {
    e.preventDefault();
    setError('');

    if (!isSupportedAsset) {
      setError(`Sending ${ASSETS[asset].symbol} is not yet supported`);
      return;
    }

    if (!recipientAddress.trim()) {
      setError('Please enter a recipient address');
      return;
    }

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // Convert to atomic units (satoshis)
    const amountAtomic = Math.round(amountFloat * divisor);

    if (amountAtomic > availableBalance) {
      setError('Insufficient balance');
      return;
    }

    const feeRateNum = parseInt(feeRate);
    if (isNaN(feeRateNum) || feeRateNum < 1) {
      setError('Invalid fee rate');
      return;
    }

    setSending(true);

    try {
      const result = await sendMessage<{ txid: string; fee: number }>({
        type: 'SEND_TX',
        asset: asset as 'btc' | 'ltc',
        recipientAddress: recipientAddress.trim(),
        amount: amountAtomic,
        feeRate: feeRateNum,
      });

      setTxid(result.txid);
      // Refresh balance after short delay
      setTimeout(onSent, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send transaction');
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    // Set to max available balance (rough estimate, actual max depends on fee)
    // For a proper implementation, we'd call estimateFee first
    if (availableBalance > 0) {
      setAmount(formatBalanceFull(availableBalance, asset));
    }
  };

  // Success view
  if (txid) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Transaction Sent</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ marginBottom: '8px' }}>Transaction Broadcast</h2>
            <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '16px' }}>
              Your {ASSETS[asset].symbol} has been sent!
            </p>

            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>
                Transaction ID
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                }}
              >
                {txid}
              </div>
            </div>

            <button class="btn btn-primary" style={{ width: '100%' }} onClick={onBack}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Send {ASSETS[asset].symbol}</h1>
        <div style={{ width: '32px' }} />
      </header>

      <div class="content">
        {!isSupportedAsset ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚧</div>
            <h3 style={{ marginBottom: '8px' }}>Coming Soon</h3>
            <p style={{ color: '#a1a1aa', fontSize: '13px' }}>
              Sending {ASSETS[asset].name} is not yet supported.
              {asset === 'xmr' || asset === 'wow' ? ' Cryptonote transactions require additional implementation.' : ''}
              {asset === 'grin' ? ' Grin requires interactive slatepack transactions.' : ''}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSend}>
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
                Recipient Address
              </label>
              <input
                type="text"
                class="form-input"
                placeholder={asset === 'btc' ? 'bc1q...' : 'ltc1q...'}
                value={recipientAddress}
                onInput={(e) => setRecipientAddress((e.target as HTMLInputElement).value)}
                disabled={sending}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>

            {/* Amount */}
            <div class="form-group">
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                Amount ({ASSETS[asset].symbol})
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  class="form-input"
                  placeholder="0.00000000"
                  value={amount}
                  onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
                  disabled={sending}
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={handleMax}
                  disabled={sending || availableBalance === 0}
                  style={{ padding: '8px 12px', fontSize: '12px' }}
                >
                  Max
                </button>
              </div>
            </div>

            {/* Fee Rate */}
            <div class="form-group">
              <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                Fee Rate (sat/vB)
              </label>
              <input
                type="number"
                class="form-input"
                placeholder="10"
                value={feeRate}
                onInput={(e) => setFeeRate((e.target as HTMLInputElement).value)}
                disabled={sending}
                min="1"
                style={{ fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: '10px', color: '#71717a', marginTop: '4px' }}>
                Higher fee = faster confirmation. 1-10 sat/vB is usually sufficient.
              </div>
            </div>

            {error && (
              <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
            )}

            <button
              type="submit"
              class="btn btn-primary"
              style={{ width: '100%' }}
              disabled={sending || !recipientAddress || !amount}
            >
              {sending ? <span class="spinner" style={{ margin: '0 auto' }} /> : `Send ${ASSETS[asset].symbol}`}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
