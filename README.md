# Smirk Wallet Browser Extension

Non-custodial multi-currency tip wallet for Telegram, Discord, and more.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Encrypted tips**: Tips targeted at specific users are encrypted with their public key
- **Auto-claim**: Detects tip links and offers one-click claiming

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
├── background/     # Service worker - crypto, storage, API, auto-lock (chrome.alarms)
├── content/        # Content script - detects claim pages
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
│   ├── browser.ts       # Cross-browser API abstraction (Chrome/Firefox)
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
- Backend acts as relay only - stores/forwards slatepacks, broadcasts finalized transactions

**Transaction Flow:**
1. Sender builds slate S1 (WASM) → encodes as slatepack → sends to backend relay
2. Recipient fetches slatepack → signs S2 (WASM) → sends signed slatepack to relay
3. Sender fetches signed response → finalizes S3 (WASM) → sends finalized tx to relay
4. Backend broadcasts finalized transaction to Grin network

**API:**
```typescript
import { initGrinWallet, createSendSlate, signSlate, finalizeSlate, encodeSlatepack, decodeSlatepack } from '@/lib/grin';

// Initialize wallet from BIP39 seed
const keys = await initGrinWallet(seed);
// keys.slatepackAddress - bech32-encoded address for receiving

// Send flow
const slate = await createSendSlate(keys, amount, fee, recipientAddress);
const slatepack = await encodeSlatepack(keys, slate, recipientAddress);
// POST slatepack to backend relay

// Receive flow
const decoded = await decodeSlatepack(keys, incomingSlatepack);
const signed = await signSlate(keys, incomingSlatepack);
const responseSlatepack = await encodeSlatepack(keys, signed);
// POST responseSlatepack to backend relay
```

## XMR/WOW Balance Verification

For Monero and Wownero, the backend returns `total_received` plus a list of candidate spent outputs detected by the Light Wallet Server. The extension verifies these client-side:

1. **Key image computation**: For each candidate spent output, smirk-wasm computes the expected key image using:
   - One-time private key: `x = Hs(aR || outputIndex) + b`
   - Key image: `KI = x * Hp(P)` where `Hp` is Monero's `hash_to_ec`

2. **Verification**: Only outputs where the computed key image matches the server's reported key image are counted as spent

3. **True balance**: `total_received - sum(verified_spent_amounts)`

This ensures the server cannot lie about spent funds - the balance is cryptographically verified using your private spend key, which never leaves the extension.

**Implementation**: Key image computation uses **smirk-wasm** (Rust compiled to WebAssembly) with the `monero-oxide` library for Monero's `hash_to_ec` operation. This ensures cryptographic correctness - the same implementation used by the broader Monero Rust ecosystem.
