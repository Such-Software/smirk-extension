/**
 * Grin wallet initialization functions.
 *
 * Derives wallet keys from mnemonic or extended private key.
 */

import {
  initializeGrinWasm,
  getCrypto,
  getSeed,
  getEd25519,
  getSecp256k1Zkp,
  getBech32,
} from './loader';
import type { GrinKeys } from './types';

/**
 * Initialize the Grin wallet and return keys derived from a mnemonic.
 *
 * NOTE: The MWC wallet Seed class expects either:
 * - Raw entropy bytes (16, 20, 24, 28, or 32 bytes)
 * - A mnemonic string
 * - A number indicating seed length to generate
 *
 * It does NOT accept a 64-byte BIP39 derived seed. We must pass the mnemonic.
 *
 * @param mnemonic - The BIP39 mnemonic phrase (12 or 24 words)
 * @returns Grin wallet keys
 */
export async function initGrinWallet(mnemonic: string): Promise<GrinKeys> {
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Create a Seed instance (constructor takes no arguments)
  const seedInstance = new Seed();

  // Initialize with the mnemonic string - the MWC Seed class will parse it internally
  await seedInstance.initialize(mnemonic);

  // Derive extended private key using BIP39 derivation
  // Parameters: key (string), useBip39 (boolean), bip39Salt (optional)
  // The key parameter is the HMAC key used for derivation - MWC uses "IamVoldemort"
  // This is accessed via globalThis.Wallet.SEED_KEY (set up by stubs.ts)
  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    globalThis.Wallet.SEED_KEY,
    true
  );

  // Get the root secret key (first 32 bytes of extended private key)
  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));

  // Derive public key from secret key
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key from secret key');
  }

  // Derive slatepack address key (index 0)
  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);

  // Get Ed25519 public key for slatepack address
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  // Encode as slatepack address (bech32 with 'grin' prefix)
  const bech32 = getBech32();
  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return {
    secretKey,
    publicKey,
    slatepackAddress,
    extendedPrivateKey,
    addressKey,
  };
}

/**
 * Reconstruct Grin wallet keys from a stored extended private key.
 * This allows restoring the wallet after service worker restart without the mnemonic.
 *
 * @param extendedPrivateKey - The 64-byte extended private key
 * @returns Grin wallet keys
 */
export async function initGrinWalletFromExtendedKey(extendedPrivateKey: Uint8Array): Promise<GrinKeys> {
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Get the root secret key (first 32 bytes of extended private key)
  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));

  // Derive public key from secret key
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key from secret key');
  }

  // Derive slatepack address key (index 0)
  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);

  // Get Ed25519 public key for slatepack address
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  // Encode as slatepack address (bech32 with 'grin' prefix)
  const bech32 = getBech32();
  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return {
    secretKey,
    publicKey,
    slatepackAddress,
    extendedPrivateKey: new Uint8Array(extendedPrivateKey),
    addressKey,
  };
}
