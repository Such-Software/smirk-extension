# Smirk Wallet Browser Extension

Non-custodial multi-currency wallet for Telegram, Discord, and the web.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Encrypted tips**: Tips targeted at specific users are encrypted with their public key
- **Website integration**: `window.smirk` API for web apps (like MetaMask's `window.ethereum`)
- **Seed protection**: Only wallets created in Smirk can be restored - external seeds are rejected

## Development

```bash
# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck
```

## Loading in Chrome

1. Run `npm run build`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `smirk-extension` folder

## Architecture

```
src/
├── background/     # Service worker - crypto, storage, API, auto-lock
├── content/        # Content script - detects claim pages, injects window.smirk
├── inject/         # Injected script - window.smirk API implementation
├── popup/          # Main UI (Preact)
├── lib/
│   ├── crypto.ts        # BIP39, BIP44 key derivation (secp256k1, ed25519)
│   ├── xmr-tx.ts        # XMR/WOW transaction signing via smirk-wasm
│   ├── monero-crypto.ts # XMR/WOW key image verification (calls smirk-wasm)
│   ├── btc-tx.ts        # BTC/LTC transaction signing
│   ├── grin/            # Grin wallet (client-side WASM)
│   │   ├── index.ts         # TypeScript API wrapper
│   │   ├── esm/init.ts      # ES module loader for MWC wallet
│   │   ├── *.wasm           # secp256k1-zkp, Ed25519, X25519, BLAKE2b
│   │   └── *.js             # MWC wallet JS files
│   ├── api.ts           # Backend API client
│   ├── browser.ts       # Cross-browser API abstraction
│   └── storage.ts       # Chrome storage helpers
└── types/          # TypeScript types

dist/wasm/          # smirk-wasm compiled to WebAssembly
├── smirk_wasm.js       # JS bindings
└── smirk_wasm_bg.wasm  # WASM binary
```

## Security Model

1. **Password-protected keys**: All private keys are encrypted with your password
2. **Keys never leave extension**: Crypto operations happen in the background script
3. **ECDH for encrypted tips**: Sender uses recipient's public key for encryption
4. **URL fragment for public tips**: Key in `#fragment` never sent to server
5. **Seed fingerprint validation**: Only Smirk-created wallets can restore

## Supported Chains

| Chain | Key Type | Notes |
|-------|----------|-------|
| BTC | secp256k1 (BIP44) | Balance via Electrum |
| LTC | secp256k1 (BIP44) | Balance via Electrum |
| XMR | ed25519 | View key registered with LWS, client-side key image verification |
| WOW | ed25519 | Same as XMR |
| GRIN | secp256k1 | Interactive transactions via slatepack, client-side WASM |

## Grin Wallet (Client-side WASM)

Grin uses Mimblewimble with interactive transactions. All cryptographic operations happen **client-side** in WebAssembly - keys never touch the backend.

**Architecture:**
- Based on [MWC Wallet](https://github.com/NicolasFlamel1/MWC-Wallet-Standalone) (MIT License)
- WASM modules: secp256k1-zkp (ZK proofs), Ed25519 (addresses), X25519 (encryption), BLAKE2b (hashing)
- Backend stores outputs/balances and provides slatepack relay for Smirk-to-Smirk transfers

**Send Flow (SRS):**
1. Select UTXOs and build S1 slate (client-side WASM)
2. Encode as slatepack and send to recipient (manual paste or relay)
3. Recipient signs S2 (client-side WASM)
4. Receive S2 back, finalize S3 (client-side WASM)
5. Broadcast to network

**Receive Flow:**
1. Receive S1 slatepack from sender
2. Sign S2 (client-side WASM) - creates output commitment
3. Return S2 to sender for finalization
4. Balance updates after confirmation

**API:**
```typescript
import { initGrinWallet, signSlate, encodeSlatepack } from '@/lib/grin';

// Initialize wallet from mnemonic
const keys = await initGrinWallet(mnemonic);
// keys.slatepackAddress - bech32-encoded address for receiving

// Receive flow
const { slate, outputInfo } = await signSlate(keys, incomingSlatepack);
const responseSlatepack = await encodeSlatepack(keys, slate, 'response');
```

## Website Integration (window.smirk API)

The extension injects a `window.smirk` API into web pages, enabling websites to request wallet connections and signatures (similar to MetaMask's `window.ethereum`).

**API:**
```typescript
// Check if extension is installed
if (window.smirk) {
  // Request connection (shows approval popup)
  const publicKeys = await window.smirk.connect();
  // Returns: { btc, ltc, xmr, wow, grin } - public keys for all assets

  // Check if already connected
  const connected = await window.smirk.isConnected();

  // Get public keys (only works if already connected)
  const keys = await window.smirk.getPublicKeys();

  // Request message signature (shows approval popup)
  const result = await window.smirk.signMessage('Sign to authenticate');
  // Returns: { message, signatures: [{ asset, signature, publicKey }, ...] }

  // Disconnect (revoke site access)
  await window.smirk.disconnect();
}
```

**Signature Types:**
- BTC/LTC: ECDSA (secp256k1) with Bitcoin message signing format
- XMR/WOW: Ed25519 using private spend key
- Grin: Ed25519 using slatepack key

**Security:**
- User must approve each connection and signature request
- Connected origins are persisted to storage
- Sites cannot access private keys or send transactions without explicit approval

## XMR/WOW Balance Verification

For Monero and Wownero, the backend returns `total_received` plus a list of candidate spent outputs detected by the Light Wallet Server. The extension verifies these client-side:

1. **Key image computation**: For each candidate spent output, smirk-wasm computes the expected key image using:
   - One-time private key: `x = Hs(aR || outputIndex) + b`
   - Key image: `KI = x * Hp(P)` where `Hp` is Monero's `hash_to_ec`

2. **Verification**: Only outputs where the computed key image matches the server's reported key image are counted as spent

3. **True balance**: `total_received - sum(verified_spent_amounts)`

This ensures the server cannot lie about spent funds - the balance is cryptographically verified using your private spend key, which never leaves the extension.
