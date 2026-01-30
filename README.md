# Smirk Wallet Browser Extension

Non-custodial multi-currency wallet for Telegram, Discord, and the web.

## Download

- [GitHub Releases](https://github.com/Such-Software/smirk-extension/releases) - Manual install
- Chrome Web Store - Coming soon

See [docs/installation.md](docs/installation.md) for installation instructions.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Social media tipping**: Tip users by Telegram username
- **Encrypted tips**: Tips targeted at specific users are encrypted with their public key
- **Website integration**: `window.smirk` API for web apps (like MetaMask's `window.ethereum`)

## Architecture

```
src/
├── background/     # Service worker (modular)
│   ├── index.ts        # Message routing
│   ├── state.ts        # Global state, session persistence
│   ├── wallet.ts       # Wallet creation, restore, unlock/lock
│   ├── balance.ts      # Balance queries for all assets
│   ├── send.ts         # BTC/LTC transaction building
│   ├── grin-handlers.ts # Grin WASM operations
│   └── tips.ts         # Tip decryption and claiming
├── content/        # Content script - injects window.smirk
├── inject/         # Injected script - window.smirk API implementation
├── popup/          # Main UI (Preact components)
├── lib/
│   ├── crypto.ts        # BIP39, BIP44 key derivation
│   ├── xmr-tx.ts        # XMR/WOW transaction signing via WASM
│   ├── btc-tx.ts        # BTC/LTC transaction signing
│   ├── grin/            # Grin wallet (client-side WASM)
│   └── api.ts           # Backend API client
└── types/          # TypeScript types
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
| XMR | ed25519 | View key registered with LWS |
| WOW | ed25519 | Same as XMR |
| GRIN | secp256k1 | Interactive transactions via slatepack |

## Website Integration (window.smirk API)

The extension injects a `window.smirk` API into web pages:

```typescript
if (window.smirk) {
  // Request connection (shows approval popup)
  const publicKeys = await window.smirk.connect();
  // Returns: { btc, ltc, xmr, wow, grin }

  // Request message signature
  const result = await window.smirk.signMessage('Sign to authenticate');
  // Returns: { message, signatures: [{ asset, signature, publicKey }] }

  // Disconnect
  await window.smirk.disconnect();
}
```

## Development

See [docs/building.md](docs/building.md) for build instructions and store submission guides.

## License

MIT
