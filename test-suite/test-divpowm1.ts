/**
 * Test feDivPowM1 implementation.
 */

const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');

function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

function feMul(a: bigint, b: bigint): bigint {
  return mod(a * b, P);
}

function feSq(a: bigint): bigint {
  return mod(a * a, P);
}

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

// Our current implementation
function feDivPowM1_ours(u: bigint, v: bigint): bigint {
  const v3 = feMul(feSq(v), v);
  const v7 = feMul(feSq(v3), v);
  const uv7 = feMul(u, v7);
  const exp = (P - 5n) / 8n;
  const powered = fePow(uv7, exp);
  return feMul(feMul(u, v3), powered);
}

// Direct computation for comparison
function feDivPowM1_direct(u: bigint, v: bigint): bigint {
  // (u/v)^((p+3)/8) = u^((p+3)/8) * v^(-(p+3)/8)
  const exp = (P + 3n) / 8n;
  const vInv = fePow(v, P - 2n);  // v^(-1)
  const uOverV = feMul(u, vInv);
  return fePow(uOverV, exp);
}

// Test with some values
const u = BigInt('0x4fcd5df86ba0d34ad22d03870c96d31a2d30f6f71d25b4c8d9b94c020d3e38d8');
const v = BigInt('0x421f62c4605849aa31206bfd9ca2b3732c4177701f53eaaff1a288da6da253d0');

console.log('u =', u.toString(16));
console.log('v =', v.toString(16));

const result_ours = feDivPowM1_ours(u, v);
const result_direct = feDivPowM1_direct(u, v);

console.log('Our method:   ', result_ours.toString(16));
console.log('Direct method:', result_direct.toString(16));
console.log('Match:', result_ours === result_direct);

// Verify: (result)^8 * v = u * v^(-7)
// Or: result^8 = u / v
const result8 = fePow(result_ours, 8n);
const uOverV = feMul(u, fePow(v, P - 2n));
console.log('result^8:     ', result8.toString(16));
console.log('u/v:          ', uOverV.toString(16));
console.log('result^8 = u/v:', result8 === uOverV);
