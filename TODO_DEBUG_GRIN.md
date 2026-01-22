# Grin Debug & Development Plan

## Status Update (2026-01-21)

### COMPLETED

1. **DuplicateCommitment Error** - FIXED
   - Root cause: `Identifier` constructor was ignoring the paths array argument
   - Fix: Use `new Identifier()` then `identifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]))`

2. **422 API Errors** - FIXED
   - Root cause: `slate.getId()` returns a `Uuid` object, not a string
   - Fix: Use `slate.getId().value || slate.getId().toString()`

3. **Receive Flow (Direct Slatepack)** - WORKING
   - S1->S2 signing works correctly
   - Transaction enters mempool and gets mined
   - Balance updates after confirmation
   - Transaction shows in history with kernel_excess

4. **Grin Confirmation Service** - WORKING
   - Backend polls for output confirmations
   - Updates grin_outputs and grin_transactions status
   - kernel_excess extracted and stored on confirmation

5. **Transaction History** - WORKING
   - Shows kernel_excess (click to copy) for confirmed transactions
   - Shows slate_id for pending transactions
   - Amount and direction displayed

6. **Mnemonic Persistence** - FIXED
   - Mnemonic stored in chrome.storage.session
   - Survives popup closes, clears on browser close
   - Grin wallet init works after service worker restart

---

## Remaining Tasks

### High Priority

1. **[x] Test Grin Send Flow (SRS)** - COMPLETED 2026-01-22
   - Create S1 slate from extension ✓
   - UTXO selection ✓
   - Change output recording ✓
   - Verify broadcast and confirmation ✓
   - Fixed: Compact slate serialization writes ZERO_OFFSET, so sender must NOT create offset
   - Fixed: Change output proof must be stored and restored for finalization
   - Fixed: Use node Foreign API (port 3413) for push_transaction, not wallet Foreign API (port 3415)

2. **[ ] Implement RSR Flow (Receive-Sign-Return)**
   - Receive S1 via paste or relay
   - Sign to S2
   - Return S2 to sender (via paste or relay)
   - Sender finalizes and broadcasts

3. **[x] Pending Display Discrepancy** - RESOLVED 2026-01-22
   - Removed confusing "Pending" button that showed relay slatepacks
   - Main wallet now shows "Tip" button (placeholder) like other coins
   - Transaction history shows pending status inline for unconfirmed txs

### Medium Priority

4. **[ ] Slatepack Relay UX**
   - Auto-refresh pending list
   - Notification when slatepack arrives
   - Expiry countdown display

5. **[ ] Block Explorer Link**
   - Click kernel_excess to open grinexplorer.net/kernel/{excess}

---

## SRS vs RSR Flows

### SRS (Sender-Receiver-Sender) - Standard Flow
```
Sender                              Recipient
  |                                    |
  |-- Create S1 (lock inputs) -------->|
  |                                    |-- Sign S2 (add output)
  |<-- Return S2 ---------------------|
  |-- Finalize S3 + Broadcast          |
```

**Current Status**: Partially implemented
- Extension can receive S1 and sign to S2
- Need to test: creating S1 and finalizing S3

### RSR (Receiver-Sender-Receiver) - Invoice Flow
```
Recipient                           Sender
  |                                    |
  |-- Create I1 (invoice slate) ------>|
  |                                    |-- Sign S2 (lock inputs + add change)
  |<-- Return S2 ---------------------|
  |-- Finalize S3 + Broadcast          |
```

**Current Status**: Not implemented
- Useful for "request payment" flow
- Recipient initiates, sender just signs
- Recipient finalizes (owns the transaction)

---

## Testing Checklist

### Receive Flow (Direct Slatepack) - COMPLETE
- [x] S1 decodes correctly
- [x] Output commitment created
- [x] Range proof created
- [x] Offset adjustment correct
- [x] Participant added
- [x] S2 encodes correctly
- [x] grin-wallet finalize accepts S2
- [x] Transaction appears in mempool
- [x] Transaction confirms
- [x] Balance updates correctly
- [x] Transaction shows in history

### Send Flow (SRS) - COMPLETE (2026-01-22)
- [x] UTXO selection works
- [x] Fee calculation correct
- [x] Change output created
- [x] S1 slatepack generated
- [x] Can paste S2 response
- [x] Finalize to S3
- [x] Broadcast succeeds
- [x] Spent outputs marked correctly

### Invoice Flow (RSR) - TODO
- [ ] I1 invoice slate created
- [ ] Sender can sign I1 to S2
- [ ] Recipient can finalize S2 to S3
- [ ] Broadcast succeeds
- [ ] Both parties' balances update

### Relay Flow (Smirk-to-Smirk) - TODO
- [ ] Slatepack stored via relay endpoint
- [ ] Recipient sees pending slatepack
- [ ] Recipient signs successfully
- [ ] Sender can finalize
- [ ] Broadcast succeeds
- [ ] Both parties' balances update

---

## Key Files Reference

| File | Purpose |
|------|---------|
| [src/lib/grin/index.ts](src/lib/grin/index.ts) | Main Grin wallet operations |
| [src/background/index.ts](src/background/index.ts) | Message handlers for Grin operations |
| [src/popup/components/GrinPendingView.tsx](src/popup/components/GrinPendingView.tsx) | Pending transactions UI |
| [src/popup/components/GrinSendView.tsx](src/popup/components/GrinSendView.tsx) | Send UI |
| [src/popup/components/WalletView.tsx](src/popup/components/WalletView.tsx) | Balance/history display |
| [src/lib/api.ts](src/lib/api.ts) | Backend API client |

---

## Architecture Notes

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
