# Smirk Extension TODO

## High Priority

### UI/UX Improvements
- [ ] **Pop-out window feature** - Allow popping out the extension into its own standalone window (like Bitwarden does). Useful for longer operations like Grin slate exchanges.
- [ ] **Copy feedback** - Toast notification when copying addresses/txids/kernels to clipboard
- [ ] **Better loading states** - Show skeleton loaders instead of spinners for balance/history loading

### Grin Improvements
- [ ] **Test Grin Send Flow** - UTXO selection, change output, broadcast
- [ ] **Pending display clarity** - Differentiate "pending relay slates" vs "unconfirmed outputs" in UI
- [ ] Link to Grin block explorer from kernel_excess (click to open grinexplorer.net)

## Medium Priority

### General
- [ ] QR code scanning for addresses (camera permission)
- [ ] Dark/light theme toggle
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

## Completed (2026-01-21)

- [x] Grin receive flow (direct slatepack) - Working
- [x] Transaction history for Grin (kernel_excess shown with click-to-copy)
- [x] Screen state persistence across popup closes
- [x] Mnemonic persistence in session storage for Grin wallet init
- [x] kernel_excess tracking in backend and display in UI
