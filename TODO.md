# Smirk Extension TODO

## Known Issues (Alpha Blockers)

### Fee Calculation / Max Send
- [ ] **BTC/LTC Max Send**: Max button fails with "Insufficient funds"
  - `maxSendable()` estimates for 1 output, `selectUtxos()` for 2 outputs
  - Need sweep mode: single output, no change, recalculate fee
- [ ] **XMR/WOW Max Send Dust**: Sweep leaves tiny dust balance
  - Fee estimation slightly off
- [ ] **Grin Fee Display**: Should show fee before confirming send

### UX
- [ ] Pending tips not reflected in balance immediately
- [ ] Clawback UI needs work
- [ ] Main view is crowded (5 action buttons + activity list)

---

## Phase 2: Public Tips

- [x] "Public tip" toggle in Social Tip UI
- [x] Warning: "Anyone can claim this tip"
- [x] Shareable link / payload copy

## Phase 3: Additional Platforms

- [ ] Discord in platform selector
- [ ] Signal / Matrix / Simplex (when backend supports)

## Security

- [x] **Password strength requirement**: Minimum 8 characters (change password modal)

## Lower Priority

- [ ] Biometric unlock (where supported)
- [ ] Address book / contacts
- [ ] Fiat price display
- [ ] Firefox/Safari ports
- [ ] Hardware wallet support

---

## Architecture Reference

### Grin Key Derivation
```
mnemonic → MWC Seed → Extended Private Key
Per-output: Identifier(depth=3, paths=[0,0,n_child,0])
Commitment = amount*H + blind*G
```

### n_child Management
Backend tracks `MAX(n_child)` across ALL outputs.
Extension MUST use `next_child_index` from `/wallet/grin/user/{id}/outputs`.

---

## Completed

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
