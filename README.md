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
├── background/     # Service worker - handles crypto, storage, API
├── content/        # Content script - detects claim pages
├── popup/          # Main UI (Preact)
├── lib/
│   ├── crypto.ts   # Cryptographic utilities
│   ├── api.ts      # Backend API client
│   └── storage.ts  # Chrome storage helpers
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
| BTC | secp256k1 | Watch-only addresses via pruned node |
| LTC | secp256k1 | Same as BTC |
| XMR | ed25519 | View key registered with LWS |
| WOW | ed25519 | Same as XMR |
| GRIN | ed25519 | Slatepack addresses |
