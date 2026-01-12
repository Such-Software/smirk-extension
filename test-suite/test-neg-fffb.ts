/**
 * Test with negated FFFB constants.
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

// Original constants
const FE_FFFB1_orig = BigInt('0x7e71fbefdad61b1720a9c53741fb19e3d19404a8b92a738d22a76975321c41ee');
const FE_FFFB2_orig = BigInt('0x4d061e0a045a2cf691d451b7c0165fbe51de03460456f7dfd2de6483607c9ae0');
const FE_FFFB3_orig = BigInt('0x674a110d14c208efb89546403f0da2ed4024ff4ea5964229581b7d8717302c66');
const FE_FFFB4_orig = BigInt('0x1a43f3031067dbf926c0f4887ef7432eee46fc08a13f4a49853d1903b6b39186');

// Try negated versions
const FE_FFFB1 = mod(-FE_FFFB1_orig, P);
const FE_FFFB2 = mod(-FE_FFFB2_orig, P);
const FE_FFFB3 = mod(-FE_FFFB3_orig, P);
const FE_FFFB4 = mod(-FE_FFFB4_orig, P);

console.log('Using negated FFFB constants');

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

// Test vectors
const tests = [
  { input: '83efb774657700e37291f4b8dd10c839d1c739fd135c07a2fd7382334dafdd6a', expected: '2789ecbaf36e4fcb41c6157228001538b40ca379464b718d830c58caae7ea4ca' },
  { input: '5c380f98794ab7a9be7c2d3259b92772125ce93527be6a76210631fdd8001498', expected: '31a1feb4986d42e2137ae061ea031838d24fa523234954cf8860bcd42421ae94' },
  { input: '4775d39f91a466262f0ccf21f5a7ee446f79a05448861e212be063a1063298f0', expected: '897b3589f29ea40e576a91506d9aeca4c05a494922a80de57276f4b40c0a98bc' },
  { input: 'e11135e56c57a95cf2e668183e91cfed3122e0bb80e833522d4dda335b57c8ff', expected: 'd52757c2bfdd30bf4137d66c087b07486643938c32d6aae0b88d20aa3c07c594' },
  { input: '3f287e7e6cf6ef2ed9a8c7361e4ec96535f0df208ddee9a57ffb94d4afb94a93', expected: 'e462eea6e7d404b0f1219076e3433c742a1641dbcc9146362c27d152c6175410' },
];

let passed = 0;
for (const { input, expected } of tests) {
  const result = geFromFeFromBytesVartime(hexToBytes(input));
  const resultHex = bytesToHex(result);
  const match = resultHex.toLowerCase() === expected.toLowerCase();
  if (match) {
    passed++;
    console.log(`✓ ${input.slice(0, 16)}...`);
  } else {
    console.log(`✗ ${input.slice(0, 16)}...`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Got:      ${resultHex}`);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
