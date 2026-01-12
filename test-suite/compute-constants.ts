/**
 * Compute and verify Monero's precomputed constants.
 *
 * Run with: npx tsx compute-constants.ts
 */

// ed25519 field prime: p = 2^255 - 19
const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');

// Curve25519 constant A = 486662
const A = BigInt(486662);

// sqrt(-1) mod p
const SQRT_M1 = BigInt('19681161376707505956807079304988542015446066515923890162744021073123829784752');

function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

function pow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) {
      result = mod(result * base, m);
    }
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

// Tonelli-Shanks for computing square roots mod p
function sqrt_mod_p(n: bigint): bigint | null {
  n = mod(n, P);

  // Check if n is a quadratic residue
  const legendre = pow(n, (P - 1n) / 2n, P);
  if (legendre !== 1n && n !== 0n) {
    return null; // No square root exists
  }

  // For p ≡ 5 (mod 8), use a simpler formula
  // p = 2^255 - 19 ≡ 5 (mod 8)
  // sqrt(n) = n^((p+3)/8) or n^((p+3)/8) * sqrt(-1)

  const exp = (P + 3n) / 8n;
  let root = pow(n, exp, P);

  // Check if root^2 = n
  if (mod(root * root, P) === n) {
    return root;
  }

  // Try root * sqrt(-1)
  root = mod(root * SQRT_M1, P);
  if (mod(root * root, P) === n) {
    return root;
  }

  return null;
}

console.log('Computing Monero constants...\n');

// -A mod p
const FE_MA = mod(-A, P);
console.log('FE_MA (-A):', '0x' + FE_MA.toString(16));

// -2*A^2 mod p
const FE_MA2 = mod(-2n * A * A, P);
console.log('FE_MA2 (-2*A^2):', '0x' + FE_MA2.toString(16));

// A + 2
const A_plus_2 = A + 2n;
console.log('A+2:', A_plus_2);

// 2 * A * (A + 2)
const two_A_Aplus2 = 2n * A * A_plus_2;
console.log('2*A*(A+2):', two_A_Aplus2);

// sqrt(2 * A * (A + 2))
const sqrt_2A_Aplus2 = sqrt_mod_p(two_A_Aplus2);
console.log('FE_FFFB2 sqrt(2*A*(A+2)):', sqrt_2A_Aplus2 ? '0x' + sqrt_2A_Aplus2.toString(16) : 'NULL');

// sqrt(-2 * A * (A + 2))
const sqrt_neg_2A_Aplus2 = sqrt_mod_p(mod(-two_A_Aplus2, P));
console.log('FE_FFFB1 sqrt(-2*A*(A+2)):', sqrt_neg_2A_Aplus2 ? '0x' + sqrt_neg_2A_Aplus2.toString(16) : 'NULL');

// A * (A + 2)
const A_Aplus2 = A * A_plus_2;

// sqrt(-1) * A * (A + 2)
const sqrtm1_A_Aplus2 = mod(SQRT_M1 * A_Aplus2, P);

// sqrt(sqrt(-1) * A * (A + 2))
const sqrt_sqrtm1_A_Aplus2 = sqrt_mod_p(sqrtm1_A_Aplus2);
console.log('FE_FFFB4 sqrt(sqrt(-1)*A*(A+2)):', sqrt_sqrtm1_A_Aplus2 ? '0x' + sqrt_sqrtm1_A_Aplus2.toString(16) : 'NULL');

// sqrt(-sqrt(-1) * A * (A + 2))
const sqrt_neg_sqrtm1_A_Aplus2 = sqrt_mod_p(mod(-sqrtm1_A_Aplus2, P));
console.log('FE_FFFB3 sqrt(-sqrt(-1)*A*(A+2)):', sqrt_neg_sqrtm1_A_Aplus2 ? '0x' + sqrt_neg_sqrtm1_A_Aplus2.toString(16) : 'NULL');

console.log('\nCurrently hardcoded in our code:');
console.log('FE_FFFB1:', '0x7e71fbefdad61b1720a9c53741fb19e3d19404a8b92a738d22a76975321c41ee');
console.log('FE_FFFB2:', '0x64d4e2a6e5e03cfc4ef296f6cb6b0fb4e44c4dca567b6ccf6f3fca0d9ea51d65');
console.log('FE_FFFB3:', '0x7d840fdb30bd70dd00b38bad25d21e1f5a0d7b33d1b24a2de68dd35ea8eb26ae');
console.log('FE_FFFB4:', '0x6bb36e1929d3e4c973eeed1e212db06d39b8aee0a756831df1c2041bbfad2d47');

// Decode the limbed format from Monero
function limbsToNumber(limbs: number[]): bigint {
  // Each limb alternates between 26 and 25 bits
  // limbs[0]: 26 bits
  // limbs[1]: 25 bits
  // limbs[2]: 26 bits
  // etc.
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < limbs.length; i++) {
    const bits = (i % 2 === 0) ? 26n : 25n;
    result += BigInt(limbs[i]) << shift;
    shift += bits;
  }
  return mod(result, P);
}

console.log('\nDecoded from Monero C source (limbed format):');

// fe_fffb1 = {-31702527, -2466483, -26106795, -12203692, -12169197, -321052, 14850977, -10296299, -16929438, -407568}
const fffb1_limbs = [-31702527, -2466483, -26106795, -12203692, -12169197, -321052, 14850977, -10296299, -16929438, -407568];
const fffb1_decoded = limbsToNumber(fffb1_limbs);
console.log('FE_FFFB1 decoded:', '0x' + fffb1_decoded.toString(16));

// fe_fffb2 = {8166131, -6741800, -17040804, 3154616, 21461005, 1466302, -30876704, -6368709, 10503587, -13363080}
const fffb2_limbs = [8166131, -6741800, -17040804, 3154616, 21461005, 1466302, -30876704, -6368709, 10503587, -13363080];
const fffb2_decoded = limbsToNumber(fffb2_limbs);
console.log('FE_FFFB2 decoded:', '0x' + fffb2_decoded.toString(16));

// fe_fffb3 = {-13620103, 14639558, 4532995, 7679154, 16815101, -15883539, -22863840, -14813421, 13716513, -6477756}
const fffb3_limbs = [-13620103, 14639558, 4532995, 7679154, 16815101, -15883539, -22863840, -14813421, 13716513, -6477756];
const fffb3_decoded = limbsToNumber(fffb3_limbs);
console.log('FE_FFFB3 decoded:', '0x' + fffb3_decoded.toString(16));

// fe_fffb4 = {-21786234, -12173074, 21573800, 4524538, -4645904, 16204591, 8012863, -8444712, 3212926, 6885324}
const fffb4_limbs = [-21786234, -12173074, 21573800, 4524538, -4645904, 16204591, 8012863, -8444712, 3212926, 6885324];
const fffb4_decoded = limbsToNumber(fffb4_limbs);
console.log('FE_FFFB4 decoded:', '0x' + fffb4_decoded.toString(16));
