# Grin Debug & Development Plan

## Status Update (2026-01-20)

### FIXED Issues

1. **DuplicateCommitment Error** - RESOLVED
   - Root cause: `Identifier` constructor was ignoring the paths array argument
   - The constructor signature is `constructor(serializedIdentifier)` - single arg only
   - Fix: Use `new Identifier()` then `identifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]))`
   - Location: [src/lib/grin/index.ts:464](src/lib/grin/index.ts#L464)

2. **422 API Errors** - RESOLVED
   - Root cause: `slate.getId()` returns a `Uuid` object, not a string
   - API was receiving `[object Object]` instead of UUID string
   - Fix: Use `slate.getId().value || slate.getId().toString()`
   - Locations: [src/lib/grin/index.ts:283](src/lib/grin/index.ts#L283), [src/lib/grin/index.ts:373](src/lib/grin/index.ts#L373), [src/lib/grin/index.ts:1100](src/lib/grin/index.ts#L1100)

3. **Transaction Now Confirms** - WORKING
   - S1->S2 signing works correctly
   - Transaction enters mempool and gets mined
   - Balance updates after confirmation

---

## Current Issue: Pending Display Discrepancy

**Symptom**: Main wallet shows "+1.00 pending" but Pending Transactions view shows "No pending transactions"

**Root Cause**: Two different data sources for "pending":

| Display | Data Source | Table |
|---------|-------------|-------|
| Pending balance on main screen | `grin_transactions` with status='pending' or 'signed' | `grin_transactions` |
| Pending Transactions view | `grin_slatepacks` with status='pending_recipient' or 'pending_sender' | `grin_slatepacks` |

**Why this happens**:
- Direct slatepack signing (paste S1 into extension) creates a `grin_transactions` record
- But there's no `grin_slatepacks` relay entry because it's not using the relay mechanism
- The Pending view only queries the relay table, not the transactions table

**Fix Options**:

1. **Option A: Unify displays** (recommended)
   - Pending balance should come from `grin_outputs` with status='unconfirmed'
   - Pending view should show unconfirmed outputs, not relay entries
   - Relay entries shown separately as "Smirk-to-Smirk transfers"

2. **Option B: Show both**
   - Main screen: pending from transactions (current)
   - Pending view: add tab for "Unconfirmed Outputs" alongside relay entries

3. **Option C: Document the difference**
   - "Pending" on main screen = any unconfirmed tx
   - "Pending Transactions" view = relay-based Smirk-to-Smirk only
   - Add tooltip/help text

---

## Enhanced Logging (Implemented)

Debug logging has been added to `signSlate()` function. View in browser DevTools:
1. Open `chrome://extensions`
2. Find Smirk extension -> Click "service worker"
3. Look for `[signSlate]` prefixed logs

**Logs emitted**:
- S1 slate details (amount, fee, inputs, sender participant)
- Key derivation (identifier path, commitment)
- S2 state (outputs, participants, offset, excess)

---

## Next Development Tasks

### High Priority

1. **[ ] Fix Pending Display Discrepancy**
   - Decide on approach (Option A/B/C above)
   - Implement chosen solution
   - Test both relay and direct slatepack flows

2. **[ ] Test Grin Send Flow**
   - Create S1 slate from extension
   - Verify UTXO selection works
   - Test change output recording
   - Verify broadcast and confirmation

3. **[ ] Rebuild and Test**
   - `bun run build`
   - Reload extension
   - Verify 422 errors are gone
   - Verify balance displays correctly

### Medium Priority

4. **[ ] Confirmation Background Service**
   - Poll backend for output confirmations
   - Update local state when outputs confirm
   - Currently relies on manual refresh

5. **[ ] Grin Transaction History View**
   - Show confirmed transactions
   - Show pending transactions
   - Link outputs to transactions

### Lower Priority

6. **[ ] Slatepack Relay UX Improvements**
   - Notification when slatepack arrives
   - Auto-refresh pending list
   - Expiry countdown display

7. **[ ] Error Handling Improvements**
   - Better error messages for common failures
   - Retry logic for transient errors
   - Offline mode handling

---

## Testing Checklist

### Receive Flow (Direct Slatepack)
- [x] S1 decodes correctly
- [x] Output commitment created
- [x] Range proof created
- [x] Offset adjustment correct
- [x] Participant added
- [x] S2 encodes correctly
- [x] grin-wallet finalize accepts S2
- [x] Transaction appears in mempool
- [x] Transaction confirms
- [ ] Balance updates correctly (need to verify after rebuild)
- [ ] Transaction shows in history

### Receive Flow (Smirk-to-Smirk Relay)
- [ ] Slatepack stored via relay endpoint
- [ ] Recipient sees pending slatepack
- [ ] Recipient signs successfully
- [ ] Sender can finalize
- [ ] Broadcast succeeds
- [ ] Both parties' balances update

### Send Flow
- [ ] UTXO selection works
- [ ] Fee calculation correct
- [ ] Change output created
- [ ] S1 slatepack generated
- [ ] Relay storage works
- [ ] Can finalize after recipient signs
- [ ] Spent outputs marked correctly

---

## Key Files Reference

| File | Purpose |
|------|---------|
| [src/lib/grin/index.ts](src/lib/grin/index.ts) | Main Grin wallet operations |
| [src/lib/grin/identifier.esm.js](src/lib/grin/identifier.esm.js) | Key derivation identifier (BUG WAS HERE) |
| [src/background/index.ts](src/background/index.ts) | Message handlers for Grin operations |
| [src/popup/components/GrinPendingView.tsx](src/popup/components/GrinPendingView.tsx) | Pending transactions UI |
| [src/popup/components/WalletView.tsx](src/popup/components/WalletView.tsx) | Balance display |
| [src/lib/api.ts](src/lib/api.ts) | Backend API client |

---

## Quick Commands

```bash
# Build extension
cd /home/jw/src/smirk-extension
bun run build

# View extension logs
# Chrome: chrome://extensions -> Smirk -> "service worker"
# Firefox: about:debugging -> Smirk -> "Inspect"

# Check Grin node status
curl -u grin:$(cat ~/.grin/main/.foreign_api_secret) \
  http://127.0.0.1:3413/v2/foreign \
  -d '{"jsonrpc":"2.0","method":"get_tip","params":[],"id":1}'

# Check wallet balance
grin-wallet info

# View transaction log
grin-wallet txs

# View outputs
grin-wallet outputs
```

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

### Slatepack Flow

```
Sender                          Backend                         Recipient
  |                                |                                |
  |-- create S1 ------------------>|                                |
  |   POST /grin/relay             |-- notify (if known) ---------->|
  |                                |                                |
  |                                |<-- GET /grin/relay/pending ----|
  |                                |                                |
  |                                |<-- sign S2 --------------------|
  |                                |   POST /grin/relay/sign        |
  |                                |                                |
  |<-- GET /grin/relay/pending ----|                                |
  |                                |                                |
  |-- finalize S3 ---------------->|                                |
  |   POST /grin/relay/finalize    |-- broadcast to network ------->|
  |                                |                                |
```
