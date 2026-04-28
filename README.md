# Smirk Wallet Browser Extension

Non-custodial multi-currency wallet for Telegram, Discord, and the web.

## Download

- [GitHub Releases](https://github.com/Such-Software/smirk-extension/releases) - Manual install
- Chrome Web Store - Coming soon

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for installation instructions.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Social media tipping**: Tip users by Telegram or Discord username
- **Encrypted tips**: Tips targeted at specific users are encrypted with their public key
- **Website integration**: `window.smirk` API for web apps (like MetaMask's `window.ethereum`)
- **Auto-lock**: Wallet locks after a configurable idle period (default 15 min)
- **In-place key migration**: Wallets created on older versions can upgrade to current BIP-44 derivation (Cake Wallet / grin-wallet compatible) without losing funds — the extension sweeps balances to the new addresses automatically

## Architecture

```
src/
├── background/     # Service worker (modular)
│   ├── index.ts        # Message routing
│   ├── state.ts        # Global state, session persistence
│   ├── settings.ts     # Settings + auto-lock timer
│   ├── balance.ts      # Balance queries for all assets
│   ├── send.ts         # BTC/LTC transaction building
│   ├── tips.ts         # Tip decryption and claiming
│   ├── migration.ts    # v1/v2 → v3 key migration orchestration
│   ├── recovery.ts     # Manual fund recovery from old derivations
│   ├── smirk-api.ts    # window.smirk API implementation
│   ├── wallet/         # Wallet lifecycle
│   │   ├── create.ts       # Mnemonic generation, wallet creation
│   │   ├── restore.ts      # Wallet restoration
│   │   ├── session.ts      # Unlock/lock, auth, reconcileUserKeys
│   │   ├── registration.ts # Backend / LWS registration + reconciliation
│   │   ├── addresses.ts    # Address derivation per asset
│   │   ├── state.ts        # In-memory unlocked-key maps
│   │   ├── types.ts        # Wallet-internal types
│   │   └── security.ts     # Seed reveal, password change
│   ├── grin/           # Grin WASM operations
│   │   ├── send.ts         # Send flow (create, finalize)
│   │   ├── receive.ts      # Sign incoming slatepacks
│   │   ├── invoice.ts      # RSR invoice flow
│   │   ├── relay.ts        # Slatepack relay via backend
│   │   ├── backend.ts      # Backend output-tracking helpers
│   │   ├── cancel.ts       # Cancel pending sends
│   │   ├── helpers.ts      # Shared internals
│   │   └── init.ts         # WASM bootstrap
│   ├── social/         # Social tipping
│   │   ├── create.ts       # Tip creation
│   │   ├── claim.ts        # Tip claiming
│   │   ├── sweep.ts        # Unified sweep logic
│   │   ├── crypto.ts       # Per-tip ephemeral key derivation
│   │   ├── lookup.ts       # Recipient lookup by social handle
│   │   └── types.ts        # Social-tip types
├── content/        # Content script - injects window.smirk
├── inject/         # Injected script - window.smirk API implementation
├── popup/          # Main UI (Preact components)
├── lib/
│   ├── hd.ts            # BIP39, BIP32/44, SLIP-10 key derivation (v1/v2/v3)
│   ├── crypto.ts        # PBKDF2, XChaCha20-Poly1305, signing primitives
│   ├── xmr-tx.ts        # XMR/WOW transaction signing via WASM
│   ├── btc-tx.ts        # BTC/LTC transaction signing
│   ├── address.ts       # Cryptonote (XMR/WOW) and bech32 (Grin) address codecs
│   ├── grin/            # Grin wallet (client-side WASM)
│   └── api/             # Backend API client (modular)
│       ├── client.ts        # Base HTTP client, retry, timeout
│       ├── parse.ts         # Response validation, snake→camel
│       ├── auth.ts          # Authentication, restore, migrate-keys
│       ├── keys.ts          # User key registration + lookup
│       ├── social.ts        # Social tipping methods
│       ├── grin.ts          # Grin wallet methods
│       ├── wallet-lws.ts    # XMR/WOW light wallet methods
│       └── index.ts         # Combined API client
├── scripts/        # One-off utilities (recover-broken-v3.ts, etc.)
└── types/          # TypeScript types
```

## Security Model

1. **Password-protected keys**: All private keys are encrypted with your password
2. **Keys never leave extension**: Crypto operations happen in the background script
3. **ECDH for encrypted tips**: Sender uses recipient's public key for encryption
4. **URL fragment for public tips**: Key in `#fragment` never sent to server

## Supported Chains

| Chain | Derivation (v3) | Notes |
|-------|-----------------|-------|
| BTC | BIP-44 secp256k1 `m/44'/0'/0'/0/0` | Balance via Electrum |
| LTC | BIP-44 secp256k1 `m/44'/2'/0'/0/0` | Balance via Electrum |
| XMR | BIP-32 secp256k1 `m/44'/128'/0'/0/0`, key bytes read LE and reduced mod ed25519 ℓ | Cake Wallet compatible. View key registered with monero-lws |
| WOW | BIP-32 secp256k1 `m/44'/2086'/0'/0/0`, same scalar reduction as XMR | View key registered with wownero-lws |
| GRIN | `HMAC-SHA512("IamVoldemort", raw_16_byte_entropy)` then `Crypto.addressKey(extKey, 0)` (ed25519) | grin-wallet / Grim compatible. Slatepack-only, no on-chain address |

See [docs/KEYS_AND_ACCOUNTS.md](docs/KEYS_AND_ACCOUNTS.md) for full derivation history (v1, v2, v3) and recovery instructions.

## WASM Dependencies

Cryptographic operations run client-side via WebAssembly. All keys stay in your browser.

### GRIN Libraries
From [Nicolas Flamel's MWC Wallet](https://github.com/NicolasFlamel1/MWC-Wallet-Standalone):

| Library | Source | Purpose |
|---------|--------|---------|
| secp256k1-zkp | [GitHub](https://github.com/NicolasFlamel1/Secp256k1-zkp-NPM-Package) | Elliptic curve + zero-knowledge proofs |
| Ed25519 | [GitHub](https://github.com/NicolasFlamel1/Ed25519-NPM-Package) | Digital signatures |
| X25519 | [GitHub](https://github.com/NicolasFlamel1/X25519-NPM-Package) | Key exchange |
| BLAKE2b | [GitHub](https://github.com/NicolasFlamel1/BLAKE2b-NPM-Package) | Cryptographic hashing |

### Monero/Wownero
Custom WASM built from Rust:

| Library | Source | Purpose |
|---------|--------|---------|
| smirk-wasm-monero | [GitHub](https://github.com/Such-Software/smirk-wasm-monero) | Transaction signing, key images |
| monero-oxide | [GitHub](https://github.com/Such-Software/monero-oxide) | Monero protocol implementation |

All source code is open. See [docs/BUILDING.md](docs/BUILDING.md) for compilation instructions.

## Website Integration (window.smirk API)

The extension injects a `window.smirk` API into web pages. Users can disable the injection per-extension in Settings ("Disable web API"); sites should always feature-detect.

```typescript
if (window.smirk) {
  // Request connection. Pass a list of assets to scope the approval; the
  // user is shown which assets you are asking for, and only those keys
  // are returned. Calling without args is allowed but discouraged — it
  // prompts the user to approve all assets.
  const publicKeys = await window.smirk.connect(['btc', 'xmr']);
  // Returns: { btc, xmr } — only the requested, approved assets

  // Request message signature
  const result = await window.smirk.signMessage('Sign to authenticate');
  // Returns: { message, signatures: [{ asset, signature, publicKey }] }

  // Request a payment (shows confirmation popup; user reviews + approves)
  const tx = await window.smirk.requestPayment({ asset: 'btc', amount: '0.001', address: '...' });

  // Disconnect
  await window.smirk.disconnect();
}
```

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the full API surface, error codes, and UX expectations.

## Development

See [docs/BUILDING.md](docs/BUILDING.md) for build instructions and store submission guides.

## Community

- [Telegram](https://t.me/smirkwallet)
- [Discord](https://discord.gg/7EnsaWTm6C)
- [GitHub Issues](https://github.com/Such-Software/smirk-extension/issues)

## License

MIT
