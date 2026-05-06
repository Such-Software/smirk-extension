# Smirk Extension Changelog

## v0.2.4 (2026-05-05)

### Bug Fixes
- **Migration robustness**: old addresses holding only unsweepable dust (outputs whose sum is below the network fee) are now skipped during the v3 upgrade instead of blocking it. Key migration proceeds and the dust is left where it sits. Applies to XMR, WOW, and Grin.

### Hardening
- **Migration concurrency guard**: `START_MIGRATION` is now refused while a previous run is still in flight, preventing a double-click or popup-reopen from spawning parallel sweeps.
- **Migration save ordering**: local wallet state is persisted to v3 *before* the backend `migrate-keys` call. A crash in the window between the two now self-heals on next unlock via the existing key-reconciliation path, instead of risking the backend being silently regressed to v1/v2 by reconcile reading stale local state.

## v0.2.3 (2026-04-28)

### Bug Fixes
- **Wallet restore**: importing a wallet that had previously run our v3 key migration could fail with a "key mismatch" error. The restore-check was comparing a redundant key field that had drifted across registration vs. migration code paths since v0.2.0. Identity is now validated by `seed_fingerprint` + `public_key` only — both still required. Affected stored values were backfilled to canonical values derived from each user's wallet address.
- **401 race on restore**: backend registration is now `await`-ed during wallet creation/restore so the auth token is set before the popup queries authenticated endpoints (e.g. `/tips/social/received`). LWS scanning registration remains non-blocking.

### Hardening
- **Self-healing key reconciliation**: on every unlock the extension now compares its locally-derived public keys against the backend's stored values; if they ever drift it silently re-uploads the canonical values via `/auth/migrate-keys`. Throttled to once per 24h. Protects against past and future server-side desync without user intervention.

## v0.2.2 (2026-04-25)

### Bug Fixes
- **Migration interop with grin-wallet/Grim/Cake**: corrected derivation paths and seed handling so wallets restored in Smirk are compatible with these external wallets (and vice versa). Migration sweep flow updated to handle the additional cross-wallet edge cases.
- **v3 derivation path corrected for XMR/WOW**: v0.2.0 shipped a buggy 3-level SLIP-10 path (`m/44'/coin'/0'`) — addresses produced were not Cake-compatible. v3 introduces the correct path (commit eea5925 used 5-level SLIP-10 ed25519, later refined in v0.2.2 to BIP-32 secp256k1 `m/44'/coin'/0'/0/0` matching Cake Wallet exactly). Migration handles v1→v3 and v2→v3 sweeps automatically.

### Internal
- Added `GRIN_TEST_PATHS` diagnostic to surface compatibility issues across grin-wallet variants during development.

## v0.2.1 (2026-04-19)

### Features
- **Optional `window.smirk` API injection**: settings toggle to disable the in-page API on sites that don't need it.

## v0.2.0 (2026-04-19)

This is the BIP-44 migration release. Existing wallets are walked through an in-app upgrade flow that re-derives keys and sweeps funds to the new addresses.

### Features
- **BIP-44 / SLIP-10 key derivation**: XMR/WOW now derived via SLIP-10 (introducing v2 keys, later corrected in v0.2.2 to v3). Aligns Smirk with Cake Wallet and standard hardware-wallet derivation.
- **Migration UI**: in-app banner/screen guides existing v1 wallets through key upgrade, including funds sweep with confirmation.
- **Grin auto-sweep**: migration includes a self-transaction (SRS flow) for Grin so users don't have to interact with another party to migrate.
- **`migrateKeys` API**: `/auth/migrate-keys` endpoint allows the extension to update the backend's stored public keys after the local key version changes.

### Security
- **PBKDF2 iterations bumped to 600K** (OWASP 2023 recommendation, up from 100K).
- **Signature formats standardized**: BIP-137 for BTC ownership proofs, RFC-8032 for ed25519. Documented in repo.
- **Asset-scoped connect API**: `window.smirk.connect()` now requires explicit per-asset scoping; plaintext seed removed from extension storage.
- **Auto-lock timer** + **approval UI** for sensitive operations.
- Multiple internal audit findings addressed.

### Bug Fixes
- Migration sweep phase no longer skips assets in some edge cases.
- Auto-lock fires after migration completes.
- Removed inaccurate references to Exodus/Monero CLI from the migration banner.
- Clearer messaging around the confirmation delay after migration sweep.
- Fixed an issue where dApp send path was missing an api import for fee estimation.

## v0.1.9 (2026-03-22)

### Features
- **XMR/WOW recipient hints**: extension now passes recipient info to backend on broadcast so the recipient can be notified.

### Bug Fixes
- **LWS re-registration on every unlock**: ensures backend has the correct address even if the wallet was restored with a different seed while auth was still valid.
- **Grin error messages**: show GRIN amounts (not raw nanogrin) in error toasts.
- **Grin change-output bug**: fixed `Identifier` constructor issue that caused all change outputs to land at `nChild=0`.
- **Grin retry logic**: API calls in the output and relay paths now retry on transient failure.

### UX
- After completing a Grin receive, the popup returns to the main wallet view (was getting stuck on the receive screen).
- Slatepacks now auto-copy to clipboard on all Grin flows.
- Locked balance from backend is surfaced in the Grin balance UI.

### Internal
- Updated cancel-flow comment: backend now handles output unlock.
- Multiple Grin invoice fixes, security hardening, and code-quality improvements.

## v0.1.8 (2026-03-04)

### Bug Fixes
- **Service worker imports**: Convert dynamic `import()` to static imports for Chrome MV3 compatibility
- **Social tip UX**: "Tip Sent!" → "Tip Created!" text, add "Ready to share" banner for confirmed public tips
- **BTC/LTC history amounts**: Show green/red +/- amounts for all assets (previously only XMR/WOW/Grin had amounts)
- **Concurrent XMR/WOW tips**: Better error message when outputs are temporarily locked by pending transactions
- **Claiming race condition**: Fixed in backend — atomic state transition prevents double-claims

### Improvements
- XMR/WOW pending balance tracking via `addPendingTx()` for immediate balance reflection
- Double-counting guard for LWS + local pending overlap
- Badge count for sent public tips ready to share

## v0.1.7 (2026-02-27)

### Bug Fixes
- **XMR/WOW payments**: Execute in popup context since service workers can't import WASM modules

## v0.1.6 (2026-02-22)

### Features
- **Payment flow**: Connected websites can prompt for payment via `window.smirk` API

### Bug Fixes
- Firefox `connect()` bug fixed
- API client robustness improvements

### Refactoring
- Split `social.ts` into multiple files
- Split `wallet.ts` and `grin-handlers.ts`
- Dynamic WASM imports for Chrome service worker

## v0.1.5 (2026-02-19)

### Bug Fixes
- Transaction history display and popout rendering
- Remove dead `funded` status check and unused `pendingSentTips` state
- Fix Grin balance double-counting pending sent tips
- Fix TypeScript errors, improve popup height

### Features
- Smirk name lookup (tip by username)

## v0.1.4 (2026-02-15)

### Bug Fixes
- Firefox receive bug
- Build script for packaging

## v0.1.3 (2026-02-12)

### Features
- **Smirk name tipping**: Tip users by Smirk username
- **Firefox MV3 support**: Full Firefox build with comprehensive build docs

### Bug Fixes
- Tip claim notifications
- Discord tipping compatibility
- Anonymous toggle on tips

## v0.1.2 (2026-02-08)

### Features
- **Discord integration**: Tip Discord users from the extension
- **Sparkline charts**: Price history under current price
- **UI revamp**: New design with price display

### Bug Fixes
- Max send fee estimation for BTC/LTC/XMR/WOW
- Price fetch and display
- Use `backend.smirk.cash` for production API

## v0.1.1 (2026-02-01)

### Features
- **Public tips**: Create shareable tip links anyone can claim
- **Sender anonymity**: Option to hide identity on tips
- **Badges**: Pending tip notifications

### Bug Fixes
- Security hardening for restore/registration
- Retry registration on network failure
- Unconfirmed XMR/WOW tip display
- Grin tipping and voucher creation
- Auto-detect sweep mode for max send
- Social tip receiving and claiming

## v0.1.0 (2026-01-22)

### Initial Alpha Release
- **Non-custodial wallet**: BTC, LTC, XMR, WOW, GRIN
- **HD key derivation**: Single seed phrase for all assets
- **Social tipping**: Tip by Telegram username
- **Grin support**: SRS/RSR flows with client-side WASM
- **Website auth**: Sign in to smirk.cash with wallet signature
- **0-conf detection**: Instant notification for XMR/WOW
- Chrome and Firefox support
