# Smirk Extension TODO

## Current Priority

### High Priority

1. **Refactor Large Files**
   - `src/lib/grin/index.ts` (1473 lines)
   - `src/lib/api.ts` (892 lines)
   - `src/popup/components/WalletView.tsx` (665 lines)

2. **Settings UI - Connected Sites**
   - Show/manage connected sites in settings page
   - Allow revoking individual site access

3. **Grin Block Explorer Link**
   - Click kernel_excess to open grinexplorer.net/kernel/{excess}

### Medium Priority

4. **Transaction List Pagination**
   - Show only 2-3 transactions on main screen (no scrollbar)
   - Add "View All" button to open full scrollable history

5. **RSR Flow (Receive-Sign-Return)** - Invoice flow
   - Create I1 invoice slate
   - Sender signs I1 to S2
   - Recipient finalizes S2 to S3 and broadcasts

6. **Slatepack Relay UX**
   - Auto-refresh pending list
   - Notification when slatepack arrives
   - Expiry countdown display

7. **QR Code Scanning**
   - Camera permission for address scanning

8. **Configurable Fee Levels**
   - Low/medium/high fee options for BTC/LTC

### Lower Priority

9. **Security Enhancements**
   - Biometric unlock option (where supported)
   - Require password for sensitive operations even when unlocked

10. **XMR/WOW Enhancements**
    - Show ring member info for transactions
    - Export key images for balance verification

11. **Nice to Have**
    - Address book / contacts
    - Price display in fiat currency
    - Multi-wallet support (multiple seeds)
    - Hardware wallet integration (Ledger/Trezor)
    - Firefox/Safari ports

### Code Quality

12. **Testing**
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
