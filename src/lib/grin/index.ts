/**
 * Grin wallet functionality for Smirk extension.
 *
 * Based on MWC Wallet (MIT License) - see MWC_LICENSE
 * https://github.com/NicolasFlamel1/MWC-Wallet-Standalone
 *
 * This module provides client-side Grin transaction building:
 * - Key derivation from seed
 * - Slate creation and signing
 * - Slatepack encoding/decoding
 * - Bulletproof range proofs
 *
 * All cryptographic operations happen in WASM, keys never leave the client.
 *
 * NOTE: The MWC wallet library has a complex API designed for interactive wallet use.
 * The functions below provide a simplified wrapper for basic Grin operations.
 */

import {
  initializeGrinWasm,
  isGrinWasmInitialized,
  getCrypto,
  getConsensus,
  getIdentifier,
  getSlate,
  getSlatepack,
  getSeed,
  getCommon,
  getBigNumber,
  getSecp256k1Zkp,
  getEd25519,
  getBech32,
  getBlake2b,
  getSlateInput,
  getSlateOutput,
} from './loader';

export { initializeGrinWasm, isGrinWasmInitialized };

/**
 * Grin wallet keys derived from a seed.
 */
export interface GrinKeys {
  /** The secret key (32 bytes) */
  secretKey: Uint8Array;
  /** The public key (33 bytes, compressed) */
  publicKey: Uint8Array;
  /** The slatepack address (ed25519-based) */
  slatepackAddress: string;
  /** The extended private key (64 bytes: secret key + chain code) */
  extendedPrivateKey: Uint8Array;
  /** The Ed25519 address key for slatepack encryption */
  addressKey: Uint8Array;
}

/**
 * Grin transaction slate.
 */
export interface GrinSlate {
  /** Slate ID (UUID) */
  id: string;
  /** Transaction amount in nanogrin */
  amount: bigint;
  /** Transaction fee in nanogrin */
  fee: bigint;
  /** Slate state: S1 (initial), S2 (signed by recipient), S3 (finalized) */
  state: 'S1' | 'S2' | 'S3';
  /** Raw slate object from MWC wallet */
  raw: any;
  /** Serialized slate data for transport */
  serialized?: Uint8Array;
}

/**
 * A Grin UTXO (unspent output) from the backend.
 */
export interface GrinOutput {
  /** Database ID */
  id: string;
  /** Key derivation path (BIP32-style, e.g. "0300000000040000000100000000") */
  keyId: string;
  /** Child index within the path */
  nChild: number;
  /** Amount in nanogrin */
  amount: bigint;
  /** Pedersen commitment (hex string) */
  commitment: string;
  /** Whether this is a coinbase output */
  isCoinbase: boolean;
  /** Block height where this output was confirmed */
  blockHeight?: number;
}

/**
 * Result of creating a send transaction.
 */
export interface SendTransactionResult {
  /** The S1 slate ready to be sent to receiver */
  slate: GrinSlate;
  /** The slatepack-encoded slate */
  slatepack: string;
  /** Secret nonce needed to finalize the transaction later */
  secretNonce: Uint8Array;
  /** Secret key (blinding factor sum after offset) for finalization */
  secretKey: Uint8Array;
  /** Inputs used in this transaction (to lock on backend) */
  inputIds: string[];
  /** Change output details (to record on backend after finalization) */
  changeOutput?: {
    keyId: string;
    nChild: number;
    amount: bigint;
    commitment: string;
  };
}

/**
 * Initialize the Grin wallet and return keys derived from a mnemonic.
 *
 * NOTE: The MWC wallet Seed class expects either:
 * - Raw entropy bytes (16, 20, 24, 28, or 32 bytes)
 * - A mnemonic string
 * - A number indicating seed length to generate
 *
 * It does NOT accept a 64-byte BIP39 derived seed. We must pass the mnemonic.
 *
 * @param mnemonic - The BIP39 mnemonic phrase (12 or 24 words)
 * @returns Grin wallet keys
 */
export async function initGrinWallet(mnemonic: string): Promise<GrinKeys> {
  // Ensure WASM modules are initialized
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Seed = getSeed();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Create a Seed instance (constructor takes no arguments)
  const seedInstance = new Seed();

  // Initialize with the mnemonic string - the MWC Seed class will parse it internally
  await seedInstance.initialize(mnemonic);

  // Derive extended private key using BIP39 derivation
  // Parameters: key (string), useBip39 (boolean), bip39Salt (optional)
  // The key parameter is the HMAC key used for derivation - MWC uses "IamVoldemort"
  // This is accessed via globalThis.Wallet.SEED_KEY (set up by stubs.ts)
  const extendedPrivateKey = await seedInstance.getExtendedPrivateKey(
    globalThis.Wallet.SEED_KEY,
    true
  );

  // Get the root secret key (first 32 bytes of extended private key)
  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));

  // Derive public key from secret key
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key from secret key');
  }

  // Derive slatepack address key (index 0)
  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);

  // Get Ed25519 public key for slatepack address
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  // Encode as slatepack address (bech32 with 'grin' prefix)
  const bech32 = getBech32();
  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return {
    secretKey,
    publicKey,
    slatepackAddress,
    extendedPrivateKey,
    addressKey,
  };
}

/**
 * Reconstruct Grin wallet keys from a stored extended private key.
 * This allows restoring the wallet after service worker restart without the mnemonic.
 *
 * @param extendedPrivateKey - The 64-byte extended private key
 * @returns Grin wallet keys
 */
export async function initGrinWalletFromExtendedKey(extendedPrivateKey: Uint8Array): Promise<GrinKeys> {
  // Ensure WASM modules are initialized
  await initializeGrinWasm();

  const Crypto = getCrypto();
  const Ed25519 = getEd25519();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Get the root secret key (first 32 bytes of extended private key)
  const secretKey = new Uint8Array(extendedPrivateKey.subarray(0, 32));

  // Derive public key from secret key
  const publicKey = Secp256k1Zkp.publicKeyFromSecretKey(secretKey);
  if (publicKey === Secp256k1Zkp.OPERATION_FAILED) {
    throw new Error('Failed to derive public key from secret key');
  }

  // Derive slatepack address key (index 0)
  const addressKey = await Crypto.addressKey(extendedPrivateKey, 0);

  // Get Ed25519 public key for slatepack address
  const ed25519PublicKey = Ed25519.publicKeyFromSecretKey(addressKey);
  if (ed25519PublicKey === Ed25519.OPERATION_FAILED) {
    throw new Error('Failed to derive Ed25519 public key');
  }

  // Encode as slatepack address (bech32 with 'grin' prefix)
  const bech32 = getBech32();
  const words = bech32.toWords(ed25519PublicKey);
  const slatepackAddress = bech32.encode('grin', words, 1023);

  return {
    secretKey,
    publicKey,
    slatepackAddress,
    extendedPrivateKey: new Uint8Array(extendedPrivateKey),
    addressKey,
  };
}

/**
 * Create a send slate (S1) for initiating a Grin transaction.
 *
 * NOTE: This is a simplified version. The full MWC wallet requires:
 * - Input selection from UTXOs
 * - Change output creation
 * - Proof generation
 *
 * For Smirk, the backend relay handles transaction coordination.
 * This function creates the initial slate structure for the sender.
 *
 * @param keys - Grin wallet keys
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param height - Current blockchain height
 * @param recipientAddress - Recipient's slatepack address (optional)
 * @returns The initial slate (S1)
 */
export async function createSendSlate(
  keys: GrinKeys,
  amount: bigint,
  fee: bigint,
  height: bigint,
  recipientAddress?: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const BigNumber = getBigNumber();
  const Consensus = getConsensus();

  // Create a new slate with amount, fee, and height
  // Constructor: (amount, isMainnet, fee, height, lockHeight, relativeHeight, ...)
  const amountBN = new BigNumber(amount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(height.toString());

  const slate = new Slate(
    amountBN,
    true, // isMainnet (Grin mainnet)
    feeBN,
    heightBN,
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    Slate.NO_SENDER_ADDRESS,
    recipientAddress || Slate.NO_RECEIVER_ADDRESS
  );

  return {
    id: slate.getId(),
    amount,
    fee,
    state: 'S1',
    raw: slate,
  };
}

/**
 * Decode a slatepack string and return the slate data.
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The slatepack string to decode
 * @param initialSlate - The initial send slate (required for S2 responses)
 * @returns The decoded slate
 */
export async function decodeSlatepack(
  keys: GrinKeys,
  slatepackString: string,
  initialSlate?: GrinSlate
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();

  // Decode the slatepack - returns Uint8Array of slate data
  const slateData: Uint8Array = await Slatepack.decodeSlatepack(
    slatepackString,
    keys.addressKey // Ed25519 secret key for decryption
  );

  // Determine purpose based on whether we have an initial slate
  const purpose = initialSlate
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE
    : Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL;

  // Create Slate from decoded data
  // Constructor: (serializedSlate, isMainnet, purpose, initialSendSlate)
  const slate = new Slate(
    slateData,
    true, // isMainnet
    purpose,
    initialSlate?.raw || null
  );

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  // Determine state based on participant count and kernel completion
  let state: 'S1' | 'S2' | 'S3' = 'S1';
  const kernels = slate.getKernels();
  if (kernels.length > 0 && kernels[0].isComplete()) {
    state = 'S3';
  } else if (slate.getParticipants().length > 1) {
    state = 'S2';
  }

  return {
    id: slate.getId(),
    amount,
    fee,
    state,
    raw: slate,
    serialized: slateData,
  };
}

/**
 * Sign an incoming slate as the recipient (S1 -> S2).
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The incoming slatepack string
 * @returns The signed slate (S2)
 */
export async function signSlate(
  keys: GrinKeys,
  slatepackString: string
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Secp256k1Zkp = getSecp256k1Zkp();

  // Decode the incoming slate
  const slate = await decodeSlatepack(keys, slatepackString);

  // Generate a random secret nonce for signing
  const secretNonce = new Uint8Array(32);
  crypto.getRandomValues(secretNonce);

  // Ensure nonce is a valid secret key
  while (Secp256k1Zkp.isValidSecretKey(secretNonce) !== true) {
    crypto.getRandomValues(secretNonce);
  }

  // Add recipient's participant data (this signs the slate)
  // addParticipant(secretKey, secretNonce, message, isMainnet, ...)
  await slate.raw.addParticipant(
    keys.secretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  // Update state to S2
  slate.state = 'S2';

  // Clear the nonce from memory
  secretNonce.fill(0);

  return slate;
}

/**
 * Finalize a slate after receiving the signed response (S2 -> S3).
 *
 * @param keys - Grin wallet keys
 * @param slatepackString - The signed slatepack from recipient
 * @param initialSlate - The original send slate (S1)
 * @param senderSecretKey - The sender's secret key (blinding factor) from initial slate creation
 * @param senderSecretNonce - The sender's secret nonce from initial slate creation
 * @returns The finalized slate (S3)
 */
export async function finalizeSlate(
  keys: GrinKeys,
  slatepackString: string,
  initialSlate: GrinSlate,
  senderSecretKey: Uint8Array,
  senderSecretNonce: Uint8Array
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Consensus = getConsensus();

  // Decode the signed response slate
  const slate = await decodeSlatepack(keys, slatepackString, initialSlate);

  // Get base fee for verification
  const baseFee = Consensus.getBaseFee(true); // isMainnet

  // Finalize the transaction
  // finalize(secretKey, secretNonce, baseFee, isMainnet, ...)
  await slate.raw.finalize(
    senderSecretKey,
    senderSecretNonce,
    baseFee,
    true // isMainnet
  );

  // Update state to S3
  slate.state = 'S3';

  return slate;
}

/**
 * Encode a slate as a slatepack string.
 *
 * @param keys - Grin wallet keys
 * @param slate - The slate to encode
 * @param purpose - The slate purpose (SEND_INITIAL or SEND_RESPONSE)
 * @param recipientPublicKey - Recipient's Ed25519 public key for encryption (optional)
 * @returns The slatepack string
 */
export async function encodeSlatepack(
  keys: GrinKeys,
  slate: GrinSlate,
  purpose: 'send' | 'response',
  recipientPublicKey?: Uint8Array
): Promise<string> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const Slatepack = getSlatepack();

  // Serialize the slate
  const slatePurpose = purpose === 'send'
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL
    : Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE;

  const serializedSlate = slate.raw.serialize(true, slatePurpose, true); // isMainnet, purpose, preferBinary

  // Encode as slatepack
  // encodeSlatepack(slate, secretKey, publicKey)
  const slatepackString = await Slatepack.encodeSlatepack(
    serializedSlate,
    recipientPublicKey ? keys.addressKey : null, // encrypt if recipient provided
    recipientPublicKey || null
  );

  return slatepackString;
}

/**
 * Get the transaction hex from a finalized slate for broadcasting.
 *
 * @param slate - The finalized slate (S3)
 * @returns The transaction hex
 */
export function getTransactionHex(slate: GrinSlate): string {
  if (slate.state !== 'S3') {
    throw new Error('Slate must be finalized (S3) to get transaction hex');
  }

  const Common = getCommon();

  // Get the finalized transaction from the slate
  const tx = slate.raw.getTransaction();
  return Common.toHexString(tx.serialize());
}

/**
 * Convert a slatepack address to its Ed25519 public key.
 *
 * @param address - The slatepack address (grin1...)
 * @returns The Ed25519 public key (32 bytes)
 */
export function slatepackAddressToPublicKey(address: string): Uint8Array {
  const Slatepack = getSlatepack();
  return Slatepack.slatepackAddressToPublicKey(address);
}

/**
 * Convert an Ed25519 public key to a slatepack address.
 *
 * @param publicKey - The Ed25519 public key (32 bytes)
 * @returns The slatepack address (grin1...)
 */
export function publicKeyToSlatepackAddress(publicKey: Uint8Array): string {
  const Slatepack = getSlatepack();
  return Slatepack.publicKeyToSlatepackAddress(publicKey);
}

/**
 * Internal: ProofBuilder for creating bulletproof range proofs.
 * Based on NewProofBuilder from MWC wallet.
 */
class ProofBuilder {
  private privateHash: Uint8Array | null = null;
  private rewindHash: Uint8Array | null = null;

  async initialize(extendedPrivateKey: Uint8Array): Promise<void> {
    const Crypto = getCrypto();
    const Blake2b = getBlake2b();
    const Identifier = getIdentifier();
    const BigNumber = getBigNumber();

    // Derive secret key from root identifier
    const secretKey = await Crypto.deriveSecretKey(
      extendedPrivateKey,
      new BigNumber(0),
      new Identifier(Identifier.ROOT_SERIALIZED_IDENTIFIER),
      Crypto.SWITCH_TYPE_NONE
    );

    // Get private hash from secret key
    this.privateHash = Blake2b.compute(Crypto.NONCE_LENGTH, secretKey, new Uint8Array([]));
    if (this.privateHash === Blake2b.OPERATION_FAILED) {
      secretKey.fill(0);
      throw new Error('Failed to compute private hash');
    }
    secretKey.fill(0);

    // Get root public key and compute rewind hash
    const publicKey = await Crypto.rootPublicKey(extendedPrivateKey);
    this.rewindHash = Blake2b.compute(Crypto.NONCE_LENGTH, publicKey, new Uint8Array([]));
    if (this.rewindHash === Blake2b.OPERATION_FAILED) {
      if (this.privateHash) this.privateHash.fill(0);
      publicKey.fill(0);
      throw new Error('Failed to compute rewind hash');
    }
    publicKey.fill(0);
  }

  uninitialize(): void {
    if (this.privateHash) {
      this.privateHash.fill(0);
      this.privateHash = null;
    }
    if (this.rewindHash) {
      this.rewindHash.fill(0);
      this.rewindHash = null;
    }
  }

  async rewindNonce(commit: Uint8Array): Promise<Uint8Array> {
    const Blake2b = getBlake2b();
    const Crypto = getCrypto();
    const Secp256k1Zkp = getSecp256k1Zkp();

    if (!this.rewindHash) throw new Error('ProofBuilder not initialized');

    const nonce = Blake2b.compute(Crypto.NONCE_LENGTH, this.rewindHash, commit);
    if (nonce === Blake2b.OPERATION_FAILED) {
      throw new Error('Failed to compute rewind nonce');
    }
    if (Secp256k1Zkp.isValidSecretKey(nonce) !== true) {
      nonce.fill(0);
      throw new Error('Rewind nonce is not a valid secret key');
    }
    return nonce;
  }

  async privateNonce(commit: Uint8Array): Promise<Uint8Array> {
    const Blake2b = getBlake2b();
    const Crypto = getCrypto();
    const Secp256k1Zkp = getSecp256k1Zkp();

    if (!this.privateHash) throw new Error('ProofBuilder not initialized');

    const nonce = Blake2b.compute(Crypto.NONCE_LENGTH, this.privateHash, commit);
    if (nonce === Blake2b.OPERATION_FAILED) {
      throw new Error('Failed to compute private nonce');
    }
    if (Secp256k1Zkp.isValidSecretKey(nonce) !== true) {
      nonce.fill(0);
      throw new Error('Private nonce is not a valid secret key');
    }
    return nonce;
  }

  proofMessage(identifier: any, switchType: number): Uint8Array {
    const Common = getCommon();
    const Identifier = getIdentifier();

    // Message format: [0, 0, switchType, depth, ...paths]
    const messageLength = 4 + Identifier.MAX_DEPTH * 4; // header + 4 uint32 paths
    const message = new Uint8Array(messageLength).fill(0);

    // Set switch type at index 2
    message[2] = switchType;

    // Copy identifier value starting at index 3
    const identifierValue = identifier.getValue();
    message.set(identifierValue.subarray(0, messageLength - 3), 3);

    return message;
  }
}

/**
 * Create a send transaction (S1 slate) with proper UTXO selection and change output.
 *
 * This is the main function for initiating a Grin send. It:
 * 1. Selects UTXOs to cover the amount + fee
 * 2. Creates inputs from the selected UTXOs
 * 3. Creates a change output with bulletproof range proof
 * 4. Builds the slate with sender participant data
 * 5. Returns the slatepack to send to the receiver
 *
 * @param keys - Grin wallet keys
 * @param outputs - Available UTXOs from the backend
 * @param amount - Amount to send in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param height - Current blockchain height
 * @param nextChildIndex - Next available child index for key derivation
 * @param recipientAddress - Recipient's slatepack address (optional, for encryption)
 * @returns SendTransactionResult with slate, slatepack, and data needed for finalization
 */
export async function createSendTransaction(
  keys: GrinKeys,
  outputs: GrinOutput[],
  amount: bigint,
  fee: bigint,
  height: bigint,
  nextChildIndex: number,
  recipientAddress?: string
): Promise<SendTransactionResult> {
  await initializeGrinWasm();

  const Slate = getSlate();
  const SlateInput = getSlateInput();
  const SlateOutput = getSlateOutput();
  const BigNumber = getBigNumber();
  const Crypto = getCrypto();
  const Common = getCommon();
  const Identifier = getIdentifier();
  const Secp256k1Zkp = getSecp256k1Zkp();

  // Sort outputs by amount (smallest first for efficient selection)
  const sortedOutputs = [...outputs].sort((a, b) =>
    a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
  );

  // Select UTXOs to cover amount + fee
  const requiredAmount = amount + fee;
  const selectedOutputs: GrinOutput[] = [];
  let totalSelected = BigInt(0);

  for (const output of sortedOutputs) {
    selectedOutputs.push(output);
    totalSelected += output.amount;
    if (totalSelected >= requiredAmount) break;
  }

  if (totalSelected < requiredAmount) {
    throw new Error(`Insufficient balance: have ${totalSelected}, need ${requiredAmount}`);
  }

  const changeAmount = totalSelected - requiredAmount;
  const hasChange = changeAmount > BigInt(0);
  const numberOfChangeOutputs = hasChange ? 1 : 0;

  // Create the slate
  const amountBN = new BigNumber(amount.toString());
  const feeBN = new BigNumber(fee.toString());
  const heightBN = new BigNumber(height.toString());

  const slate = new Slate(
    amountBN,
    true, // isMainnet
    feeBN,
    heightBN.plus(1), // height + 1
    Slate.NO_LOCK_HEIGHT,
    Slate.NO_RELATIVE_HEIGHT,
    Slate.NO_TIME_TO_LIVE_CUT_OFF_HEIGHT,
    keys.slatepackAddress, // sender address for payment proof
    recipientAddress || Slate.NO_RECEIVER_ADDRESS
  );

  // Create SlateInputs from selected UTXOs
  const slateInputs = selectedOutputs.map(output => {
    const commitBytes = Common.fromHexString(output.commitment);
    const features = output.isCoinbase ? SlateInput.COINBASE_FEATURES : SlateInput.PLAIN_FEATURES;
    return new SlateInput(features, commitBytes);
  });

  // Add inputs to slate (async operation)
  await Slate.addInputsAsynchronous(slate, slateInputs, true, numberOfChangeOutputs + 1);

  // Build change output if needed
  let changeOutputInfo: SendTransactionResult['changeOutput'] = undefined;
  const inputsForSum: Array<{
    amount: any;
    identifier: any;
    switchType: number;
  }> = [];

  // Track input identifiers for sum calculation
  for (const output of selectedOutputs) {
    const identifier = new Identifier(output.keyId);
    inputsForSum.push({
      amount: new BigNumber(output.amount.toString()),
      identifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    });
  }

  let outputForSum: { amount: any; identifier: any; switchType: number } | null = null;

  if (hasChange) {
    // Create identifier for change output
    // Use depth 3 (account/change/index pattern)
    const changeIdentifier = new Identifier(
      3,
      new Uint32Array([0, 0, nextChildIndex, 0])
    );

    const changeAmountBN = new BigNumber(changeAmount.toString());

    // Create commitment for change output
    const changeCommit = await Crypto.commit(
      keys.extendedPrivateKey,
      changeAmountBN,
      changeIdentifier,
      Crypto.SWITCH_TYPE_REGULAR
    );

    // Create bulletproof range proof using ProofBuilder
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

    // Create SlateOutput for change
    const slateOutput = new SlateOutput(
      SlateOutput.PLAIN_FEATURES,
      changeCommit,
      changeProof
    );

    // Add output to slate
    await Slate.addOutputsAsynchronous(slate, [slateOutput]);

    // Store change output info for backend recording
    changeOutputInfo = {
      keyId: Common.toHexString(changeIdentifier.getValue()),
      nChild: nextChildIndex,
      amount: changeAmount,
      commitment: Common.toHexString(changeCommit),
    };

    outputForSum = {
      amount: changeAmountBN,
      identifier: changeIdentifier,
      switchType: Crypto.SWITCH_TYPE_REGULAR,
    };
  }

  // Create slate offset
  slate.createOffset();

  // Calculate sum of inputs and outputs (blinding factors)
  // Sum = sum(output blinds) - sum(input blinds)
  let sum: Uint8Array;

  if (outputForSum) {
    // Derive output secret key
    const outputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      outputForSum.amount,
      outputForSum.identifier,
      outputForSum.switchType
    );

    // Start with output blinding factor
    sum = new Uint8Array(outputSecretKey);
  } else {
    // No change output, start with zero
    sum = new Uint8Array(32).fill(0);
  }

  // Subtract input blinding factors
  for (const input of inputsForSum) {
    const inputSecretKey = await Crypto.deriveSecretKey(
      keys.extendedPrivateKey,
      input.amount,
      input.identifier,
      input.switchType
    );

    // Subtract input secret key from sum: sum = sum - inputSecretKey
    const negated = Secp256k1Zkp.secretKeyNegate(inputSecretKey);
    if (negated === Secp256k1Zkp.OPERATION_FAILED) {
      inputSecretKey.fill(0);
      sum.fill(0);
      throw new Error('Failed to negate input secret key');
    }

    const newSum = Secp256k1Zkp.secretKeyTweakAdd(sum, negated);
    negated.fill(0);
    inputSecretKey.fill(0);

    if (newSum === Secp256k1Zkp.OPERATION_FAILED) {
      sum.fill(0);
      throw new Error('Failed to add secret keys');
    }

    sum.fill(0);
    sum = newSum;
  }

  // Apply offset to get final secret key
  // secretKey = sum - offset
  const offset = slate.getOffset();
  const secretKey = await slate.applyOffset(sum);
  sum.fill(0);

  // Generate secret nonce for participant
  const secretNonce = Secp256k1Zkp.createSecretNonce();
  if (secretNonce === Secp256k1Zkp.OPERATION_FAILED) {
    secretKey.fill(0);
    throw new Error('Failed to create secret nonce');
  }

  // Add sender as participant
  await slate.addParticipant(
    secretKey,
    secretNonce,
    null, // no message
    true  // isMainnet
  );

  // Encode as slatepack
  const serializedSlate = slate.serialize(
    true, // isMainnet
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    true  // preferBinary
  );

  // Get recipient public key for encryption if provided
  let recipientPublicKey: Uint8Array | null = null;
  if (recipientAddress) {
    const Slatepack = getSlatepack();
    recipientPublicKey = Slatepack.slatepackAddressToPublicKey(recipientAddress);
  }

  const Slatepack = getSlatepack();
  const slatepackString = await Slatepack.encodeSlatepack(
    serializedSlate,
    recipientPublicKey ? keys.addressKey : null,
    recipientPublicKey
  );

  return {
    slate: {
      id: slate.getId(),
      amount,
      fee,
      state: 'S1',
      raw: slate,
      serialized: serializedSlate,
    },
    slatepack: slatepackString,
    secretNonce: new Uint8Array(secretNonce), // Copy to prevent mutation
    secretKey: new Uint8Array(secretKey), // Copy to prevent mutation
    inputIds: selectedOutputs.map(o => o.id),
    changeOutput: changeOutputInfo,
  };
}
