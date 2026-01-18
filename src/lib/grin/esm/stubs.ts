/**
 * Stub classes for MWC wallet dependencies.
 *
 * The MWC wallet code references Tor, Wallet, and HardwareWallet classes
 * that we don't need for basic slatepack operations. This module provides
 * minimal stubs with the constants needed to avoid runtime errors.
 *
 * NOTE: Tor address functions are stubbed to throw errors since we don't
 * use payment proofs with Tor addresses in the extension.
 */

// Tor class - minimal stub (no actual Tor support needed)
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
  static browserSupportsTor: boolean | null = false;

  /**
   * Convert Ed25519 public key to Tor v3 onion address.
   * Not implemented - we don't use Tor payment proofs.
   */
  static publicKeyToTorAddress(_publicKey: Uint8Array): string {
    throw new Error('Tor address conversion not supported in extension');
  }

  /**
   * Convert Tor v3 onion address to Ed25519 public key.
   * Not implemented - we don't use Tor payment proofs.
   */
  static torAddressToPublicKey(_torAddress: string): Uint8Array {
    throw new Error('Tor address conversion not supported in extension');
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
