# Smirk Extension TODO

## High Priority

### Website Integration (BLOCKER for smirk-website)
- [x] **Inject `window.smirk` API** - Content script that exposes API to web pages (2026-01-22)
  - [x] Content script injection on localhost and smirk.cash domains
  - [x] `window.smirk.connect()` - Return public keys for all 5 assets
  - [x] `window.smirk.signMessage(message)` - Sign with all 5 asset keys
  - [x] `window.smirk.isConnected()` - Check if site is approved
  - [x] `window.smirk.disconnect()` - Revoke site access
  - [x] `window.smirk.getPublicKeys()` - Get public keys if connected
- [x] **Approval popup UI** - User approves/denies connect and sign requests (2026-01-22)
- [x] **Origin allowlist** - Persist approved origins in storage (2026-01-22)
- [x] **Message passing** - Content script ↔ Background script for API calls (2026-01-22)
- [ ] **Settings UI** - Show/manage connected sites in settings page

### UI/UX Improvements
- [x] **Pop-out window feature** - Standalone window via ⧉ button in header (2026-01-22)
- [x] **Copy feedback** - Toast notifications for all clipboard operations (2026-01-22)
- [x] **Better loading states** - Skeleton loaders for balance/history (2026-01-22)
- [ ] **Transaction list pagination** - Show only 2-3 transactions on main screen without scrollbar, add "View All" button to open full scrollable history

### Grin Improvements
- [x] **Grin Send Flow** - UTXO selection, change output, broadcast - WORKING (2026-01-22)
- [x] **Pending display clarity** - Removed confusing "Pending" button, pending status shown inline in tx history
- [ ] Link to Grin block explorer from kernel_excess (click to open grinexplorer.net)

## Medium Priority

### General
- [ ] QR code scanning for addresses (camera permission)
- [x] Dark/light theme toggle (2026-01-22)
- [ ] Configurable fee levels (low/medium/high)

### Security
- [ ] Biometric unlock option (where supported)
- [ ] Option to require password for sensitive operations even when unlocked

### XMR/WOW
- [ ] Show ring member info for transactions
- [ ] Export key images for balance verification

## Low Priority / Nice to Have

- [ ] Address book / contacts
- [ ] Price display in fiat currency
- [ ] Multi-wallet support (multiple seeds)
- [ ] Hardware wallet integration (Ledger/Trezor)
- [ ] Firefox/Safari ports

## Technical Debt

- [ ] Break up large files (background/index.ts is very long)
- [ ] Add unit tests for crypto operations
- [ ] Add e2e tests with Playwright

## Completed (2026-01-22)

- [x] Toast notifications for clipboard copy feedback
- [x] Skeleton loaders for balance/history loading states
- [x] Pop-out window feature (⧉ button in header)
- [x] Grin send flow (SRS) - Working end-to-end
  - UTXO selection, change outputs, finalization, broadcast
  - Fixed compact slate offset handling (must NOT create offset for compact slates)
  - Fixed change output proof storage/restoration for finalization
  - Fixed push_transaction to use node Foreign API (port 3413)
- [x] Grin receive flow (direct slatepack) - Working
- [x] Transaction history for Grin (kernel_excess shown with click-to-copy)
- [x] Cancel pending send transactions from history view
- [x] Screen state persistence across popup closes
- [x] Mnemonic persistence in session storage for Grin wallet init
- [x] kernel_excess tracking in backend and display in UI
- [x] window.smirk API for website integration
  - Inject script exposes connect(), signMessage(), isConnected(), disconnect(), getPublicKeys()
  - Approval popup for connect and sign requests
  - Origin allowlist persisted to storage
  - BTC/LTC message signing with secp256k1 ECDSA
  - XMR/WOW/Grin message signing with Ed25519
