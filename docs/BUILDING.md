# Building & Distribution

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

## Release Process

```bash
# 1. Bump version in all files (package.json + both manifests)
./scripts/bump-version.sh 0.2.4

# 2. Commit the version bump
git add package.json manifest.json manifest.firefox.json
git commit -m "chore: bump version to 0.2.4"

# 3. Build, test, and create release artifacts (also creates the git tag)
./scripts/release.sh

# 4. Push commits and tag
git push origin main
git push origin v0.2.4
```

The release script (`scripts/release.sh`):
- Refuses to run with uncommitted changes or an existing tag
- Runs typecheck and tests
- Builds Chrome and Firefox zips
- Creates source archive for Mozilla review (via `git archive HEAD`, so include the version bump in the same commit before running)
- Creates annotated git tag
- Outputs to `releases/`:
  - `smirk-wallet-chrome-vX.Y.Z.zip`
  - `smirk-wallet-firefox-vX.Y.Z.zip`
  - `smirk-wallet-X.Y.Z-src.zip`

### Manual Testing (Optional)

```bash
# Chrome: load dist/ as unpacked extension
npm run build:chrome

# Firefox: requires web-ext CLI
npm run build:firefox && cd dist && web-ext run
```

---

## Chrome Web Store

**Dashboard:** https://chrome.google.com/webstore/devconsole

### First Submission

1. Click "New Item" → Upload `releases/smirk-wallet-chrome-vX.X.X.zip`
2. Fill in listing details:
   - **Name:** Smirk Wallet
   - **Summary:** Non-custodial multi-currency wallet for crypto tipping
   - **Category:** Productivity
   - **Language:** English
3. Upload assets:
   - **Icon:** 128x128 PNG (use `icons/icon128.png`)
   - **Screenshots:** 1280x800 or 640x400 PNG
   - **Promo tile:** 440x280 PNG (optional)
4. Privacy practices:
   - Single purpose: "Cryptocurrency wallet and tipping"
   - No remote code, no data collection
5. Submit for review

**Review time:** 1-3 business days (crypto extensions may take longer)

### Updates

1. Go to existing extension → "Package" tab
2. Upload new zip
3. Update "What's new" description
4. Submit for review

---

## Firefox Add-ons

**Dashboard:** https://addons.mozilla.org/developers/

### Why a Separate Manifest?

Firefox MV3 has key differences from Chrome MV3:
- Background page is `background.scripts: ["background.js"]` with `type: "module"` (Chrome uses `background.service_worker: "background.js"`)
- Requires `browser_specific_settings.gecko.data_collection_permissions` declaring data-collection scope (we use `["none"]`)
- Requires `browser_specific_settings.gecko.id` (we use `wallet@smirk.cash`)

`strict_min_version` is a Gecko-only field and is not currently set on the Firefox manifest — pin it under `browser_specific_settings.gecko.strict_min_version` if you ever need to require a minimum Firefox version.

### First Submission

1. Click "Submit a New Add-on"
2. Select "On this site" for distribution
3. Upload `releases/smirk-wallet-firefox-vX.X.X.zip`
4. **Source code required:** Upload `releases/smirk-wallet-X.X.X-src.zip`
   - This archive includes `docs/SOURCE_CODE_REVIEW.md` with complete build-from-source instructions for Mozilla reviewers
5. Fill in listing details
6. Submit for review

**Review time:** 1-2 days

### Validation Warnings

Some warnings are expected and can be noted in review:

- **Function constructor warnings** (eval): From WASM crypto libraries - unavoidable for WebAssembly
- **innerHTML warning**: From Preact rendering - safe, no user input

### Testing Locally

```bash
# Install web-ext CLI (one time)
npm install -g web-ext

# Build and run in Firefox
npm run build:firefox
cd dist && web-ext run
```

### Updates

1. Go to existing add-on → "Manage" → "Upload New Version"
2. Upload `releases/smirk-wallet-firefox-vX.X.X.zip` + `releases/smirk-wallet-X.X.X-src.zip`
3. Submit for review

---

## Safari (macOS/iOS)

Safari requires converting the extension using Xcode and distributing through the Mac App Store.

**Prerequisites:**
- macOS with Xcode installed
- Apple Developer account ($99/year for distribution)

### Build Steps

```bash
# Build for Chrome first (Safari converter uses Chrome manifest format)
npm run build:chrome

# Convert to Safari extension
xcrun safari-web-extension-converter dist \
  --project-location ./safari-build \
  --app-name "Smirk Wallet"

# Open in Xcode
open safari-build/Smirk\ Wallet/Smirk\ Wallet.xcodeproj
```

### In Xcode

1. Select your development team in project settings
2. Build and run to test locally
3. Enable extension in Safari → Preferences → Extensions
4. Test all functionality
5. Archive and submit to App Store Connect

**Note:** Safari extensions are distributed through the Mac App Store, not as standalone downloads.

---

## Troubleshooting

### Chrome: "Service worker registration failed"
- Check `background.js` exists in `dist/`
- Check for syntax errors in background code
- Check Chrome console for errors

### Firefox: "service_worker is not supported"
- Make sure you're using `manifest.firefox.json` (npm run build:firefox)
- Check `background.scripts` is used instead of `background.service_worker`

### Icons not showing
- Verify icon sizes match manifest declarations
- icon16.png = 16x16, icon48.png = 48x48, icon128.png = 128x128

### WASM not loading
- Check CSP in manifest: `'wasm-unsafe-eval'` is required
- Check WASM files are in `web_accessible_resources`

---

## WASM Dependencies

The extension uses WebAssembly for client-side cryptographic operations.

### Pre-built Binaries (Default)

The repository includes pre-built WASM binaries in `src/lib/grin/` for convenience. These are copied from:
- **GRIN libraries**: [MWC Wallet Standalone](https://github.com/NicolasFlamel1/MWC-Wallet-Standalone)
- **Monero library**: Built from [smirk-wasm-monero](https://github.com/Such-Software/smirk-wasm-monero)

### Building GRIN WASM from Source

Each library can be compiled from C/C++ source using Emscripten:

```bash
# Example: Build secp256k1-zkp
git clone https://github.com/NicolasFlamel1/Secp256k1-zkp-WASM-Wrapper
cd Secp256k1-zkp-WASM-Wrapper
npm install
npm run prepublishOnly  # Downloads C source and compiles with Emscripten
# Output: secp256k1-zkp-*.wasm, secp256k1-zkp-*.js
```

Repeat for Ed25519, X25519, and BLAKE2b using their respective repos:
- https://github.com/NicolasFlamel1/Ed25519-WASM-Wrapper
- https://github.com/NicolasFlamel1/X25519-WASM-Wrapper
- https://github.com/NicolasFlamel1/BLAKE2b-WASM-Wrapper

### Building Monero WASM from Source

```bash
# Prerequisites
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli

# Clone and build
git clone https://github.com/Such-Software/smirk-wasm-monero
cd smirk-wasm-monero
git submodule update --init  # Gets monero-oxide

# Build WASM
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/smirk_wasm.wasm

# Output: pkg/smirk_wasm_bg.wasm, pkg/smirk_wasm.js
```

### Integrating Updated WASM

After building, copy files to the extension:

```bash
# GRIN WASM (from each wrapper repo)
cp secp256k1-zkp-*.wasm secp256k1-zkp-*.js ../smirk-extension/src/lib/grin/
cp Ed25519-*.wasm Ed25519-*.js ../smirk-extension/src/lib/grin/
cp X25519-*.wasm X25519-*.js ../smirk-extension/src/lib/grin/
cp BLAKE2b-*.wasm BLAKE2b-*.js ../smirk-extension/src/lib/grin/

# Monero WASM (Vite copies from ../smirk-wasm-monero/pkg/ during build)
```

### Verifying WASM Binaries

To verify pre-built binaries match source:

1. Build from source using steps above
2. Compare SHA256 hashes:
   ```bash
   sha256sum src/lib/grin/*.wasm
   sha256sum ../smirk-wasm-monero/pkg/*.wasm
   ```

**Note:** WASM compilation is not fully deterministic. Minor differences may exist due to compiler versions, but functionality should be identical.
