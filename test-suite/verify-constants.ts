/**
 * Verify Monero's precomputed constants by converting from limbed format.
 */

const P = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');

function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

function pow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

// Monero limbed format to BigInt
// Each limb alternates between having 26 and 25 bits of significance
// limb[0] has 26 bits, limb[1] has 25 bits, etc.
function limbsToNumber(limbs: number[]): bigint {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    const bits = (i % 2 === 0) ? 26n : 25n;
    // Handle negative limbs - in Monero's representation, negative values are allowed
    // and represent negative coefficients
    let limbValue = BigInt(limbs[i]);
    result += limbValue << shift;
    shift += bits;
  }
  return mod(result, P);
}

// Test: verify limbsToNumber with a known constant
// fe_sqrtm1 = {-32595792, -7943725, 9377950, 3500415, 12389472, -272473, -25146209, -2005654, 326686, 11406482}
// Should equal sqrt(-1) = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0
const sqrtm1_limbs = [-32595792, -7943725, 9377950, 3500415, 12389472, -272473, -25146209, -2005654, 326686, 11406482];
const sqrtm1_computed = limbsToNumber(sqrtm1_limbs);
const sqrtm1_expected = BigInt('19681161376707505956807079304988542015446066515923890162744021073123829784752');

console.log('Verifying sqrt(-1) constant:');
console.log('  Expected:', sqrtm1_expected.toString(16));
console.log('  Computed:', sqrtm1_computed.toString(16));
console.log('  Match:', sqrtm1_computed === sqrtm1_expected);
console.log('');

// Verify by squaring - should equal -1 mod p
const sqrtm1_sq = mod(sqrtm1_computed * sqrtm1_computed, P);
const neg1 = mod(-1n, P);
console.log('  sqrtm1^2:', sqrtm1_sq.toString(16));
console.log('  -1 mod p:', neg1.toString(16));
console.log('  sqrtm1^2 = -1:', sqrtm1_sq === neg1);
console.log('');

// Now verify FFFB constants
// fe_fffb1 = {-31702527, -2466483, -26106795, -12203692, -12169197, -321052, 14850977, -10296299, -16929438, -407568}
const fffb1_limbs = [-31702527, -2466483, -26106795, -12203692, -12169197, -321052, 14850977, -10296299, -16929438, -407568];
const fffb1 = limbsToNumber(fffb1_limbs);

// fe_fffb2 = {8166131, -6741800, -17040804, 3154616, 21461005, 1466302, -30876704, -6368709, 10503587, -13363080}
const fffb2_limbs = [8166131, -6741800, -17040804, 3154616, 21461005, 1466302, -30876704, -6368709, 10503587, -13363080];
const fffb2 = limbsToNumber(fffb2_limbs);

// fe_fffb3 = {-13620103, 14639558, 4532995, 7679154, 16815101, -15883539, -22863840, -14813421, 13716513, -6477756}
const fffb3_limbs = [-13620103, 14639558, 4532995, 7679154, 16815101, -15883539, -22863840, -14813421, 13716513, -6477756];
const fffb3 = limbsToNumber(fffb3_limbs);

// fe_fffb4 = {-21786234, -12173074, 21573800, 4524538, -4645904, 16204591, 8012863, -8444712, 3212926, 6885324}
const fffb4_limbs = [-21786234, -12173074, 21573800, 4524538, -4645904, 16204591, 8012863, -8444712, 3212926, 6885324];
const fffb4 = limbsToNumber(fffb4_limbs);

console.log('FFFB1:', fffb1.toString(16));
console.log('FFFB2:', fffb2.toString(16));
console.log('FFFB3:', fffb3.toString(16));
console.log('FFFB4:', fffb4.toString(16));

// Verify FFFB constants by their mathematical definitions
// FFFB1 = sqrt(-2 * A * (A + 2))
// FFFB2 = sqrt(2 * A * (A + 2))
// FFFB3 = sqrt(-sqrt(-1) * A * (A + 2))
// FFFB4 = sqrt(sqrt(-1) * A * (A + 2))

const A = BigInt(486662);
const A_plus_2 = A + 2n;
const two_A_Aplus2 = mod(2n * A * A_plus_2, P);
const sqrtm1 = sqrtm1_expected;

console.log('');
console.log('Verification:');

// FFFB2^2 should equal 2 * A * (A + 2)
const fffb2_sq = mod(fffb2 * fffb2, P);
console.log('FFFB2^2:', fffb2_sq.toString(16));
console.log('2*A*(A+2):', two_A_Aplus2.toString(16));
console.log('FFFB2^2 = 2*A*(A+2):', fffb2_sq === two_A_Aplus2);

// FFFB1^2 should equal -2 * A * (A + 2)
const fffb1_sq = mod(fffb1 * fffb1, P);
const neg_two_A_Aplus2 = mod(-two_A_Aplus2, P);
console.log('FFFB1^2:', fffb1_sq.toString(16));
console.log('-2*A*(A+2):', neg_two_A_Aplus2.toString(16));
console.log('FFFB1^2 = -2*A*(A+2):', fffb1_sq === neg_two_A_Aplus2);

// FFFB4^2 should equal sqrt(-1) * A * (A + 2)
const sqrtm1_A_Aplus2 = mod(sqrtm1 * A * A_plus_2, P);
const fffb4_sq = mod(fffb4 * fffb4, P);
console.log('FFFB4^2:', fffb4_sq.toString(16));
console.log('sqrt(-1)*A*(A+2):', sqrtm1_A_Aplus2.toString(16));
console.log('FFFB4^2 = sqrt(-1)*A*(A+2):', fffb4_sq === sqrtm1_A_Aplus2);

// FFFB3^2 should equal -sqrt(-1) * A * (A + 2)
const neg_sqrtm1_A_Aplus2 = mod(-sqrtm1_A_Aplus2, P);
const fffb3_sq = mod(fffb3 * fffb3, P);
console.log('FFFB3^2:', fffb3_sq.toString(16));
console.log('-sqrt(-1)*A*(A+2):', neg_sqrtm1_A_Aplus2.toString(16));
console.log('FFFB3^2 = -sqrt(-1)*A*(A+2):', fffb3_sq === neg_sqrtm1_A_Aplus2);
