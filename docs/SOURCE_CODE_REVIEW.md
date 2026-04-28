# Source Code Review Instructions

For Mozilla Add-on reviewers. This document explains how to build the extension from source and verify the submitted package.

## Prerequisites

- Node.js >= 20 (see `.nvmrc` for pinned major version)
- npm (included with Node.js)

## Build the Firefox Extension

```bash
npm install
npm run build:firefox
```

This produces `dist/` containing the extension files identical to the submitted `.zip`.

## What the Build Does

1. `vite build` - Bundles TypeScript source into JavaScript (Vite 5.x bundler)
2. `cp manifest.firefox.json dist/manifest.json` - Copies the Firefox-specific manifest

No minification beyond standard Vite production bundling. No obfuscation. All source is readable TypeScript in `src/`.

## Pre-built WebAssembly Binaries

The extension includes WASM binaries for client-side cryptography. These are **not** built during `npm run build` - they are pre-built from open-source repositories and committed to the repo.

### GRIN Cryptography (`src/lib/grin/*.wasm`)

Third-party libraries by NicolasFlamel1, compiled from C/C++ source with Emscripten:

| Library | Source Repository |
|---------|-------------------|
| secp256k1-zkp | https://github.com/NicolasFlamel1/Secp256k1-zkp-WASM-Wrapper |
| Ed25519 | https://github.com/NicolasFlamel1/Ed25519-WASM-Wrapper |
| X25519 | https://github.com/NicolasFlamel1/X25519-WASM-Wrapper |
| BLAKE2b | https://github.com/NicolasFlamel1/BLAKE2b-WASM-Wrapper |

To rebuild any of these from source:

```bash
git clone <repo-url>
npm install
npm run prepublishOnly
```

### Monero/Wownero WASM

Built from our open-source Rust code:

| Library | Source Repository |
|---------|-------------------|
| smirk-wasm-monero | https://github.com/Such-Software/smirk-wasm-monero |
| monero-oxide (dependency) | https://github.com/Such-Software/monero-oxide |

To rebuild from source:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
git clone https://github.com/Such-Software/smirk-wasm-monero
cd smirk-wasm-monero
git submodule update --init
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/smirk_wasm.wasm
```

**Note:** WASM compilation is not fully deterministic across compiler versions. The JavaScript source code and functionality are identical regardless of minor binary differences.

## Validation Warnings

Expected warnings during `web-ext lint` that are safe to ignore:

- **"Function constructor" (eval)** - From WASM crypto library initialization. Required for WebAssembly module loading. Cannot be avoided.
- **"innerHTML"** - From Preact framework rendering. No user input is passed to innerHTML; all content is framework-controlled.

## Project Structure

```
src/
  background/   Service worker / background page - message handling, wallet operations
  popup/        UI components (Preact framework)
  content/      Content script - injects window.smirk API into web pages
  inject/       In-page script - window.smirk API surface
  lib/          Crypto libraries, API client, WASM wrappers
  types/        TypeScript type definitions
scripts/        One-off / dev-only utilities (NOT bundled into the extension):
                - bump-version.sh, release.sh — release helpers
                - recover-broken-v3.ts — manual recovery script for users
                  affected by a derivation-path bug in v0.2.0; not invoked
                  by the extension at runtime, never loaded from the bundle
                - derive_keys.{js,py}, zmq_*.py — diagnostic helpers
```

The `scripts/` directory is included in the source archive for transparency but its files are never imported by the build (no entry in `vite.config.ts` references them) and do not appear in the produced `.zip`. You can verify by inspecting the built `dist/` after `npm run build:firefox` — `scripts/` is absent.

## npm Dependencies

All npm dependencies are standard, well-known packages from the Node ecosystem:

- `preact` - Lightweight UI framework (3KB alternative to React)
- `@noble/curves`, `@noble/hashes`, `@noble/ciphers` - Audited cryptography by Paul Miller
- `@scure/bip32`, `@scure/bip39`, `@scure/btc-signer` - Audited Bitcoin key derivation
- `vite` - Build tool (dev dependency only, not in final bundle)
- `typescript` - Type checker (dev dependency only)

No dependencies contain pre-built native code. All are pure JavaScript/TypeScript.
