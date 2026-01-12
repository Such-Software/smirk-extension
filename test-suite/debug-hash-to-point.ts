/**
 * Debug ge_fromfe_frombytes_vartime by tracing each step.
 */

import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

// ed25519 field prime: p = 2^255 - 19
const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');
const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
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

function debugGeFromFe(s: Uint8Array): void {
  const u = feFromBytes(s);
  console.log('u =', u.toString(16));

  const v = feSq2(u);
  console.log('v = 2*u^2 =', v.toString(16));

  const w = feAdd(v, 1n);
  console.log('w = v+1 =', w.toString(16));

  let x = feSq(w);
  console.log('x = w^2 =', x.toString(16));

  let y = feMul(FE_MA2, v);
  console.log('y = -2*A^2*u^2 =', y.toString(16));

  x = feAdd(x, y);
  console.log('x = w^2 + y =', x.toString(16));

  let rX = feDivPowM1(w, x);
  console.log('rX = (w/x)^((p+3)/8) =', rX.toString(16));

  y = feSq(rX);
  console.log('y = rX^2 =', y.toString(16));

  x = feMul(y, x);
  console.log('x = rX^2 * x =', x.toString(16));

  y = feSub(w, x);
  console.log('y = w - x =', y.toString(16));
  console.log('feIsNonzero(y) =', feIsNonzero(y));

  let z = FE_MA;
  let sign: number;
  let goToNegative = false;

  if (feIsNonzero(y)) {
    y = feAdd(w, x);
    console.log('y = w + x =', y.toString(16));
    console.log('feIsNonzero(y) =', feIsNonzero(y));

    if (feIsNonzero(y)) {
      console.log('→ goto negative');
      goToNegative = true;
    } else {
      console.log('→ using FFFB1');
      rX = feMul(rX, FE_FFFB1);
    }
  } else {
    console.log('→ using FFFB2');
    rX = feMul(rX, FE_FFFB2);
  }

  if (!goToNegative) {
    rX = feMul(rX, u);
    z = feMul(z, v);
    sign = 0;
    console.log('→ sign = 0 path');
  } else {
    x = feMul(x, SQRT_M1);
    console.log('x = x * sqrt(-1) =', x.toString(16));

    y = feSub(w, x);
    console.log('y = w - x =', y.toString(16));
    console.log('feIsNonzero(y) =', feIsNonzero(y));

    if (feIsNonzero(y)) {
      console.log('→ using FFFB3');
      rX = feMul(rX, FE_FFFB3);
    } else {
      console.log('→ using FFFB4');
      rX = feMul(rX, FE_FFFB4);
    }
    sign = 1;
    console.log('→ sign = 1 path');
  }

  console.log('rX before sign adjust =', rX.toString(16));
  console.log('feIsNegative(rX) =', feIsNegative(rX), 'sign =', sign);

  if ((feIsNegative(rX) ? 1 : 0) !== sign) {
    rX = feNeg(rX);
    console.log('→ negated rX');
  }

  const rZ = feAdd(z, w);
  const rY = feSub(z, w);
  rX = feMul(rX, rZ);

  console.log('rX =', rX.toString(16));
  console.log('rY =', rY.toString(16));
  console.log('rZ =', rZ.toString(16));

  const zInv = feInv(rZ);
  const affineX = feMul(rX, zInv);
  const affineY = feMul(rY, zInv);

  console.log('affineX =', affineX.toString(16));
  console.log('affineY =', affineY.toString(16));

  const compressed = feToBytes(affineY);
  if (feIsNegative(affineX)) {
    compressed[31] |= 0x80;
    console.log('→ set sign bit');
  }

  console.log('Result:', bytesToHex(compressed));
}

// Test first failing case
const input = '83efb774657700e37291f4b8dd10c839d1c739fd135c07a2fd7382334dafdd6a';
const expected = '2789ecbaf36e4fcb41c6157228001538b40ca379464b718d830c58caae7ea4ca';

console.log('Input:', input);
console.log('Expected:', expected);
console.log('');
debugGeFromFe(hexToBytes(input));
