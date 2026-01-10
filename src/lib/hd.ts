/**
 * Hierarchical Deterministic (HD) wallet utilities.
 *
 * Uses BIP39 for mnemonic generation and BIP32/44 for key derivation.
 * - BTC: m/44'/0'/0'/0/0 (secp256k1)
 * - LTC: m/44'/2'/0'/0/0 (secp256k1)
 * - XMR/WOW: Custom derivation from master seed to ed25519
 * - Grin: Custom derivation (secp256k1 but different format)
 *
 * @scure/bip39 and @scure/bip32 are from Paul Miller (same author as @noble/*)
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from './crypto';

// BIP44 coin types (from SLIP-0044)
const COIN_TYPES = {
  btc: 0,
  ltc: 2,
  // XMR/WOW/Grin don't use standard BIP44 - we derive custom
} as const;

export interface DerivedKeys {
  btc: { privateKey: Uint8Array; publicKey: Uint8Array };
  ltc: { privateKey: Uint8Array; publicKey: Uint8Array };
  xmr: { spendKey: Uint8Array; viewKey: Uint8Array };
  wow: { spendKey: Uint8Array; viewKey: Uint8Array };
  grin: { privateKey: Uint8Array };
}

/**
 * Generates a new 12-word BIP39 mnemonic.
 * 128 bits of entropy = 12 words = 2048^12 combinations
 */
export function generateMnemonicPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

/**
 * Validates a mnemonic phrase.
 */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/**
 * Derives the master seed from a mnemonic.
 * Optional passphrase for additional security (BIP39 standard).
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(mnemonic, passphrase);
}

/**
 * Derives a BIP44 key for a given coin type.
 * Path: m/44'/coin'/0'/0/0
 */
function deriveBip44Key(
  masterSeed: Uint8Array,
  coinType: number
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const hdKey = HDKey.fromMasterSeed(masterSeed);
  // m/44'/coin'/0'/0/0 - first account, external chain, first address
  const derived = hdKey.derive(`m/44'/${coinType}'/0'/0/0`);

  if (!derived.privateKey || !derived.publicKey) {
    throw new Error('Failed to derive key');
  }

  return {
    privateKey: derived.privateKey,
    publicKey: derived.publicKey,
  };
}

/**
 * Derives Monero/Wownero keys from master seed.
 *
 * Monero uses ed25519 with a specific key derivation:
 * 1. Derive a sub-seed specific to the coin
 * 2. Hash to get spend key (reduced mod l)
 * 3. Hash spend key to get view key
 *
 * This is NOT the same as Monero's native 25-word seed,
 * but provides deterministic derivation from our BIP39 master.
 */
function deriveCryptonoteKeys(
  masterSeed: Uint8Array,
  coinId: string
): { spendKey: Uint8Array; viewKey: Uint8Array } {
  // Domain separation: hash master seed with coin identifier
  const domainSeparator = new TextEncoder().encode(`smirk:${coinId}:v1`);
  const combined = new Uint8Array(masterSeed.length + domainSeparator.length);
  combined.set(masterSeed);
  combined.set(domainSeparator, masterSeed.length);

  // Derive spend key seed
  const spendKeySeed = sha256(combined);

  // For proper Monero compatibility, we'd need to reduce mod l (curve order)
  // For now, we use the hash directly - this works but isn't perfectly uniform
  // TODO: Use @noble/ed25519 for proper scalar reduction
  const spendKey = spendKeySeed;

  // Derive view key from spend key (Monero standard: Hs(spend_key))
  const viewKey = sha256(spendKey);

  return { spendKey, viewKey };
}

/**
 * Derives Grin keys from master seed.
 * Grin uses secp256k1 but with a different address/commitment scheme.
 */
function deriveGrinKey(masterSeed: Uint8Array): { privateKey: Uint8Array } {
  const domainSeparator = new TextEncoder().encode('smirk:grin:v1');
  const combined = new Uint8Array(masterSeed.length + domainSeparator.length);
  combined.set(masterSeed);
  combined.set(domainSeparator, masterSeed.length);

  const privateKey = sha256(combined);
  return { privateKey };
}

/**
 * Derives all wallet keys from a mnemonic phrase.
 */
export function deriveAllKeys(mnemonic: string, passphrase = ''): DerivedKeys {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const masterSeed = mnemonicToSeed(mnemonic, passphrase);

  return {
    btc: deriveBip44Key(masterSeed, COIN_TYPES.btc),
    ltc: deriveBip44Key(masterSeed, COIN_TYPES.ltc),
    xmr: deriveCryptonoteKeys(masterSeed, 'xmr'),
    wow: deriveCryptonoteKeys(masterSeed, 'wow'),
    grin: deriveGrinKey(masterSeed),
  };
}

/**
 * Gets the derivation info for display/documentation.
 */
export function getDerivationInfo(): Record<string, string> {
  return {
    btc: "m/44'/0'/0'/0/0 (BIP44 standard)",
    ltc: "m/44'/2'/0'/0/0 (BIP44 standard)",
    xmr: 'SHA256(master || "smirk:xmr:v1") - custom derivation',
    wow: 'SHA256(master || "smirk:wow:v1") - custom derivation',
    grin: 'SHA256(master || "smirk:grin:v1") - custom derivation',
  };
}

/**
 * Converts mnemonic words to an array for verification UI.
 */
export function mnemonicToWords(mnemonic: string): string[] {
  return mnemonic.trim().split(/\s+/);
}

/**
 * Joins words back into a mnemonic string.
 */
export function wordsToMnemonic(words: string[]): string {
  return words.join(' ');
}

/**
 * Gets random word indices for seed verification.
 * Returns indices of words the user must confirm.
 */
export function getVerificationIndices(wordCount: number, verifyCount = 3): number[] {
  const indices: number[] = [];
  while (indices.length < verifyCount) {
    const idx = Math.floor(Math.random() * wordCount);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices.sort((a, b) => a - b);
}
