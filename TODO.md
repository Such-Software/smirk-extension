# Smirk Extension TODO

See [smirk-backend/docs/SOCIAL_TIPPING.md](../smirk-backend/docs/SOCIAL_TIPPING.md) for full architecture.

## Phase 1: Social Tipping MVP (Telegram) ✅

Completed 2026-01-26. See Completed section below.

## Balance UX Issues

### Pending Tips Not Reflected in Balance
When a tip is created, the sender's balance should immediately reflect the deduction:
- [ ] Track pending outgoing tips locally
- [ ] Subtract pending tips from "available balance" display
- [ ] Show pending tips separately (similar to pending Grin txs)
- [ ] Update balance display when tip is claimed or clawed back

Currently: Balance only updates when tx confirms (~1 min), confusing for sender.

### Tip Status Display
- [ ] Show pending tips in sender's wallet UI (not just claimable inbox)
- [ ] Show clawback option for unclaimed tips
- [ ] Clear indication when tip has been claimed vs still pending

## Phase 1.5: Grin Social Tips (Vouchers) ✅

Completed 2026-01-26. Uses non-interactive voucher model:
- [x] Grin voucher generation (single-party transaction)
- [x] Sender creates voucher output with known blinding factor
- [x] Blinding factor encrypted with recipient's BTC pubkey (ECIES)
- [x] Recipient claims via non-interactive sweep (controls both blinds)
- [x] Clawback support (sender sweeps with stored blinding factor)

See `src/lib/grin/voucher.ts` for implementation.

## Phase 2: Public Tips

- [ ] "Public tip" toggle in Social Tip UI
- [ ] Warning: "Anyone can claim this tip"
- [ ] Options after creation:
  - "Drop in Smirk channel" → backend announces
  - "Copy shareable link" → URL with fragment
  - "Copy payload" → slatepack-like envelope (if we support it)
- [ ] Success screen shows shareable link/payload

## Phase 3: Additional Platforms

- [ ] Enable Discord in platform selector
- [ ] Enable Signal (when backend supports)
- [ ] Enable Simplex (when backend supports)
- [ ] Enable Matrix (when backend supports)

## Lower Priority

### Security Enhancements
- [ ] Biometric unlock option (where supported)
- [ ] Require password for sensitive operations even when unlocked

### XMR/WOW Enhancements
- [ ] Show ring member info for transactions
- [ ] Export key images for balance verification

### Nice to Have
- [ ] Address book / contacts
- [ ] Price display in fiat currency
- [ ] Multi-wallet support (multiple seeds)
- [ ] Hardware wallet integration (Ledger/Trezor)
- [ ] Firefox/Safari ports

### Code Quality
- [ ] Unit tests for crypto operations
- [ ] E2E tests with Playwright
- [ ] Add comprehensive comments to all public functions
- [ ] Document message types and handlers

---

## Architecture Reference

### Grin Key Derivation

```
mnemonic (12 words)
    ↓
MWC Seed class (BIP39)
    ↓
Extended Private Key (HMAC key = "IamVoldemort")
    ↓
Per-output key derivation:
  - Identifier: depth=3, paths=[0, 0, n_child, 0]
  - Crypto.commit(extPrivKey, amount, identifier, SWITCH_TYPE_REGULAR)
    ↓
  Pedersen commitment = amount*H + blind*G
```

### n_child Index Management

**CRITICAL**: Never reuse n_child for same user!

- Backend tracks `MAX(n_child)` across ALL outputs (including spent)
- Returns `next_child_index` from `/wallet/grin/user/{id}/outputs`
- Extension MUST use this value for new outputs

### SRS vs RSR Flows

**SRS (Sender-Receiver-Sender)** - Standard flow:
```
Sender creates S1 → Recipient signs S2 → Sender finalizes S3 + broadcasts
```

**RSR (Receiver-Sender-Receiver)** - Invoice flow:
```
Recipient creates I1 → Sender signs S2 → Recipient finalizes S3 + broadcasts
```

---

## Completed

- [x] Grin voucher social tips (2026-01-26)
  - Non-interactive voucher model (single-party transaction)
  - `createGrinVoucherTransaction()` builds complete tx sender can sign alone
  - `claimGrinVoucher()` sweeps voucher to claimer's wallet
  - Blinding factor encrypted with ECIES (same as other assets)
  - Clawback uses same flow as claiming
- [x] Social tipping MVP for BTC/LTC/XMR/WOW (2026-01-26)
  - Real fund transfers via ephemeral tip addresses
  - ECIES encryption of tip private keys with recipient's pubkey
  - Local storage of tip keys for sender clawback capability
  - Inbox UI for claiming tips with sweep transactions
  - XMR/WOW use random spend keys, derive view keys via SHA256
- [x] Grin RSR invoice flow (2026-01-25)
  - Uses standard slatepack format compatible with grin-wallet
  - Receiver creates I1 via "Request" tab in Receive screen
  - Sender signs via "Pay Invoice" tab in Send screen
  - Receiver finalizes and broadcasts via "Request" tab
  - State byte patching (I1→S1, I2→S2) for WASM compatibility
- [x] Block explorer links for all assets (2026-01-25)
  - BTC: mempool.space, LTC: litecoinspace.org
  - XMR: monerohash.com, WOW: explore.wowne.ro
  - GRIN: grincoin.org/kernel/{excess}
- [x] Configurable fee levels (2026-01-25)
  - Slow/Normal/Fast presets for BTC/LTC
  - Custom sat/vB input option
- [x] Slatepack Relay UX (2026-01-25)
  - GrinPendingBanner shows pending receive state
  - Expiry countdown display already implemented
  - Pending txs visible quickly via mempool API
- [x] Connected sites management UI (2026-01-25)
  - Show connected sites in Settings
  - Disconnect individual sites
- [x] Transaction list pagination (2026-01-25)
  - Show 3 transactions by default
  - "View All" button to expand
- [x] Grin kernel explorer link (2026-01-25)
  - Click to open grincoin.org/kernel/{excess}
- [x] Refactor api.ts and WalletView.tsx (2026-01-25)
  - Split api.ts (900 lines) into 8 modules under src/lib/api/
  - Split WalletView.tsx (665 lines) into wallet/ components
  - Split grin/index.ts (1473 lines) into 8 modules
- [x] Website single-asset auth (2026-01-25)
  - User chooses favorite coin to sign with
  - Ed25519 signing fixed to use raw scalars (not seeds)
  - ECDSA signing with Bitcoin message format
- [x] Wallet restore with original start heights (2026-01-24)
  - API passes xmr/wow heights on wallet creation
  - Restore uses stored heights instead of current heights
  - Fixes LWS scanning from correct start point
- [x] Refactor background/index.ts into modules (2026-01-23)
  - `background/state.ts` - Global state, session persistence, pending txs
  - `background/settings.ts` - User settings, auto-lock timer
  - `background/wallet.ts` - Wallet creation, restore, unlock/lock
  - `background/balance.ts` - Balance queries for all assets
  - `background/send.ts` - BTC/LTC transaction building
  - `background/grin-handlers.ts` - Grin WASM operations
  - `background/tips.ts` - Tip decryption and claiming
  - `background/smirk-api.ts` - window.smirk website integration
  - `background/index.ts` - Message routing only
- [x] Seed fingerprint & restore enforcement (2026-01-23)
- [x] User ID passed to LWS registration (2026-01-23)
- [x] Light mode styling fixes (2026-01-23)
- [x] Pending mnemonic recovery on service worker restart (2026-01-23)
- [x] window.smirk API for website integration (2026-01-22)
- [x] Grin send flow (SRS) - Working end-to-end (2026-01-22)
- [x] Grin receive flow (direct slatepack) - Working (2026-01-20)
- [x] kernel_excess tracking and display (2026-01-22)
- [x] Cancel pending send transactions (2026-01-22)
- [x] Pop-out window feature (2026-01-22)
- [x] Toast notifications for clipboard copy (2026-01-22)
- [x] Skeleton loaders for balance/history (2026-01-22)
- [x] Dark/light theme toggle (2026-01-22)
- [x] Screen state persistence across popup closes (2026-01-22)
