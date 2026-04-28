# Smirk Extension TODO

## Known Issues (Alpha)

### UX
- [x] Pending tips not reflected in balance immediately (FIXED)
- [ ] Clawback UI could be improved (confirmation flow)
- [ ] Grin fee display before confirming send

---

## WASM Build Transparency

### Current State
- GRIN WASM: Pre-built binaries from MWC Wallet Standalone zip
- Monero WASM: Built locally from smirk-wasm-monero (uses monero-oxide)
- All source repos are public and linked in README

### Phase 1: Documentation (Done)
- [x] Document WASM sources in README.md
- [x] Add build-from-source instructions to BUILDING.md
- [x] Link to Nicolas Flamel's GitHub repos

### Phase 2: Submodules (Future)
Add WASM source repos as git submodules for easier auditing:

```
smirk-extension/
├── deps/
│   ├── secp256k1-zkp-wasm/  (submodule)
│   ├── ed25519-wasm/        (submodule)
│   ├── x25519-wasm/         (submodule)
│   ├── blake2b-wasm/        (submodule)
│   └── smirk-wasm-monero/   (submodule)
```

Benefits:
- Pinned versions via commit hashes
- Easy `git diff` to see changes between releases
- CI can verify submodule commits match expected

### Phase 3: CI-built WASM (Future)
Automate WASM compilation in GitHub Actions:

1. Install Emscripten + Rust WASM target in CI
2. Build all WASM from submodules
3. Compare against committed binaries (or replace them)
4. Fail CI if WASM differs unexpectedly

This would provide reproducible builds without trusting pre-compiled binaries.

---

## Future: Additional Platforms

- [ ] Signal / Matrix / Simplex (when backend supports)

## In Progress

- [ ] Chrome Web Store submission (pending review)
- [ ] Firefox Add-ons submission (pending review)

## Lower Priority

- [ ] Safari port (requires Xcode + Apple Developer account)
- [ ] Biometric unlock (where supported)
- [ ] Address book / contacts
- [ ] Hardware wallet support

---

## Architecture Reference

### Grin Key Derivation (v3+)
```
mnemonic → BIP-39 entropy (16 bytes)
        → HMAC-SHA512("IamVoldemort", entropy) → Extended Private Key
        → Crypto.addressKey(extKey, 0) → ed25519 keypair → slatepack address
Per-output blinding: Identifier(depth=3, paths=[0,0,n_child,0])
Commitment = amount*H + blind*G
```
Pre-v3 wallets used `HMAC-SHA512("IamVoldemort", PBKDF2(mnemonic))` (MWC's BIP-39 mode); migration sweeps from old → new on first unlock after upgrade.

### n_child Management
Backend tracks `MAX(n_child)` across ALL outputs.
Extension MUST use `next_child_index` from `/wallet/grin/user/{id}/outputs`.

---

## Completed

- [x] **Sweep Retry Mechanism** (2026-02-01)
  - Two-phase claim: pending -> claiming -> claimed
  - Sweep failures can be retried, funds never stuck
  - Sender notification on successful claim
- [x] **Claimable Tips Banner** (2026-02-01)
  - Banner on main screen when tips ready to claim
  - Badge counts on History tabs (Received/Sent)
- [x] **Discord Tipping** (2026-02-01)
  - Discord added to platform selector
  - Scalable platform registry (data-driven UI)
  - Sender anonymity toggle
- [x] **Stats & Prices Panel** (2026-01-30)
  - InfoPanel component with Prices/Stats tabs
  - Live USD prices for all 5 assets
  - Tip count statistics
- [x] **HistoryView with 3 Tabs** (2026-01-30)
  - Consolidated Activity, Received Tips, Sent Tips
  - 4-button main layout (Receive, Send, Tip, History)
- [x] **UI Polish** (2026-01-30)
  - Reduced spacing/padding across all views
  - Fixed scrollbar issues on main view
- [x] **BTC/LTC Max Send Fix** (2026-01-30)
  - Proper sweep mode for entire balance
  - Fee calculation aligned with single-output transactions
- [x] **XMR/WOW Dust Fix** (2026-01-30)
  - 0.1% fee buffer when sweeping to avoid dust
- [x] **Settings Enhancements** (2026-01-30)
  - Show seed fingerprint button
  - Change password feature
  - Password strength requirement (8 char min)
- [x] **Public Tips UI** (2026-01-28)
  - Public tip toggle in Social Tip flow
  - Warning for public tips
  - Shareable link copy
- [x] **Sent Tips View** (2026-01-27)
  - Sent button on main view
  - List of tips you've created with status
- [x] **Security Hardening** (2026-01-28)
  - Signed timestamp verification on registration (proves private key ownership)
  - 256-bit seed fingerprint (increased from 64-bit)
  - Bitcoin message signing for auth
- [x] **Social Tipping MVP** (2026-01-27)
  - Telegram tipping with confirmation tracking
  - Grin vouchers (non-interactive)
  - Inbox UI with claim/pending states
- [x] **Grin Wallet** (2026-01-22)
  - SRS send, RSR invoice flows
  - Client-side WASM signing
  - Slatepack relay for Smirk-to-Smirk
- [x] **Website Integration** (2026-01-22)
  - `window.smirk` API (connect, signMessage)
  - Single-asset auth
- [x] **Infrastructure**
  - Seed fingerprint validation
  - Birthday height restore
  - 0-conf detection
