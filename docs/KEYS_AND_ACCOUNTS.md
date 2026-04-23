# Keys and Account Recovery

This document describes how Smirk generates and derives cryptographic keys, and how to recover your wallet on other platforms.

## Overview

Smirk uses a single **BIP39 12-word mnemonic** to derive all keys for all supported currencies. This means you only need to back up one seed phrase to recover everything.

**Supported currencies:**
- Bitcoin (BTC) - secp256k1, BIP44
- Litecoin (LTC) - secp256k1, BIP44
- Monero (XMR) - ed25519, SLIP-10 (v3: `m/44'/128'/0'/0'/0'`)
- Wownero (WOW) - ed25519, SLIP-10 (v3: `m/44'/2086'/0'/0'/0'`)
- Grin - ed25519, MWC WASM derivation

## Key Derivation Details

### BIP39 Mnemonic

- 12 words (128 bits of entropy)
- English wordlist (BIP39 standard)
- Optional passphrase for additional security (empty string by default)
- Seed derived via PBKDF2-HMAC-SHA512 (BIP39 standard)

### Bitcoin (BTC)

**Derivation path:** `m/44'/0'/0'/0/0`

Standard BIP44 derivation. Your Smirk BTC keys are fully compatible with any BIP44-compliant wallet.

**To recover in another wallet:**
1. Import your 12-word mnemonic
2. Ensure the wallet uses BIP44 derivation
3. First receive address should match Smirk

**Libraries:** `@scure/bip32`, `@scure/bip39`

### Litecoin (LTC)

**Derivation path:** `m/44'/2'/0'/0/0`

Standard BIP44 derivation with coin type 2 (SLIP-44). Compatible with LTC wallets supporting BIP44.

**To recover in another wallet:**
1. Import your 12-word mnemonic
2. Ensure the wallet uses BIP44 with coin type 2
3. First receive address should match Smirk

### Monero (XMR)

**Derivation path (v3, current):** `m/44'/128'/0'/0'/0'` (SLIP-10 ed25519, Cake Wallet compatible)

```
BIP39 mnemonic → PBKDF2-HMAC-SHA512 → 64-byte master seed
  → SLIP-10 ed25519 at m/44'/128'/0'/0'/0'
  → 32-byte private key = spend key (reduced mod l)
  → Keccak-256(spend_key) mod l = view key (Monero standard Hs())
  → spend_key * G = public spend key
  → view_key * G = public view key
```

Where `l` is the ed25519 curve order: `2^252 + 27742317777372353535851937790883648493`

**Derivation history:**
- **v1 (legacy):** Custom `SHA256(seed || "smirk:xmr:v1") mod l` — incompatible with all other wallets
- **v2 (buggy):** SLIP-10 at `m/44'/128'/0'` (3 levels) — missing last 2 path components
- **v3 (current):** SLIP-10 at `m/44'/128'/0'/0'/0'` (5 levels) — Cake Wallet compatible

**To recover in another wallet (v3):**
1. Import your 12-word BIP39 mnemonic into Cake Wallet or any wallet supporting BIP39 + SLIP-10 Monero derivation
2. Your XMR address should match Smirk's address
3. Or use `monero-wallet-cli --generate-from-spend-key` with the raw private spend key

**Keys registered with backend:**
- Public spend key (for encrypted tip targeting)
- Private view key (registered with LWS for balance scanning)
- **Private spend key stays on device - never sent to server**

**Balance verification:**
The backend returns `total_received` plus a list of `spent_outputs` (candidate spends detected by LWS). The extension uses the private spend key to compute key images locally and verifies which outputs were actually spent. This ensures the server cannot falsely report spent funds - only cryptographically verified spends are subtracted from the balance.

**Why this matters:** LWS can detect *candidate* spends by scanning the blockchain for key images, but it cannot verify ownership without the spend key. The `total_sent` field from LWS is unreliable - it includes outputs that *might* be spent by this wallet but could belong to other wallets sharing similar stealth address patterns. True balance = `total_received - sum(verified_spent_outputs)`.

### Wownero (WOW)

**Derivation path (v3, current):** `m/44'/2086'/0'/0'/0'` (SLIP-10 ed25519)

Same derivation as Monero but with SLIP-44 coin type 2086. All steps are identical to XMR.

**Derivation history:**
- **v1 (legacy):** Custom `SHA256(seed || "smirk:wow:v1") mod l`
- **v2 (buggy):** SLIP-10 at `m/44'/2086'/0'` (3 levels)
- **v3 (current):** SLIP-10 at `m/44'/2086'/0'/0'/0'` (5 levels)

**Transaction Differences from Monero:**

| Property | Monero (XMR) | Wownero (WOW) |
|----------|--------------|---------------|
| RCT Type | 6 (ClsagBulletproofPlus) | 8 (BulletproofPlus) |
| Ring Size | 16 (15 decoys + 1 real) | 22 (21 decoys + 1 real) |
| Commitment Format | Full commitment C | C/8 (scaled by INV_EIGHT) |

The smirk-wasm library handles these differences automatically. The commitment scaling by INV_EIGHT is critical - Wownero's verifier performs `scalarmult8(outPk)` to recover full commitments. This transformation must happen before signing because the commitment values are part of the CLSAG signed message hash.

### Grin

Grin uses **two separate key derivation approaches** in Smirk:

#### 1. Basic Grin Keys (for backend registration)

**Derivation:** Custom ed25519 derivation (same pattern as XMR/WOW)

```
domainSeparator = "smirk:grin:v1"
keySeed = SHA256(masterSeed || domainSeparator)
privateKey = keySeed mod l  (reduced to valid ed25519 scalar)
publicKey = privateKey * G
```

These keys are stored encrypted and registered with the backend for slatepack address identification.

#### 2. Grin WASM Wallet (for transaction building)

For actual Grin transaction operations (slate creation, signing, finalization), Smirk uses the **MWC Wallet WASM library** which has its own key derivation:

**Important:** The MWC Seed class expects the BIP39 **mnemonic string** (12/24 words), NOT the 64-byte derived BIP39 seed. Valid entropy lengths for MWC are 16/20/24/28/32 bytes.

```javascript
// MWC Seed initialization
const seedInstance = new Seed();
await seedInstance.initialize(mnemonic);  // 12-word mnemonic string

// Extended private key derivation
// First parameter is the HMAC key - MWC uses "IamVoldemort" (Wallet.SEED_KEY)
// Second parameter enables BIP39 mode
const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
  Wallet.SEED_KEY,  // "IamVoldemort"
  true              // useBip39
);

// Slatepack address derivation via Crypto.addressKey
const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);
const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
const slatepackAddress = bech32.encode('grin', bech32.toWords(ed25519PublicKey), 1023);
```

The MWC library performs its own internal BIP39 derivation from the mnemonic, producing compatible keys for the Grin/MWC ecosystem.

**On-chain vs Off-chain Keys:**
- **Basic keys** (SHA256 derivation): Used for backend slatepack address registration
- **WASM keys** (MWC derivation): Used for actual transaction signing

Both derive from the same 12-word mnemonic but via different paths. The slatepack addresses produced may differ.

**Important:** Grin has no on-chain addresses. The derived ed25519 keypair is used for:
- Slatepack address (bech32-encoded public key, prefix `grin1...`)
- Tor onion service for receiving interactive transactions
- Encryption of slate data during transaction building

**To recover:**
1. Use Smirk extension with your mnemonic
2. The public key encodes to your slatepack address

**Note:** Grin transactions are interactive (sender and receiver must exchange data). The backend stores pending slatepacks but never holds spend keys.

**Current Status (2026-01-17):**
Grin receive flow is working. The extension can decode an incoming S1 slatepack, sign it to produce S2, and external wallets (tested with Grim) can successfully finalize the transaction. All cryptographic operations happen client-side in WASM - keys never touch the backend.

## Password Encryption

When you set a password in Smirk, your mnemonic is encrypted before storage:

```
salt = random(16 bytes)
key = PBKDF2-SHA256(password, salt, 100000 iterations)
encrypted = XChaCha20-Poly1305(mnemonic, key)
```

The encrypted mnemonic and salt are stored in browser extension storage. The password never leaves your device.

## What the Backend Stores

| Data | Purpose | Security |
|------|---------|----------|
| User ID | Account identifier | Public |
| BTC/LTC public keys | Tip targeting | Public |
| XMR/WOW public spend keys | Tip targeting | Public |
| XMR/WOW private view keys | LWS balance scanning | View-only (cannot spend) |
| Grin public key | Slatepack address | Public |

**Never stored on backend:**
- Mnemonic phrase
- Private spend keys (BTC, LTC, XMR, WOW)
- Grin private key
- Your password

## Recovery Scenarios

### Lost Extension / New Device

1. Install Smirk extension
2. Choose "Restore wallet"
3. Enter your 12-word mnemonic
4. Set a new password
5. All keys are re-derived, balances restored

### Lost Password

If you forget your password but have your mnemonic:
1. Clear extension storage (or reinstall)
2. Restore from mnemonic
3. Set a new password

If you've lost both password AND mnemonic, funds are unrecoverable.

### Migrating to Native Wallets

**BTC/LTC:** Import mnemonic into any BIP44 wallet (Electrum, Sparrow, etc.)

**XMR/WOW (v3 wallets):** Import your 12-word BIP39 mnemonic into Cake Wallet or any wallet supporting BIP39 + SLIP-10 Monero derivation at path `m/44'/128'/0'/0'/0'`.

**Grin:** Cannot directly import into grin-wallet. You must:
1. Export raw private key from Smirk (future feature)
2. Use the key material to construct a compatible wallet

## Security Recommendations

1. **Write down your mnemonic** on paper and store securely (not digitally)
2. **Never share your mnemonic** - anyone with it can steal all funds
3. **Use a strong password** - protects against device theft
4. **Verify your backup** - Smirk asks you to confirm random words
5. **Consider a passphrase** - BIP39 passphrase adds another layer (if you forget it, funds are lost)

## Technical Notes

### ed25519 Scalar Reduction

For XMR/WOW/Grin, raw SHA256 output (32 bytes) must be reduced mod l to produce a valid ed25519 scalar. This ensures the private key is in the correct range for the curve.

### Little-Endian Encoding

Monero/Grin use little-endian byte encoding for scalars, matching ed25519 conventions.

### Domain Separation

Each coin uses a unique domain separator (`smirk:{coin}:v1`) to ensure the same master seed produces different keys for different currencies. This prevents cross-chain key reuse vulnerabilities.

### Library Dependencies

**Extension (TypeScript):**
- `@scure/bip39` - BIP39 mnemonic generation/validation
- `@scure/bip32` - BIP32/44 HD key derivation
- `@scure/btc-signer` - Bitcoin/Litecoin transaction signing
- `@noble/curves/ed25519` - ed25519 operations (key derivation)
- `@noble/hashes/sha256` - SHA256 hashing
- `@noble/ciphers/chacha` - XChaCha20-Poly1305 encryption
- `smirk-wasm` - Monero/Wownero transaction signing and key image computation

All `@noble/*` and `@scure/*` libraries are by Paul Miller, audited, and widely used in the cryptocurrency ecosystem.

**smirk-wasm (Rust/WASM):**
- `monero-oxide` - Monero cryptographic primitives
- `monero-wallet` - Transaction construction
- `curve25519-dalek` - Ed25519 curve operations

### Key Image Verification Implementation

Key image computation for spent output verification is implemented in **smirk-wasm** using Rust and the `monero-oxide` library. The algorithm:

1. **Derive one-time private key:** `x = Hs(a*R || outputIndex) + b`
   - `a` = private view key
   - `R` = transaction public key (from the original receive tx)
   - `b` = private spend key
   - `Hs()` = hash to scalar (Keccak-256, reduced mod l)

2. **Derive one-time public key:** `P = x * G`

3. **Compute key image:** `KI = x * Hp(P)`
   - `Hp()` = Monero's `hash_to_ec` (via `monero-oxide::Point::biased_hash`)

The WASM module uses `monero-oxide`'s verified implementation of Monero's `ge_fromfe_frombytes_vartime`, which correctly maps hash output to curve points. This is the same cryptographic library used by the Serai DEX and other Monero Rust ecosystem projects.

**Why WASM?** JavaScript implementations of Monero's Elligator-like hash-to-point function are notoriously difficult to get right. The Rust implementation from `monero-oxide` has been battle-tested and is cryptographically correct.

## 0-Conf Transaction Detection (XMR/WOW)

The extension shows pending (unconfirmed) incoming transactions when they hit the mempool.

### Two Detection Paths

There are two paths depending on where the transaction originates:

#### Path 1: External → Smirk (LWS Webhooks)

When a tx is sent from an external wallet (not through our LWS/daemon):

1. The daemon receives the tx via p2p and publishes `json-full-txpool_add` on ZMQ
2. LWS detects the mempool tx, matches it to a registered address
3. LWS fires `payment_hook` webhook with `confirmations=0` (mempool)
4. Backend receives via ZMQ subscriber, resolves address via `event_id` lookup in `lws_webhooks`
5. Upserts into `pending_transactions` with `confirmations=0`
6. When tx confirms, LWS fires `payment_hook` with `confirmations=1+`, backend sets `confirmed_at`

#### Path 2: Smirk → Smirk (Direct Backend Insert + Daemon Polling)

When a tx is sent between two wallets on the same smirk backend:

1. Extension broadcasts via `POST /wallet/lws/submit` with `recipient_address`, `amount`, `tx_hash`
2. Backend checks if recipient is a registered smirk address
3. If yes, inserts `pending_transaction` record directly — **receiver sees pending instantly**
4. **LWS webhooks do NOT fire** for this tx (see "Known Limitation" below)
5. Backend confirmation poller (`tip_confirmation.rs`) checks stale pending records (>2 min)
   against the daemon every 60s and marks them confirmed

### Known Limitation: Daemon txpool_add for Local Submissions

monerod/wownerod intentionally do NOT publish `json-full-txpool_add` ZMQ events for
transactions submitted via local RPC (`relay_method::local`). See `cryptonote_core.cpp`
line 1084 and `blockchain_db.cpp` line 65: `matches_category(relay_method::local,
relay_category::legacy)` returns `false`.

This means LWS never detects mempool txs that were submitted through the same daemon
it's connected to. It also means LWS never fires confirmation webhooks for these txs,
because the webhook system (`send_webhook` in `scanner.cpp` line 281-285) requires
the tx to be in the mempool cache to compute its hash.

This affects all setups where sender and receiver share the same LWS/daemon instance,
including MyMonero-style architectures. The upstream fix is a 1-line change in
`cryptonote_core.cpp` (change `relay_category::legacy` to `relay_category::relayable`),
but requires building the daemon from source with static linking.

### Balance Query

The `/wallet/lws/balance` endpoint returns `pending_balance` — the sum of
`pending_transactions` where `confirmed_at IS NULL` and `address` matches the
requesting user's address.

### Prerequisites

For detection to work:
- The receiving address must be registered with LWS (`/add_account` admin API)
- A `tx-confirmation` webhook with `confirmations=0` must be registered with `event_id` stored
- LWS scanner must be running
- The daemon must be publishing ZMQ events (requires `--zmq-pub` flag)

The extension registers both the address and webhook automatically on wallet unlock
via `registerWithLwsFromUnlockedKeys()` → backend `register_lws` endpoint.

### Troubleshooting

If pending detection stops working:
- Check that the address is in the `wallets` table with a view key
- Check that a webhook exists in `lws_webhooks` table with `event_id` populated
- For external sends: check backend logs for `payment_hook.*confirmations=0`
- For smirk-to-smirk: check backend logs for `Inserted pending transaction for smirk-to-smirk`
- Stale pending records (confirmed on-chain but still showing pending) should auto-clear
  within ~2 minutes via the daemon confirmation poller
