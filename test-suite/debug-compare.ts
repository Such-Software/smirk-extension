/**
 * Compare passing vs failing test cases.
 */

import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

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

function analyzePath(inputHex: string): void {
  const s = hexToBytes(inputHex);
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

  const firstBranch = feIsNonzero(y);
  let secondBranch = false;
  let whichFFFB = '';

  if (firstBranch) {
    y = feAdd(w, x);
    secondBranch = feIsNonzero(y);
    if (secondBranch) {
      // goto negative
      x = feMul(x, SQRT_M1);
      y = feSub(w, x);
      if (feIsNonzero(y)) {
        whichFFFB = 'FFFB3';
      } else {
        whichFFFB = 'FFFB4';
      }
    } else {
      whichFFFB = 'FFFB1';
    }
  } else {
    whichFFFB = 'FFFB2';
  }

  console.log(`Input: ${inputHex}`);
  console.log(`  firstBranch (w-x != 0): ${firstBranch}`);
  console.log(`  secondBranch (w+x != 0): ${secondBranch}`);
  console.log(`  Using: ${whichFFFB}`);
  console.log('');
}

// Failing cases
console.log('=== FAILING CASES ===');
analyzePath('83efb774657700e37291f4b8dd10c839d1c739fd135c07a2fd7382334dafdd6a');
analyzePath('5c380f98794ab7a9be7c2d3259b92772125ce93527be6a76210631fdd8001498');
analyzePath('4775d39f91a466262f0ccf21f5a7ee446f79a05448861e212be063a1063298f0');

// Passing cases
console.log('=== PASSING CASES ===');
analyzePath('e11135e56c57a95cf2e668183e91cfed3122e0bb80e833522d4dda335b57c8ff');
analyzePath('3f287e7e6cf6ef2ed9a8c7361e4ec96535f0df208ddee9a57ffb94d4afb94a93');
