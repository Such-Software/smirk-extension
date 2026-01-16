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

  // Grin-specific state
  const [grinLoading, setGrinLoading] = useState(false);
  const [grinError, setGrinError] = useState<string | null>(null);
  const [grinInitialized, setGrinInitialized] = useState(false);

  // Slatepack input/output for Grin
  const [inputSlatepack, setInputSlatepack] = useState('');
  const [outputSlatepack, setOutputSlatepack] = useState('');
  const [signing, setSigning] = useState(false);

  // Initialize Grin WASM wallet
  useEffect(() => {
    if (asset === 'grin') {
      setGrinLoading(true);
      setGrinError(null);

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
      const result = await sendMessage<{ signedSlatepack: string }>({
        type: 'GRIN_SIGN_SLATEPACK',
        slatepack: inputSlatepack.trim(),
      });
      setOutputSlatepack(result.signedSlatepack);
    } catch (err) {
      console.error('Failed to sign slatepack:', err);
      setGrinError(err instanceof Error ? err.message : 'Failed to sign slatepack');
    } finally {
      setSigning(false);
    }
  };

  // Copy output slatepack to clipboard
  const handleCopyOutput = async () => {
    if (!outputSlatepack) return;
    try {
      await navigator.clipboard.writeText(outputSlatepack);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // For non-Grin assets, use the provided address
  const displayAddress = asset !== 'grin' ? address?.address : null;

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
          {asset !== 'grin' && (
            <div style={{ fontSize: '14px', color: '#a1a1aa' }}>
              Your {ASSETS[asset].name} Address
            </div>
          )}
        </div>

        {/* Grin-specific UI: Interactive slatepack signing */}
        {asset === 'grin' ? (
          grinLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <span class="spinner" style={{ width: '24px', height: '24px' }} />
              <p style={{ color: '#a1a1aa', fontSize: '13px', marginTop: '12px' }}>
                Initializing...
              </p>
            </div>
          ) : grinError && !grinInitialized ? (
            <div style={{ textAlign: 'center', color: '#ef4444', padding: '16px' }}>
              {grinError}
            </div>
          ) : (
            <div>
              {/* Explanation */}
              <div
                style={{
                  background: '#27272a',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#a1a1aa',
                  lineHeight: '1.5',
                }}
              >
                <p>
                  <strong style={{ color: '#fff' }}>Grin uses interactive transactions.</strong>
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
                <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px' }}>
                  Paste slatepack from sender:
                </label>
                <textarea
                  value={inputSlatepack}
                  onInput={(e) => setInputSlatepack((e.target as HTMLTextAreaElement).value)}
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
                  <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px' }}>
                    Send this response back to the sender:
                  </label>
                  <div
                    style={{
                      background: '#18181b',
                      border: '1px solid #22c55e',
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
                        color: '#22c55e',
                      }}
                    >
                      {outputSlatepack}
                    </pre>
                  </div>
                  <button
                    class="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={handleCopyOutput}
                  >
                    {copied ? 'Copied!' : 'Copy Response Slatepack'}
                  </button>
                </div>
              )}
            </div>
          )
        ) : displayAddress ? (
          /* Non-Grin: Show address */
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

        {/* Footer text for non-Grin assets */}
        {asset !== 'grin' && (
          <div
            style={{
              fontSize: '12px',
              color: '#71717a',
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
