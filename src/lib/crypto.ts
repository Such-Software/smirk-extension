/**
 * Cryptographic utilities for Smirk wallet.
 *
 * Uses WebCrypto API and noble libraries for:
 * - Key generation (secp256k1 for BTC/LTC, ed25519 for XMR/WOW/Grin)
 * - ECDH key agreement for encrypted tips
 * - XChaCha20-Poly1305 authenticated encryption
 * - Password-based key derivation (PBKDF2 via WebCrypto)
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/hashes/utils';

// Re-export for convenience
export { randomBytes };

/**
 * Generates a random 32-byte private key for secp256k1.
 */
export function generatePrivateKey(): Uint8Array {
  return secp256k1.utils.randomPrivateKey();
}

/**
 * Derives the public key from a private key.
 */
export function getPublicKey(privateKey: Uint8Array, compressed = true): Uint8Array {
  return secp256k1.getPublicKey(privateKey, compressed);
}

/**
 * Performs ECDH to derive a shared secret.
 * Used for encrypting tip keys to recipients.
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const sharedPoint = secp256k1.getSharedSecret(privateKey, publicKey);
  // Hash the shared point to get a uniform 32-byte key
  return sha256(sharedPoint);
}

/**
 * Encrypts data using XChaCha20-Poly1305.
 * Returns: nonce (24 bytes) || ciphertext || tag (16 bytes)
 */
export function encrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(data);

  // Concatenate nonce + ciphertext (includes tag)
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

/**
 * Decrypts data encrypted with encrypt().
 */
export function decrypt(encryptedData: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = encryptedData.slice(0, 24);
  const ciphertext = encryptedData.slice(24);

  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Derives an encryption key from a password using PBKDF2.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const keyBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  return new Uint8Array(keyBits);
}

/**
 * Encrypts a private key for storage, using password-derived key.
 */
export async function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string
): Promise<{ encrypted: string; salt: string }> {
  const salt = randomBytes(16);
  const key = await deriveKeyFromPassword(password, salt);
  const encrypted = encrypt(privateKey, key);

  return {
    encrypted: bytesToHex(encrypted),
    salt: bytesToHex(salt),
  };
}

/**
 * Decrypts a stored private key.
 */
export async function decryptPrivateKey(
  encryptedHex: string,
  saltHex: string,
  password: string
): Promise<Uint8Array> {
  const encrypted = hexToBytes(encryptedHex);
  const salt = hexToBytes(saltHex);
  const key = await deriveKeyFromPassword(password, salt);

  return decrypt(encrypted, key);
}

/**
 * Creates an encrypted tip payload.
 *
 * For encrypted tips:
 * 1. Generate ephemeral keypair
 * 2. ECDH with recipient's public key
 * 3. Encrypt tip private key with shared secret
 *
 * Returns the encrypted blob and ephemeral public key.
 */
export function createEncryptedTipPayload(
  tipPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): { encryptedKey: string; ephemeralPubkey: string } {
  // Generate ephemeral keypair
  const ephemeralPrivate = generatePrivateKey();
  const ephemeralPublic = getPublicKey(ephemeralPrivate);

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(ephemeralPrivate, recipientPublicKey);

  // Encrypt the tip private key
  const encryptedKey = encrypt(tipPrivateKey, sharedSecret);

  return {
    encryptedKey: bytesToHex(encryptedKey),
    ephemeralPubkey: bytesToHex(ephemeralPublic),
  };
}

/**
 * Decrypts a tip payload using the recipient's private key.
 */
export function decryptTipPayload(
  encryptedKeyHex: string,
  ephemeralPubkeyHex: string,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  const encryptedKey = hexToBytes(encryptedKeyHex);
  const ephemeralPubkey = hexToBytes(ephemeralPubkeyHex);

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(recipientPrivateKey, ephemeralPubkey);

  // Decrypt the tip private key
  return decrypt(encryptedKey, sharedSecret);
}

/**
 * Creates a public (non-encrypted) tip payload.
 * The key in the URL fragment is used directly for encryption.
 */
export function createPublicTipPayload(
  tipPrivateKey: Uint8Array,
  urlFragmentKey: Uint8Array
): string {
  const encrypted = encrypt(tipPrivateKey, urlFragmentKey);
  return bytesToHex(encrypted);
}

/**
 * Decrypts a public tip payload using the URL fragment key.
 */
export function decryptPublicTipPayload(
  encryptedKeyHex: string,
  urlFragmentKey: Uint8Array
): Uint8Array {
  const encrypted = hexToBytes(encryptedKeyHex);
  return decrypt(encrypted, urlFragmentKey);
}

// ============================================================================
// Utility functions
// ============================================================================

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generates a URL-safe random key for public tips.
 * Returns both the raw bytes and base64url encoded string.
 */
export function generateUrlFragmentKey(): { bytes: Uint8Array; encoded: string } {
  const bytes = randomBytes(32);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return { bytes, encoded };
}

/**
 * Decodes a URL fragment key from base64url.
 */
export function decodeUrlFragmentKey(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
