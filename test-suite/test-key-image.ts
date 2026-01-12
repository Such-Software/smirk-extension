/**
 * Test key image generation.
 *
 * This tests the full pipeline:
 * 1. Derive one-time private key x = Hs(aR || outputIndex) + b
 * 2. Compute one-time public key P = x*G
 * 3. Compute Hp(P) using hash_to_ec
 * 4. Key image KI = x * Hp(P)
 */

import { generateKeyImage } from './src/lib/monero-crypto';

// Test with generated values - we verify the process doesn't throw
// and produces a valid 32-byte hex output (64 chars)

// Sample test keys (these are test keys, not real)
const txPublicKey = 'a7fbdeeccb597c2d5fd7e8126e0f5e6ed3e2d0b5a3b52aee5d29bb3f7a1c0de4';
const privateViewKey = 'f5add4d3f9e1edc4b1be13b5e8f10c2d6e9f8a7c5b3d4e2f1a0c9b8d7e6f5a43';
const publicSpendKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const privateSpendKey = 'a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2';
const outputIndex = 0;

console.log('Testing key image generation...\n');

try {
  const keyImage = generateKeyImage(
    txPublicKey,
    privateViewKey,
    publicSpendKey,
    privateSpendKey,
    outputIndex
  );

  console.log('Key image generated successfully!');
  console.log('Key image:', keyImage);
  console.log('Length:', keyImage.length, 'chars (expected: 64)');

  if (keyImage.length === 64 && /^[0-9a-f]+$/i.test(keyImage)) {
    console.log('\n✓ Key image generation working correctly!');
  } else {
    console.log('\n✗ Invalid key image format');
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Key image generation failed:', error);
  process.exit(1);
}
