# Monero Crypto Test Suite

Test files for verifying the Monero `hash_to_ec` and key image implementation.

## Running Tests

```bash
# Run all tests
npx tsx test-hash-to-ec.ts
npx tsx test-hash-to-point.ts
npx tsx test-key-image.ts
```

## Test Files

| File | Description |
|------|-------------|
| `test-hash-to-ec.ts` | Tests full hash_to_ec against 10 Monero test vectors |
| `test-hash-to-point.ts` | Tests ge_fromfe_frombytes_vartime (hash to point mapping) |
| `test-key-image.ts` | Tests key image generation |
| `verify-constants.ts` | Verifies FFFB constants by squaring |
| `compute-constants.ts` | Decodes Monero's limbed constant representation |
| `test-divpowm1.ts` | Tests feDivPowM1 (modular square root helper) |

## Debug Files

| File | Description |
|------|-------------|
| `debug-hash-to-point.ts` | Step-by-step debugging of hash_to_point |
| `debug-compare.ts` | Compares our implementation with reference |
| `minimal-test.ts` | Minimal standalone test |
| `test-neg-fffb.ts` | Tests with negated FFFB constants |
