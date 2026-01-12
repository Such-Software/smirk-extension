/**
 * Test ge_fromfe_frombytes_vartime implementation against official test vectors.
 *
 * Run with: npx tsx test-hash-to-point.ts
 */

import { testHashToPoint } from './src/lib/monero-crypto';

// Test vectors from monero/tests/crypto/tests.txt
// Format: hash_to_point <input_hash_hex> <expected_output_point_hex>
// These test ge_fromfe_frombytes_vartime directly (no initial hash)
const testVectors = [
  {
    input: '83efb774657700e37291f4b8dd10c839d1c739fd135c07a2fd7382334dafdd6a',
    expected: '2789ecbaf36e4fcb41c6157228001538b40ca379464b718d830c58caae7ea4ca',
  },
  {
    input: '5c380f98794ab7a9be7c2d3259b92772125ce93527be6a76210631fdd8001498',
    expected: '31a1feb4986d42e2137ae061ea031838d24fa523234954cf8860bcd42421ae94',
  },
  {
    input: '4775d39f91a466262f0ccf21f5a7ee446f79a05448861e212be063a1063298f0',
    expected: '897b3589f29ea40e576a91506d9aeca4c05a494922a80de57276f4b40c0a98bc',
  },
  {
    input: 'e11135e56c57a95cf2e668183e91cfed3122e0bb80e833522d4dda335b57c8ff',
    expected: 'd52757c2bfdd30bf4137d66c087b07486643938c32d6aae0b88d20aa3c07c594',
  },
  {
    input: '3f287e7e6cf6ef2ed9a8c7361e4ec96535f0df208ddee9a57ffb94d4afb94a93',
    expected: 'e462eea6e7d404b0f1219076e3433c742a1641dbcc9146362c27d152c6175410',
  },
];

console.log('Testing ge_fromfe_frombytes_vartime (hash_to_point) implementation...\n');

let passed = 0;
let failed = 0;

for (const { input, expected } of testVectors) {
  const result = testHashToPoint(input, expected);
  if (result) {
    passed++;
    console.log(`✓ Test passed for input ${input.slice(0, 16)}...`);
  } else {
    failed++;
  }
}

console.log(`\n${passed}/${testVectors.length} tests passed`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} tests failed - ge_fromfe_frombytes_vartime implementation needs debugging`);
  process.exit(1);
} else {
  console.log('\n✓ All tests passed! ge_fromfe_frombytes_vartime implementation is correct.');
  process.exit(0);
}
