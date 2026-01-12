/**
 * Test Monero hash_to_ec implementation against official test vectors.
 *
 * Run with: npx tsx test-hash-to-ec.ts
 */

import { testHashToEc } from './src/lib/monero-crypto';

// Test vectors from monero/tests/crypto/tests.txt
// Format: hash_to_ec <input_public_key_hex> <expected_output_point_hex>
const testVectors = [
  {
    input: 'da66e9ba613919dec28ef367a125bb310d6d83fb9052e71034164b6dc4f392d0',
    expected: '52b3f38753b4e13b74624862e253072cf12f745d43fcfafbe8c217701a6e5875',
  },
  {
    input: 'a7fbdeeccb597c2d5fdaf2ea2e10cbfcd26b5740903e7f6d46bcbf9a90384fc6',
    expected: 'f055ba2d0d9828ce2e203d9896bfda494d7830e7e3a27fa27d5eaa825a79a19c',
  },
  {
    input: 'ed6e6579368caba2cc4851672972e949c0ee586fee4d6d6a9476d4a908f64070',
    expected: 'da3ceda9a2ef6316bf9272566e6dffd785ac71f57855c0202f422bbb86af4ec0',
  },
  {
    input: '9ae78e5620f1c4e6b29d03da006869465b3b16dae87ab0a51f4e1b74bc8aa48b',
    expected: '72d8720da66f797f55fbb7fa538af0b4a4f5930c8289c991472c37dc5ec16853',
  },
  {
    input: 'ab49eb4834d24db7f479753217b763f70604ecb79ed37e6c788528720f424e5b',
    expected: '45914ba926a1a22c8146459c7f050a51ef5f560f5b74bae436b93a379866e6b8',
  },
  {
    input: '5b79158ef2341180b8327b976efddbf364620b7e88d2e0707fa56f3b902c34b3',
    expected: 'eac991dcbba39cb3bd166906ab48e2c3c3f4cd289a05e1c188486d348ede7c2e',
  },
  {
    input: 'f21daa7896c81d3a7a2e9df721035d3c3902fe546c9d739d0c334ed894fb1d21',
    expected: 'a6bedc5ffcc867d0c13a88a03360c8c83a9e4ddf339851bd3768c53a124378ec',
  },
  {
    input: '3dae79aaca1abe6aecea7b0d38646c6b013d40053c7cdde2bed094497d925d2b',
    expected: '1a442546a35860a4ab697a36b158ded8e001bbfe20aef1c63e2840e87485c613',
  },
  {
    input: '3d219463a55c24ac6f55706a6e46ade3fcd1edc87bade7b967129372036aca63',
    expected: 'b252922ab64e32968735b8ade861445aa8dc02b763bd249bff121d10829f7c52',
  },
  {
    input: 'bc5db69aced2b3197398eaf7cf60fd782379874b5ca27cb21bd23692c3c885cc',
    expected: 'ae072a43f78a0f29dc9822ae5e70865bbd151236a6d7fe4ae3e8f8961e19b0e5',
  },
];

console.log('Testing Monero hash_to_ec implementation...\n');

let passed = 0;
let failed = 0;

for (const { input, expected } of testVectors) {
  const result = testHashToEc(input, expected);
  if (result) {
    passed++;
    console.log(`✓ Test passed for input ${input.slice(0, 16)}...`);
  } else {
    failed++;
  }
}

console.log(`\n${passed}/${testVectors.length} tests passed`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} tests failed - implementation needs debugging`);
  process.exit(1);
} else {
  console.log('\n✓ All tests passed! hash_to_ec implementation is correct.');
  process.exit(0);
}
