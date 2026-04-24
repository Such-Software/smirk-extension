#!/usr/bin/env npx tsx
/**
 * One-off recovery script for jwinterm's broken-v3 derivation.
 *
 * The initial v3 used SLIP-10 ed25519 (wrong). The correct v3 uses
 * BIP32 secp256k1 (Cake Wallet compatible). This script sweeps funds
 * from the broken-v3 addresses to the correct-v3 addresses.
 *
 * Usage:
 *   npx tsx scripts/recover-broken-v3.ts              # interactive
 *   npx tsx scripts/recover-broken-v3.ts --dry-run     # just show addresses
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createInterface } from 'readline';

// Crypto libs (already in node_modules)
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { keccak_256 } from '@noble/hashes/sha3';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://backend.smirk.cash/api/v1';
const XMR_COIN_TYPE = 128;
const WOW_COIN_TYPE = 2086;
const XMR_ADDRESS_PREFIX = 18;
const WOW_ADDRESS_PREFIX = 4146;

// ed25519 curve order
const CURVE_L = 2n ** 252n + 27742317777372353535851937790883648493n;

const PROJECT_ROOT = join(import.meta.dirname, '..');

// ============================================================================
// Scalar math (little-endian, mod l)
// ============================================================================

function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = 0; i < 32; i++) {
    scalar += BigInt(bytes[i]) << BigInt(8 * i);
  }
  return scalar % CURVE_L;
}

function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ============================================================================
// SLIP-10 ed25519 derivation (the BROKEN v3 method)
// ============================================================================

function slip10DeriveEd25519(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32, 64);

  for (const index of path) {
    const hardenedIndex = (index | 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (hardenedIndex >>> 24) & 0xff;
    data[34] = (hardenedIndex >>> 16) & 0xff;
    data[35] = (hardenedIndex >>> 8) & 0xff;
    data[36] = hardenedIndex & 0xff;

    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32, 64);
  }

  return key;
}

interface CryptonoteKeys {
  privateSpendKey: Uint8Array;
  privateViewKey: Uint8Array;
  publicSpendKey: Uint8Array;
  publicViewKey: Uint8Array;
}

/** Broken v3: SLIP-10 ed25519 at m/44'/coinType'/0'/0'/0' */
function deriveBrokenV3Keys(masterSeed: Uint8Array, coinType: number): CryptonoteKeys {
  const rawKey = slip10DeriveEd25519(masterSeed, [44, coinType, 0, 0, 0]);
  const spendKeyScalar = bytesToScalar(rawKey);
  const privateSpendKey = scalarToBytes(spendKeyScalar);

  const viewKeySeed = keccak_256(privateSpendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  const privateViewKey = scalarToBytes(viewKeyScalar);

  const publicSpendKey = ed25519.ExtendedPoint.BASE.multiply(spendKeyScalar).toRawBytes();
  const publicViewKey = ed25519.ExtendedPoint.BASE.multiply(viewKeyScalar).toRawBytes();

  return { privateSpendKey, privateViewKey, publicSpendKey, publicViewKey };
}

/** Correct v3: BIP32 secp256k1 at m/44'/coinType'/0'/0/0 (Cake Wallet) */
function deriveCorrectV3Keys(masterSeed: Uint8Array, coinType: number): CryptonoteKeys {
  const hdKey = HDKey.fromMasterSeed(masterSeed);
  const derived = hdKey.derive(`m/44'/${coinType}'/0'/0/0`);
  if (!derived.privateKey) throw new Error('Failed to derive BIP32 key');

  const spendKeyScalar = bytesToScalar(derived.privateKey);
  const privateSpendKey = scalarToBytes(spendKeyScalar);

  const viewKeySeed = keccak_256(privateSpendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  const privateViewKey = scalarToBytes(viewKeyScalar);

  const publicSpendKey = ed25519.ExtendedPoint.BASE.multiply(spendKeyScalar).toRawBytes();
  const publicViewKey = ed25519.ExtendedPoint.BASE.multiply(viewKeyScalar).toRawBytes();

  return { privateSpendKey, privateViewKey, publicSpendKey, publicViewKey };
}

// ============================================================================
// Cryptonote address encoding (Monero-style base58)
// ============================================================================

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function uint8ArrayToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

function encodeBase58Block(data: Uint8Array, padLength: number): string {
  let num = uint8ArrayToBigInt(data);
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  return result.padStart(padLength, '1');
}

function base58Encode(data: Uint8Array): string {
  const fullBlocks = Math.floor(data.length / 8);
  const remainder = data.length % 8;
  const blockSizes: Record<number, number> = { 0: 0, 1: 2, 2: 3, 3: 5, 4: 6, 5: 7, 6: 9, 7: 10, 8: 11 };

  let result = '';
  for (let i = 0; i < fullBlocks; i++) {
    result += encodeBase58Block(data.slice(i * 8, (i + 1) * 8), 11);
  }
  if (remainder > 0) {
    result += encodeBase58Block(data.slice(fullBlocks * 8), blockSizes[remainder]);
  }
  return result;
}

function cryptonoteAddress(publicSpendKey: Uint8Array, publicViewKey: Uint8Array, prefix: number): string {
  const prefixBytes: number[] = [];
  let p = prefix;
  while (p >= 0x80) {
    prefixBytes.push((p & 0x7f) | 0x80);
    p >>= 7;
  }
  prefixBytes.push(p);

  const data = new Uint8Array(prefixBytes.length + 64);
  data.set(prefixBytes);
  data.set(publicSpendKey, prefixBytes.length);
  data.set(publicViewKey, prefixBytes.length + 32);

  const checksum = keccak_256(data).slice(0, 4);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set(checksum, data.length);

  return base58Encode(full);
}

// ============================================================================
// Bitcoin message signing (inlined for Node.js compatibility)
// ============================================================================

function encodeVarint(n: number): Uint8Array {
  if (n < 253) return new Uint8Array([n]);
  const buf = new Uint8Array(3);
  buf[0] = 0xfd;
  buf[1] = n & 0xff;
  buf[2] = (n >> 8) & 0xff;
  return buf;
}

function bitcoinMessageHash(message: string): Uint8Array {
  const prefix = new TextEncoder().encode('\x18Bitcoin Signed Message:\n');
  const messageBytes = new TextEncoder().encode(message);
  const lenBytes = encodeVarint(messageBytes.length);
  const fullMessage = new Uint8Array(prefix.length + lenBytes.length + messageBytes.length);
  fullMessage.set(prefix, 0);
  fullMessage.set(lenBytes, prefix.length);
  fullMessage.set(messageBytes, prefix.length + lenBytes.length);
  return sha256(sha256(fullMessage));
}

function signBitcoinMessage(message: string, privateKey: Uint8Array): string {
  const msgHash = bitcoinMessageHash(message);
  const signature = secp256k1.sign(msgHash, privateKey, { lowS: true });
  const headerByte = 27 + signature.recovery + 4;
  const compactSig = new Uint8Array(65);
  compactSig[0] = headerByte;
  const rBytes = hexToBytes(signature.r.toString(16).padStart(64, '0'));
  const sBytes = hexToBytes(signature.s.toString(16).padStart(64, '0'));
  compactSig.set(rBytes, 1);
  compactSig.set(sBytes, 33);
  return Buffer.from(compactSig).toString('base64');
}

// ============================================================================
// Backend API
// ============================================================================

let accessToken: string | null = null;

async function apiRequest(endpoint: string, body?: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

async function deactivateLws(asset: string, address: string): Promise<void> {
  try {
    const result = await apiRequest('/wallet/lws/deactivate', { asset, address });
    console.log(`  LWS deactivate ${asset}: ${result.message || 'ok'}`);
  } catch (err) {
    console.log(`  LWS deactivate ${asset}: ${err instanceof Error ? err.message : 'failed'} (continuing)`);
  }
}

async function registerLws(asset: string, address: string, viewKey: string, userId: string, startHeight?: number): Promise<void> {
  const result = await apiRequest('/wallet/lws/register', {
    user_id: userId,
    asset,
    address,
    view_key: viewKey,
    start_height: startHeight,
  });
  console.log(`  LWS register ${asset}: ${result.message || 'ok'}`);
}

async function getBalance(asset: string, address: string, viewKey: string): Promise<{
  total_received: number;
  scanned_height: number;
  blockchain_height: number;
}> {
  return apiRequest('/wallet/lws/balance', { asset, address, view_key: viewKey });
}

async function getUnspentOuts(asset: string, address: string, viewKey: string): Promise<{
  outputs: any[];
  per_byte_fee: number;
  fee_mask: number;
}> {
  return apiRequest('/wallet/lws/unspent', { asset, address, view_key: viewKey });
}

async function getRandomOuts(asset: string, count: number): Promise<{ outputs: any[] }> {
  return apiRequest('/wallet/lws/decoys', { asset, count });
}

async function submitTx(asset: string, txHex: string, recipientAddress: string, amount: number, txHash: string): Promise<void> {
  const result = await apiRequest('/wallet/lws/submit', {
    asset,
    tx_hex: txHex,
    recipient_address: recipientAddress,
    amount,
    tx_hash: txHash,
  });
  if (!result.success) throw new Error(result.status || 'Submit failed');
}

// ============================================================================
// WASM loading
// ============================================================================

let wasm: any = null;

async function loadWasm(): Promise<void> {
  const wasmPath = join(PROJECT_ROOT, 'dist', 'wasm', 'smirk_wasm_bg.wasm');
  const wasmBytes = await readFile(wasmPath);

  const jsModulePath = join(PROJECT_ROOT, 'src', 'lib', 'smirk-wasm.js');
  const jsModule = await import(jsModulePath);

  const module = await WebAssembly.compile(wasmBytes);
  jsModule.initSync({ module });
  wasm = jsModule;
  console.log('WASM loaded:', wasm.test(), 'version:', wasm.version());
}

// ============================================================================
// Sweep logic
// ============================================================================

async function sweepAsset(
  asset: 'xmr' | 'wow',
  oldKeys: CryptonoteKeys,
  oldAddress: string,
  newAddress: string
): Promise<string | null> {
  const viewKeyHex = bytesToHex(oldKeys.privateViewKey);
  const spendKeyHex = bytesToHex(oldKeys.privateSpendKey);
  const decoyCount = asset === 'wow' ? 21 : 15;

  console.log(`  Getting unspent outputs...`);
  const { outputs: rawOutputs, per_byte_fee, fee_mask } = await getUnspentOuts(asset, oldAddress, viewKeyHex);

  if (rawOutputs.length === 0) {
    console.log(`  No outputs found.`);
    return null;
  }

  // Filter spent outputs using key images
  const unspent: any[] = [];
  for (const output of rawOutputs) {
    const resultJson = wasm.compute_key_image(viewKeyHex, spendKeyHex, output.tx_pub_key, output.index);
    const result = JSON.parse(resultJson);
    if (!result.success) continue;

    const computedKI = result.data.toLowerCase();
    if (output.spend_key_images?.some((ki: string) => ki.toLowerCase() === computedKI)) {
      continue;
    }
    unspent.push(output);
  }

  console.log(`  ${rawOutputs.length} raw outputs, ${unspent.length} unspent`);

  if (unspent.length === 0) {
    console.log(`  All outputs spent.`);
    return null;
  }

  const totalValue = unspent.reduce((sum: number, o: any) => sum + o.amount, 0);
  console.log(`  Total unspent: ${totalValue} atomic units`);

  // Estimate fee for sweep (all inputs, 1 output)
  const feeResult = JSON.parse(wasm.estimate_fee(unspent.length, 1, BigInt(per_byte_fee), BigInt(fee_mask)));
  if (!feeResult.success) throw new Error(`Fee estimate failed: ${feeResult.error}`);
  const baseFee = feeResult.data;
  const feeBuffer = Math.max(Math.ceil(baseFee * 0.001), fee_mask);
  const fee = baseFee + feeBuffer;
  const sweepAmount = totalValue - fee;

  if (sweepAmount <= 0) {
    console.log(`  Balance ${totalValue} too small to cover fee ${fee}`);
    return null;
  }

  console.log(`  Sweep amount: ${sweepAmount}, fee: ${fee}`);

  // Get decoys for each input
  console.log(`  Getting decoys...`);
  const inputsWithDecoys: any[] = [];
  for (const output of unspent) {
    const decoyResp = await getRandomOuts(asset, decoyCount);
    inputsWithDecoys.push({
      output: {
        amount: output.amount,
        public_key: output.public_key,
        tx_pub_key: output.tx_pub_key,
        index: output.index,
        global_index: output.global_index,
        height: output.height,
        rct: output.rct,
      },
      decoys: decoyResp.outputs.slice(0, decoyCount).map((d: any) => ({
        global_index: d.global_index,
        public_key: d.public_key,
        rct: d.rct,
      })),
    });
  }

  // Sign transaction
  console.log(`  Signing transaction...`);
  const params = {
    inputs: inputsWithDecoys,
    destinations: [{ address: newAddress, amount: sweepAmount }],
    change_address: oldAddress,
    fee_per_byte: per_byte_fee,
    fee_mask,
    view_key: viewKeyHex,
    spend_key: spendKeyHex,
    network: 'mainnet',
    coin: asset,
  };

  const signResult = JSON.parse(wasm.sign_transaction(JSON.stringify(params)));
  if (!signResult.success) throw new Error(`Sign failed: ${signResult.error}`);

  const { tx_hex, tx_hash, fee: actualFee } = signResult.data;
  console.log(`  Signed: ${tx_hash}, fee: ${actualFee}`);

  // Broadcast
  console.log(`  Broadcasting...`);
  await submitTx(asset, tx_hex, newAddress, sweepAmount, tx_hash);
  console.log(`  Broadcast OK!`);

  return tx_hash;
}

// ============================================================================
// Auth
// ============================================================================

async function authenticate(masterSeed: Uint8Array): Promise<string> {
  const hdKey = HDKey.fromMasterSeed(masterSeed);
  const btcDerived = hdKey.derive("m/44'/0'/0'/0/0");
  if (!btcDerived.privateKey || !btcDerived.publicKey) throw new Error('BTC key derivation failed');

  const signedTimestamp = Math.floor(Date.now() / 1000);
  const message = `smirk-auth-${signedTimestamp}`;
  const signature = signBitcoinMessage(message, btcDerived.privateKey);

  // Backend uses snake_case and returns snake_case
  const result = await apiRequest('/auth/extension', {
    keys: [{ asset: 'btc', public_key: bytesToHex(btcDerived.publicKey) }],
    signed_timestamp: signedTimestamp,
    signature,
  });

  accessToken = result.access_token;
  console.log(`Authenticated as user: ${result.user.id}`);
  return result.user.id;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  let mnemonic: string;

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    mnemonic = await new Promise<string>((resolve) => {
      process.stderr.write('Enter mnemonic: ');
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
    });
  } else {
    mnemonic = readFileSync(0, 'utf-8').trim();
  }

  if (!validateMnemonic(mnemonic, wordlist)) {
    console.error('Invalid mnemonic!');
    process.exit(1);
  }

  const masterSeed = mnemonicToSeedSync(mnemonic);

  // Derive both key sets
  const brokenXmr = deriveBrokenV3Keys(masterSeed, XMR_COIN_TYPE);
  const brokenWow = deriveBrokenV3Keys(masterSeed, WOW_COIN_TYPE);
  const correctXmr = deriveCorrectV3Keys(masterSeed, XMR_COIN_TYPE);
  const correctWow = deriveCorrectV3Keys(masterSeed, WOW_COIN_TYPE);

  const brokenXmrAddr = cryptonoteAddress(brokenXmr.publicSpendKey, brokenXmr.publicViewKey, XMR_ADDRESS_PREFIX);
  const brokenWowAddr = cryptonoteAddress(brokenWow.publicSpendKey, brokenWow.publicViewKey, WOW_ADDRESS_PREFIX);
  const correctXmrAddr = cryptonoteAddress(correctXmr.publicSpendKey, correctXmr.publicViewKey, XMR_ADDRESS_PREFIX);
  const correctWowAddr = cryptonoteAddress(correctWow.publicSpendKey, correctWow.publicViewKey, WOW_ADDRESS_PREFIX);

  console.log('\n=== Broken v3 (SLIP-10 ed25519 — funds are HERE) ===');
  console.log(`XMR: ${brokenXmrAddr}`);
  console.log(`WOW: ${brokenWowAddr}`);

  console.log('\n=== Correct v3 (BIP32 secp256k1 / Cake Wallet — sweep TO here) ===');
  console.log(`XMR: ${correctXmrAddr}`);
  console.log(`WOW: ${correctWowAddr}`);

  if (process.argv.includes('--dry-run')) {
    console.log('\n--dry-run: showing keys, not sweeping.');
    console.log('\nBroken v3 private keys (for manual recovery if needed):');
    console.log(`  XMR spend: ${bytesToHex(brokenXmr.privateSpendKey)}`);
    console.log(`  XMR view:  ${bytesToHex(brokenXmr.privateViewKey)}`);
    console.log(`  WOW spend: ${bytesToHex(brokenWow.privateSpendKey)}`);
    console.log(`  WOW view:  ${bytesToHex(brokenWow.privateViewKey)}`);
    return;
  }

  // Load WASM
  console.log('\nLoading WASM...');
  await loadWasm();

  // Authenticate
  console.log('\nAuthenticating with backend...');
  const userId = await authenticate(masterSeed);

  // Deactivate existing LWS registrations (they were registered with wrong start_height)
  console.log('\nDeactivating stale LWS registrations...');
  await deactivateLws('xmr', brokenXmrAddr);
  await deactivateLws('wow', brokenWowAddr);

  // Get current blockchain heights to calculate rescan start
  console.log('\nGetting blockchain heights...');
  const xmrHeightCheck = await getBalance('xmr', brokenXmrAddr, bytesToHex(brokenXmr.privateViewKey)).catch(() => null);
  const wowHeightCheck = await getBalance('wow', brokenWowAddr, bytesToHex(brokenWow.privateViewKey)).catch(() => null);

  // Re-register with start_height = current - 1000 to catch recent sweep tx
  const xmrStart = xmrHeightCheck ? Math.max(0, xmrHeightCheck.blockchain_height - 1000) : 0;
  const wowStart = wowHeightCheck ? Math.max(0, wowHeightCheck.blockchain_height - 1000) : 0;

  console.log(`\nRe-registering broken-v3 addresses (XMR from ${xmrStart}, WOW from ${wowStart})...`);
  await registerLws('xmr', brokenXmrAddr, bytesToHex(brokenXmr.privateViewKey), userId, xmrStart);
  await registerLws('wow', brokenWowAddr, bytesToHex(brokenWow.privateViewKey), userId, wowStart);

  // Wait for LWS to scan the last 1000 blocks
  console.log('\nWaiting 15s for LWS to scan...');
  await new Promise(r => setTimeout(r, 15_000));

  // Poll balance until scanned
  for (let attempt = 0; attempt < 8; attempt++) {
    const xmrBal = await getBalance('xmr', brokenXmrAddr, bytesToHex(brokenXmr.privateViewKey));
    const wowBal = await getBalance('wow', brokenWowAddr, bytesToHex(brokenWow.privateViewKey));
    console.log(`  XMR: total_received=${xmrBal.total_received}, scanned=${xmrBal.scanned_height}/${xmrBal.blockchain_height}`);
    console.log(`  WOW: total_received=${wowBal.total_received}, scanned=${wowBal.scanned_height}/${wowBal.blockchain_height}`);

    const xmrDone = xmrBal.scanned_height >= xmrBal.blockchain_height - 5;
    const wowDone = wowBal.scanned_height >= wowBal.blockchain_height - 5;
    if (xmrDone && wowDone) break;

    if (attempt < 7) {
      console.log('  Still scanning, waiting 15s...');
      await new Promise(r => setTimeout(r, 15_000));
    }
  }

  // Sweep XMR
  console.log('\n=== Sweeping XMR ===');
  try {
    const xmrTx = await sweepAsset('xmr', brokenXmr, brokenXmrAddr, correctXmrAddr);
    if (xmrTx) console.log(`  XMR sweep tx: ${xmrTx}`);
    else console.log('  XMR: nothing to sweep');
  } catch (err) {
    console.error('  XMR sweep failed:', err instanceof Error ? err.message : err);
  }

  // Sweep WOW
  console.log('\n=== Sweeping WOW ===');
  try {
    const wowTx = await sweepAsset('wow', brokenWow, brokenWowAddr, correctWowAddr);
    if (wowTx) console.log(`  WOW sweep tx: ${wowTx}`);
    else console.log('  WOW: nothing to sweep');
  } catch (err) {
    console.error('  WOW sweep failed:', err instanceof Error ? err.message : err);
  }

  // Register correct-v3 addresses with LWS so they're ready for the new extension
  console.log('\nRegistering correct-v3 addresses with LWS...');
  await registerLws('xmr', correctXmrAddr, bytesToHex(correctXmr.privateViewKey), userId, 0);
  await registerLws('wow', correctWowAddr, bytesToHex(correctWow.privateViewKey), userId, 0);

  console.log('\nDone! Update the extension and unlock to see your balance at the correct v3 addresses.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
