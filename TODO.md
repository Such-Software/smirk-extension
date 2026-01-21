# Smirk Extension TODO

## High Priority

### UI/UX Improvements
- [ ] **Pop-out window feature** - Allow popping out the extension into its own standalone window (like Bitwarden does). Useful for longer operations like Grin slate exchanges.
- [ ] **Better loading states** - Show skeleton loaders instead of spinners for balance/history loading
- [ ] **Copy feedback** - Toast notification when copying addresses/txids to clipboard

### Grin Improvements
- [ ] Store kernel_excess in local storage after finalization for tx history display
- [ ] Show link to Grin block explorer once kernel_excess is available
- [ ] Better differentiation between "pending relay slates" vs "unconfirmed outputs" in UI

## Medium Priority

### General
- [ ] Transaction history for all coins (currently BTC/LTC only)
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
