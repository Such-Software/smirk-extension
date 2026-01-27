/**
 * Generate a test WOW wallet for debugging.
 * Run with: npx tsx scripts/generate_test_wallet.ts
 */

import { generateMnemonicPhrase, deriveAllKeys } from '../src/lib/hd';
import { wowAddress } from '../src/lib/address';
import { bytesToHex } from '../src/lib/crypto';

// Generate a new mnemonic
const mnemonic = generateMnemonicPhrase();
console.log('='.repeat(80));
console.log('TEST WALLET - DO NOT USE FOR REAL FUNDS');
console.log('='.repeat(80));
console.log();
console.log('Mnemonic:', mnemonic);
console.log();

// Derive all keys
const keys = deriveAllKeys(mnemonic);

// Get WOW keys
const wowKeys = keys.wow;
console.log('WOW Private Spend Key:', bytesToHex(wowKeys.privateSpendKey));
console.log('WOW Private View Key:', bytesToHex(wowKeys.privateViewKey));
console.log('WOW Public Spend Key:', bytesToHex(wowKeys.publicSpendKey));
console.log('WOW Public View Key:', bytesToHex(wowKeys.publicViewKey));
console.log();

// Generate address
const address = wowAddress(wowKeys.publicSpendKey, wowKeys.publicViewKey);
console.log('WOW Address:', address);
console.log();

// Also show XMR for comparison
const xmrKeys = keys.xmr;
console.log('XMR Private View Key:', bytesToHex(xmrKeys.privateViewKey));
console.log('XMR Public Spend Key:', bytesToHex(xmrKeys.publicSpendKey));
console.log();
console.log('='.repeat(80));
