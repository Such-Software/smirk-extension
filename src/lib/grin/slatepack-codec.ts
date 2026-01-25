/**
 * Grin slatepack encoding/decoding functions.
 *
 * Handles converting slates to/from slatepack format for transport.
 */

import {
  initializeGrinWasm,
  getSlate,
  getSlatepack,
  getCommon,
} from './loader';
import type { GrinKeys, GrinSlate } from './types';

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

  // Debug: log slatepack info
  console.log('[Grin] decodeSlatepack called');
  console.log('[Grin] slatepack length:', slatepackString.length);
  console.log('[Grin] slatepack starts with:', slatepackString.substring(0, 50));
  console.log('[Grin] slatepack ends with:', slatepackString.substring(slatepackString.length - 50));

  // Find delimiters for debugging
  const sep = '.';
  const headerDelim = slatepackString.indexOf(sep);
  const payloadDelim = slatepackString.indexOf(sep, headerDelim + 1);
  const footerDelim = slatepackString.indexOf(sep, payloadDelim + 1);
  console.log('[Grin] Delimiter positions - header:', headerDelim, 'payload:', payloadDelim, 'footer:', footerDelim);

  // Decode the slatepack - returns Uint8Array of slate data
  let slateData: Uint8Array;
  try {
    slateData = await Slatepack.decodeSlatepack(
      slatepackString,
      keys.addressKey // Ed25519 secret key for decryption
    );
    console.log('[Grin] Slatepack.decodeSlatepack() succeeded, data length:', slateData?.length);
    console.log('[Grin] First 32 bytes:', Array.from(slateData?.slice(0, 32) || []).map(b => b.toString(16).padStart(2, '0')).join(' '));
  } catch (e: any) {
    console.error('[Grin] Slatepack.decodeSlatepack() FAILED:', e?.message || e);
    throw e;
  }

  // Determine purpose based on whether we have an initial slate
  const purpose = initialSlate
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE
    : Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL;

  // Create Slate from decoded data
  // Constructor: (serializedSlate, isMainnet, purpose, initialSendSlate)
  console.log('[Grin] Creating Slate with purpose:', purpose, '(SEND_INITIAL=0, SEND_RESPONSE=1)');
  console.log('[Grin] initialSlate provided:', !!initialSlate);
  let slate;
  try {
    slate = new Slate(
      slateData,
      true, // isMainnet
      purpose,
      initialSlate?.raw || null
    );
    console.log('[Grin] Slate created successfully, id:', slate.getId?.());
  } catch (e: any) {
    console.error('[Grin] Slate constructor FAILED:', e?.message || e);
    throw e;
  }

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
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state,
    raw: slate,
    serialized: slateData,
  };
}

/**
 * Reconstruct a GrinSlate from serialized binary data.
 * Used to recreate the S1 slate for finalizing S2 responses.
 *
 * @param serializedData - The serialized slate as Uint8Array
 * @returns The reconstructed GrinSlate
 */
export async function reconstructSlateFromSerialized(
  serializedData: Uint8Array
): Promise<GrinSlate> {
  await initializeGrinWasm();

  const Slate = getSlate();

  console.log('[Grin] Reconstructing slate from serialized data, length:', serializedData.length);

  // Create Slate from serialized data as S1 (SEND_INITIAL)
  const slate = new Slate(
    serializedData,
    true, // isMainnet
    Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL,
    null // no initial slate needed for S1
  );

  const amount = BigInt(slate.getAmount().toFixed());
  const fee = BigInt(slate.getFee().toFixed());

  console.log('[Grin] Reconstructed slate - id:', slate.getId().value, 'amount:', amount.toString(), 'fee:', fee.toString());

  return {
    id: slate.getId().value || slate.getId().toString(),
    amount,
    fee,
    state: 'S1',
    raw: slate,
    serialized: serializedData,
  };
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
  const Common = getCommon();

  // Serialize the slate
  const slatePurpose = purpose === 'send'
    ? Slate.COMPACT_SLATE_PURPOSE_SEND_INITIAL
    : Slate.COMPACT_SLATE_PURPOSE_SEND_RESPONSE;

  console.log('[Grin.encodeSlatepack] Purpose:', purpose, 'slatePurpose:', slatePurpose);
  console.log('[Grin.encodeSlatepack] Slate version:', slate.raw.getVersion?.().toFixed?.());
  console.log('[Grin.encodeSlatepack] Slate ID:', slate.raw.getId?.().serialize?.());
  console.log('[Grin.encodeSlatepack] Participants:', slate.raw.getParticipants?.()?.length);

  // Debug: show offset being serialized
  const offset = slate.raw.getOffset?.();
  if (offset) {
    console.log('[Grin.encodeSlatepack] Slate offset:', Common.toHexString(offset));
  }

  const serializedSlate = slate.raw.serialize(true, slatePurpose, true); // isMainnet, purpose, preferBinary
  console.log('[Grin.encodeSlatepack] Serialized slate length:', serializedSlate?.length);
  console.log('[Grin.encodeSlatepack] First 64 bytes:', Array.from(serializedSlate?.slice(0, 64) || []).map((b: number) => b.toString(16).padStart(2, '0')).join(' '));

  // Encode as slatepack
  // encodeSlatepack(slate, secretKey, publicKey)
  const slatepackString = await Slatepack.encodeSlatepack(
    serializedSlate,
    recipientPublicKey ? keys.addressKey : null, // encrypt if recipient provided
    recipientPublicKey || null
  );

  console.log('[Grin.encodeSlatepack] Slatepack generated, length:', slatepackString?.length);
  return slatepackString;
}
