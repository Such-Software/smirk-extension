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
import { ed25519 } from '@noble/curves/ed25519';

// BIP44 coin types (from SLIP-0044)
const COIN_TYPES = {
  btc: 0,
  ltc: 2,
  // XMR/WOW/Grin don't use standard BIP44 - we derive custom
} as const;

/** Grin key set - ed25519 for slatepack addresses */
export interface GrinKeys {
  /** Private key (32 bytes) - ed25519 scalar */
  privateKey: Uint8Array;
  /** Public key (32 bytes) - ed25519 point, used for slatepack address */
  publicKey: Uint8Array;
}

export interface DerivedKeys {
  btc: { privateKey: Uint8Array; publicKey: Uint8Array };
  ltc: { privateKey: Uint8Array; publicKey: Uint8Array };
  xmr: CryptonoteKeys;
  wow: CryptonoteKeys;
  grin: GrinKeys;
}

/** Monero/Wownero key set */
export interface CryptonoteKeys {
  /** Private spend key (32 bytes) - for signing transactions */
  privateSpendKey: Uint8Array;
  /** Private view key (32 bytes) - for scanning blockchain, register with LWS */
  privateViewKey: Uint8Array;
  /** Public spend key (32 bytes) - part of address */
  publicSpendKey: Uint8Array;
  /** Public view key (32 bytes) - part of address */
  publicViewKey: Uint8Array;
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
 * Computes a seed fingerprint for restore validation.
 * Format: hex(SHA256(SHA256(bip39_seed))) = 64 hex chars (256 bits)
 *
 * This fingerprint is stored in the backend when creating a wallet,
 * and used to verify that a restore attempt is for a Smirk-created wallet.
 *
 * Security: 256 bits provides collision resistance of 2^128, making
 * brute-force collision attacks infeasible.
 */
export function computeSeedFingerprint(mnemonic: string, passphrase = ''): string {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  // Double SHA256
  const hash1 = sha256(seed);
  const hash2 = sha256(hash1);
  // Use full 256-bit hash (64 hex chars)
  return Array.from(hash2)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
 * 2. Hash to get private spend key (reduced mod l for valid scalar)
 * 3. Hash private spend key to get private view key (also reduced)
 * 4. Derive public keys via ed25519 scalar multiplication
 *
 * IMPORTANT: Private keys must be stored as reduced scalars (mod l),
 * not raw hash bytes. This ensures the stored private key matches
 * the one used to derive the public key in the address.
 *
 * This is NOT the same as Monero's native 25-word seed,
 * but provides deterministic derivation from our BIP39 master.
 */
function deriveCryptonoteKeys(
  masterSeed: Uint8Array,
  coinId: string
): CryptonoteKeys {
  // Domain separation: hash master seed with coin identifier
  const domainSeparator = new TextEncoder().encode(`smirk:${coinId}:v1`);
  const combined = new Uint8Array(masterSeed.length + domainSeparator.length);
  combined.set(masterSeed);
  combined.set(domainSeparator, masterSeed.length);

  // Derive private spend key seed
  const spendKeySeed = sha256(combined);
  // Reduce to valid ed25519 scalar - this is Monero's sc_reduce32
  const spendKeyScalar = bytesToScalar(spendKeySeed);
  const privateSpendKey = scalarToBytes(spendKeyScalar);

  // Derive private view key from private spend key (Monero standard: Hs(private_spend_key))
  // Hash the REDUCED private spend key, then reduce the result
  const viewKeySeed = sha256(privateSpendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  const privateViewKey = scalarToBytes(viewKeyScalar);

  // Derive public keys from private keys using ed25519
  // public key = private_scalar * G (base point)
  const publicSpendKey = ed25519.ExtendedPoint.BASE.multiply(
    spendKeyScalar
  ).toRawBytes();

  const publicViewKey = ed25519.ExtendedPoint.BASE.multiply(
    viewKeyScalar
  ).toRawBytes();

  return {
    privateSpendKey,
    privateViewKey,
    publicSpendKey,
    publicViewKey,
  };
}

/**
 * Converts a 32-byte array to a BigInt scalar for ed25519.
 * Reads as little-endian (Monero convention).
 * Reduces mod l to ensure valid scalar.
 */
function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = 0; i < 32; i++) {
    scalar += BigInt(bytes[i]) << BigInt(8 * i);
  }
  // Reduce mod l (ed25519 curve order) to ensure valid scalar
  const l = 2n ** 252n + 27742317777372353535851937790883648493n;
  return scalar % l;
}

/**
 * Converts a BigInt scalar to a 32-byte array.
 * Writes as little-endian (Monero convention).
 */
function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Derives Grin keys from master seed.
 *
 * Grin slatepack addresses are ed25519 public keys used for:
 * - Tor onion service addresses (for receiving transactions)
 * - Encryption of slate data during transaction building
 *
 * Note: Grin has NO on-chain addresses - Mimblewimble transactions
 * are interactive and don't contain recipient addresses.
 */
function deriveGrinKey(masterSeed: Uint8Array): GrinKeys {
  const domainSeparator = new TextEncoder().encode('smirk:grin:v1');
  const combined = new Uint8Array(masterSeed.length + domainSeparator.length);
  combined.set(masterSeed);
  combined.set(domainSeparator, masterSeed.length);

  // Hash to get key seed, then reduce to valid ed25519 scalar
  const keySeed = sha256(combined);
  const keyScalar = bytesToScalar(keySeed);
  const privateKey = scalarToBytes(keyScalar);

  // Derive public key via ed25519 scalar multiplication
  const publicKey = ed25519.ExtendedPoint.BASE.multiply(keyScalar).toRawBytes();

  return { privateKey, publicKey };
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
