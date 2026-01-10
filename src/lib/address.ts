/**
 * Address generation for all supported cryptocurrencies.
 *
 * - BTC: P2WPKH (bech32, bc1q...) - Native SegWit
 * - LTC: P2WPKH (bech32, ltc1q...) - Native SegWit
 * - XMR/WOW: Standard address from public spend + view keys
 * - Grin: Slatepack address
 */

import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { keccak_256 } from '@noble/hashes/sha3';

// Network prefixes
const NETWORKS = {
  btc: {
    bech32: 'bc',
    pubkeyHash: 0x00,
    scriptHash: 0x05,
  },
  ltc: {
    bech32: 'ltc',
    pubkeyHash: 0x30,
    scriptHash: 0x32,
  },
  xmr: {
    addressPrefix: 18, // Standard address
    integratedPrefix: 19,
    subaddressPrefix: 42,
  },
  wow: {
    addressPrefix: 4146, // Wo
    integratedPrefix: 4147,
    subaddressPrefix: 6810,
  },
} as const;

/**
 * Generates a Bitcoin P2WPKH (bech32) address from a compressed public key.
 */
export function btcAddress(publicKey: Uint8Array): string {
  return generateBech32Address(publicKey, NETWORKS.btc.bech32);
}

/**
 * Generates a Litecoin P2WPKH (bech32) address from a compressed public key.
 */
export function ltcAddress(publicKey: Uint8Array): string {
  return generateBech32Address(publicKey, NETWORKS.ltc.bech32);
}

/**
 * Generates a bech32 P2WPKH address.
 * witness version 0 + HASH160(pubkey)
 */
function generateBech32Address(publicKey: Uint8Array, hrp: string): string {
  // HASH160 = RIPEMD160(SHA256(pubkey))
  const hash160 = ripemd160(sha256(publicKey));

  // Witness version 0 for P2WPKH
  const witnessVersion = 0;

  // Convert to 5-bit words for bech32
  const words = bech32.toWords(hash160);

  // Prepend witness version
  const fullWords = new Uint8Array(words.length + 1);
  fullWords[0] = witnessVersion;
  fullWords.set(words, 1);

  return bech32.encode(hrp, fullWords);
}

/**
 * Generates a Monero standard address from public spend and view keys.
 * Format: prefix + public_spend_key + public_view_key + checksum
 */
export function xmrAddress(publicSpendKey: Uint8Array, publicViewKey: Uint8Array): string {
  return generateCryptonoteAddress(
    publicSpendKey,
    publicViewKey,
    NETWORKS.xmr.addressPrefix
  );
}

/**
 * Generates a Wownero standard address from public spend and view keys.
 */
export function wowAddress(publicSpendKey: Uint8Array, publicViewKey: Uint8Array): string {
  return generateCryptonoteAddress(
    publicSpendKey,
    publicViewKey,
    NETWORKS.wow.addressPrefix
  );
}

/**
 * Generates a Cryptonote (Monero-style) address.
 * Uses base58 with a 4-byte Keccak checksum.
 */
function generateCryptonoteAddress(
  publicSpendKey: Uint8Array,
  publicViewKey: Uint8Array,
  prefix: number
): string {
  // Build the data: prefix + spend key + view key
  const prefixBytes = encodeVarint(prefix);
  const data = new Uint8Array(prefixBytes.length + 32 + 32);
  data.set(prefixBytes, 0);
  data.set(publicSpendKey, prefixBytes.length);
  data.set(publicViewKey, prefixBytes.length + 32);

  // Calculate Keccak-256 checksum (first 4 bytes)
  const hash = keccak_256(data);
  const checksum = hash.slice(0, 4);

  // Combine data + checksum
  const fullData = new Uint8Array(data.length + 4);
  fullData.set(data, 0);
  fullData.set(checksum, data.length);

  // Encode with Monero's base58 (8-byte blocks)
  return cnBase58Encode(fullData);
}

/**
 * Encodes a number as a varint (used in Cryptonote addresses).
 */
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>= 7;
  }
  bytes.push(value);
  return new Uint8Array(bytes);
}

/**
 * Monero base58 alphabet (different from Bitcoin's).
 */
const CN_BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes data using Monero's base58 (8-byte block encoding).
 * This is NOT the same as standard base58 or base58check.
 */
function cnBase58Encode(data: Uint8Array): string {
  const fullBlockSize = 8;
  const fullEncodedBlockSize = 11;

  // Process in 8-byte blocks
  let result = '';
  for (let i = 0; i < data.length; i += fullBlockSize) {
    const blockSize = Math.min(fullBlockSize, data.length - i);
    const block = data.slice(i, i + blockSize);

    // Convert block to big integer
    let num = 0n;
    for (let j = 0; j < block.length; j++) {
      num = num * 256n + BigInt(block[j]);
    }

    // Convert to base58
    let encoded = '';
    const encodedSize = blockSize === fullBlockSize ? fullEncodedBlockSize : getEncodedBlockSize(blockSize);

    for (let j = 0; j < encodedSize; j++) {
      const remainder = num % 58n;
      num = num / 58n;
      encoded = CN_BASE58_ALPHABET[Number(remainder)] + encoded;
    }

    result += encoded;
  }

  return result;
}

/**
 * Returns the encoded size for a partial block.
 */
function getEncodedBlockSize(blockSize: number): number {
  // Mapping from raw block size to encoded size
  const sizes = [0, 2, 3, 5, 6, 7, 9, 10, 11];
  return sizes[blockSize];
}

/**
 * Generates a Grin slatepack address from a public key.
 * Format: grin1... (bech32m encoded)
 */
export function grinSlatpackAddress(publicKey: Uint8Array): string {
  // Grin slatepack addresses use bech32m with 'grin' HRP
  // The public key is derived from the wallet's master key
  // For simplicity, we'll use the first 32 bytes of the key material

  // Hash the key to get consistent 32-byte output
  const keyHash = sha256(publicKey);

  // Convert to 5-bit words for bech32m
  const words = bech32m.toWords(keyHash);

  return bech32m.encode('grin', words);
}

/**
 * Validates a Bitcoin address (bech32 format).
 */
export function isValidBtcAddress(address: string): boolean {
  try {
    const decoded = bech32.decode(address);
    return decoded.prefix === 'bc' && decoded.words.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validates a Litecoin address (bech32 format).
 */
export function isValidLtcAddress(address: string): boolean {
  try {
    const decoded = bech32.decode(address);
    return decoded.prefix === 'ltc' && decoded.words.length > 0;
  } catch {
    return false;
  }
}

/**
 * Hex string to Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
