# Smirk Extension TODO

## Current Priority

### High Priority

1. **RSR Flow (Receive-Sign-Return)** - Invoice flow
   - Create I1 invoice slate
   - Sender signs I1 to S2
   - Recipient finalizes S2 to S3 and broadcasts

2. **Slatepack Relay UX**
   - Auto-refresh pending list
   - Notification when slatepack arrives
   - Expiry countdown display

3. **QR Code Scanning**
   - Camera permission for address scanning

4. **Configurable Fee Levels**
   - Low/medium/high fee options for BTC/LTC

### Lower Priority

5. **Security Enhancements**
   - Biometric unlock option (where supported)
   - Require password for sensitive operations even when unlocked

6. **XMR/WOW Enhancements**
   - Show ring member info for transactions
   - Export key images for balance verification

7. **Nice to Have**
   - Address book / contacts
   - Price display in fiat currency
   - Multi-wallet support (multiple seeds)
   - Hardware wallet integration (Ledger/Trezor)
   - Firefox/Safari ports

### Code Quality

8. **Testing**
   - Unit tests for crypto operations
   - E2E tests with Playwright

13. **Documentation**
    - Add comprehensive comments to all public functions
    - Document message types and handlers

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
