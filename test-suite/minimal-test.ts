/**
 * Minimal test of ge_fromfe_frombytes_vartime.
 */

import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { ed25519 } from '@noble/curves/ed25519';

const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');
const A = BigInt(486662);
const SQRT_M1 = BigInt('19681161376707505956807079304988542015446066515923890162744021073123829784752');

function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

const FE_MA = mod(-A, P);
const FE_MA2 = mod(BigInt(-2) * A * A, P);
const FE_FFFB1 = BigInt('0x7e71fbefdad61b1720a9c53741fb19e3d19404a8b92a738d22a76975321c41ee');
const FE_FFFB2 = BigInt('0x4d061e0a045a2cf691d451b7c0165fbe51de03460456f7dfd2de6483607c9ae0');
const FE_FFFB3 = BigInt('0x674a110d14c208efb89546403f0da2ed4024ff4ea5964229581b7d8717302c66');
const FE_FFFB4 = BigInt('0x1a43f3031067dbf926c0f4887ef7432eee46fc08a13f4a49853d1903b6b39186');

function feAdd(a: bigint, b: bigint): bigint { return mod(a + b, P); }
function feSub(a: bigint, b: bigint): bigint { return mod(a - b, P); }
function feMul(a: bigint, b: bigint): bigint { return mod(a * b, P); }
function feSq(a: bigint): bigint { return mod(a * a, P); }
function feSq2(a: bigint): bigint { return mod(2n * a * a, P); }
function feNeg(a: bigint): bigint { return mod(-a, P); }
function feIsNonzero(a: bigint): boolean { return mod(a, P) !== 0n; }
function feIsNegative(a: bigint): boolean { return (mod(a, P) & 1n) === 1n; }

function fePow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  base = mod(base, P);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, P);
    exp >>= 1n;
    base = mod(base * base, P);
  }
  return result;
}

function feInv(a: bigint): bigint { return fePow(a, P - 2n); }

function feDivPowM1(u: bigint, v: bigint): bigint {
  const v3 = feMul(feSq(v), v);
  const v7 = feMul(feSq(v3), v);
  const uv7 = feMul(u, v7);
  const exp = (P - 5n) / 8n;
  const powered = fePow(uv7, exp);
  return feMul(feMul(u, v3), powered);
}

function feFromBytes(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return mod(n, P);
}

function feToBytes(n: bigint): Uint8Array {
  n = mod(n, P);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return result;
}

function geFromFeFromBytesVartime(s: Uint8Array): Uint8Array {
  const u = feFromBytes(s);
  const v = feSq2(u);
  const w = feAdd(v, 1n);
  let x = feSq(w);
  let y = feMul(FE_MA2, v);
  x = feAdd(x, y);
  let rX = feDivPowM1(w, x);
  y = feSq(rX);
  x = feMul(y, x);
  y = feSub(w, x);
  let z = FE_MA;

  let sign: number;
  let goToNegative = false;

  if (feIsNonzero(y)) {
    y = feAdd(w, x);
    if (feIsNonzero(y)) {
      goToNegative = true;
    } else {
      rX = feMul(rX, FE_FFFB1);
    }
  } else {
    rX = feMul(rX, FE_FFFB2);
  }

  if (!goToNegative) {
    rX = feMul(rX, u);
    z = feMul(z, v);
    sign = 0;
  } else {
    x = feMul(x, SQRT_M1);
    y = feSub(w, x);
    if (feIsNonzero(y)) {
      rX = feMul(rX, FE_FFFB3);
    } else {
      rX = feMul(rX, FE_FFFB4);
    }
    sign = 1;
  }

  if ((feIsNegative(rX) ? 1 : 0) !== sign) {
    rX = feNeg(rX);
  }

  const rZ = feAdd(z, w);
  const rY = feSub(z, w);
  rX = feMul(rX, rZ);

  const zInv = feInv(rZ);
  const affineX = feMul(rX, zInv);
  const affineY = feMul(rY, zInv);

  const compressed = feToBytes(affineY);
  if (feIsNegative(affineX)) {
    compressed[31] ^= 0x80;
  }

  return compressed;
}

// Test with a passing case
const input1 = hexToBytes('e11135e56c57a95cf2e668183e91cfed3122e0bb80e833522d4dda335b57c8ff');
const expected1 = 'd52757c2bfdd30bf4137d66c087b07486643938c32d6aae0b88d20aa3c07c594';

console.log('Test 1 (should pass):');
const result1 = geFromFeFromBytesVartime(input1);
console.log('Expected:', expected1);
console.log('Got:     ', bytesToHex(result1));
console.log('Match:', bytesToHex(result1).toLowerCase() === expected1.toLowerCase());

// Verify the point is valid by trying to decode it
try {
  const point = ed25519.ExtendedPoint.fromHex(result1);
  console.log('Point decoded successfully');
} catch (e) {
  console.log('Point decode FAILED:', e);
}

console.log('');

// Test with a failing case
const input2 = hexToBytes('83efb774657700e37291f4b8dd10c839d1c739fd135c07a2fd7382334dafdd6a');
const expected2 = '2789ecbaf36e4fcb41c6157228001538b40ca379464b718d830c58caae7ea4ca';

console.log('Test 2 (should fail currently):');
const result2 = geFromFeFromBytesVartime(input2);
console.log('Expected:', expected2);
console.log('Got:     ', bytesToHex(result2));
console.log('Match:', bytesToHex(result2).toLowerCase() === expected2.toLowerCase());

// Try to decode both
try {
  const point2 = ed25519.ExtendedPoint.fromHex(result2);
  console.log('Our point decoded successfully');
} catch (e) {
  console.log('Our point decode FAILED:', e);
}

try {
  const expected_point = ed25519.ExtendedPoint.fromHex(expected2);
  console.log('Expected point decoded successfully');
} catch (e) {
  console.log('Expected point decode FAILED:', e);
}
