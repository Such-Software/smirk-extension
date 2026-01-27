import { deriveAllKeys } from './src/lib/hd';
import { xmrAddress, wowAddress } from './src/lib/address';

const mnemonic = process.argv[2];
if (!mnemonic) {
  console.error('Usage: tsx derive_from_mnemonic.ts "mnemonic phrase"');
  process.exit(1);
}

const keys = deriveAllKeys(mnemonic);

console.log('XMR:');
const xmrAddr = xmrAddress(keys.xmr.publicSpendKey, keys.xmr.publicViewKey);
console.log(`  Address: ${xmrAddr}`);
console.log(`  Private View Key: ${Buffer.from(keys.xmr.privateViewKey).toString('hex')}`);

console.log('\nWOW:');
const wowAddr = wowAddress(keys.wow.publicSpendKey, keys.wow.publicViewKey);
console.log(`  Address: ${wowAddr}`);
console.log(`  Private View Key: ${Buffer.from(keys.wow.privateViewKey).toString('hex')}`);
