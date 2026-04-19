/**
 * Unit tests for crypto.ts
 *
 * Tests cover:
 * - Key generation (secp256k1)
 * - ECDH key agreement
 * - XChaCha20-Poly1305 encryption/decryption
 * - ECIES encrypted tip payloads
 * - Public tip payloads (symmetric encryption)
 * - Bitcoin message signing
 * - Utility functions (hex conversion, URL fragment keys)
 */

import { describe, it, expect } from 'vitest';
import {
  generatePrivateKey,
  getPublicKey,
  deriveSharedSecret,
  encrypt,
  decrypt,
  deriveKeyFromPassword,
  encryptPrivateKey,
  decryptPrivateKey,
  createEncryptedTipPayload,
  decryptTipPayload,
  createPublicTipPayload,
  decryptPublicTipPayload,
  signBitcoinMessage,
  bytesToHex,
  hexToBytes,
  generateUrlFragmentKey,
  decodeUrlFragmentKey,
  randomBytes,
} from './crypto';

describe('Key Generation', () => {
  it('generatePrivateKey returns 32-byte Uint8Array', () => {
    const key = generatePrivateKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('generatePrivateKey returns unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = generatePrivateKey();
      keys.add(bytesToHex(key));
    }
    expect(keys.size).toBe(100);
  });

  it('getPublicKey derives compressed public key (33 bytes)', () => {
    const privateKey = generatePrivateKey();
    const publicKey = getPublicKey(privateKey, true);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(33);
    // Compressed keys start with 0x02 or 0x03
    expect([0x02, 0x03]).toContain(publicKey[0]);
  });

  it('getPublicKey derives uncompressed public key (65 bytes)', () => {
    const privateKey = generatePrivateKey();
    const publicKey = getPublicKey(privateKey, false);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(65);
    // Uncompressed keys start with 0x04
    expect(publicKey[0]).toBe(0x04);
  });

  it('getPublicKey is deterministic', () => {
    const privateKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const pub1 = getPublicKey(privateKey);
    const pub2 = getPublicKey(privateKey);
    expect(bytesToHex(pub1)).toBe(bytesToHex(pub2));
  });

  it('getPublicKey matches known test vector', () => {
    // BIP-340 test vector: private key = 1
    const privateKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const publicKey = getPublicKey(privateKey);
    // Known public key for private key = 1
    expect(bytesToHex(publicKey)).toBe('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  });
});

describe('ECDH Key Agreement', () => {
  it('deriveSharedSecret returns 32-byte key', () => {
    const alicePrivate = generatePrivateKey();
    const bobPrivate = generatePrivateKey();
    const bobPublic = getPublicKey(bobPrivate);

    const sharedSecret = deriveSharedSecret(alicePrivate, bobPublic);
    expect(sharedSecret).toBeInstanceOf(Uint8Array);
    expect(sharedSecret.length).toBe(32);
  });

  it('ECDH is symmetric (Alice-Bob = Bob-Alice)', () => {
    const alicePrivate = generatePrivateKey();
    const alicePublic = getPublicKey(alicePrivate);
    const bobPrivate = generatePrivateKey();
    const bobPublic = getPublicKey(bobPrivate);

    const aliceShared = deriveSharedSecret(alicePrivate, bobPublic);
    const bobShared = deriveSharedSecret(bobPrivate, alicePublic);

    expect(bytesToHex(aliceShared)).toBe(bytesToHex(bobShared));
  });

  it('different keypairs produce different shared secrets', () => {
    const alice = generatePrivateKey();
    const bob = generatePrivateKey();
    const carol = generatePrivateKey();

    const aliceBob = deriveSharedSecret(alice, getPublicKey(bob));
    const aliceCarol = deriveSharedSecret(alice, getPublicKey(carol));

    expect(bytesToHex(aliceBob)).not.toBe(bytesToHex(aliceCarol));
  });
});

describe('XChaCha20-Poly1305 Encryption', () => {
  it('encrypt returns nonce + ciphertext + tag', () => {
    const key = randomBytes(32);
    const plaintext = new TextEncoder().encode('Hello, World!');
    const encrypted = encrypt(plaintext, key);

    // 24-byte nonce + plaintext + 16-byte tag
    expect(encrypted.length).toBe(24 + plaintext.length + 16);
  });

  it('decrypt recovers original plaintext', () => {
    const key = randomBytes(32);
    const plaintext = new TextEncoder().encode('Test message for encryption');

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext));
  });

  it('decrypt with wrong key throws', () => {
    const correctKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const plaintext = new TextEncoder().encode('Secret data');

    const encrypted = encrypt(plaintext, correctKey);

    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it('tampered ciphertext throws', () => {
    const key = randomBytes(32);
    const plaintext = new TextEncoder().encode('Important data');

    const encrypted = encrypt(plaintext, key);
    // Tamper with the ciphertext (not the nonce)
    encrypted[30] ^= 0xff;

    expect(() => decrypt(encrypted, key)).toThrow();
  });

  it('encrypting same plaintext produces different ciphertext (random nonce)', () => {
    const key = randomBytes(32);
    const plaintext = new TextEncoder().encode('Same message');

    const encrypted1 = encrypt(plaintext, key);
    const encrypted2 = encrypt(plaintext, key);

    expect(bytesToHex(encrypted1)).not.toBe(bytesToHex(encrypted2));
  });

  it('handles empty plaintext', () => {
    const key = randomBytes(32);
    const plaintext = new Uint8Array(0);

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted.length).toBe(0);
  });

  it('handles large plaintext', () => {
    const key = randomBytes(32);
    const plaintext = randomBytes(10000);

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(plaintext));
  });
});

describe('Password-based Key Derivation', () => {
  it('deriveKeyFromPassword returns 32-byte key', async () => {
    const password = 'test-password-123';
    const salt = randomBytes(16);

    const key = await deriveKeyFromPassword(password, salt);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('same password+salt produces same key', async () => {
    const password = 'deterministic-test';
    const salt = hexToBytes('0102030405060708090a0b0c0d0e0f10');

    const key1 = await deriveKeyFromPassword(password, salt);
    const key2 = await deriveKeyFromPassword(password, salt);

    expect(bytesToHex(key1)).toBe(bytesToHex(key2));
  });

  it('different salts produce different keys', async () => {
    const password = 'same-password';
    const salt1 = randomBytes(16);
    const salt2 = randomBytes(16);

    const key1 = await deriveKeyFromPassword(password, salt1);
    const key2 = await deriveKeyFromPassword(password, salt2);

    expect(bytesToHex(key1)).not.toBe(bytesToHex(key2));
  });

  it('different passwords produce different keys', async () => {
    const salt = randomBytes(16);

    const key1 = await deriveKeyFromPassword('password1', salt);
    const key2 = await deriveKeyFromPassword('password2', salt);

    expect(bytesToHex(key1)).not.toBe(bytesToHex(key2));
  });
});

describe('Private Key Encryption/Decryption', () => {
  it('encryptPrivateKey returns hex strings', async () => {
    const privateKey = generatePrivateKey();
    const password = 'secure-password';

    const result = await encryptPrivateKey(privateKey, password);

    expect(typeof result.encrypted).toBe('string');
    expect(typeof result.salt).toBe('string');
    expect(result.salt.length).toBe(32); // 16 bytes = 32 hex chars
  });

  it('decryptPrivateKey recovers original key', async () => {
    const privateKey = generatePrivateKey();
    const password = 'test-password';

    const { encrypted, salt } = await encryptPrivateKey(privateKey, password);
    const decrypted = await decryptPrivateKey(encrypted, salt, password);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(privateKey));
  });

  it('decryptPrivateKey with wrong password throws', async () => {
    const privateKey = generatePrivateKey();

    const { encrypted, salt } = await encryptPrivateKey(privateKey, 'correct-password');

    await expect(decryptPrivateKey(encrypted, salt, 'wrong-password')).rejects.toThrow();
  });
});

describe('ECIES Encrypted Tip Payloads', () => {
  it('createEncryptedTipPayload returns hex strings', () => {
    const tipPrivateKey = generatePrivateKey();
    const recipientPrivateKey = generatePrivateKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);

    const payload = createEncryptedTipPayload(tipPrivateKey, recipientPublicKey);

    expect(typeof payload.encryptedKey).toBe('string');
    expect(typeof payload.ephemeralPubkey).toBe('string');
    expect(payload.ephemeralPubkey.length).toBe(66); // 33 bytes = 66 hex chars
  });

  it('decryptTipPayload recovers original tip key', () => {
    const tipPrivateKey = generatePrivateKey();
    const recipientPrivateKey = generatePrivateKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);

    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(
      tipPrivateKey,
      recipientPublicKey
    );

    const decrypted = decryptTipPayload(encryptedKey, ephemeralPubkey, recipientPrivateKey);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(tipPrivateKey));
  });

  it('decryptTipPayload with wrong recipient key throws', () => {
    const tipPrivateKey = generatePrivateKey();
    const recipientPrivateKey = generatePrivateKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const wrongRecipientKey = generatePrivateKey();

    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(
      tipPrivateKey,
      recipientPublicKey
    );

    expect(() => decryptTipPayload(encryptedKey, ephemeralPubkey, wrongRecipientKey)).toThrow();
  });

  it('same tip encrypted twice produces different ciphertext', () => {
    const tipPrivateKey = generatePrivateKey();
    const recipientPrivateKey = generatePrivateKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);

    const payload1 = createEncryptedTipPayload(tipPrivateKey, recipientPublicKey);
    const payload2 = createEncryptedTipPayload(tipPrivateKey, recipientPublicKey);

    // Different ephemeral keys
    expect(payload1.ephemeralPubkey).not.toBe(payload2.ephemeralPubkey);
    // Different ciphertext
    expect(payload1.encryptedKey).not.toBe(payload2.encryptedKey);
  });

  it('ECIES round-trip with known test values', () => {
    // Use deterministic keys for reproducibility
    const tipKey = hexToBytes('1111111111111111111111111111111111111111111111111111111111111111');
    const recipientKey = hexToBytes('2222222222222222222222222222222222222222222222222222222222222222');
    const recipientPub = getPublicKey(recipientKey);

    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(tipKey, recipientPub);
    const decrypted = decryptTipPayload(encryptedKey, ephemeralPubkey, recipientKey);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(tipKey));
  });
});

describe('Public Tip Payloads (Symmetric)', () => {
  it('createPublicTipPayload returns hex string', () => {
    const tipPrivateKey = generatePrivateKey();
    const urlKey = randomBytes(32);

    const encrypted = createPublicTipPayload(tipPrivateKey, urlKey);

    expect(typeof encrypted).toBe('string');
    // 24 nonce + 32 plaintext + 16 tag = 72 bytes = 144 hex chars
    expect(encrypted.length).toBe(144);
  });

  it('decryptPublicTipPayload recovers original key', () => {
    const tipPrivateKey = generatePrivateKey();
    const urlKey = randomBytes(32);

    const encrypted = createPublicTipPayload(tipPrivateKey, urlKey);
    const decrypted = decryptPublicTipPayload(encrypted, urlKey);

    expect(bytesToHex(decrypted)).toBe(bytesToHex(tipPrivateKey));
  });

  it('decryptPublicTipPayload with wrong key throws', () => {
    const tipPrivateKey = generatePrivateKey();
    const correctKey = randomBytes(32);
    const wrongKey = randomBytes(32);

    const encrypted = createPublicTipPayload(tipPrivateKey, correctKey);

    expect(() => decryptPublicTipPayload(encrypted, wrongKey)).toThrow();
  });
});

describe('URL Fragment Key Generation', () => {
  it('generateUrlFragmentKey returns 32-byte key', () => {
    const { bytes, encoded } = generateUrlFragmentKey();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(typeof encoded).toBe('string');
  });

  it('generateUrlFragmentKey produces URL-safe encoding', () => {
    const { encoded } = generateUrlFragmentKey();

    // Should not contain + / or =
    expect(encoded).not.toMatch(/[+/=]/);
    // Should only contain base64url characters
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('decodeUrlFragmentKey reverses encoding', () => {
    const { bytes, encoded } = generateUrlFragmentKey();
    const decoded = decodeUrlFragmentKey(encoded);

    expect(bytesToHex(decoded)).toBe(bytesToHex(bytes));
  });

  it('URL fragment key round-trip with known value', () => {
    // Test with a known base64url string
    const originalBytes = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
    const encoded = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';

    const decoded = decodeUrlFragmentKey(encoded);
    expect(bytesToHex(decoded)).toBe(bytesToHex(originalBytes));
  });
});

describe('Bitcoin Message Signing', () => {
  it('signBitcoinMessage returns Base64 BIP-137 signature (88 chars)', () => {
    const privateKey = generatePrivateKey();
    const message = 'Test message';

    const signature = signBitcoinMessage(message, privateKey);

    expect(typeof signature).toBe('string');
    // BIP-137: Base64(65 bytes) = 88 chars
    expect(signature.length).toBe(88);
    // Verify it's valid Base64
    expect(() => atob(signature)).not.toThrow();
    // Decoded should be 65 bytes (header + r + s)
    const decoded = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    expect(decoded.length).toBe(65);
    // Header byte should be 31 or 32 (27 + recovery + 4)
    expect(decoded[0]).toBeGreaterThanOrEqual(31);
    expect(decoded[0]).toBeLessThanOrEqual(32);
  });

  it('signBitcoinMessage is deterministic', () => {
    const privateKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const message = 'Hello World';

    const sig1 = signBitcoinMessage(message, privateKey);
    const sig2 = signBitcoinMessage(message, privateKey);

    expect(sig1).toBe(sig2);
  });

  it('different messages produce different signatures', () => {
    const privateKey = generatePrivateKey();

    const sig1 = signBitcoinMessage('Message 1', privateKey);
    const sig2 = signBitcoinMessage('Message 2', privateKey);

    expect(sig1).not.toBe(sig2);
  });

  it('different keys produce different signatures', () => {
    const key1 = generatePrivateKey();
    const key2 = generatePrivateKey();
    const message = 'Same message';

    const sig1 = signBitcoinMessage(message, key1);
    const sig2 = signBitcoinMessage(message, key2);

    expect(sig1).not.toBe(sig2);
  });

  it('handles empty message', () => {
    const privateKey = generatePrivateKey();
    const signature = signBitcoinMessage('', privateKey);

    expect(signature.length).toBe(88); // Base64(65 bytes)
  });

  it('handles unicode message', () => {
    const privateKey = generatePrivateKey();
    const signature = signBitcoinMessage('Hello 🌍 World! Привет!', privateKey);

    expect(signature.length).toBe(88);
  });

  it('BIP-137 signature has correct structure', () => {
    const privateKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const message = 'Hello World';

    const signature = signBitcoinMessage(message, privateKey);

    // Decode Base64
    const decoded = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    expect(decoded.length).toBe(65);

    // First byte: header (27 + recovery + 4 for compressed)
    const header = decoded[0];
    expect(header).toBeGreaterThanOrEqual(31); // 27 + 0 + 4
    expect(header).toBeLessThanOrEqual(32);    // 27 + 1 + 4

    // Remaining 64 bytes: r (32) + s (32)
    const r = decoded.slice(1, 33);
    const s = decoded.slice(33, 65);
    expect(r.length).toBe(32);
    expect(s.length).toBe(32);
  });
});

describe('Utility Functions', () => {
  describe('bytesToHex', () => {
    it('converts empty array', () => {
      expect(bytesToHex(new Uint8Array([]))).toBe('');
    });

    it('converts single byte', () => {
      expect(bytesToHex(new Uint8Array([0]))).toBe('00');
      expect(bytesToHex(new Uint8Array([255]))).toBe('ff');
      expect(bytesToHex(new Uint8Array([16]))).toBe('10');
    });

    it('converts multiple bytes', () => {
      expect(bytesToHex(new Uint8Array([1, 2, 3]))).toBe('010203');
      expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
    });

    it('pads single-digit hex values', () => {
      expect(bytesToHex(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])))
        .toBe('000102030405060708090a0b0c0d0e0f');
    });
  });

  describe('hexToBytes', () => {
    it('converts empty string', () => {
      expect(hexToBytes('')).toEqual(new Uint8Array([]));
    });

    it('converts lowercase hex', () => {
      expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('converts uppercase hex', () => {
      expect(hexToBytes('DEADBEEF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('converts mixed case hex', () => {
      expect(hexToBytes('DeAdBeEf')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('round-trips with bytesToHex', () => {
      const original = randomBytes(32);
      const hex = bytesToHex(original);
      const roundTripped = hexToBytes(hex);
      expect(bytesToHex(roundTripped)).toBe(bytesToHex(original));
    });
  });

  describe('randomBytes', () => {
    it('returns requested length', () => {
      expect(randomBytes(16).length).toBe(16);
      expect(randomBytes(32).length).toBe(32);
      expect(randomBytes(64).length).toBe(64);
    });

    it('returns unique values', () => {
      const values = new Set<string>();
      for (let i = 0; i < 100; i++) {
        values.add(bytesToHex(randomBytes(16)));
      }
      expect(values.size).toBe(100);
    });
  });
});
