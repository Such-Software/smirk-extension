/**
 * Grin RSR (Receive-Sign-Return) Invoice Flow
 *
 * This module implements the invoice flow where the receiver initiates:
 * 1. Receiver creates I1 (invoice) - specifies amount they want to receive
 * 2. Sender signs I1 → I2 - adds inputs, fee, change, and signature
 * 3. Receiver finalizes I2 → I3 - adds final signature and broadcasts
 *
 * Uses standard Grin slatepack format compatible with grin-wallet.
 *
 * Slate State Byte Values (at position 20 in slate binary):
 * - 1 = Standard1 (S1)
 * - 2 = Standard2 (S2)
 * - 3 = Standard3 (S3)
 * - 4 = Invoice1 (I1)
 * - 5 = Invoice2 (I2)
 * - 6 = Invoice3 (I3)
 */

import {
  initializeGrinWasm,
  getSlate,
  getSlateInput,
  getSlateOutput,
  getSlateParticipant,
  getBigNumber,
  getCrypto,
  getCommon,
  getIdentifier,
  getSecp256k1Zkp,
  getSlatepack,
  getConsensus,
} from './loader';
import { calculateGrinFee } from './constants';
import { ProofBuilder } from './signing';
import type { GrinKeys, GrinOutput, GrinSlate } from './types';

// Slate state values in binary format (position 20)
const SLATE_STATE = {
  STANDARD1: 1,
  STANDARD2: 2,
  STANDARD3: 3,
  INVOICE1: 4,
  INVOICE2: 5,
  INVOICE3: 6,
} as const;

// Position of state byte in serialized slate binary
const STATE_BYTE_POSITION = 20;

/**
 * Result of creating an invoice.
 */
export interface CreateInvoiceResult {
  /** The invoice slatepack (BEGINSLATEPACK...ENDSLATEPACK format) */
  slatepack: string;
  /** Slate ID (UUID) */
  slateId: string;
  /** Requested amount in nanogrin */
  amount: bigint;
  /** Secret key needed to finalize (store securely!) */
  secretKey: Uint8Array;
  /** Secret nonce needed to finalize (store securely!) */
  secretNonce: Uint8Array;
  /** Output info to record on backend after finalization */
  outputInfo: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
    proof: string;
  };
  /** Public blind excess (hex) - for finalization */
  publicBlindExcess: string;
  /** Public nonce (hex) - for finalization */
  publicNonce: string;
  /** Receiver's slatepack address */
  receiverAddress: string;
}

/**
 * Result of signing an invoice (sender's perspective).
 */
export interface SignInvoiceResult {
  /** The signed I2 slatepack to send back to receiver */
  slatepack: string;
  /** Slate ID from original invoice */
  slateId: string;
  /** Transaction amount */
  amount: bigint;
  /** Transaction fee */
  fee: bigint;
  /** Input IDs used (to lock on backend) */
  inputIds: string[];
  /** Change output info (to record after finalization) */
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
    proof: string;
  };
}

/**
 * Patch the state byte in serialized slate binary.
 *
 * @param serializedSlate - The serialized slate binary
 * @param newState - The new state value (1-6)
 * @returns New Uint8Array with patched state
 */
function patchSlateState(serializedSlate: Uint8Array, newState: number): Uint8Array {
  const patched = new Uint8Array(serializedSlate);
  patched[STATE_BYTE_POSITION] = newState;
  console.log('[Invoice] Patched state byte from', serializedSlate[STATE_BYTE_POSITION], 'to', newState);
  return patched;
}

/**
 * Get the state from serialized slate binary.
 *
 * @param serializedSlate - The serialized slate binary
 * @returns The state value (1-6)
 */
function getSlateState(serializedSlate: Uint8Array): number {
  return serializedSlate[STATE_BYTE_POSITION];
}

/**
 * Check if a slate is an invoice slate based on its state byte.
 *
 * @param serializedSlate - The serialized slate binary
 * @returns True if the slate is an invoice (I1/I2/I3)
 */
export function isInvoiceSlate(serializedSlate: Uint8Array): boolean {
  const state = getSlateState(serializedSlate);
  return state === SLATE_STATE.INVOICE1 ||
         state === SLATE_STATE.INVOICE2 ||
         state === SLATE_STATE.INVOICE3;
}

/**
 * Create an invoice (I1) requesting a specific amount.
 *
 * The receiver calls this to create an invoice slatepack that they send to the payer.
 * The invoice is a standard Grin slatepack with Invoice1 state.
 *
 * @param keys - Receiver's Grin wallet keys
 * @param amount - Amount to request in nanogrin
 * @param nextChildIndex - Next child index for output key derivation
 * @returns Invoice slatepack and secrets needed for finalization
 */
export async function createInvoice(
  keys: GrinKeys,
  amount: bigint,
  nextChildIndex: number
): Promise<CreateInvoiceResult> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const SlateOutput = getSlateOutput();
  const Slatepack = getSlatepack();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Secp256k1Zkp = getSecp256k1Zkp();
  const BigNumber = getBigNumber();

  const amountBN = new BigNumber(amount.toString());

  // Create identifier for the receive output
  const outputIdentifier = new Identifier();
  outputIdentifier.setValue(3, new Uint32Array([0, 0, nextChildIndex, 0]));

  console.log('[createInvoice] Creating invoice for amount:', amount.toString());
  console.log('[createInvoice] Output identifier path: [0, 0,', nextChildIndex, ', 0]');

  // Create commitment for the output
  const outputCommit = await Crypto.commit(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // Create bulletproof range proof
  const proofBuilder = new ProofBuilder();
  await proofBuilder.initialize(keys.extendedPrivateKey);

  const outputProof = await Crypto.proof(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR,
    proofBuilder
  );

  proofBuilder.uninitialize();

  // Derive the blinding factor for this output
  const outputBlind = await Crypto.deriveSecretKey(
    keys.extendedPrivateKey,
    amountBN,
    outputIdentifier,
    Crypto.SWITCH_TYPE_REGULAR
  );

  // Use the output blinding factor as our secret key for signing
  // This is the receiver's contribution to the kernel excess
  const secretKey = new Uint8Array(outputBlind);

  // Generate secret nonce for participant
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    outputBlind.fill(0);
    secretKey.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  // Compute public blind excess from secret key
  const publicBlindExcess = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicBlindExcess === Secp256k1Zkp.OPERATION_FAILED) {
    outputBlind.fill(0);
    secretKey.fill(0);
    secretNonce.fill(0);
    throw new Error('Failed to compute public blind excess');
  }

  // Compute public nonce
  const publicNonce = Secp256k1Zkp.publicKeyFromSecretKey(secretNonce);
  if (publicNonce === Secp256k1Zkp.OPERATION_FAILED) {
    outputBlind.fill(0);
    secretKey.fill(0);
    secretNonce.fill(0);
    throw new Error('Failed to compute public nonce');
  }

  // Create the slate with requested amount but zero fee initially
  // Fee will be set by sender when they sign
  const feeBN = new BigNumber(0);
  const heightBN = new BigNumber(1); // Height not critical for invoice

  const slate = new Slate(
    amountBN,
    true, // isMainnet
    feeBN,
    heightBN,
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    Slate.NO_SENDER_ADDRESS, // Will be set by sender
    keys.slatepackAddress
  );

  // Add receiver's output
  const receiverOutput = new SlateOutput(
    SlateOutput.PLAIN_FEATURES,
    outputCommit,
    outputProof
  );

  const addResult = slate.addOutputs([receiverOutput]);
  if (addResult === false) {
    throw new Error('Failed to add receiver output to slate');
  }

  // Add receiver's participant data (we are participant 0 in invoice flow)
  await slate.addParticipant(
    secretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  // Get slate ID
  const slateId = slate.getId().value || slate.getId().toString();

  console.log('[createInvoice] Slate ID:', slateId);
  console.log('[createInvoice] Outputs added:', slate.getOutputs?.()?.length);
  console.log('[createInvoice] Participants:', slate.getParticipants?.()?.length);

  // Serialize the slate (will have S1 state initially)
  const serializedSlate = slate.serialize(
    true, // isMainnet
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    true  // preferBinary
  );

  console.log('[createInvoice] Serialized slate length:', serializedSlate.length);
  console.log('[createInvoice] Original state byte:', serializedSlate[STATE_BYTE_POSITION]);

  // Patch the state byte from S1 (1) to I1 (4)
  const invoiceSlate = patchSlateState(serializedSlate, SLATE_STATE.INVOICE1);

  // Encode as slatepack
  const slatepack = await Slatepack.encodeSlatepack(
    invoiceSlate,
    null, // no encryption
    null  // no recipient
  );

  console.log('[createInvoice] Slatepack created, length:', slatepack.length);

  // Clean up sensitive intermediate data
  outputBlind.fill(0);

  return {
    slatepack,
    slateId,
    amount,
    secretKey,
    secretNonce,
    outputInfo: {
      keyId: Common.toHexString(outputIdentifier.getValue()),
      nChild: nextChildIndex,
      amount,
      commitment: Common.toHexString(outputCommit),
      proof: Common.toHexString(outputProof),
    },
    publicBlindExcess: Common.toHexString(publicBlindExcess),
    publicNonce: Common.toHexString(publicNonce),
    receiverAddress: keys.slatepackAddress,
  };
}

/**
 * Decode and parse an invoice slatepack.
 *
 * @param keys - Keys for decryption (if encrypted)
 * @param slatepackString - The slatepack to decode
 * @returns Decoded invoice information
 */
export async function parseInvoice(
  keys: GrinKeys,
  slatepackString: string
): Promise<{
  slateId: string;
  amount: bigint;
  fee: bigint;
  state: 'I1' | 'I2' | 'I3';
  serialized: Uint8Array;
  raw: any;
}> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();

  console.log('[parseInvoice] Decoding slatepack...');

  // Decode the slatepack to get raw slate data
  const slateData = await Slatepack.decodeSlatepack(
    slatepackString,
    keys.addressKey
  );

  console.log('[parseInvoice] Decoded slate length:', slateData.length);

  // Check the state byte
  const stateValue = getSlateState(slateData);
  console.log('[parseInvoice] State byte value:', stateValue);

  if (!isInvoiceSlate(slateData)) {
    throw new Error(`Not an invoice slate. State: ${stateValue}`);
  }

  // Map state value to state string
  let state: 'I1' | 'I2' | 'I3';
  switch (stateValue) {
    case SLATE_STATE.INVOICE1:
      state = 'I1';
      break;
    case SLATE_STATE.INVOICE2:
      state = 'I2';
      break;
    case SLATE_STATE.INVOICE3:
      state = 'I3';
      break;
    default:
      throw new Error(`Invalid invoice state: ${stateValue}`);
  }

  // To parse with WASM library, we need to temporarily patch state to S1/S2
  // The WASM library only understands S1 (SEND_INITIAL) and S2 (SEND_RESPONSE)
  let purpose: number;
  let patchedState: number;

  if (stateValue === SLATE_STATE.INVOICE1) {
    purpose = Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL;
    patchedState = SLATE_STATE.STANDARD1;
  } else {
    purpose = Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE;
    patchedState = SLATE_STATE.STANDARD2;
  }

  const patchedSlate = patchSlateState(slateData, patchedState);

  // Parse the slate
  const slate = new Slate(
    patchedSlate,
    true, // isMainnet
    purpose,
    null  // no initial slate for I1
  );

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());
  const slateId = slate.getId().value || slate.getId().toString();

  console.log('[parseInvoice] Parsed invoice - ID:', slateId, 'amount:', amount.toString(), 'state:', state);

  return {
    slateId,
    amount,
    fee,
    state,
    serialized: slateData, // Keep original with correct state
    raw: slate,
  };
}

/**
 * Sign an invoice (sender's perspective).
 *
 * The sender receives an Invoice1 slatepack and creates an Invoice2 slatepack
 * that pays the requested amount.
 *
 * @param keys - Sender's Grin wallet keys
 * @param invoiceSlatepack - The I1 slatepack from the receiver
 * @param outputs - Sender's available UTXOs
 * @param height - Current blockchain height
 * @param nextChildIndex - Next child index for change output
 * @returns Signed I2 slatepack to send back to receiver
 */
export async function signInvoice(
  keys: GrinKeys,
  invoiceSlatepack: string,
  outputs: GrinOutput[],
  height: bigint,
  nextChildIndex: number
): Promise<SignInvoiceResult> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const SlateInput = getSlateInput();
  const SlateOutput = getSlateOutput();
  const Slatepack = getSlatepack();
  const BigNumber = getBigNumber();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Parse the invoice
  const invoice = await parseInvoice(keys, invoiceSlatepack);

  if (invoice.state !== 'I1') {
    throw new Error(`Expected Invoice1 (I1) state, got ${invoice.state}`);
  }

  const amount = invoice.amount;
  console.log('[signInvoice] Signing invoice:', invoice.slateId);
  console.log('[signInvoice] Amount:', amount.toString());

  // Sort outputs by amount (smallest first)
  const sortedOutputs = [...outputs].sort((a, b) =>
    a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
  );

  // Select UTXOs with dynamic fee calculation
  let selectedOutputs: GrinOutput[] = [];
  let totalSelected = BigInt(0);
  let fee = calculateGrinFee(1, 2, 1);
  let changeAmount = BigInt(0);

  // Iteratively select inputs and recalculate fee
  let estimatedInputs = 1;
  const MAX_ITERATIONS = 10;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Outputs = 1 (receiver, already in invoice) + 1 (change) = 2
    fee = calculateGrinFee(estimatedInputs, 2, 1);

    const requiredAmount = amount + fee;
    selectedOutputs = [];
    totalSelected = BigInt(0);

    for (const output of sortedOutputs) {
      selectedOutputs.push(output);
      totalSelected += output.amount;
      if (totalSelected >= requiredAmount) break;
    }

    if (totalSelected < requiredAmount) {
      throw new Error(
        `Insufficient balance: have ${totalSelected}, need ${requiredAmount}`
      );
    }

    if (selectedOutputs.length > estimatedInputs) {
      estimatedInputs = selectedOutputs.length;
      continue;
    }
    break;
  }

  // Final fee and change calculation
  changeAmount = totalSelected - amount - fee;
  const hasChange = changeAmount > BigInt(0);
  const actualOutputs = hasChange ? 2 : 1;
  fee = calculateGrinFee(selectedOutputs.length, actualOutputs, 1);
  changeAmount = totalSelected - amount - fee;

  console.log('[signInvoice] Selected', selectedOutputs.length, 'inputs');
  console.log('[signInvoice] Fee:', fee.toString());
  console.log('[signInvoice] Change:', changeAmount.toString());

  // We need to reconstruct the slate with the invoice data
  // Patch the state to S1 so WASM can work with it
  const patchedData = patchSlateState(invoice.serialized, SLATE_STATE.STANDARD1);

  // Create slate from the patched data (as if it's S1)
  const slate = new Slate(
    patchedData,
    true,
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    null
  );

  // Update the fee
  const feeBN = new BigNumber(fee.toString());
  slate.fee = feeBN;

  // Create SlateInputs from selected UTXOs
  const slateInputs = selectedOutputs.map(output => {
    const commitBytes = Common.fromHexString(output.commitment);
    const features = output.isCoinbase
      ? SlateInput.COINBASE_FEATURES
      : SlateInput.PLAIN_FEATURES;
    return new SlateInput(features, commitBytes);
  });

  // Add inputs to slate
  const numberOfChangeOutputs = hasChange ? 1 : 0;
  slate.addInputs(slateInputs, true, numberOfChangeOutputs + 1);

  // Track blinding factors for inputs
  const inputsForSum: Array<{
    amount: any;
    identifier: any;
    switchType: number;
  }> = [];

  for (const output of selectedOutputs) {
    const identifier = new Identifier(output.keyId);
    inputsForSum.push({
      amount: new BigNumber(output.amount.toString()),
      identifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    });
  }

  let changeOutputInfo: SignInvoiceResult['changeOutput'] = undefined;
  let outputForSum: { amount: any; identifier: any; switchType: number } | null = null;

  // Create change output if needed
  if (hasChange) {
    const changeIdentifier = new Identifier(
      3,
      new Uint32Array([0, 0, nextChildIndex, 0])
    );

    const changeAmountBN = new BigNumber(changeAmount.toString());

    const changeCommit = await Crypto.commit(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR
    );

    const proofBuilder = new ProofBuilder();
    await proofBuilder.initialize(keys.extendedPrivateKey);

    const changeProof = await Crypto.proof(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR,
      proofBuilder
    );

    proofBuilder.uninitialize();

    const changeOutput = new SlateOutput(
      SlateOutput.PLAIN_FEATURES,
      changeCommit,
      changeProof
    );

    const addChangeResult = slate.addOutputs([changeOutput]);
    if (addChangeResult === false) {
      throw new Error('Failed to add change output to slate');
    }

    changeOutputInfo = {
      keyId: Common.toHexString(changeIdentifier.getValue()),
      nChild: nextChildIndex,
      amount: changeAmount,
      commitment: Common.toHexString(changeCommit),
      proof: Common.toHexString(changeProof),
    };

    outputForSum = {
      amount: changeAmountBN,
      identifier: changeIdentifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    };
  }

  // Calculate blinding factor sum: change output - inputs
  let sum: Uint8Array;

  if (outputForSum) {
    const outputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      outputForSum.amount,
      outputForSum.identifier,
      outputForSum.switchType
    );
    sum = new Uint8Array(outputSecretKey);
  } else {
    sum = new Uint8Array(32).fill(0);
  }

  for (const input of inputsForSum) {
    const inputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      input.amount,
      input.identifier,
      input.switchType
    );

    const newSum = Secp256k1Zkp.blindSum([sum], [inputSecretKey]);
    inputSecretKey.fill(0);

    if (newSum === Secp256k1Zkp.OPERATION_FAILED) {
      sum.fill(0);
      throw new Error('Failed to compute blind sum');
    }

    sum.fill(0);
    sum = newSum;
  }

  // Apply offset to get sender's secret key
  // The offset should be updated: new_offset = old_offset + random
  const existingOffset = slate.getOffset();
  const randomOffset = Secp256k1Zkp.createSecretNonce();
  if (randomOffset === Secp256k1Zkp.OPERATION_FAILED) {
    sum.fill(0);
    throw new Error('Failed to create random offset');
  }

  // New offset = existing + random
  let newOffset: Uint8Array;
  if (Common.arraysAreEqual(existingOffset, new Uint8Array(32).fill(0))) {
    newOffset = randomOffset;
  } else {
    const offsetSum = Secp256k1Zkp.blindSum([existingOffset, randomOffset], []);
    if (offsetSum === Secp256k1Zkp.OPERATION_FAILED) {
      sum.fill(0);
      throw new Error('Failed to compute new offset');
    }
    newOffset = offsetSum;
  }

  slate.offset = newOffset;

  // secretKey = sum - randomOffset
  const secretKey = Secp256k1Zkp.blindSum([sum], [randomOffset]);
  sum.fill(0);

  if (secretKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to apply offset');
  }

  // Generate sender's nonce
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    secretKey.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  // Add sender's participant (we are participant 1 in invoice flow)
  await slate.addParticipant(
    secretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  console.log('[signInvoice] Participants after adding sender:', slate.getParticipants?.()?.length);
  console.log('[signInvoice] Outputs after adding change:', slate.getOutputs?.()?.length);

  // Serialize with SEND_RESPONSE - this is the "response" in our inverted RSR flow
  // Note: WASM will compact out data it thinks is in the "initial" slate (I1)
  // The receiver will need to merge data from I1 when parsing I2
  const serializedSlate = slate.serialize(
    true,
    Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE,
    true
  );

  // Patch the state from S2 (2) to I2 (5)
  const signedSlate = patchSlateState(serializedSlate, SLATE_STATE.INVOICE2);

  // Encode as slatepack
  const slatepack = await Slatepack.encodeSlatepack(
    signedSlate,
    null,
    null
  );

  // Clean up
  secretKey.fill(0);
  secretNonce.fill(0);

  console.log('[signInvoice] Created I2 slatepack');

  return {
    slatepack,
    slateId: invoice.slateId,
    amount,
    fee,
    inputIds: selectedOutputs.map(o => o.id),
    changeOutput: changeOutputInfo,
  };
}

/**
 * Finalize an invoice transaction (receiver's perspective).
 *
 * After receiving the I2 slatepack back from the sender, the receiver
 * finalizes the transaction using their stored secret key and nonce.
 *
 * @param keys - Receiver's Grin wallet keys
 * @param signedSlatepack - The I2 slatepack from the sender
 * @param originalSlatepack - The original I1 slatepack we created (needed to parse compact I2)
 * @param originalInvoice - Data from the original createInvoice call
 * @returns Finalized I3 slate ready for broadcast
 */
export async function finalizeInvoice(
  keys: GrinKeys,
  signedSlatepack: string,
  originalSlatepack: string,
  originalInvoice: {
    slateId: string;
    secretKey: Uint8Array;
    secretNonce: Uint8Array;
    amount: bigint;
    outputInfo: CreateInvoiceResult['outputInfo'];
    publicBlindExcess: string;
    publicNonce: string;
    receiverAddress: string;
  }
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const SlateOutput = getSlateOutput();
  const Common = getCommon();
  const Consensus = getConsensus();
  const Slatepack = getSlatepack();

  console.log('[finalizeInvoice] Finalizing invoice:', originalInvoice.slateId);

  // First, decode the original I1 slatepack to use as initial slate for parsing I2
  // This is needed because I2 is in compact SEND_RESPONSE format
  console.log('[finalizeInvoice] Decoding original I1 slatepack...');
  const i1Data = await Slatepack.decodeSlatepack(
    originalSlatepack,
    keys.addressKey
  );

  // Check state is I1
  const i1State = getSlateState(i1Data);
  if (i1State !== SLATE_STATE.INVOICE1) {
    throw new Error(`Original slatepack is not I1, state: ${i1State}`);
  }

  // Patch I1 state to S1 so WASM can parse it
  const patchedI1 = patchSlateState(i1Data, SLATE_STATE.STANDARD1);
  const initialSlate = new Slate(
    patchedI1,
    true,
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    null
  );

  console.log('[finalizeInvoice] Initial slate ID:', initialSlate.getId().value);
  console.log('[finalizeInvoice] Initial slate amount:', initialSlate.getAmount().toFixed());

  // Decode the I2 slatepack
  console.log('[finalizeInvoice] Decoding I2 slatepack...');
  const i2Data = await Slatepack.decodeSlatepack(
    signedSlatepack,
    keys.addressKey
  );

  // Check state is I2
  const i2State = getSlateState(i2Data);
  if (i2State !== SLATE_STATE.INVOICE2) {
    throw new Error(`Signed slatepack is not I2, state: ${i2State}`);
  }

  // Verify slate IDs match (extract UUID from binary)
  // Binary format: [0-2] header, [3] block header version, [4-19] UUID (16 bytes)
  const i2Uuid = Array.from(i2Data.slice(4, 20))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const formattedUuid = `${i2Uuid.slice(0, 8)}-${i2Uuid.slice(8, 12)}-${i2Uuid.slice(12, 16)}-${i2Uuid.slice(16, 20)}-${i2Uuid.slice(20)}`;
  console.log('[finalizeInvoice] I2 slate ID:', formattedUuid);

  if (formattedUuid !== originalInvoice.slateId) {
    throw new Error(`Slate ID mismatch: expected ${originalInvoice.slateId}, got ${formattedUuid}`);
  }

  // Patch I2 state to S2 so WASM can parse it with the initial slate
  const patchedI2 = patchSlateState(i2Data, SLATE_STATE.STANDARD2);

  // Create slate from I2 data, providing the initial slate for compacted field recovery
  const slate = new Slate(
    patchedI2,
    true,
    Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE,
    initialSlate // Provide initial slate to recover amount
  );

  // Check if receiver's output is in the slate (WASM may not copy outputs from initial in RSR flow)
  const outputs = slate.getOutputs?.() || [];
  const receiverCommitHex = originalInvoice.outputInfo.commitment.toLowerCase();
  const hasReceiverOutput = outputs.some((o: any) => {
    const commitHex = Common.toHexString(o.getCommit()).toLowerCase();
    return commitHex === receiverCommitHex;
  });

  console.log('[finalizeInvoice] Outputs in slate:', outputs.length, 'hasReceiverOutput:', hasReceiverOutput);

  // If receiver's output is missing, add it from the stored outputInfo
  if (!hasReceiverOutput) {
    console.log('[finalizeInvoice] Adding receiver output from stored outputInfo');
    const receiverCommit = Common.fromHexString(originalInvoice.outputInfo.commitment);
    const receiverProof = Common.fromHexString(originalInvoice.outputInfo.proof);
    const receiverOutput = new SlateOutput(
      SlateOutput.PLAIN_FEATURES,
      receiverCommit,
      receiverProof
    );
    const addResult = slate.addOutputs([receiverOutput]);
    if (addResult === false) {
      throw new Error('Failed to add receiver output to slate');
    }
    console.log('[finalizeInvoice] Receiver output added, total outputs:', slate.getOutputs?.()?.length);
  }

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  console.log('[finalizeInvoice] Amount:', amount.toString(), 'Fee:', fee.toString());
  console.log('[finalizeInvoice] Slate reconstructed');
  console.log('[finalizeInvoice] Inputs:', slate.getInputs?.()?.length);
  console.log('[finalizeInvoice] Outputs:', slate.getOutputs?.()?.length);
  console.log('[finalizeInvoice] Participants:', slate.getParticipants?.()?.length);

  // Get base fee for verification
  const baseFee = Consensus.getBaseFee(true);

  // Finalize the transaction
  // We (receiver) are participant 0 and need to add our partial signature
  try {
    await slate.finalize(
      originalInvoice.secretKey,
      originalInvoice.secretNonce,
      baseFee,
      true // isMainnet
    );
  } catch (e: any) {
    console.error('[finalizeInvoice] Finalization failed:', e?.message || e);
    throw new Error(`Finalization failed: ${e?.message || e}`);
  }

  // Verify the kernel is complete
  const kernel = slate.getKernels?.()?.[0];
  if (!kernel?.isComplete?.()) {
    throw new Error('Kernel finalization failed');
  }

  console.log('[finalizeInvoice] Transaction finalized');
  console.log('[finalizeInvoice] Kernel excess:', Common.toHexString(kernel.getExcess()));

  // Clean up secrets
  originalInvoice.secretKey.fill(0);
  originalInvoice.secretNonce.fill(0);

  return {
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state: 'S3', // Finalized state (could also call it I3)
    raw: slate,
  };
}
