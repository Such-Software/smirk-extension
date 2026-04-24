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
 * @param useBip39 - false (default) = HMAC-SHA512("IamVoldemort", raw_entropy) — matches grin-wallet/Grim.
 *                   true = PBKDF2 first then HMAC — MWC-style, used by pre-v3 Smirk wallets.
 * @returns Grin wallet keys
 */
export async function initGrinWallet(mnemonic: string, useBip39 = false): Promise<GrinKeys> {
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Create a Seed instance (constructor takes no arguments)
  const seedInstance = new Seed();

  // Initialize with the mnemonic string - the MWC Seed class will parse it internally
  await seedInstance.initialize(mnemonic);

  // Derive extended private key
  // Parameters: key (string), useBip39 (boolean)
  // The key parameter is the HMAC key - both MWC and grin-wallet use "IamVoldemort"
  // useBip39=false: HMAC-SHA512(key, raw_entropy) — matches grin-wallet/Grim
  // useBip39=true: PBKDF2(mnemonic) → HMAC-SHA512(key, pbkdf2_seed) — MWC-style (legacy)
  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    globalThis.Wallet.SEED_KEY,
    useBip39
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

/** Legacy MWC path for migration sweeps */
export const LEGACY_MWC_PATH = new Uint32Array([
  44 | 0x80000000,  // 44' (BIP44 purpose, hardened)
  593 | 0x80000000, // 593' (MWC coin type, hardened)
  0 | 0x80000000,   // 0' (account, hardened)
  0,                 // 0 (change)
  0,                 // 0 (address index)
]);

/**
 * Initialize Grin wallet at a specific derivation path.
 * Used for migration sweeps and path testing.
 *
 * @param useBip39 - false (default) = raw entropy HMAC (grin-wallet compat), true = PBKDF2 first (MWC/legacy)
 */
export async function initGrinWalletAtPath(mnemonic: string, path: Uint32Array, useBip39 = false): Promise<GrinKeys> {
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();
  const bech32 = getBech32();

  const seedInstance = new Seed();
  await seedInstance.initialize(mnemonic);

  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    globalThis.Wallet.SEED_KEY,
    useBip39,
    undefined, // default salt
    path
  );

  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key');
  }

  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return { secretKey, publicKey, slatepackAddress, extendedPrivateKey, addressKey };
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
