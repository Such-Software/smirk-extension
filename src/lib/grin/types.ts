/**
 * Grin wallet type definitions.
 */

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
    proof: string;
  };
}
