/**
 * Monero/Wownero cryptographic utilities using @noble/curves (pure JS).
 *
 * Used for client-side verification of spent outputs without exposing spend key to server.
 *
 * Key image computation:
 * 1. Derive one-time private key: x = Hs(aR || outputIndex) + b
 *    where a = private view key, R = tx public key, b = private spend key
 * 2. Compute key image: KI = x * Hp(P) where P = x*G (one-time public key)
 *
 * This implementation uses Monero's exact hash_to_ec algorithm (ge_fromfe_frombytes_vartime)
 * ported from the Monero C source code.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ============================================================================
// Constants
// ============================================================================

// ed25519 field prime: p = 2^255 - 19
const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');

// ed25519 curve order (l)
const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');

// Curve25519 constant A = 486662
const A = BigInt(486662);

// sqrt(-1) mod p
const SQRT_M1 = BigInt('19681161376707505956807079304988542015446066515923890162744021073123829784752');

// Edwards curve parameter d
const D = BigInt('0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3');

// Precomputed constants for ge_fromfe_frombytes_vartime
// Values from monerolib (CoinSpace) which has a working pure JS implementation
// -A mod p
const FE_MA = mod(-A, P);
// -2*A^2 mod p
const FE_MA2 = mod(BigInt(-2) * A * A, P);
// sqrt(-2 * A * (A + 2)) mod p
const FE_FFFB1 = BigInt('0x7e71fbefdad61b1720a9c53741fb19e3d19404a8b92a738d22a76975321c41ee');
// sqrt(2 * A * (A + 2)) mod p
const FE_FFFB2 = BigInt('0x32f9e1f5fba5d3096e2bae483fe9a041ae21fcb9fba908202d219b7c9f83650d');
// sqrt(-sqrt(-1) * A * (A + 2)) mod p
const FE_FFFB3 = BigInt('0x1a43f3031067dbf926c0f4887ef7432eee46fc08a13f4a49853d1903b6b39186');
// sqrt(sqrt(-1) * A * (A + 2)) mod p
const FE_FFFB4 = BigInt('0x674a110d14c208efb89546403f0da2ed4024ff4ea5964229581b7d8717302c66');

// ============================================================================
// Field Arithmetic Helpers
// ============================================================================

/**
 * Modular reduction (always positive result)
 */
function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

/**
 * Modular addition
 */
function feAdd(a: bigint, b: bigint): bigint {
  return mod(a + b, P);
}

/**
 * Modular subtraction
 */
function feSub(a: bigint, b: bigint): bigint {
  return mod(a - b, P);
}

/**
 * Modular multiplication
 */
function feMul(a: bigint, b: bigint): bigint {
  return mod(a * b, P);
}

/**
 * Modular squaring
 */
function feSq(a: bigint): bigint {
  return mod(a * a, P);
}

/**
 * Compute 2*a^2 mod p
 */
function feSq2(a: bigint): bigint {
  return mod(2n * a * a, P);
}

/**
 * Modular negation
 */
function feNeg(a: bigint): bigint {
  return mod(-a, P);
}

/**
 * Check if field element is non-zero
 */
function feIsNonzero(a: bigint): boolean {
  return mod(a, P) !== 0n;
}

/**
 * Check if field element is negative (LSB is 1)
 */
function feIsNegative(a: bigint): boolean {
  return (mod(a, P) & 1n) === 1n;
}

/**
 * Modular exponentiation
 */
function fePow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  base = mod(base, P);
  while (exp > 0n) {
    if (exp & 1n) {
      result = mod(result * base, P);
    }
    exp >>= 1n;
    base = mod(base * base, P);
  }
  return result;
}

/**
 * Modular inverse using Fermat's little theorem: a^(-1) = a^(p-2) mod p
 */
function feInv(a: bigint): bigint {
  return fePow(a, P - 2n);
}

/**
 * Compute (u/v)^((p+3)/8) mod p
 * This is the core operation for square root computation in Monero.
 */
function feDivPowM1(u: bigint, v: bigint): bigint {
  // Compute (u/v)^((p+3)/8)
  // = u * v^(-1) ^ ((p+3)/8)
  // = u^((p+3)/8) * v^((p+3)/8 * -(p-2))
  // But it's easier to compute u*v^7 * (u*v^7)^((p-5)/8)

  // v^3
  const v3 = feMul(feSq(v), v);
  // v^7
  const v7 = feMul(feSq(v3), v);
  // u * v^7
  const uv7 = feMul(u, v7);

  // (u * v^7)^((p-5)/8)
  // (p-5)/8 = (2^255 - 19 - 5) / 8 = 2^252 - 3
  const exp = (P - 5n) / 8n;
  const powered = fePow(uv7, exp);

  // u * v^3 * (u * v^7)^((p-5)/8)
  return feMul(feMul(u, v3), powered);
}

// ============================================================================
// Monero's ge_fromfe_frombytes_vartime implementation
// ============================================================================

/**
 * Load 32 bytes as a field element (little-endian).
 * This matches Monero's fe_frombytes.
 */
function feFromBytes(bytes: Uint8Array): bigint {
  // Simple little-endian load, then reduce mod p
  let n = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return mod(n, P);
}

/**
 * Convert field element to 32-byte little-endian representation
 */
function feToBytes(n: bigint): Uint8Array {
  n = mod(n, P);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return result;
}

/**
 * ge_fromfe_frombytes_vartime - Monero's hash-to-point function.
 *
 * This maps a 32-byte hash to a point on the Edwards curve using
 * an Elligator-like construction specific to Monero.
 *
 * Implementation follows monerolib (CoinSpace) which has a verified working implementation.
 *
 * Returns the point as compressed Edwards format (32 bytes).
 */
function geFromFeFromBytesVartime(s: Uint8Array): Uint8Array {
  const u = feFromBytes(s);

  // v = 2 * u^2
  const v = feSq2(u);
  // w = 2 * u^2 + 1 = v + 1
  const w = feAdd(v, 1n);
  // t = w^2 - A^2 * v
  const A_sq = feSq(A);
  const t = feSub(feSq(w), feMul(A_sq, v));
  // x = sqrt(w / t) = (w/t)^((p+3)/8) candidate
  let x = feDivPowM1(w, t);

  let negative = false;

  // check = w - x^2 * t
  let check = feSub(w, feMul(feSq(x), t));

  if (feIsNonzero(check)) {
    // check = w + x^2 * t
    check = feAdd(w, feMul(feSq(x), t));
    if (feIsNonzero(check)) {
      negative = true;
    } else {
      // x = x * fffb1
      x = feMul(x, FE_FFFB1);
    }
  } else {
    // x = x * fffb2
    x = feMul(x, FE_FFFB2);
  }

  let odd: boolean;
  let r: bigint;

  if (!negative) {
    odd = false;
    // r = -A * v
    r = feMul(feNeg(A), v);
    // x = x * u
    x = feMul(x, u);
  } else {
    odd = true;
    // r = -A
    r = feNeg(A);
    // check = w - sqrtm1 * x^2 * t
    check = feSub(w, feMul(feMul(feSq(x), t), SQRT_M1));
    if (feIsNonzero(check)) {
      // check = w + sqrtm1 * x^2 * t  (should be zero here)
      // x = x * fffb3
      x = feMul(x, FE_FFFB3);
    } else {
      // x = x * fffb4
      x = feMul(x, FE_FFFB4);
    }
  }

  // if x.isOdd() !== odd, negate x
  const xIsOdd = (mod(x, P) & 1n) === 1n;
  if (xIsOdd !== odd) {
    x = feNeg(x);
  }

  // z = r + w
  const z = feAdd(r, w);
  // y = r - w
  const y = feSub(r, w);
  // x = x * z
  x = feMul(x, z);

  // Convert from projective (X:Y:Z) to affine, then to compressed Edwards format
  // Affine xAff = X/Z, yAff = Y/Z
  const zInv = feInv(z);
  const affineX = feMul(x, zInv);
  const affineY = feMul(y, zInv);

  // Compressed format: y with sign bit of x in highest bit
  const compressed = feToBytes(affineY);
  if ((mod(affineX, P) & 1n) === 1n) {
    compressed[31] ^= 0x80;
  }

  return compressed;
}

/**
 * Multiply a point by 8 (cofactor clearing).
 */
function geMul8(point: Uint8Array): Uint8Array {
  try {
    const p = ed25519.ExtendedPoint.fromHex(point);
    const p8 = p.multiply(8n);
    return p8.toRawBytes();
  } catch {
    // If point decoding fails, return as-is
    return point;
  }
}

/**
 * hash_to_ec - Monero's complete hash-to-point function.
 *
 * 1. Hash the input with Keccak-256 (cn_fast_hash)
 * 2. Map the hash to a curve point (ge_fromfe_frombytes_vartime)
 * 3. Multiply by 8 (cofactor clearing)
 */
function hashToEc(data: Uint8Array): Uint8Array {
  // Step 1: Keccak-256 hash
  const hash = keccak_256(data);

  // Step 2: Map to curve point
  const point = geFromFeFromBytesVartime(hash);

  // Step 3: Multiply by cofactor 8
  const cleared = geMul8(point);

  return cleared;
}

// ============================================================================
// Scalar Operations
// ============================================================================

/**
 * Reduce a 64-byte hash to a valid ed25519 scalar (mod l).
 * Monero uses little-endian byte order.
 */
function scReduce(hash: Uint8Array): Uint8Array {
  // Convert 64-byte hash to BigInt (little-endian)
  let n = 0n;
  for (let i = hash.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(hash[i]);
  }

  // Reduce mod l
  n = n % L;

  // Convert back to 32-byte little-endian
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
  return result;
}

/**
 * Reduce a 32-byte value to a valid ed25519 scalar (mod l).
 */
function scReduce32(bytes: Uint8Array): Uint8Array {
  // Convert 32-byte to BigInt (little-endian)
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }

  // Reduce mod l
  n = n % L;

  // Convert back to 32-byte little-endian
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
  return result;
}

/**
 * Add two scalars mod l.
 */
function scAdd(a: Uint8Array, b: Uint8Array): Uint8Array {
  let an = 0n;
  let bn = 0n;
  for (let i = a.length - 1; i >= 0; i--) {
    an = (an << 8n) | BigInt(a[i]);
    bn = (bn << 8n) | BigInt(b[i]);
  }

  let sum = (an + bn) % L;

  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(sum & 0xffn);
    sum = sum >> 8n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return n;
}

/**
 * Hs() - Hash to scalar using Keccak-256.
 * Takes arbitrary data, hashes with Keccak-256, reduces mod l.
 */
function hashToScalar(data: Uint8Array): Uint8Array {
  // Monero uses Keccak-256, then reduces the 32-byte output
  const hash = keccak_256(data);
  return scReduce32(hash);
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive the one-time private key for an output.
 *
 * x = Hs(a*R || outputIndex) + b
 *
 * where:
 * - a = private view key
 * - R = transaction public key
 * - b = private spend key
 */
function deriveOneTimePrivateKey(
  txPublicKey: Uint8Array,
  privateViewKey: Uint8Array,
  privateSpendKey: Uint8Array,
  outputIndex: number
): Uint8Array {
  // Compute a*R (shared secret)
  // The tx public key R is a point, we multiply by view key scalar
  try {
    const R = ed25519.ExtendedPoint.fromHex(txPublicKey);
    const a = bytesToBigInt(scReduce32(privateViewKey));
    const aR = R.multiply(a);
    const aRBytes = aR.toRawBytes();

    // Concatenate aR || outputIndex as varint
    // Monero uses varint encoding for output index
    const varint = encodeVarint(outputIndex);
    const derivationData = new Uint8Array(aRBytes.length + varint.length);
    derivationData.set(aRBytes);
    derivationData.set(varint, aRBytes.length);

    // Hs(aR || outputIndex)
    const hs = hashToScalar(derivationData);

    // x = Hs(...) + b
    const x = scAdd(hs, scReduce32(privateSpendKey));

    return x;
  } catch (err) {
    console.error('[monero-crypto] Failed to derive one-time key:', err);
    throw err;
  }
}

/**
 * Encode an integer as a Monero varint (variable-length integer).
 */
function encodeVarint(n: number): Uint8Array {
  const bytes: number[] = [];
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return new Uint8Array(bytes);
}

// ============================================================================
// Key Image Generation
// ============================================================================

/**
 * Generate a key image for an output.
 *
 * Key image: KI = x * Hp(P)
 * where x is the one-time private key and P = x*G is the one-time public key.
 *
 * @param txPublicKey - Transaction public key (hex)
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex) - not used in this derivation
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @param outputIndex - Output index within transaction
 * @returns The computed key image (hex string)
 */
export function generateKeyImage(
  txPublicKey: string,
  privateViewKey: string,
  _publicSpendKey: string,
  privateSpendKey: string,
  outputIndex: number
): string {
  const txPubKeyBytes = hexToBytes(txPublicKey);
  const viewKeyBytes = hexToBytes(privateViewKey);
  const spendKeyBytes = hexToBytes(privateSpendKey);

  // Derive one-time private key
  const x = deriveOneTimePrivateKey(txPubKeyBytes, viewKeyBytes, spendKeyBytes, outputIndex);

  // Compute one-time public key P = x*G
  const xBigInt = bytesToBigInt(x);
  const P = ed25519.ExtendedPoint.BASE.multiply(xBigInt);
  const PBytes = P.toRawBytes();

  // Compute Hp(P) using Monero's hash_to_ec
  const HpP = hashToEc(PBytes);

  // Key image KI = x * Hp(P)
  try {
    const HpPPoint = ed25519.ExtendedPoint.fromHex(HpP);
    const KI = HpPPoint.multiply(xBigInt);
    return bytesToHex(KI.toRawBytes());
  } catch (err) {
    console.error('[monero-crypto] Failed to compute key image:', err);
    throw err;
  }
}

// ============================================================================
// Test function for hash_to_ec
// ============================================================================

/**
 * Test hash_to_ec against Monero test vectors.
 * Returns true if the test passes.
 */
export function testHashToEc(inputHex: string, expectedOutputHex: string): boolean {
  const input = hexToBytes(inputHex);
  const result = hashToEc(input);
  const resultHex = bytesToHex(result);
  const matches = resultHex.toLowerCase() === expectedOutputHex.toLowerCase();
  if (!matches) {
    console.log(`[monero-crypto] hash_to_ec test FAILED`);
    console.log(`  Input:    ${inputHex}`);
    console.log(`  Expected: ${expectedOutputHex}`);
    console.log(`  Got:      ${resultHex}`);
  }
  return matches;
}

/**
 * Test hash_to_point (ge_fromfe_frombytes_vartime without the initial hash).
 * This tests the direct field element to point mapping.
 * Returns true if the test passes.
 */
export function testHashToPoint(inputHex: string, expectedOutputHex: string): boolean {
  const input = hexToBytes(inputHex);
  // hash_to_point does NOT hash the input, it directly maps to a point
  const point = geFromFeFromBytesVartime(input);
  const resultHex = bytesToHex(point);
  const matches = resultHex.toLowerCase() === expectedOutputHex.toLowerCase();
  if (!matches) {
    console.log(`[monero-crypto] hash_to_point test FAILED`);
    console.log(`  Input:    ${inputHex}`);
    console.log(`  Expected: ${expectedOutputHex}`);
    console.log(`  Got:      ${resultHex}`);
  }
  return matches;
}

// ============================================================================
// Balance Verification API
// ============================================================================

/**
 * Spent output candidate from the server.
 */
export interface SpentOutputCandidate {
  amount: number;
  key_image: string;
  tx_pub_key: string;
  out_index: number;
}

/**
 * Verify which spent outputs actually belong to this wallet.
 *
 * Computes key images locally using the spend key and compares
 * with the server-provided key images. Only returns outputs where
 * the key images match (i.e., actually spent by this wallet).
 *
 * @param spentOutputs - Candidate spent outputs from server
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex)
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @returns Array of verified spent outputs with their amounts
 */
export async function verifySpentOutputs(
  spentOutputs: SpentOutputCandidate[],
  privateViewKey: string,
  publicSpendKey: string,
  privateSpendKey: string
): Promise<SpentOutputCandidate[]> {
  if (spentOutputs.length === 0) {
    return [];
  }

  const verified: SpentOutputCandidate[] = [];

  for (const output of spentOutputs) {
    try {
      const computedKeyImage = generateKeyImage(
        output.tx_pub_key,
        privateViewKey,
        publicSpendKey,
        privateSpendKey,
        output.out_index
      );

      // Compare computed key image with server's key image
      if (computedKeyImage.toLowerCase() === output.key_image.toLowerCase()) {
        verified.push(output);
        console.log(
          `[monero-crypto] Verified spent output: ${output.amount} (key_image matches)`
        );
      } else {
        console.log(
          `[monero-crypto] Spent output NOT ours: key_image mismatch`,
          { server: output.key_image, computed: computedKeyImage }
        );
      }
    } catch (err) {
      console.error(`[monero-crypto] Error verifying spent output:`, err, output);
    }
  }

  return verified;
}

/**
 * Calculate the true balance after verifying spent outputs.
 *
 * @param totalReceived - Total received from server (view-only balance)
 * @param spentOutputs - Candidate spent outputs from server
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex)
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @returns The true balance after subtracting verified spends
 */
export async function calculateVerifiedBalance(
  totalReceived: number,
  spentOutputs: SpentOutputCandidate[],
  privateViewKey: string,
  publicSpendKey: string,
  privateSpendKey: string
): Promise<{
  balance: number;
  verifiedSpentAmount: number;
  verifiedSpentCount: number;
  hashToEcImplemented: boolean;
}> {
  try {
    const verified = await verifySpentOutputs(
      spentOutputs,
      privateViewKey,
      publicSpendKey,
      privateSpendKey
    );

    const verifiedSpentAmount = verified.reduce((sum, o) => sum + o.amount, 0);
    const balance = totalReceived - verifiedSpentAmount;

    return {
      balance: Math.max(0, balance), // Never negative
      verifiedSpentAmount,
      verifiedSpentCount: verified.length,
      hashToEcImplemented: true,
    };
  } catch (err) {
    console.error('[monero-crypto] Error calculating balance:', err);
    // Fall back to view-only balance on error
    return {
      balance: totalReceived,
      verifiedSpentAmount: 0,
      verifiedSpentCount: 0,
      hashToEcImplemented: false,
    };
  }
}
