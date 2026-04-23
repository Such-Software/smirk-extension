/**
 * Grin WASM Wallet Module
 *
 * Re-exports all Grin handlers for use by the background message router.
 *
 * Grin Transaction Model (Mimblewimble):
 * Unlike BTC/LTC, Grin uses interactive transactions requiring both parties
 * to participate in building the transaction. This is called "slates".
 *
 * SRS Flow (Standard Send):
 * 1. Sender creates S1 slate (selects inputs, creates partial signature)
 * 2. Sender sends S1 slatepack to Recipient
 * 3. Recipient signs S2 (adds output, partial signature)
 * 4. Recipient sends S2 slatepack back to Sender
 * 5. Sender finalizes S3 (combines signatures, builds kernel)
 * 6. Sender broadcasts transaction to network
 *
 * RSR Flow (Invoice/Request):
 * 1. Receiver creates I1 invoice (output commitment)
 * 2. Receiver sends I1 to Sender
 * 3. Sender signs I2 (selects inputs, adds signature)
 * 4. Sender sends I2 back to Receiver
 * 5. Receiver finalizes I3 (combines signatures)
 * 6. Receiver broadcasts transaction to network
 */

// Wallet initialization
export { handleInitGrinWallet, handleGrinTestPaths } from './init';

// Relay polling
export { handleGetGrinPendingSlatepacks } from './relay';

// Receive flow (sign incoming slatepacks)
export { handleGrinSignSlate, handleGrinSignSlatepack } from './receive';

// Send flow (create, finalize, broadcast)
export { handleGrinCreateSend, handleGrinFinalizeAndBroadcast } from './send';

// Invoice flow (RSR)
export {
  handleGrinCreateInvoice,
  handleGrinSignInvoice,
  handleGrinFinalizeInvoice,
} from './invoice';

// Cancel operations
export {
  handleGrinCancelSlate,
  handleGrinCancelSend,
  handleGrinFinalizeSlate, // Deprecated but still exported
} from './cancel';
