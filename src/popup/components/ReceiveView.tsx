import { useState } from 'preact/hooks';
import type { AssetType } from '@/types';
import { ASSETS, type AddressData } from '../shared';

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

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address.address);
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

        {address ? (
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
              {address.address}
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
