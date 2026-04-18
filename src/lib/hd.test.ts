/**
 * Unit tests for hd.ts (Hierarchical Deterministic wallet)
 *
 * Tests cover:
 * - BIP39 mnemonic generation and validation
 * - Seed derivation
 * - Seed fingerprint computation
 * - Key derivation for all assets (BTC, LTC, XMR, WOW, Grin)
 * - Utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  generateMnemonicPhrase,
  isValidMnemonic,
  mnemonicToSeed,
  computeSeedFingerprint,
  deriveAllKeys,
  mnemonicToWords,
  wordsToMnemonic,
  getVerificationIndices,
  getDerivationInfo,
} from './hd';

// Standard BIP39 test vector mnemonic
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Another valid 12-word mnemonic for comparison
const TEST_MNEMONIC_2 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

describe('Mnemonic Generation', () => {
  it('generateMnemonicPhrase returns 12 words', () => {
    const mnemonic = generateMnemonicPhrase();
    const words = mnemonic.split(' ');

    expect(words.length).toBe(12);
  });

  it('generateMnemonicPhrase generates valid BIP39 mnemonic', () => {
    const mnemonic = generateMnemonicPhrase();

    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('generateMnemonicPhrase produces unique mnemonics', () => {
    const mnemonics = new Set<string>();
    for (let i = 0; i < 50; i++) {
      mnemonics.add(generateMnemonicPhrase());
    }

    expect(mnemonics.size).toBe(50);
  });

  it('generated words are lowercase', () => {
    const mnemonic = generateMnemonicPhrase();
    expect(mnemonic).toBe(mnemonic.toLowerCase());
  });
});

describe('Mnemonic Validation', () => {
  it('validates correct 12-word mnemonic', () => {
    expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true);
  });

  it('validates another valid mnemonic', () => {
    expect(isValidMnemonic(TEST_MNEMONIC_2)).toBe(true);
  });

  it('rejects 11-word mnemonic', () => {
    const shortMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(isValidMnemonic(shortMnemonic)).toBe(false);
  });

  it('rejects 13-word mnemonic', () => {
    const longMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(isValidMnemonic(longMnemonic)).toBe(false);
  });

  it('rejects invalid words', () => {
    const invalidMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon xyz';
    expect(isValidMnemonic(invalidMnemonic)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidMnemonic('')).toBe(false);
  });

  it('rejects random text', () => {
    expect(isValidMnemonic('this is not a valid mnemonic phrase at all')).toBe(false);
  });

  it('rejects mnemonic with extra whitespace (scure/bip39 is strict)', () => {
    // scure/bip39 does NOT normalize whitespace - it requires proper formatting
    const spacedMnemonic = '  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  about  ';
    expect(isValidMnemonic(spacedMnemonic)).toBe(false);

    // But properly formatted works
    const properMnemonic = TEST_MNEMONIC;
    expect(isValidMnemonic(properMnemonic)).toBe(true);
  });
});

describe('Seed Derivation', () => {
  it('mnemonicToSeed returns 64-byte seed', () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC);

    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it('mnemonicToSeed is deterministic', () => {
    const seed1 = mnemonicToSeed(TEST_MNEMONIC);
    const seed2 = mnemonicToSeed(TEST_MNEMONIC);

    expect(bytesToHex(seed1)).toBe(bytesToHex(seed2));
  });

  it('different mnemonics produce different seeds', () => {
    const seed1 = mnemonicToSeed(TEST_MNEMONIC);
    const seed2 = mnemonicToSeed(TEST_MNEMONIC_2);

    expect(bytesToHex(seed1)).not.toBe(bytesToHex(seed2));
  });

  it('passphrase changes the seed', () => {
    const seedNoPass = mnemonicToSeed(TEST_MNEMONIC, '');
    const seedWithPass = mnemonicToSeed(TEST_MNEMONIC, 'my-passphrase');

    expect(bytesToHex(seedNoPass)).not.toBe(bytesToHex(seedWithPass));
  });

  it('different passphrases produce different seeds', () => {
    const seed1 = mnemonicToSeed(TEST_MNEMONIC, 'password1');
    const seed2 = mnemonicToSeed(TEST_MNEMONIC, 'password2');

    expect(bytesToHex(seed1)).not.toBe(bytesToHex(seed2));
  });

  it('matches BIP39 test vector', () => {
    // BIP39 test vector for "abandon" x11 + "about" with empty passphrase
    const seed = mnemonicToSeed(TEST_MNEMONIC);
    const seedHex = bytesToHex(seed);

    // Known test vector result
    expect(seedHex).toBe(
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1' +
      '9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
    );
  });
});

describe('Seed Fingerprint', () => {
  it('computeSeedFingerprint returns 64-char hex string', () => {
    const fingerprint = computeSeedFingerprint(TEST_MNEMONIC);

    expect(typeof fingerprint).toBe('string');
    expect(fingerprint.length).toBe(64);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it('computeSeedFingerprint is deterministic', () => {
    const fp1 = computeSeedFingerprint(TEST_MNEMONIC);
    const fp2 = computeSeedFingerprint(TEST_MNEMONIC);

    expect(fp1).toBe(fp2);
  });

  it('different mnemonics produce different fingerprints', () => {
    const fp1 = computeSeedFingerprint(TEST_MNEMONIC);
    const fp2 = computeSeedFingerprint(TEST_MNEMONIC_2);

    expect(fp1).not.toBe(fp2);
  });

  it('passphrase changes the fingerprint', () => {
    const fpNoPass = computeSeedFingerprint(TEST_MNEMONIC, '');
    const fpWithPass = computeSeedFingerprint(TEST_MNEMONIC, 'my-passphrase');

    expect(fpNoPass).not.toBe(fpWithPass);
  });
});

describe('Key Derivation - All Assets', () => {
  it('deriveAllKeys returns keys for all 5 assets', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys).toHaveProperty('btc');
    expect(keys).toHaveProperty('ltc');
    expect(keys).toHaveProperty('xmr');
    expect(keys).toHaveProperty('wow');
    expect(keys).toHaveProperty('grin');
  });

  it('throws on invalid mnemonic', () => {
    expect(() => deriveAllKeys('invalid mnemonic phrase')).toThrow('Invalid mnemonic');
  });
});

describe('Key Derivation - BTC', () => {
  it('BTC private key is 32 bytes', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.btc.privateKey).toBeInstanceOf(Uint8Array);
    expect(keys.btc.privateKey.length).toBe(32);
  });

  it('BTC public key is 33 bytes (compressed)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.btc.publicKey).toBeInstanceOf(Uint8Array);
    expect(keys.btc.publicKey.length).toBe(33);
    // Compressed public keys start with 0x02 or 0x03
    expect([0x02, 0x03]).toContain(keys.btc.publicKey[0]);
  });

  it('BTC derivation is deterministic', () => {
    const keys1 = deriveAllKeys(TEST_MNEMONIC);
    const keys2 = deriveAllKeys(TEST_MNEMONIC);

    expect(bytesToHex(keys1.btc.privateKey)).toBe(bytesToHex(keys2.btc.privateKey));
    expect(bytesToHex(keys1.btc.publicKey)).toBe(bytesToHex(keys2.btc.publicKey));
  });

  it('passphrase changes BTC keys', () => {
    const keysNoPass = deriveAllKeys(TEST_MNEMONIC, '');
    const keysWithPass = deriveAllKeys(TEST_MNEMONIC, 'my-passphrase');

    expect(bytesToHex(keysNoPass.btc.privateKey)).not.toBe(bytesToHex(keysWithPass.btc.privateKey));
  });
});

describe('Key Derivation - LTC', () => {
  it('LTC private key is 32 bytes', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.ltc.privateKey).toBeInstanceOf(Uint8Array);
    expect(keys.ltc.privateKey.length).toBe(32);
  });

  it('LTC public key is 33 bytes (compressed)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.ltc.publicKey).toBeInstanceOf(Uint8Array);
    expect(keys.ltc.publicKey.length).toBe(33);
  });

  it('LTC keys differ from BTC keys (different coin type)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    // Same mnemonic but different derivation paths
    expect(bytesToHex(keys.ltc.privateKey)).not.toBe(bytesToHex(keys.btc.privateKey));
  });
});

describe('Key Derivation - XMR', () => {
  it('XMR has all 4 key components', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.xmr).toHaveProperty('privateSpendKey');
    expect(keys.xmr).toHaveProperty('privateViewKey');
    expect(keys.xmr).toHaveProperty('publicSpendKey');
    expect(keys.xmr).toHaveProperty('publicViewKey');
  });

  it('XMR keys are all 32 bytes', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.xmr.privateSpendKey.length).toBe(32);
    expect(keys.xmr.privateViewKey.length).toBe(32);
    expect(keys.xmr.publicSpendKey.length).toBe(32);
    expect(keys.xmr.publicViewKey.length).toBe(32);
  });

  it('XMR derivation is deterministic', () => {
    const keys1 = deriveAllKeys(TEST_MNEMONIC);
    const keys2 = deriveAllKeys(TEST_MNEMONIC);

    expect(bytesToHex(keys1.xmr.privateSpendKey)).toBe(bytesToHex(keys2.xmr.privateSpendKey));
    expect(bytesToHex(keys1.xmr.privateViewKey)).toBe(bytesToHex(keys2.xmr.privateViewKey));
    expect(bytesToHex(keys1.xmr.publicSpendKey)).toBe(bytesToHex(keys2.xmr.publicSpendKey));
    expect(bytesToHex(keys1.xmr.publicViewKey)).toBe(bytesToHex(keys2.xmr.publicViewKey));
  });

  it('XMR private keys are valid ed25519 scalars (< l)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);
    const l = 2n ** 252n + 27742317777372353535851937790883648493n;

    const spendScalar = bytesToBigInt(keys.xmr.privateSpendKey);
    const viewScalar = bytesToBigInt(keys.xmr.privateViewKey);

    expect(spendScalar).toBeLessThan(l);
    expect(viewScalar).toBeLessThan(l);
  });
});

describe('Key Derivation - WOW', () => {
  it('WOW has all 4 key components', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.wow).toHaveProperty('privateSpendKey');
    expect(keys.wow).toHaveProperty('privateViewKey');
    expect(keys.wow).toHaveProperty('publicSpendKey');
    expect(keys.wow).toHaveProperty('publicViewKey');
  });

  it('WOW keys differ from XMR keys (different domain)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(bytesToHex(keys.wow.privateSpendKey)).not.toBe(bytesToHex(keys.xmr.privateSpendKey));
    expect(bytesToHex(keys.wow.publicSpendKey)).not.toBe(bytesToHex(keys.xmr.publicSpendKey));
  });

  it('WOW derivation is deterministic', () => {
    const keys1 = deriveAllKeys(TEST_MNEMONIC);
    const keys2 = deriveAllKeys(TEST_MNEMONIC);

    expect(bytesToHex(keys1.wow.privateSpendKey)).toBe(bytesToHex(keys2.wow.privateSpendKey));
  });
});

describe('Key Derivation - Grin', () => {
  it('Grin has private and public keys', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.grin).toHaveProperty('privateKey');
    expect(keys.grin).toHaveProperty('publicKey');
  });

  it('Grin keys are 32 bytes', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    expect(keys.grin.privateKey.length).toBe(32);
    expect(keys.grin.publicKey.length).toBe(32);
  });

  it('Grin derivation is deterministic', () => {
    const keys1 = deriveAllKeys(TEST_MNEMONIC);
    const keys2 = deriveAllKeys(TEST_MNEMONIC);

    expect(bytesToHex(keys1.grin.privateKey)).toBe(bytesToHex(keys2.grin.privateKey));
    expect(bytesToHex(keys1.grin.publicKey)).toBe(bytesToHex(keys2.grin.publicKey));
  });

  it('Grin private key is valid ed25519 scalar (< l)', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);
    const l = 2n ** 252n + 27742317777372353535851937790883648493n;

    const scalar = bytesToBigInt(keys.grin.privateKey);
    expect(scalar).toBeLessThan(l);
  });
});

describe('Utility Functions', () => {
  describe('mnemonicToWords', () => {
    it('splits mnemonic into word array', () => {
      const words = mnemonicToWords(TEST_MNEMONIC);

      expect(Array.isArray(words)).toBe(true);
      expect(words.length).toBe(12);
      expect(words[0]).toBe('abandon');
      expect(words[11]).toBe('about');
    });

    it('handles extra whitespace', () => {
      const words = mnemonicToWords('  word1   word2  word3  ');

      expect(words).toEqual(['word1', 'word2', 'word3']);
    });
  });

  describe('wordsToMnemonic', () => {
    it('joins words with spaces', () => {
      const words = ['abandon', 'abandon', 'abandon'];
      const mnemonic = wordsToMnemonic(words);

      expect(mnemonic).toBe('abandon abandon abandon');
    });

    it('round-trips with mnemonicToWords', () => {
      const original = TEST_MNEMONIC;
      const words = mnemonicToWords(original);
      const rebuilt = wordsToMnemonic(words);

      expect(rebuilt).toBe(original);
    });
  });

  describe('getVerificationIndices', () => {
    it('returns requested number of indices', () => {
      const indices = getVerificationIndices(12, 3);

      expect(indices.length).toBe(3);
    });

    it('returns indices within valid range', () => {
      const indices = getVerificationIndices(12, 3);

      for (const idx of indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(12);
      }
    });

    it('returns sorted indices', () => {
      const indices = getVerificationIndices(12, 3);

      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    });

    it('returns unique indices', () => {
      const indices = getVerificationIndices(12, 5);
      const unique = new Set(indices);

      expect(unique.size).toBe(5);
    });

    it('defaults to 3 verification words', () => {
      const indices = getVerificationIndices(12);

      expect(indices.length).toBe(3);
    });
  });

  describe('getDerivationInfo', () => {
    it('returns derivation paths for all assets', () => {
      const info = getDerivationInfo();

      expect(info).toHaveProperty('btc');
      expect(info).toHaveProperty('ltc');
      expect(info).toHaveProperty('xmr');
      expect(info).toHaveProperty('wow');
      expect(info).toHaveProperty('grin');
    });

    it('BTC/LTC have BIP44 paths', () => {
      const info = getDerivationInfo();

      expect(info.btc).toContain('BIP44');
      expect(info.ltc).toContain('BIP44');
    });

    it('v2 shows SLIP-10 for XMR/WOW', () => {
      const info = getDerivationInfo(2);

      expect(info.xmr).toContain('SLIP-10');
      expect(info.wow).toContain('SLIP-10');
    });

    it('v1 shows custom derivation for XMR/WOW', () => {
      const info = getDerivationInfo(1);

      expect(info.xmr).toContain('legacy');
      expect(info.wow).toContain('legacy');
    });
  });
});

describe('Cross-Asset Key Isolation', () => {
  it('all derived keys are unique', () => {
    const keys = deriveAllKeys(TEST_MNEMONIC);

    const allKeys = [
      bytesToHex(keys.btc.privateKey),
      bytesToHex(keys.ltc.privateKey),
      bytesToHex(keys.xmr.privateSpendKey),
      bytesToHex(keys.xmr.privateViewKey),
      bytesToHex(keys.wow.privateSpendKey),
      bytesToHex(keys.wow.privateViewKey),
      bytesToHex(keys.grin.privateKey),
    ];

    const unique = new Set(allKeys);
    expect(unique.size).toBe(allKeys.length);
  });

  it('different mnemonics produce completely different keys', () => {
    const keys1 = deriveAllKeys(TEST_MNEMONIC);
    const keys2 = deriveAllKeys(TEST_MNEMONIC_2);

    expect(bytesToHex(keys1.btc.privateKey)).not.toBe(bytesToHex(keys2.btc.privateKey));
    expect(bytesToHex(keys1.xmr.privateSpendKey)).not.toBe(bytesToHex(keys2.xmr.privateSpendKey));
    expect(bytesToHex(keys1.grin.privateKey)).not.toBe(bytesToHex(keys2.grin.privateKey));
  });
});

// =============================================================================
// Snapshot Tests: Freeze derivation outputs to detect silent changes
// =============================================================================

describe('Derivation Snapshots (v1 legacy)', () => {
  const keys = deriveAllKeys(TEST_MNEMONIC, '', 1);

  it('SNAPSHOT: v1 XMR spend key is stable', () => {
    expect(bytesToHex(keys.xmr.privateSpendKey)).toMatchInlineSnapshot(`"256b07fd2e0d5fb5d6509f63fbf8e7a8c244e98cab8e1551989cb283a6fad90d"`);
  });

  it('SNAPSHOT: v1 XMR view key is stable', () => {
    expect(bytesToHex(keys.xmr.privateViewKey)).toMatchInlineSnapshot(`"f9d7eed6d731e7510e16fa679606ace9bca73607dc95bcd97d6d71b69c40e204"`);
  });

  it('SNAPSHOT: v1 WOW spend key is stable', () => {
    expect(bytesToHex(keys.wow.privateSpendKey)).toMatchInlineSnapshot(`"798923ab09b7da721292c75bdaa40bced6f1b83e9159dbaf82475a97a00ee104"`);
  });
});

describe('BIP44/SLIP-10 Derivation (v2 standard)', () => {
  const v1 = deriveAllKeys(TEST_MNEMONIC, '', 1);
  const v2 = deriveAllKeys(TEST_MNEMONIC, '', 2);

  it('v2 XMR keys differ from v1', () => {
    expect(bytesToHex(v2.xmr.privateSpendKey)).not.toBe(bytesToHex(v1.xmr.privateSpendKey));
    expect(bytesToHex(v2.xmr.privateViewKey)).not.toBe(bytesToHex(v1.xmr.privateViewKey));
  });

  it('v2 WOW keys differ from v1', () => {
    expect(bytesToHex(v2.wow.privateSpendKey)).not.toBe(bytesToHex(v1.wow.privateSpendKey));
  });

  it('v2 BTC keys are same as v1 (BIP44 unchanged)', () => {
    expect(bytesToHex(v2.btc.privateKey)).toBe(bytesToHex(v1.btc.privateKey));
  });

  it('v2 LTC keys are same as v1 (BIP44 unchanged)', () => {
    expect(bytesToHex(v2.ltc.privateKey)).toBe(bytesToHex(v1.ltc.privateKey));
  });

  it('v2 XMR keys are 32 bytes and valid scalars', () => {
    expect(v2.xmr.privateSpendKey.length).toBe(32);
    expect(v2.xmr.privateViewKey.length).toBe(32);
    const l = 2n ** 252n + 27742317777372353535851937790883648493n;
    expect(bytesToBigInt(v2.xmr.privateSpendKey)).toBeLessThan(l);
    expect(bytesToBigInt(v2.xmr.privateViewKey)).toBeLessThan(l);
  });

  it('v2 is deterministic', () => {
    const v2b = deriveAllKeys(TEST_MNEMONIC, '', 2);
    expect(bytesToHex(v2.xmr.privateSpendKey)).toBe(bytesToHex(v2b.xmr.privateSpendKey));
    expect(bytesToHex(v2.wow.privateSpendKey)).toBe(bytesToHex(v2b.wow.privateSpendKey));
  });

  it('SNAPSHOT: v2 XMR spend key is stable', () => {
    expect(bytesToHex(v2.xmr.privateSpendKey)).toMatchInlineSnapshot(`"8f2d521d4334f4d5d174c47aacb346e7633516416fae089d74ecfd0c389a6b08"`);
  });

  it('SNAPSHOT: v2 XMR view key is stable', () => {
    expect(bytesToHex(v2.xmr.privateViewKey)).toMatchInlineSnapshot(`"84b0087a63854856686f80596a5a1a6090795b4d1311139173262170d7e7180f"`);
  });

  it('SNAPSHOT: v2 WOW spend key is stable', () => {
    expect(bytesToHex(v2.wow.privateSpendKey)).toMatchInlineSnapshot(`"3c79c0c51f9b2b8b7d7d26e6e3cca68c1020037a87b2e89c346f1cd857d4cf04"`);
  });

  it('XMR and WOW use different SLIP-44 coin types', () => {
    expect(bytesToHex(v2.xmr.privateSpendKey)).not.toBe(bytesToHex(v2.wow.privateSpendKey));
  });
});

// Helper functions for tests

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  // Little-endian (Monero convention)
  for (let i = 0; i < bytes.length; i++) {
    result += BigInt(bytes[i]) << BigInt(8 * i);
  }
  return result;
}
