/**
 * Social tipping view component.
 *
 * Allows users to send tips to social platform usernames.
 * Flow: Select platform → Enter username → Lookup → Enter amount → Send
 */

import { useState, useEffect } from 'preact/hooks';
import type { AssetType, SocialLookupResult } from '@/types';
import {
  ASSETS,
  ATOMIC_DIVISORS,
  formatBalance,
  formatBalanceFull,
  sendMessage,
  type BalanceData,
} from '../shared';
import { useToast, copyToClipboard } from './Toast';

type TipStep = 'platform' | 'username' | 'amount' | 'sending' | 'success';
type Platform = 'telegram' | 'free';

const PLATFORMS: { id: Platform; name: string; icon: string }[] = [
  { id: 'telegram', name: 'Telegram', icon: '📱' },
  { id: 'free', name: 'Public Tip', icon: '🌐' },
];

export function TipView({
  asset,
  balance,
  onBack,
  onTipSent,
}: {
  asset: AssetType;
  balance: BalanceData | null;
  onBack: () => void;
  onTipSent: () => void;
}) {
  const { showToast } = useToast();
  const [step, setStep] = useState<TipStep>('platform');
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [username, setUsername] = useState('');
  const [amount, setAmount] = useState('');
  const [lookupResult, setLookupResult] = useState<SocialLookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [tipId, setTipId] = useState<string | null>(null);

  const availableBalance = balance?.confirmed ?? 0;
  const divisor = ATOMIC_DIVISORS[asset];

  // Normalize username (remove @ prefix, lowercase)
  const normalizeUsername = (u: string) => {
    let normalized = u.trim();
    if (normalized.startsWith('@')) {
      normalized = normalized.slice(1);
    }
    return normalized.toLowerCase();
  };

  // Handle platform selection
  const handlePlatformSelect = (p: Platform) => {
    setPlatform(p);
    setError('');
    if (p === 'free') {
      // Public tips skip username lookup
      setStep('amount');
    } else {
      setStep('username');
    }
  };

  // Handle username lookup
  const handleLookup = async () => {
    if (!platform || platform === 'free') return;

    const normalized = normalizeUsername(username);
    if (!normalized) {
      setError('Please enter a username');
      return;
    }

    setLookingUp(true);
    setError('');

    try {
      const result = await sendMessage<SocialLookupResult>({
        type: 'LOOKUP_SOCIAL',
        platform,
        username: normalized,
      });

      setLookupResult(result);

      if (!result.registered) {
        setError(`@${normalized} is not registered on Smirk. They need to link their ${platform} account at smirk.cash first.`);
      } else {
        // Check if recipient has a key for this asset
        const recipientKey = result.publicKeys?.[asset];
        if (!recipientKey) {
          setError(`@${normalized} doesn't have a ${ASSETS[asset].symbol} wallet set up.`);
        } else {
          setStep('amount');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to look up user');
    } finally {
      setLookingUp(false);
    }
  };

  // State for share URL (public tips)
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loadingShareUrl, setLoadingShareUrl] = useState(false);
  const [shareUrlPending, setShareUrlPending] = useState(false);

  // Confirmation requirements by asset (0 = immediately claimable)
  const CONFIRMATION_REQUIREMENTS: Record<AssetType, number> = {
    btc: 0,
    ltc: 0,
    xmr: 10,
    wow: 4,
    grin: 10,
  };

  // Handle tip creation
  const handleSendTip = async (e: Event) => {
    e.preventDefault();
    setError('');

    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const amountAtomic = Math.round(amountFloat * divisor);
    if (amountAtomic > availableBalance) {
      setError('Insufficient balance');
      return;
    }

    setSending(true);
    setStep('sending');

    try {
      // For targeted tips, include the recipient's BTC public key for encryption
      const recipientBtcPubkey = platform !== 'free' ? lookupResult?.publicKeys?.btc : undefined;

      const result = await sendMessage<{ tipId: string; status: string; isPublic?: boolean }>({
        type: 'CREATE_SOCIAL_TIP',
        platform: platform === 'free' ? '' : platform!,
        username: platform === 'free' ? '' : normalizeUsername(username),
        asset,
        amount: amountAtomic,
        recipientBtcPubkey: recipientBtcPubkey || undefined,
      });

      setTipId(result.tipId);

      // For public tips, try to get the share URL
      // BTC/LTC have 0 confirmations required so URL is available immediately
      // XMR/WOW/GRIN need confirmations so URL won't be available yet
      if (platform === 'free' && result.isPublic) {
        const confirmationsNeeded = CONFIRMATION_REQUIREMENTS[asset];
        if (confirmationsNeeded === 0) {
          // URL should be available immediately
          setLoadingShareUrl(true);
          try {
            const urlResult = await sendMessage<{ shareUrl: string | null; isPublic: boolean }>({
              type: 'GET_PUBLIC_TIP_SHARE_URL',
              tipId: result.tipId,
            });
            if (urlResult.shareUrl) {
              setShareUrl(urlResult.shareUrl);
            }
          } catch {
            // Silently fail - tip is created, just can't get URL yet
          } finally {
            setLoadingShareUrl(false);
          }
        } else {
          // URL will be available after confirmations
          setShareUrlPending(true);
        }
      }

      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tip');
      setStep('amount');
    } finally {
      setSending(false);
    }
  };

  // Handle Max button
  const handleMax = () => {
    if (availableBalance > 0) {
      setAmount(formatBalanceFull(availableBalance, asset));
    }
  };

  // Copy tip ID
  const copyTipId = async () => {
    if (tipId) {
      await copyToClipboard(tipId, showToast, 'Tip ID copied');
    }
  };

  // Copy share URL
  const copyShareUrl = async () => {
    if (shareUrl) {
      await copyToClipboard(shareUrl, showToast, 'Share link copied!');
    }
  };

  // Success view
  if (step === 'success' && tipId) {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Tip Created</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎁</div>
            <h2 style={{ marginBottom: '8px' }}>Tip Sent!</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              {platform === 'free'
                ? 'Your public tip is ready to claim'
                : `Your tip to @${normalizeUsername(username)} has been created`}
            </p>

            <div
              style={{
                background: 'var(--color-bg-card)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '24px', fontWeight: 600, marginBottom: '4px' }}>
                {amount} {ASSETS[asset].symbol}
              </div>
              {platform !== 'free' && (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
                  to @{normalizeUsername(username)} on {platform}
                </div>
              )}
            </div>

            {/* Share URL for public tips */}
            {shareUrl && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  cursor: 'pointer',
                  border: '1px solid var(--color-primary)',
                }}
                onClick={copyShareUrl}
                title="Click to copy share link"
              >
                <div style={{ fontSize: '11px', color: 'var(--color-primary)', marginBottom: '4px', fontWeight: 500 }}>
                  Share Link (click to copy)
                </div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    wordBreak: 'break-all',
                  }}
                >
                  {shareUrl}
                </div>
              </div>
            )}

            {/* Loading share URL */}
            {loadingShareUrl && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span class="spinner" style={{ width: '14px', height: '14px' }} />
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Getting share link...
                </span>
              </div>
            )}

            {/* Share URL pending confirmations */}
            {shareUrlPending && !shareUrl && !loadingShareUrl && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  border: '1px solid var(--color-warning)',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--color-warning)', marginBottom: '4px', fontWeight: 500 }}>
                  ⏳ Share Link Pending
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  The share link will be available once the transaction has {CONFIRMATION_REQUIREMENTS[asset]} confirmations.
                  Check your Sent Tips later to copy the link.
                </div>
              </div>
            )}

            <div
              style={{
                background: 'var(--color-bg-card)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                cursor: 'pointer',
              }}
              onClick={copyTipId}
              title="Click to copy"
            >
              <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginBottom: '4px' }}>
                Tip ID (click to copy)
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                }}
              >
                {tipId}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {shareUrl ? (
                <button
                  class="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={copyShareUrl}
                >
                  Copy Link
                </button>
              ) : !shareUrlPending ? (
                <button
                  class="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={copyTipId}
                >
                  Copy ID
                </button>
              ) : null}
              <button class="btn btn-primary" style={{ flex: shareUrlPending && !shareUrl ? 'unset' : 1, width: shareUrlPending && !shareUrl ? '100%' : 'auto' }} onClick={onTipSent}>
                Done
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Sending view
  if (step === 'sending') {
    return (
      <>
        <header class="header">
          <button class="btn btn-icon" disabled title="Back">←</button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Creating Tip</h1>
          <div style={{ width: '32px' }} />
        </header>

        <div class="content">
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div class="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--color-text-muted)' }}>Creating your tip...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header class="header">
        <button
          class="btn btn-icon"
          onClick={() => {
            if (step === 'platform') {
              onBack();
            } else if (step === 'username') {
              setStep('platform');
              setUsername('');
              setLookupResult(null);
              setError('');
            } else if (step === 'amount') {
              if (platform === 'free') {
                setStep('platform');
              } else {
                setStep('username');
              }
              setAmount('');
              setError('');
            }
          }}
          title="Back"
        >
          ←
        </button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>
          Tip {ASSETS[asset].symbol}
        </h1>
        <div style={{ width: '32px' }} />
      </header>

      <div class="content">
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

        {/* Step 1: Platform Selection */}
        {step === 'platform' && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '12px' }}>
              Choose tip type
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  class="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    textAlign: 'left',
                  }}
                  onClick={() => handlePlatformSelect(p.id)}
                >
                  <span style={{ fontSize: '24px' }}>{p.icon}</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {p.id === 'telegram'
                        ? 'Send to a Telegram username'
                        : 'Create a tip anyone can claim'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Username Entry */}
        {step === 'username' && platform && platform !== 'free' && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '12px' }}>
              Enter {platform === 'telegram' ? 'Telegram' : platform} username
            </div>

            <div class="form-group">
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  class="form-input"
                  placeholder="@username"
                  value={username}
                  onInput={(e) => {
                    setUsername((e.target as HTMLInputElement).value);
                    setError('');
                    setLookupResult(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleLookup();
                    }
                  }}
                  disabled={lookingUp}
                  style={{ flex: 1 }}
                />
                <button
                  class="btn btn-primary"
                  onClick={handleLookup}
                  disabled={lookingUp || !username.trim()}
                  style={{ minWidth: '80px' }}
                >
                  {lookingUp ? (
                    <span class="spinner" style={{ width: '14px', height: '14px' }} />
                  ) : (
                    'Look up'
                  )}
                </button>
              </div>
            </div>

            {lookupResult?.registered && !error && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '24px' }}>✅</span>
                <div>
                  <div style={{ fontWeight: 500 }}>@{normalizeUsername(username)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    Registered on Smirk
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>
            )}
          </div>
        )}

        {/* Step 3: Amount Entry */}
        {step === 'amount' && (
          <form onSubmit={handleSendTip}>
            {/* Show recipient for targeted tips */}
            {platform && platform !== 'free' && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '20px' }}>
                  {PLATFORMS.find((p) => p.id === platform)?.icon}
                </span>
                <div>
                  <div style={{ fontWeight: 500 }}>@{normalizeUsername(username)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    {platform}
                  </div>
                </div>
              </div>
            )}

            {/* Public tip notice */}
            {platform === 'free' && (
              <div
                style={{
                  background: 'var(--color-bg-card)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>🌐 Public Tip</div>
                <div style={{ color: 'var(--color-text-muted)' }}>
                  Anyone with the tip link can claim this. Share it however you like!
                </div>
              </div>
            )}

            {/* Amount Input */}
            <div class="form-group">
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  marginBottom: '4px',
                }}
              >
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
                  style={{ padding: '8px 12px', fontSize: '12px', minWidth: '50px' }}
                >
                  Max
                </button>
              </div>
            </div>

            {error && (
              <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
            )}

            <button
              type="submit"
              class="btn btn-primary"
              style={{ width: '100%' }}
              disabled={sending || !amount}
            >
              {sending ? (
                <span class="spinner" style={{ margin: '0 auto' }} />
              ) : (
                `Send ${ASSETS[asset].symbol} Tip`
              )}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
