# Installation Guide

Manual installation for when store versions are pending review.

Each tagged release publishes three artifacts on [GitHub Releases](https://github.com/Such-Software/smirk-extension/releases):

- `smirk-wallet-chrome-vX.X.X.zip` — Chrome / Brave / Edge build
- `smirk-wallet-firefox-vX.X.X.zip` — Firefox build (different manifest, MV2 background page)
- `smirk-wallet-X.X.X-src.zip` — reproducible source archive (Mozilla source-review submission)

## Chrome / Brave / Edge

1. **Download** `smirk-wallet-chrome-vX.X.X.zip` from [GitHub Releases](https://github.com/Such-Software/smirk-extension/releases)
2. **Unzip** to a permanent folder (e.g., `~/Extensions/smirk-wallet/`)
   > Don't delete this folder — Chrome needs it on disk to run the extension
3. Open `chrome://extensions` / `brave://extensions` / `edge://extensions`
4. Enable **Developer Mode** (toggle in top-right)
5. Click **Load unpacked** and select the unzipped folder
6. **Pin to toolbar:**
   - Click the puzzle piece icon in the toolbar
   - Find "Smirk Wallet" and click the pin icon

**Updating:** Download new zip, unzip to same folder (overwrite), go to Extensions page, click refresh icon on Smirk Wallet

## Firefox

> Firefox treats manually-loaded extensions as temporary - they disappear on restart.
> For persistent use, wait for Firefox Add-ons store approval or use Firefox Developer Edition.

**Temporary install (for testing):**
1. Download `smirk-wallet-firefox-vX.X.X.zip` and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on...**
4. Select `manifest.json` from the unzipped folder

**Persistent install (Developer/Nightly only):**
1. Go to `about:config` and set `xpinstall.signatures.required` to `false`
2. Go to `about:addons`, click gear icon, then **Install Add-on From File...**
3. Select `smirk-wallet-firefox-vX.X.X.zip` directly

⚠️ **Alpha Release** - Use with small amounts while testing.

## Safari

Not yet supported. Safari requires Xcode conversion and Apple Developer account.

## Store Versions

- **Chrome Web Store** - Coming soon (in review)
- **Firefox Add-ons** - Coming soon (in review)
