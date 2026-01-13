import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import {
  ASSETS,
  ATOMIC_DIVISORS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  type BalanceData,
} from '../shared';
import {
  sendTransaction as sendXmrTransaction,
  validateAddress as validateXmrAddress,
  type XmrAsset,
} from '@/lib/xmr-tx';

interface FeeEstimate {
  fast: number | null;
  normal: number | null;
  slow: number | null;
}

type FeeSpeed = 'fast' | 'normal' | 'slow' | 'custom';

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
  const [feeRate, setFeeRate] = useState('');
  const [feeSpeed, setFeeSpeed] = useState<FeeSpeed>('normal');
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [loadingFees, setLoadingFees] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState<string | null>(null);

  // Supported assets
  const isUtxoAsset = asset === 'btc' || asset === 'ltc';
  const isCryptonoteAsset = asset === 'xmr' || asset === 'wow';
  const isSupportedAsset = isUtxoAsset || isCryptonoteAsset;

  // Fetch fee estimates on mount (only for UTXO assets)
  useEffect(() => {
    if (isUtxoAsset) {
      fetchFeeEstimate();
    }
  }, [asset]);

  // Update fee rate when speed selection changes
  useEffect(() => {
    if (feeEstimate && feeSpeed !== 'custom') {
      const rate = feeEstimate[feeSpeed];
      if (rate !== null) {
        setFeeRate(Math.ceil(rate).toString());
      }
    }
  }, [feeSpeed, feeEstimate]);

  const fetchFeeEstimate = async () => {
    setLoadingFees(true);
    try {
      const result = await sendMessage<FeeEstimate>({
        type: 'ESTIMATE_FEE',
        asset: asset as 'btc' | 'ltc',
      });
      setFeeEstimate(result);
      // Set initial fee rate from normal estimate
      if (result.normal !== null) {
        setFeeRate(Math.ceil(result.normal).toString());
      } else if (result.slow !== null) {
        setFeeRate(Math.ceil(result.slow).toString());
        setFeeSpeed('slow');
      } else {
        // Fallback if no estimates available
        setFeeRate(asset === 'ltc' ? '1' : '2');
      }
    } catch (err) {
      console.error('Failed to fetch fee estimate:', err);
      // Use conservative defaults
      setFeeRate(asset === 'ltc' ? '1' : '2');
    } finally {
      setLoadingFees(false);
    }
  };

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

    // Convert to atomic units
    const amountAtomic = Math.round(amountFloat * divisor);

    if (amountAtomic > availableBalance) {
      setError('Insufficient balance');
      return;
    }

    setSending(true);

    try {
      if (isCryptonoteAsset) {
        // XMR/WOW: Use client-side WASM signing
        // Validate address first
        const addrValidation = await validateXmrAddress(recipientAddress.trim());
        if (!addrValidation.valid) {
          setError(addrValidation.error || 'Invalid address');
          setSending(false);
          return;
        }

        // Get wallet keys from background
        const walletData = await sendMessage<{
          address: string;
          viewKey: string;
          spendKey: string;
        }>({
          type: 'GET_WALLET_KEYS',
          asset,
        });

        // Send transaction using WASM
        const result = await sendXmrTransaction(
          asset as XmrAsset,
          walletData.address,
          walletData.viewKey,
          walletData.spendKey,
          recipientAddress.trim(),
          amountAtomic,
          'mainnet'
        );

        setTxid(result.txHash);

        // Record pending tx locally for immediate UI feedback.
        // LWS may take a few seconds to see the tx in mempool, so we track it
        // locally to show the correct balance immediately after send.
        await sendMessage({
          type: 'ADD_PENDING_TX',
          txHash: result.txHash,
          asset,
          amount: amountAtomic,
          fee: result.fee,
        });
      } else {
        // BTC/LTC: Use backend signing
        const feeRateNum = parseInt(feeRate);
        if (isNaN(feeRateNum) || feeRateNum < 1) {
          setError('Invalid fee rate');
          setSending(false);
          return;
        }

        const result = await sendMessage<{ txid: string; fee: number }>({
          type: 'SEND_TX',
          asset: asset as 'btc' | 'ltc',
          recipientAddress: recipientAddress.trim(),
          amount: amountAtomic,
          feeRate: feeRateNum,
        });

        setTxid(result.txid);
      }
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

  // Copy txid to clipboard
  const copyTxid = async () => {
    if (txid) {
      await navigator.clipboard.writeText(txid);
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
                cursor: 'pointer',
              }}
              onClick={copyTxid}
              title="Click to copy"
            >
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>
                Transaction ID (click to copy)
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

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                class="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={copyTxid}
              >
                Copy TXID
              </button>
              <button class="btn btn-primary" style={{ flex: 1 }} onClick={onSent}>
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
                placeholder={
                  asset === 'btc' ? 'bc1q...' :
                  asset === 'ltc' ? 'ltc1q...' :
                  asset === 'xmr' ? '4...' :
                  asset === 'wow' ? 'Wo...' : ''
                }
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

            {/* Fee Rate - only for UTXO assets */}
            {isUtxoAsset && (
              <div class="form-group">
                <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>
                  Fee Rate (sat/vB)
                </label>
                {loadingFees ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
                    <span class="spinner" style={{ width: '14px', height: '14px' }} />
                    <span style={{ fontSize: '12px', color: '#71717a' }}>Fetching fee estimates...</span>
                  </div>
                ) : (
                  <>
                    {/* Speed selection buttons */}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                      {(['slow', 'normal', 'fast'] as const).map((speed) => {
                        const rate = feeEstimate?.[speed] ?? null;
                        const label = speed === 'fast' ? 'Fast' : speed === 'normal' ? 'Normal' : 'Slow';
                        const blocks = speed === 'fast' ? '~1-2' : speed === 'normal' ? '~3-6' : '~12+';
                        return (
                          <button
                            key={speed}
                            type="button"
                            class={`btn ${feeSpeed === speed ? 'btn-primary' : 'btn-secondary'}`}
                            style={{
                              flex: 1,
                              padding: '6px 4px',
                              fontSize: '10px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '2px',
                            }}
                            onClick={() => setFeeSpeed(speed)}
                            disabled={sending || rate === null}
                          >
                            <span>{label}</span>
                            <span style={{ opacity: 0.7 }}>
                              {rate !== null ? `${Math.ceil(rate)}` : '-'} sat/vB
                            </span>
                            <span style={{ opacity: 0.5, fontSize: '9px' }}>{blocks} blocks</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        class={`btn ${feeSpeed === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{
                          flex: 1,
                          padding: '6px 4px',
                          fontSize: '10px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onClick={() => setFeeSpeed('custom')}
                        disabled={sending}
                      >
                        <span>Custom</span>
                      </button>
                    </div>
                    {/* Manual input (always visible but highlighted when custom) */}
                    <input
                      type="number"
                      class="form-input"
                      placeholder="1"
                      value={feeRate}
                      onInput={(e) => {
                        setFeeRate((e.target as HTMLInputElement).value);
                        setFeeSpeed('custom');
                      }}
                      disabled={sending}
                      min="1"
                      style={{
                        fontFamily: 'monospace',
                        opacity: feeSpeed === 'custom' ? 1 : 0.7,
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {/* XMR/WOW fee notice */}
            {isCryptonoteAsset && (
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
                Network fee will be calculated automatically based on transaction size.
              </div>
            )}

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
