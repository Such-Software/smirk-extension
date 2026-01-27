# Smirk Wallet Browser Extension

Non-custodial multi-currency wallet for Telegram, Discord, and the web.

## Features

- **Non-custodial**: Your keys never leave your device
- **Multi-currency**: BTC, LTC, XMR, WOW, GRIN
- **Social media tipping**: Tip users by Telegram username (verify on website first)
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

## Loading in Chrome (Development)

1. Run `npm run build`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

## Distribution

### Building for Release

```bash
# Build production version
npm run build

# Create distributable zip
cd dist && zip -r ../smirk-wallet.zip . && cd ..
```

### Chrome Web Store

1. Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click "New Item" → Upload `smirk-wallet.zip`
3. Fill in listing details:
   - Name: Smirk Wallet
   - Description: Non-custodial multi-currency wallet for crypto tipping
   - Category: Productivity
   - Screenshots: 1280x800 or 640x400
   - Icon: 128x128 PNG
4. Submit for review (usually 1-3 business days)

**Note:** First submissions may take longer. Crypto extensions often get extra scrutiny.

### Firefox Add-ons

The extension uses browser-agnostic APIs and works on Firefox without changes.

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Click "Submit a New Add-on"
3. Upload `smirk-wallet.zip`
4. Firefox requires source code for review - upload the full source repo as a zip
5. Fill in listing details
6. Submit for review (usually 1-2 days)

**Testing locally on Firefox:**
```bash
# Install web-ext CLI
npm install -g web-ext

# Run in Firefox (from dist folder)
cd dist && web-ext run
```

### Safari (macOS/iOS)

Safari requires converting the extension using Xcode.

**Prerequisites:**
- macOS with Xcode installed
- Apple Developer account ($99/year for distribution)

**Steps:**
```bash
# Convert extension to Safari format
xcrun safari-web-extension-converter dist --project-location ./safari-build --app-name "Smirk Wallet"

# Open in Xcode
open safari-build/Smirk\ Wallet/Smirk\ Wallet.xcodeproj
```

Then in Xcode:
1. Select your development team
2. Build and run to test locally
3. Archive and submit to App Store Connect for review

**Note:** Safari extensions are distributed through the Mac App Store, not as standalone downloads.

### Direct Distribution (GitHub Releases)

For users who prefer manual installation or when store versions are pending review.

#### Installing from ZIP (Chrome/Brave/Edge)

1. **Download** `smirk-wallet.zip` from [Releases](https://github.com/user/smirk-extension/releases)
2. **Unzip** to a permanent folder (e.g., `~/Extensions/smirk-wallet/`)
   - ⚠️ Don't delete this folder after installing - Chrome needs it!
3. **Open Extensions page**:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
4. **Enable Developer Mode** (toggle in top-right corner)
5. **Click "Load unpacked"**
6. **Select the unzipped folder** (the one containing `manifest.json`)
7. **Done!** Click the puzzle piece icon in toolbar and pin Smirk Wallet

**Updating:** Download new zip → unzip to same folder (overwrite) → go to extensions page → click refresh icon on Smirk Wallet

#### Installing from ZIP (Firefox)

Firefox treats manually loaded extensions as "temporary" - they disappear when Firefox restarts. For persistent installation, use Firefox Add-ons store or Firefox Developer/Nightly edition.

**Temporary install (testing):**
1. **Download** `smirk-wallet.zip` and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select `manifest.json` from the unzipped folder

**Permanent install (Firefox Developer/Nightly only):**
1. Go to `about:config` → set `xpinstall.signatures.required` to `false`
2. Go to `about:addons` → gear icon → **"Install Add-on From File..."**
3. Select the `.zip` file directly

#### GitHub Release Template

```markdown
## Smirk Wallet vX.X.X

### Download
- `smirk-wallet.zip` - Manual installation (see instructions below)

### Installation (Chrome/Brave/Edge)
1. Download and unzip `smirk-wallet.zip` to a permanent folder
2. Go to `chrome://extensions` (or `brave://extensions` / `edge://extensions`)
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** → select the unzipped folder
5. Pin the extension from the puzzle piece menu

### Installation (Firefox)
1. Download and unzip `smirk-wallet.zip`
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → select `manifest.json`
   - Note: Temporary extensions reset on Firefox restart

### What's New
- Feature X
- Bug fix Y
```

### Version Bumping

Update version in these files before release:
- `package.json` - `"version": "x.x.x"`
- `manifest.json` - `"version": "x.x.x"`

## Architecture

```
src/
├── background/     # Service worker (modular)
│   ├── index.ts        # Message routing
│   ├── state.ts        # Global state, session persistence
│   ├── settings.ts     # User settings, auto-lock timer
│   ├── wallet.ts       # Wallet creation, restore, unlock/lock
│   ├── balance.ts      # Balance queries for all assets
│   ├── send.ts         # BTC/LTC transaction building
│   ├── grin-handlers.ts # Grin WASM operations
│   ├── tips.ts         # Tip decryption and claiming
│   └── smirk-api.ts    # window.smirk website integration
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

  // Request message signature (user chooses asset, shows approval popup)
  const result = await window.smirk.signMessage('Sign to authenticate');
  // Returns: { message, signature: { asset, signature, publicKey } }

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
