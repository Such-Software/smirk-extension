# Website Integration Guide

Add "Sign in with Smirk" to your website. Users authenticate by cryptographically proving they control their wallet keys - no passwords, no email, no OAuth.

## Overview

Smirk provides a `window.smirk` API that any website can use for authentication and payments. The flow works like MetaMask's `window.ethereum`:

**Authentication:**
1. Website requests connection to Smirk wallet
2. User approves in extension popup
3. Website receives user's public keys
4. Website requests signature on a challenge message
5. Backend verifies signature, issues session token

**Payments:**
1. Website calls `requestPayment()` with asset, amount, and address
2. User sees payment details in approval popup
3. User approves — extension signs and broadcasts the transaction
4. Website receives the transaction ID

**Key benefit:** Users get a consistent identity across all Smirk-integrated sites, tied to their wallet keys. Payments require no backend — the extension handles signing and broadcasting.

## Quick Start

### 1. Check for Extension

```javascript
function hasSmirkWallet() {
  return typeof window.smirk !== 'undefined';
}

// Show appropriate UI
if (hasSmirkWallet()) {
  showSmirkLoginButton();
} else {
  showInstallSmirkPrompt();
}
```

### 2. Connect and Get Public Keys

```javascript
async function connectSmirk() {
  if (!window.smirk) {
    throw new Error('Smirk wallet not installed');
  }

  // This opens the approval popup
  const publicKeys = await window.smirk.connect();

  // Returns: { btc: string, ltc: string, xmr: string, wow: string, grin: string }
  console.log('Connected! BTC pubkey:', publicKeys.btc);

  return publicKeys;
}
```

### 3. Request Signature for Authentication

```javascript
async function authenticateWithSmirk() {
  // 1. Get a challenge from your backend
  const challenge = await fetch('/api/auth/challenge').then(r => r.json());
  // challenge = { nonce: "abc123...", message: "Sign to login to MyApp" }

  // 2. Request signature from Smirk
  const result = await window.smirk.signMessage(challenge.message);

  // result = {
  //   message: "Sign to login to MyApp",
  //   signatures: [
  //     { asset: "btc", signature: "...", publicKey: "..." }
  //   ]
  // }

  // 3. Send to your backend for verification
  const session = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce: challenge.nonce,
      signatures: result.signatures
    })
  }).then(r => r.json());

  return session; // { token: "jwt...", user: { ... } }
}
```

## API Reference

### `window.smirk.connect()`

Request connection to the user's Smirk wallet. Opens an approval popup.

**Returns:** `Promise<PublicKeys>`

```typescript
interface PublicKeys {
  btc: string;   // Compressed secp256k1 public key (hex)
  ltc: string;   // Compressed secp256k1 public key (hex)
  xmr: string;   // Ed25519 public spend key (hex)
  wow: string;   // Ed25519 public spend key (hex)
  grin: string;  // Ed25519 public key (hex)
}
```

**Errors:**
- User rejected the connection request
- Extension locked (user needs to unlock with password)

### `window.smirk.signMessage(message: string)`

Request signature on a message. Opens an approval popup showing the message.

**Parameters:**
- `message`: The message to sign (displayed to user)

**Returns:** `Promise<SignResult>`

```typescript
interface SignResult {
  message: string;
  signatures: Array<{
    asset: 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';
    signature: string;  // Hex-encoded signature
    publicKey: string;  // Hex-encoded public key
  }>;
}
```

**Signature format details (important for verification):**

| Asset | Algorithm | Pre-hash | Format | Standard |
|-------|-----------|----------|--------|----------|
| BTC/LTC | ECDSA (secp256k1) | Double SHA256 with Bitcoin magic prefix | Compact r\|\|s hex (128 chars) | Non-standard (no recovery byte, not Base64/BIP-137) |
| XMR/WOW/Grin | Ed25519 | SHA-256(message) | Ed25519 signature hex (128 chars) | Non-standard (message is pre-hashed, not RFC 8032) |

The Smirk backend's `/auth/verify` endpoint handles these formats. If verifying independently, you must pre-hash the message with SHA-256 before Ed25519 verification, and use Bitcoin message signing format (with magic prefix) for BTC/LTC ECDSA.

By default, signs with BTC key only. The message is prefixed with Bitcoin's standard message prefix for verification.

### `window.smirk.disconnect()`

Disconnect the website from Smirk. Clears the site's connection approval.

**Returns:** `Promise<void>`

### `window.smirk.isConnected()`

Check if the website is currently connected.

**Returns:** `Promise<boolean>`

### `window.smirk.getPublicKeys()`

Get public keys without prompting user (only works if already connected).

**Returns:** `Promise<PublicKeys | null>`

Returns `null` if not connected. Returns error if wallet is locked.

```typescript
const keys = await window.smirk.getPublicKeys();
if (keys) {
  console.log('BTC pubkey:', keys.btc);
}
```

### `window.smirk.getAddresses()`

Get wallet addresses for receiving funds. Requires prior connection.

**Returns:** `Promise<Addresses | null>`

```typescript
interface Addresses {
  btc: string;   // bc1q... (bech32 P2WPKH)
  ltc: string;   // ltc1q... (bech32 P2WPKH)
  xmr: string;   // 4... (95 chars, standard CryptoNote address)
  wow: string;   // Wo... (97 chars, standard CryptoNote address)
  grin: string;  // grin1... (bech32 slatepack address)
}
```

Returns `null` if not connected. Returns error if wallet is locked.

**Example:**
```javascript
const addresses = await window.smirk.getAddresses();
if (addresses) {
  console.log('WOW address:', addresses.wow);
  // Wo4cjRpBfdMXQovzJvmoBjjG8Gr7F5ZUTZAu3gFCWpNc2LrxkYtYi1CrXhfYKXWiXKghMDaSYyv1kvgvkJYG1PY527hNiV1wR
}
```

### `window.smirk.requestPayment(request)`

Request a payment from the user's wallet. Opens an approval popup showing the payment details. The user must explicitly approve each payment.

Requires prior connection (`connect()` must have been called). Grin is not supported (requires interactive slatepack exchange).

**No backend changes required** — the transaction is signed and broadcast entirely by the extension. Your website only needs to handle the returned transaction ID.

**Parameters:**

```typescript
interface PaymentRequest {
  asset: 'btc' | 'ltc' | 'xmr' | 'wow';  // Asset to send
  amount: string;    // Human-readable amount (e.g., "1.0", "0.5")
  address: string;   // Recipient address
  memo?: string;     // Optional description shown to user
}
```

**Returns:** `Promise<PaymentResult>`

```typescript
interface PaymentResult {
  txid: string;    // Transaction hash
  amount: string;  // Actual amount sent (may differ slightly for XMR/WOW due to fees)
}
```

**Errors:**
- `"Site is not connected"` — Call `connect()` first
- `"User rejected the request"` — User clicked Deny
- `"Wallet is locked"` — User needs to unlock
- `"Insufficient funds"` — Not enough balance
- `"Invalid asset"` — Must be btc, ltc, xmr, or wow
- `"Amount must be a positive number"` — Invalid amount

**Example:**

```javascript
async function payWithSmirk(amount, address) {
  // Check if Smirk is available and connected
  if (!window.smirk || !await window.smirk.isConnected()) {
    showManualPaymentModal(amount, address);
    return;
  }

  try {
    const result = await window.smirk.requestPayment({
      asset: 'wow',
      amount: String(amount),
      address: address,
      memo: 'Game credits purchase',
    });

    console.log('Payment sent! TX:', result.txid);
    onPaymentSuccess(result.txid);

  } catch (err) {
    if (err.message === 'User rejected the request') {
      // User clicked Deny — don't show an error, just do nothing
      return;
    }
    // Other errors (insufficient funds, network issue, etc.)
    console.error('Payment failed:', err.message);
    showManualPaymentModal(amount, address);
  }
}
```

**Security:**
- Every payment opens an approval popup — no silent transactions
- The popup shows the amount, asset, recipient address, and requesting site
- Private keys never leave the extension
- There is no "trust this site" for payments — every transaction requires a click

## Backend Verification

Verify signatures yourself using standard crypto libraries. This is the whole point of cryptographic authentication - no third-party dependency required.

### BTC/LTC (secp256k1 ECDSA)

Bitcoin message signing uses a specific prefix. Smirk signs with Bitcoin's standard message format.

**JavaScript (bitcoinjs-message):**
```javascript
import { verify } from 'bitcoinjs-message';

function verifyBtcSignature(message, signature, address) {
  return verify(message, address, signature);
}
```

**JavaScript (alternative with @noble/secp256k1):**
```javascript
import { verify } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

function verifyBtcSignature(message, signatureHex, publicKeyHex) {
  // Bitcoin message prefix
  const prefix = '\x18Bitcoin Signed Message:\n';
  const fullMessage = prefix + String.fromCharCode(message.length) + message;
  const msgHash = sha256(sha256(new TextEncoder().encode(fullMessage)));

  return verify(signatureHex, msgHash, publicKeyHex);
}
```

**Rust (secp256k1):**
```rust
use secp256k1::{Message, PublicKey, Secp256k1, ecdsa::Signature};
use bitcoin_hashes::{sha256d, Hash};

fn verify_btc_signature(message: &str, sig: &[u8], pubkey: &[u8]) -> bool {
    let secp = Secp256k1::verification_only();
    let prefixed = format!("\x18Bitcoin Signed Message:\n{}{}", message.len() as u8 as char, message);
    let hash = sha256d::Hash::hash(prefixed.as_bytes());
    let msg = Message::from_digest_slice(&hash[..]).unwrap();
    let signature = Signature::from_compact(sig).unwrap();
    let public_key = PublicKey::from_slice(pubkey).unwrap();
    secp.verify_ecdsa(&msg, &signature, &public_key).is_ok()
}
```

### XMR/WOW/GRIN (Ed25519)

**JavaScript (tweetnacl - lightweight, no dependencies):**
```javascript
import nacl from 'tweetnacl';

function verifyEd25519Signature(message, signatureHex, publicKeyHex) {
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  const messageBytes = new TextEncoder().encode(message);

  return nacl.sign.detached.verify(messageBytes, signature, publicKey);
}
```

**JavaScript (@noble/curves):**
```javascript
import { ed25519 } from '@noble/curves/ed25519';

function verifyEd25519Signature(message, signatureHex, publicKeyHex) {
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  const messageBytes = new TextEncoder().encode(message);

  return ed25519.verify(signature, messageBytes, publicKey);
}
```

**Rust (ed25519-dalek):**
```rust
use ed25519_dalek::{PublicKey, Signature, Verifier};

fn verify_ed25519_signature(message: &[u8], sig: &[u8], pubkey: &[u8]) -> bool {
    let public_key = PublicKey::from_bytes(pubkey).unwrap();
    let signature = Signature::from_bytes(sig).unwrap();
    public_key.verify(message, &signature).is_ok()
}
```

**Python (PyNaCl):**
```python
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignature

def verify_ed25519_signature(message: bytes, signature: bytes, public_key: bytes) -> bool:
    try:
        verify_key = VerifyKey(public_key)
        verify_key.verify(message, signature)
        return True
    except BadSignature:
        return False
```

### Hex Utility

```javascript
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
```

## Security Best Practices

### 1. Always Include Nonce and Timestamp

```javascript
const message = `Sign to login to ${siteName}

Nonce: ${randomNonce}
Time: ${isoTimestamp}`;
```

This prevents replay attacks. Reject signatures older than 5 minutes.

### 2. Verify Origin

Include your domain in the challenge message so users know what they're signing into. Verify the signature matches the expected origin.

### 3. Bind to Session

After verification, bind the user to a server-side session. Don't trust client-side state.

### 4. Handle Disconnection

When users disconnect, invalidate their session:

```javascript
window.smirk.on('disconnect', () => {
  // Clear local session, redirect to login
  logout();
});
```

## Example: Complete Login Flow

```html
<!DOCTYPE html>
<html>
<head>
  <title>Login with Smirk</title>
</head>
<body>
  <div id="app">
    <button id="login-btn" style="display: none;">
      Sign in with Smirk
    </button>
    <p id="install-prompt" style="display: none;">
      <a href="https://smirk.cash" target="_blank">Install Smirk Wallet</a> to sign in
    </p>
    <div id="user-info" style="display: none;">
      <p>Welcome, <span id="username"></span>!</p>
      <button id="logout-btn">Logout</button>
    </div>
  </div>

  <script>
    // Your backend - handles challenge generation and signature verification
    const API_BASE = 'https://your-api.com';

    // Check for Smirk on load
    window.addEventListener('load', () => {
      if (window.smirk) {
        document.getElementById('login-btn').style.display = 'block';
        checkExistingSession();
      } else {
        document.getElementById('install-prompt').style.display = 'block';
      }
    });

    // Login button click
    document.getElementById('login-btn').addEventListener('click', async () => {
      try {
        // 1. Connect
        await window.smirk.connect();

        // 2. Get challenge
        const challengeRes = await fetch(`${API_BASE}/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: window.location.origin })
        });
        const challenge = await challengeRes.json();

        // 3. Sign challenge
        const signResult = await window.smirk.signMessage(challenge.message);

        // 4. Send to your backend for verification
        const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce: challenge.nonce,
            signatures: signResult.signatures
          })
        });
        const session = await verifyRes.json();

        // 5. Store token, show user
        localStorage.setItem('token', session.token);
        showUser(session.user);

      } catch (err) {
        console.error('Login failed:', err);
        alert('Login failed: ' + err.message);
      }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await window.smirk?.disconnect();
      localStorage.removeItem('token');
      location.reload();
    });

    function showUser(user) {
      document.getElementById('login-btn').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username').textContent = user.username || 'Smirk User';
    }

    async function checkExistingSession() {
      const token = localStorage.getItem('token');
      if (token) {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const user = await res.json();
          showUser(user);
        }
      }
    }
  </script>
</body>
</html>
```

## Live Integrations

- **smirk.cash** - Primary Smirk website, dashboard and settings
- **play.wownero.ro** - Wownero roguelike game with Smirk wallet login and payments

## Support

- GitHub Issues: [github.com/Such-Software/smirk-extension/issues](https://github.com/Such-Software/smirk-extension/issues)
- Telegram: [@smirk_wallet](https://t.me/smirk_wallet)

## Changelog

- **2026-02-19**: Added `requestPayment()` for one-click payments (BTC, LTC, XMR, WOW)
- **2026-02-02**: Added `getAddresses()` and documented `getPublicKeys()`
- **2026-01-30**: Initial integration guide
- Website auth via challenge-response with ECDSA/Ed25519 signatures
