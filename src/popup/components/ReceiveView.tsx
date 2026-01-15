import { useState, useEffect } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, sendMessage, type AddressData } from '../shared';

export function ReceiveView({
  asset,
  address,
  onBack,
}: {
  asset: AssetType;
  address: AddressData | null;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // For Grin, we need to get the slatepack address from WASM
  const [grinAddress, setGrinAddress] = useState<string | null>(null);
  const [grinLoading, setGrinLoading] = useState(false);
  const [grinError, setGrinError] = useState<string | null>(null);

  // Initialize Grin WASM wallet to get slatepack address
  useEffect(() => {
    if (asset === 'grin') {
      setGrinLoading(true);
      setGrinError(null);
      sendMessage<{ slatepackAddress: string }>({ type: 'INIT_GRIN_WALLET' })
        .then((result) => {
          setGrinAddress(result.slatepackAddress);
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

  // For Grin, use the WASM-derived slatepack address
  const displayAddress = asset === 'grin' ? grinAddress : address?.address;

  const handleCopy = async () => {
    if (!displayAddress) return;
    try {
      await navigator.clipboard.writeText(displayAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
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
          <div style={{ fontSize: '14px', color: '#a1a1aa' }}>
            Your {ASSETS[asset].name} Address
          </div>
        </div>

        {/* Loading state for Grin WASM initialization */}
        {asset === 'grin' && grinLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <span class="spinner" style={{ width: '24px', height: '24px' }} />
            <p style={{ color: '#a1a1aa', fontSize: '13px', marginTop: '12px' }}>
              Initializing Grin wallet...
            </p>
          </div>
        ) : asset === 'grin' && grinError ? (
          <div style={{ textAlign: 'center', color: '#ef4444', padding: '16px' }}>
            {grinError}
          </div>
        ) : displayAddress ? (
          <div
            style={{
              background: '#27272a',
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
              {copied ? 'Copied!' : 'Copy Address'}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#ef4444' }}>
            Address not available
          </div>
        )}

        <div
          style={{
            fontSize: '12px',
            color: '#71717a',
            textAlign: 'center',
            padding: '0 16px',
          }}
        >
          {asset === 'grin' ? (
            <>
              Grin uses interactive transactions. Share this slatepack address
              with the sender, or use it to generate a Tor address for receiving.
            </>
          ) : (
            <>
              Send only {ASSETS[asset].name} ({ASSETS[asset].symbol}) to this address.
              Sending other assets may result in permanent loss.
            </>
          )}
        </div>
      </div>
    </>
  );
}
