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

## Building for Release

```bash
# Build production version
npm run build

# Create distributable zip
cd dist && zip -r ../smirk-wallet.zip . && cd ..
```

## Version Bumping

Update version in these files before release:
- `package.json` - `"version": "x.x.x"`
- `manifest.json` - `"version": "x.x.x"`

## Chrome Web Store

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

## Firefox Add-ons

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

## Safari (macOS/iOS)

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
