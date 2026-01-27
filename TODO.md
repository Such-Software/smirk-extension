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
- [ ] No sent tips view in extension (only Inbox for received)
- [ ] Clawback UI needs work

---

## Phase 2: Public Tips

- [ ] "Public tip" toggle in Social Tip UI
- [ ] Warning: "Anyone can claim this tip"
- [ ] Shareable link / payload copy

## Phase 3: Additional Platforms

- [ ] Discord in platform selector
- [ ] Signal / Matrix / Simplex (when backend supports)

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
