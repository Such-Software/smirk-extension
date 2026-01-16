/**
 * Stub classes for MWC wallet dependencies.
 *
 * The MWC wallet code references Tor, Wallet, and HardwareWallet classes
 * that we don't need for basic slatepack operations. This module provides
 * minimal stubs with the constants needed to avoid runtime errors.
 *
 * Tor address functions are implemented using sha3 from @noble/hashes
 * and base32 from hi-base32 (which we import below).
 */

import { sha3_256 } from '@noble/hashes/sha3';
import base32 from 'hi-base32';

// Tor class - provides onion address encoding/decoding
// Used for payment proof address verification
export class Tor {
  // Constants
  static get ADDRESS_LENGTH(): number {
    return 56;
  }

  static get URL_TOP_LEVEL_DOMAIN(): string {
    return '.onion';
  }

  static get ADDRESS_CHECKSUM_SEED(): string {
    return '.onion checksum';
  }

  static get ADDRESS_VERSION(): number {
    return 3;
  }

  static get ADDRESS_CHECKSUM_LENGTH(): number {
    return 2;
  }

  static get URL_PATTERN(): RegExp {
    return /^[^:]+:\/\/.+\.onion$/i;
  }

  static get SUPPORT_UNKNOWN(): null {
    return null;
  }

  // Static state
  static browserSupportsTor: boolean | null = null;

  /**
   * Convert Ed25519 public key to Tor v3 onion address.
   * Uses SHA3-256 for checksum calculation.
   */
  static publicKeyToTorAddress(publicKey: Uint8Array): string {
    // Check if public key has correct length (ED25519 = 32 bytes)
    if (publicKey.length !== 32) {
      throw new Error('Invalid public key.');
    }

    // Build checksum input: seed + public key + version
    const seed = new TextEncoder().encode(Tor.ADDRESS_CHECKSUM_SEED);
    const checksumInput = new Uint8Array(seed.length + publicKey.length + 1);
    checksumInput.set(seed, 0);
    checksumInput.set(publicKey, seed.length);
    checksumInput[seed.length + publicKey.length] = Tor.ADDRESS_VERSION;

    // Get SHA3-256 hash and take first 2 bytes as checksum
    const checksum = sha3_256(checksumInput);

    // Combine: public key (32) + checksum (2) + version (1) = 35 bytes
    const combined = new Uint8Array(35);
    combined.set(publicKey, 0);
    combined.set(checksum.subarray(0, Tor.ADDRESS_CHECKSUM_LENGTH), 32);
    combined[34] = Tor.ADDRESS_VERSION;

    // Encode as base32 lowercase (56 chars)
    return base32.encode(combined).toLowerCase();
  }

  /**
   * Convert Tor v3 onion address to Ed25519 public key.
   */
  static torAddressToPublicKey(torAddress: string): Uint8Array {
    // Check length (56 characters)
    if (torAddress.length !== Tor.ADDRESS_LENGTH) {
      throw new Error('Invalid Tor address.');
    }

    // Check lowercase
    if (torAddress !== torAddress.toLowerCase()) {
      throw new Error('Invalid Tor address.');
    }

    // Decode base32
    let decodedAddress: Uint8Array;
    try {
      decodedAddress = new Uint8Array(base32.decode.asBytes(torAddress.toUpperCase()));
    } catch {
      throw new Error('Invalid Tor address.');
    }

    // Check decoded length (32 bytes pubkey + 2 bytes checksum + 1 byte version = 35)
    if (decodedAddress.length !== 35) {
      throw new Error('Invalid Tor address.');
    }

    // Extract public key
    const publicKey = decodedAddress.subarray(0, 32);

    // Verify checksum
    const seed = new TextEncoder().encode(Tor.ADDRESS_CHECKSUM_SEED);
    const checksumInput = new Uint8Array(seed.length + 32 + 1);
    checksumInput.set(seed, 0);
    checksumInput.set(publicKey, seed.length);
    checksumInput[seed.length + 32] = Tor.ADDRESS_VERSION;

    const expectedChecksum = sha3_256(checksumInput);
    const actualChecksum = decodedAddress.subarray(32, 34);

    if (expectedChecksum[0] !== actualChecksum[0] || expectedChecksum[1] !== actualChecksum[1]) {
      throw new Error('Invalid Tor address.');
    }

    // Verify version
    if (decodedAddress[34] !== Tor.ADDRESS_VERSION) {
      throw new Error('Invalid Tor address.');
    }

    return publicKey;
  }

  // Initialize - no-op for stub
  static initialize(): Promise<void> {
    Tor.browserSupportsTor = false;
    return Promise.resolve();
  }

  // Is supported - always false for stub
  static isSupported(): boolean {
    return false;
  }

  // Is Onion Service - always false for stub
  static isOnionService(): boolean {
    return false;
  }

  // Is Tor URL
  static isTorUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return Tor.URL_PATTERN.test(parsedUrl.protocol + '//' + parsedUrl.hostname);
    } catch {
      return false;
    }
  }
}

// Wallet class - minimal stub with payment proof constant
export class Wallet {
  // Payment proof Tor address key index (from wallet.js line 4197)
  static get PAYMENT_PROOF_TOR_ADDRESS_KEY_INDEX(): number {
    return 0;
  }

  // No hardware type
  static get NO_HARDWARE_TYPE(): null {
    return null;
  }

  // Seed key - used as HMAC key for BIP39 derivation (from wallet.js line 4176)
  static get SEED_KEY(): string {
    return 'IamVoldemort';
  }

  // No BIP39 salt (from wallet.js line 4113)
  static get NO_BIP39_SALT(): null {
    return null;
  }
}

// HardwareWallet class - minimal stub with constants used by slatepack.js
export class HardwareWallet {
  // No text (null)
  static get NO_TEXT(): null {
    return null;
  }

  // No salt (null)
  static get NO_SALT(): null {
    return null;
  }

  // Encrypted slate nonce index (0)
  static get ENCRYPTED_SLATE_NONCE_INDEX(): number {
    return 0;
  }

  // Encrypted slate data index (1)
  static get ENCRYPTED_SLATE_DATA_INDEX(): number {
    return 1;
  }

  // No secret nonce index
  static get NO_SECRET_NONCE_INDEX(): null {
    return null;
  }

  // No address
  static get NO_ADDRESS(): null {
    return null;
  }

  // No kernel commit
  static get NO_KERNEL_COMMIT(): null {
    return null;
  }

  // No data
  static get NO_DATA(): null {
    return null;
  }
}
