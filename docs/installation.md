# Manual Installation

For users who prefer manual installation or when store versions are pending review.

## Chrome / Brave / Edge

1. **Download** `smirk-wallet-vX.X.X.zip` from [Releases](https://github.com/Such-Software/smirk-extension/releases)
2. **Unzip** to a permanent folder (e.g., `~/Extensions/smirk-wallet/`)
   - Don't delete this folder after installing - Chrome needs it!
3. **Open Extensions page**:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
4. **Enable Developer Mode** (toggle in top-right corner)
5. **Click "Load unpacked"**
6. **Select the unzipped folder** (the one containing `manifest.json`)
7. **Done!** Click the puzzle piece icon in toolbar and pin Smirk Wallet

**Updating:** Download new zip → unzip to same folder (overwrite) → go to extensions page → click refresh icon on Smirk Wallet

## Firefox

Firefox treats manually loaded extensions as "temporary" - they disappear when Firefox restarts. For persistent installation, use Firefox Add-ons store or Firefox Developer/Nightly edition.

**Temporary install (testing):**
1. **Download** `smirk-wallet-vX.X.X.zip` and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select `manifest.json` from the unzipped folder

**Permanent install (Firefox Developer/Nightly only):**
1. Go to `about:config` → set `xpinstall.signatures.required` to `false`
2. Go to `about:addons` → gear icon → **"Install Add-on From File..."**
3. Select the `.zip` file directly
