/**
 * window.smirk API Handlers
 *
 * This module handles the website integration API (similar to MetaMask's window.ethereum).
 * Websites can use window.smirk to:
 * - Request wallet connection (get public keys)
 * - Request message signatures
 * - Check connection status
 *
 * Security Model:
 * - User must explicitly approve each connection request
 * - User must approve each signature request
 * - Connected sites are persisted to storage
 * - Sites can be disconnected at any time
 * - Private keys NEVER leave the extension
 *
 * Flow:
 * 1. Website calls window.smirk.connect()
 * 2. Content script forwards to background
 * 3. Background opens approval popup
 * 4. User approves/rejects
 * 5. If approved, public keys are returned
 * 6. Future calls from same origin skip approval (until disconnected)
 */

import type { MessageResponse, AssetType } from '@/types';
import { getWalletState, isOriginConnected, addConnectedSite, touchConnectedSite, removeConnectedSite, getConnectedSites, getConnectedSite, type ConnectedSite } from '@/lib/storage';
import { runtime, windows } from '@/lib/browser';
import {
  isUnlocked,
  unlockedKeys,
  unlockedViewKeys,
  pendingApprovals,
  incrementApprovalRequestId,
  addPendingTx,
  type PendingApprovalRequest,
  type PendingPaymentDetails,
} from './state';
import { handleClaimPublicTip } from './social';
// Static imports — import() is blocked in Chrome MV3 service workers
import { handleGetAddresses, getAddressForAsset } from './wallet';
import { handleSendTx } from './send';
import { sendTransaction as sendXmrTransaction, type XmrAsset } from '@/lib/xmr-tx';
import { bytesToHex } from '@/lib/crypto';

import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

// =============================================================================
// Main API Handler
// =============================================================================

/**
 * Main handler for window.smirk API requests from content script.
 *
 * Routes requests to appropriate handlers based on method.
 *
 * @param method - API method name
 * @param params - Method parameters
 * @param origin - Origin of the requesting website
 * @param siteName - Human-readable site name
 * @param favicon - Site favicon URL
 * @returns Method-specific response
 */
export async function handleSmirkApi(
  method: string,
  params: unknown,
  origin: string,
  siteName: string,
  favicon?: string
): Promise<MessageResponse> {
  console.log(`[SmirkAPI] ${method} from ${origin}`);

  switch (method) {
    case 'connect': {
      const assets = (params as { assets?: string[] })?.assets;
      return handleSmirkConnect(origin, siteName, favicon, assets);
    }

    case 'isConnected':
      return handleSmirkIsConnected(origin);

    case 'disconnect':
      return handleSmirkDisconnect(origin);

    case 'signMessage': {
      const { message } = params as { message: string };
      return handleSmirkSignMessage(origin, siteName, favicon, message);
    }

    case 'getPublicKeys':
      return handleSmirkGetPublicKeys(origin);

    case 'getAddresses':
      return handleSmirkGetAddresses(origin);

    case 'requestPayment': {
      const { asset, amount, address, memo } = params as { asset: string; amount: string; address: string; memo?: string };
      return handleSmirkRequestPayment(origin, siteName, favicon, asset, amount, address, memo);
    }

    case 'claimPublicTip': {
      const { tipId, fragmentKey } = params as { tipId: string; fragmentKey: string };
      return handleSmirkClaimPublicTip(origin, tipId, fragmentKey);
    }

    default:
      return { success: false, error: `Unknown method: ${method}` };
  }
}

// =============================================================================
// Connection Management
// =============================================================================

/**
 * Handle connect request from website.
 *
 * If already connected: Returns public keys immediately
 * If not connected: Opens approval popup, waits for user decision
 *
 * @param origin - Website origin
 * @param siteName - Site name for display
 * @param favicon - Site favicon
 * @returns Public keys if approved
 */
async function handleSmirkConnect(
  origin: string,
  siteName: string,
  favicon?: string,
  assets?: string[]
): Promise<MessageResponse> {
  const requestedAssets = assets || ['btc', 'ltc', 'xmr', 'wow', 'grin'];

  // Check if already connected (works even when locked)
  const connected = await isOriginConnected(origin);
  if (connected) {
    // If locked, still need to open popup for unlock
    if (!isUnlocked) {
      return openApprovalPopup('connect', origin, siteName, favicon, undefined, undefined, requestedAssets);
    }
    // Already connected and unlocked, just return public keys (filtered to approved assets)
    await touchConnectedSite(origin);
    const site = await getConnectedSite(origin);
    return await getPublicKeysResponse(site?.approvedAssets);
  }

  // Not connected - need user approval (popup will show unlock screen if locked)
  return openApprovalPopup('connect', origin, siteName, favicon, undefined, undefined, requestedAssets);
}

/**
 * Handle isConnected request.
 *
 * @param origin - Website origin to check
 * @returns Whether the origin is connected
 */
async function handleSmirkIsConnected(origin: string): Promise<MessageResponse<boolean>> {
  const connected = await isOriginConnected(origin);
  return { success: true, data: connected };
}

/**
 * Handle disconnect request.
 *
 * Removes the site from connected sites list.
 *
 * @param origin - Website origin to disconnect
 * @returns Disconnect status
 */
async function handleSmirkDisconnect(origin: string): Promise<MessageResponse> {
  await removeConnectedSite(origin);
  return { success: true, data: { disconnected: true } };
}

/**
 * Handle getPublicKeys request.
 *
 * Only returns public keys if the origin is already connected.
 *
 * @param origin - Website origin
 * @returns Public keys if connected, null otherwise
 */
async function handleSmirkGetPublicKeys(origin: string): Promise<MessageResponse> {
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: true, data: null };
  }

  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  await touchConnectedSite(origin);
  const site = await getConnectedSite(origin);
  return await getPublicKeysResponse(site?.approvedAssets);
}

/**
 * Handle getAddresses request.
 *
 * Returns wallet addresses for approved assets only.
 *
 * @param origin - Website origin
 * @returns Addresses if connected, null otherwise
 */
async function handleSmirkGetAddresses(origin: string): Promise<MessageResponse> {
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: true, data: null };
  }

  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  await touchConnectedSite(origin);
  const site = await getConnectedSite(origin);
  return await getAddressesResponse(site?.approvedAssets);
}

// =============================================================================
// Message Signing
// =============================================================================

/**
 * Handle signMessage request.
 *
 * Always requires user approval, even for connected sites.
 * This prevents malicious scripts from silently signing messages.
 *
 * @param origin - Website origin
 * @param siteName - Site name for display
 * @param favicon - Site favicon
 * @param message - Message to sign
 * @returns Signatures from all wallet keys
 */
async function handleSmirkSignMessage(
  origin: string,
  siteName: string,
  favicon: string | undefined,
  message: string
): Promise<MessageResponse> {
  // Check if connected
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: false, error: 'Site is not connected. Call connect() first.' };
  }

  // Need user approval for signing (popup will show unlock screen if locked)
  return openApprovalPopup('sign', origin, siteName, favicon, message);
}

// =============================================================================
// Approval Popup
// =============================================================================

/**
 * Opens an approval popup and returns a promise that resolves when user responds.
 *
 * Creates a new browser window with the approval UI and waits for the
 * user to approve or reject. The promise resolves with the appropriate
 * response (public keys for connect, signatures for sign, txid for payment).
 *
 * @param type - Request type (connect, sign, or payment)
 * @param origin - Website origin
 * @param siteName - Site name for display
 * @param favicon - Site favicon
 * @param message - Message to sign (for sign requests)
 * @param payment - Payment details (for payment requests)
 * @returns Promise that resolves with the response
 */
function openApprovalPopup(
  type: 'connect' | 'sign' | 'payment',
  origin: string,
  siteName: string,
  favicon?: string,
  message?: string,
  payment?: PendingPaymentDetails,
  requestedAssets?: string[]
): Promise<MessageResponse> {
  return new Promise((resolve, reject) => {
    const id = `${incrementApprovalRequestId()}`;

    // Store the pending request
    // Cast resolve/reject to match PendingApprovalRequest interface
    pendingApprovals.set(id, {
      id,
      type,
      origin,
      siteName,
      favicon,
      message,
      payment,
      requestedAssets,
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // Open approval popup
    const popupUrl = runtime.getURL(`popup.html?mode=approve&requestId=${id}`);

    // Payment popup is taller to show amount, address, memo
    const popupHeight = type === 'payment' ? 700 : type === 'sign' ? 650 : 600;

    windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: popupHeight,
      focused: true,
    }).then((window) => {
      if (window?.id) {
        const pending = pendingApprovals.get(id);
        if (pending) {
          pending.windowId = window.id;
        }
      }
    }).catch((err) => {
      pendingApprovals.delete(id);
      reject(err);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        resolve({ success: false, error: 'Approval request timed out' });
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * Handle approval response from popup.
 *
 * Called when user clicks approve or reject in the approval popup.
 *
 * @param requestId - Pending request ID
 * @param approved - Whether user approved
 * @returns Handled status
 */
export async function handleApprovalResponse(
  requestId: string,
  approved: boolean
): Promise<MessageResponse> {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return { success: false, error: 'No pending approval request found' };
  }

  pendingApprovals.delete(requestId);

  // Close the approval window if it's still open
  if (pending.windowId) {
    try {
      await windows.remove(pending.windowId);
    } catch {
      // Window may already be closed
    }
  }

  if (!approved) {
    pending.resolve({ success: false, error: 'User rejected the request' });
    return { success: true, data: { handled: true } };
  }

  // User approved
  if (pending.type === 'connect') {
    // Add to connected sites with approved asset scope
    await addConnectedSite({
      origin: pending.origin,
      name: pending.siteName,
      favicon: pending.favicon,
      connectedAt: Date.now(),
      lastUsed: Date.now(),
      approvedAssets: pending.requestedAssets,
    });

    // Return public keys (filtered to approved assets only)
    pending.resolve(await getPublicKeysResponse(pending.requestedAssets));
  } else if (pending.type === 'sign') {
    // Sign the message with all keys
    try {
      const signatures = await signMessageWithAllKeys(pending.message!);
      pending.resolve({
        success: true,
        data: {
          message: pending.message,
          signatures,
        },
      });
    } catch (err) {
      pending.resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Signing failed',
      });
    }
  } else if (pending.type === 'payment') {
    // Execute the payment
    try {
      const result = await executePayment(pending.payment!);
      pending.resolve({
        success: true,
        data: result,
      });
    } catch (err) {
      pending.resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Payment failed',
      });
    }
  }

  return { success: true, data: { handled: true } };
}

/**
 * Get pending approval request info for the approval popup.
 *
 * @param requestId - Request ID from URL params
 * @returns Pending request info
 */
export async function handleGetPendingApproval(requestId: string): Promise<MessageResponse> {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return { success: false, error: 'No pending approval request found' };
  }

  return {
    success: true,
    data: {
      id: pending.id,
      type: pending.type,
      origin: pending.origin,
      siteName: pending.siteName,
      favicon: pending.favicon,
      message: pending.message,
      payment: pending.payment,
    },
  };
}

// =============================================================================
// Connected Sites Management
// =============================================================================

/**
 * Get list of connected sites.
 *
 * @returns Array of connected sites with metadata
 */
export async function handleGetConnectedSites(): Promise<MessageResponse<{ sites: ConnectedSite[] }>> {
  const sites = await getConnectedSites();
  return { success: true, data: { sites } };
}

/**
 * Disconnect a specific site.
 *
 * @param origin - Origin to disconnect
 * @returns Disconnect status
 */
export async function handleDisconnectSite(origin: string): Promise<MessageResponse> {
  await removeConnectedSite(origin);
  return { success: true, data: { disconnected: true } };
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Get public keys response, filtered to approved assets only.
 *
 * @param approvedAssets - List of approved asset names (if absent, returns all for legacy compat)
 * @returns Public keys for approved assets
 */
async function getPublicKeysResponse(approvedAssets?: string[]): Promise<MessageResponse> {
  const state = await getWalletState();

  const allKeys: Record<string, string> = {
    btc: state.keys.btc?.publicKey || '',
    ltc: state.keys.ltc?.publicKey || '',
    xmr: state.keys.xmr?.publicSpendKey || state.keys.xmr?.publicKey || '',
    wow: state.keys.wow?.publicSpendKey || state.keys.wow?.publicKey || '',
    grin: state.keys.grin?.publicKey || '',
  };

  // Filter to approved assets only
  const allowed = approvedAssets || ['btc', 'ltc', 'xmr', 'wow', 'grin'];
  const publicKeys: Record<string, string> = {};
  for (const asset of allowed) {
    if (allKeys[asset]) publicKeys[asset] = allKeys[asset];
  }

  return { success: true, data: publicKeys };
}

/**
 * Get addresses response, filtered to approved assets only.
 *
 * @param approvedAssets - List of approved asset names (if absent, returns all for legacy compat)
 * @returns Addresses for approved assets
 */
async function getAddressesResponse(approvedAssets?: string[]): Promise<MessageResponse> {
  const result = await handleGetAddresses();

  if (!result.success || !result.data) {
    return result;
  }

  const allowed = approvedAssets || ['btc', 'ltc', 'xmr', 'wow', 'grin'];
  const addresses: Record<string, string> = {};

  for (const item of result.data.addresses) {
    if (allowed.includes(item.asset)) {
      addresses[item.asset] = item.address;
    }
  }

  return { success: true, data: addresses };
}

/**
 * Sign a message with all wallet keys.
 *
 * Returns array of signatures for each asset type:
 * - BTC/LTC: ECDSA signature (secp256k1) with Bitcoin message signing format
 * - XMR/WOW/Grin: Ed25519 signature using spend/slatepack key
 *
 * Signature Formats:
 * - BTC/LTC use Bitcoin message signing: double SHA256 with magic prefix
 * - XMR/WOW/Grin use SHA256 hash + Ed25519 signature
 *
 * @param message - Message to sign
 * @returns Array of signatures per asset
 */
async function signMessageWithAllKeys(message: string): Promise<Array<{
  asset: AssetType;
  signature: string;
  publicKey: string;
}>> {
  // Crypto libraries are imported statically at the top of the file

  const state = await getWalletState();
  const signatures: Array<{ asset: AssetType; signature: string; publicKey: string }> = [];

  // Ed25519 curve order (L)
  const ED25519_ORDER = BigInt(
    '7237005577332262213973186563042994240857116359379907606001950938285454250989'
  );

  // Helper to convert bytes to hex
  function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Helper to convert hex to bytes
  function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // Convert bytes to bigint (little-endian)
  function bytesToBigInt(bytes: Uint8Array): bigint {
    let result = BigInt(0);
    for (let i = bytes.length - 1; i >= 0; i--) {
      result = result * BigInt(256) + BigInt(bytes[i]);
    }
    return result;
  }

  // Convert bigint to bytes (little-endian, 32 bytes)
  function bigIntToBytes(n: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let remaining = n;
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number(remaining & BigInt(0xff));
      remaining = remaining >> BigInt(8);
    }
    return bytes;
  }

  // Modular arithmetic
  function mod(n: bigint, m: bigint): bigint {
    return ((n % m) + m) % m;
  }

  /**
   * Sign with Ed25519 using a raw scalar (not a seed).
   *
   * Our wallet stores the scalar directly (not the seed), but ed25519.sign()
   * expects a seed and would re-hash it. This function signs correctly
   * using the raw scalar.
   *
   * @param msgHash - The message hash to sign (already SHA256'd)
   * @param privateScalar - The private key as bytes (little-endian scalar)
   * @param publicKeyBytes - The public key (32 bytes)
   * @returns The signature (64 bytes: R || s)
   */
  function ed25519SignWithScalar(
    message: Uint8Array,
    privateScalar: Uint8Array,
    publicKeyBytes: Uint8Array
  ): Uint8Array {
    // Convert scalar bytes to bigint
    const a = bytesToBigInt(privateScalar);

    // Generate deterministic nonce: r = SHA512(SHA512(a) || message) mod L
    // Using double-hash of scalar as prefix for nonce generation
    const scalarHash = sha512(privateScalar);
    const nonceInput = new Uint8Array(scalarHash.length + message.length);
    nonceInput.set(scalarHash);
    nonceInput.set(message, scalarHash.length);
    const rHash = sha512(nonceInput);
    const r = mod(bytesToBigInt(rHash), ED25519_ORDER);

    // R = r * G (base point multiplication)
    const R = ed25519.ExtendedPoint.BASE.multiply(r);
    const RBytes = R.toRawBytes();

    // k = SHA512(R || A || message) mod L  (RFC 8032 standard)
    const kInput = new Uint8Array(RBytes.length + publicKeyBytes.length + message.length);
    kInput.set(RBytes);
    kInput.set(publicKeyBytes, RBytes.length);
    kInput.set(message, RBytes.length + publicKeyBytes.length);
    const kHash = sha512(kInput);
    const k = mod(bytesToBigInt(kHash), ED25519_ORDER);

    // s = r + k * a mod L
    const s = mod(r + k * a, ED25519_ORDER);
    const sBytes = bigIntToBytes(s);

    // Signature = R || s
    const signature = new Uint8Array(64);
    signature.set(RBytes);
    signature.set(sBytes, 32);
    return signature;
  }

  /**
   * Create Bitcoin-style message hash.
   * Format: SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
   *
   * This is the standard Bitcoin message signing format used by wallets
   * like Bitcoin Core and Electrum.
   */
  function bitcoinMessageHash(msg: string): Uint8Array {
    const prefix = '\x18Bitcoin Signed Message:\n';
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(msg);
    const prefixBytes = encoder.encode(prefix);

    // Encode length as varint (for simplicity, assume < 253 bytes)
    const lenByte = new Uint8Array([messageBytes.length]);

    // Concatenate: prefix + length + message
    const fullMessage = new Uint8Array(prefixBytes.length + 1 + messageBytes.length);
    fullMessage.set(prefixBytes, 0);
    fullMessage.set(lenByte, prefixBytes.length);
    fullMessage.set(messageBytes, prefixBytes.length + 1);

    // Double SHA256
    return sha256(sha256(fullMessage));
  }

  /**
   * Encode message string to bytes for Ed25519 signing.
   * Uses raw UTF-8 bytes (standard RFC 8032 — no pre-hashing).
   */
  function ed25519MessageBytes(msg: string): Uint8Array {
    return new TextEncoder().encode(msg);
  }

  // BIP-137 Bitcoin message signature: Base64(header || r || s)
  // header = 27 + recovery + 4 (compressed key)
  function signBip137(msg: string, privateKey: Uint8Array): string {
    const msgHash = bitcoinMessageHash(msg);
    const sig = secp256k1.sign(msgHash, privateKey, { lowS: true });
    const headerByte = 27 + sig.recovery + 4;
    const compact = new Uint8Array(65);
    compact[0] = headerByte;
    compact.set(sig.toCompactRawBytes(), 1);
    return btoa(String.fromCharCode(...compact));
  }

  // Sign with BTC key (ECDSA secp256k1, BIP-137 format)
  if (unlockedKeys.has('btc') && state.keys.btc) {
    try {
      const privateKey = unlockedKeys.get('btc')!;
      signatures.push({
        asset: 'btc',
        signature: signBip137(message, privateKey),
        publicKey: state.keys.btc.publicKey,
      });
    } catch (err) {
      console.error('[SignMessage] BTC signing failed:', err);
      signatures.push({ asset: 'btc', signature: '', publicKey: state.keys.btc.publicKey });
    }
  }

  // Sign with LTC key (ECDSA secp256k1, BIP-137 format)
  if (unlockedKeys.has('ltc') && state.keys.ltc) {
    try {
      const privateKey = unlockedKeys.get('ltc')!;
      signatures.push({
        asset: 'ltc',
        signature: signBip137(message, privateKey),
        publicKey: state.keys.ltc.publicKey,
      });
    } catch (err) {
      console.error('[SignMessage] LTC signing failed:', err);
      signatures.push({ asset: 'ltc', signature: '', publicKey: state.keys.ltc.publicKey });
    }
  }

  // Sign with XMR key (Ed25519 using private spend key)
  // Note: We use custom signing because our keys are raw scalars, not seeds
  if (unlockedKeys.has('xmr') && state.keys.xmr) {
    try {
      const privateKey = unlockedKeys.get('xmr')!;
      const publicKeyHex = state.keys.xmr.publicSpendKey || state.keys.xmr.publicKey;
      const publicKeyBytes = fromHex(publicKeyHex);
      const msgBytes = ed25519MessageBytes(message);
      const sig = ed25519SignWithScalar(msgBytes, privateKey, publicKeyBytes);
      signatures.push({
        asset: 'xmr',
        signature: toHex(sig),
        publicKey: publicKeyHex,
      });
    } catch (err) {
      console.error('[SignMessage] XMR signing failed:', err);
      signatures.push({
        asset: 'xmr',
        signature: '',
        publicKey: state.keys.xmr.publicSpendKey || state.keys.xmr.publicKey,
      });
    }
  }

  // Sign with WOW key (Ed25519 using private spend key, same format as XMR)
  if (unlockedKeys.has('wow') && state.keys.wow) {
    try {
      const privateKey = unlockedKeys.get('wow')!;
      const publicKeyHex = state.keys.wow.publicSpendKey || state.keys.wow.publicKey;
      const publicKeyBytes = fromHex(publicKeyHex);
      const msgBytes = ed25519MessageBytes(message);
      const sig = ed25519SignWithScalar(msgBytes, privateKey, publicKeyBytes);
      signatures.push({
        asset: 'wow',
        signature: toHex(sig),
        publicKey: publicKeyHex,
      });
    } catch (err) {
      console.error('[SignMessage] WOW signing failed:', err);
      signatures.push({
        asset: 'wow',
        signature: '',
        publicKey: state.keys.wow.publicSpendKey || state.keys.wow.publicKey,
      });
    }
  }

  // Sign with Grin key (Ed25519 using slatepack key)
  if (unlockedKeys.has('grin') && state.keys.grin) {
    try {
      const privateKey = unlockedKeys.get('grin')!;
      const publicKeyHex = state.keys.grin.publicKey;
      const publicKeyBytes = fromHex(publicKeyHex);
      const msgBytes = ed25519MessageBytes(message);
      const sig = ed25519SignWithScalar(msgBytes, privateKey, publicKeyBytes);
      signatures.push({
        asset: 'grin',
        signature: toHex(sig),
        publicKey: publicKeyHex,
      });
    } catch (err) {
      console.error('[SignMessage] Grin signing failed:', err);
      signatures.push({
        asset: 'grin',
        signature: '',
        publicKey: state.keys.grin.publicKey,
      });
    }
  }

  return signatures;
}

// =============================================================================
// Payment Requests
// =============================================================================

/**
 * Handle requestPayment from website.
 *
 * Validates parameters and opens approval popup showing payment details.
 * Requires prior connection.
 *
 * @param origin - Website origin
 * @param siteName - Site name for display
 * @param favicon - Site favicon
 * @param asset - Asset to send
 * @param amount - Human-readable amount
 * @param address - Recipient address
 * @param memo - Optional description
 */
async function handleSmirkRequestPayment(
  origin: string,
  siteName: string,
  favicon: string | undefined,
  asset: string,
  amount: string,
  address: string,
  memo?: string
): Promise<MessageResponse> {
  // Check if connected
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: false, error: 'Site is not connected. Call connect() first.' };
  }

  // Validate asset
  const validAssets = ['btc', 'ltc', 'xmr', 'wow'];
  if (!validAssets.includes(asset)) {
    return { success: false, error: `Invalid asset: ${asset}` };
  }

  // Validate amount — reject non-numeric, negative, zero, Infinity, NaN, scientific notation
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) {
    return { success: false, error: 'Amount must be a valid decimal number' };
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return { success: false, error: 'Amount must be a positive finite number' };
  }
  // Check atomic unit precision won't overflow safe integer range
  const maxAtomicMultiplier = (asset === 'btc' || asset === 'ltc') ? 1e8 : 1e12;
  if (numAmount * maxAtomicMultiplier > Number.MAX_SAFE_INTEGER) {
    return { success: false, error: 'Amount too large' };
  }

  // Open approval popup with payment details
  return openApprovalPopup('payment', origin, siteName, favicon, undefined, {
    asset,
    amount,
    address,
    memo,
  });
}

/**
 * Execute an approved payment.
 *
 * Routes to the appropriate send handler based on asset type:
 * - BTC/LTC: UTXO-based send via handleSendTx
 * - XMR/WOW: WASM-based send via xmr-tx sendTransaction
 *
 * @param payment - Payment details from the approval
 * @returns Transaction result with txid and amount
 */
async function executePayment(
  payment: PendingPaymentDetails
): Promise<{ txid: string; amount: string }> {
  const { asset, amount, address } = payment;

  if (asset === 'btc' || asset === 'ltc') {
    // Convert human amount to satoshis
    const satoshis = Math.round(Number(amount) * 1e8);

    // Get fee estimate from backend
    const feeResult = await api.estimateFee(asset);
    const feeRate = feeResult.data?.normal ?? (asset === 'btc' ? 2 : 1); // fallback if estimation fails

    const result = await handleSendTx(asset, address, satoshis, feeRate);
    if (!result.success) {
      throw new Error(result.error || 'Transaction failed');
    }

    // Track pending transaction
    await addPendingTx({
      txHash: result.data.txid,
      asset,
      amount: result.data.actualAmount,
      fee: result.data.fee,
      timestamp: Date.now(),
    });

    return {
      txid: result.data.txid,
      amount: (result.data.actualAmount / 1e8).toString(),
    };
  }

  if (asset === 'xmr' || asset === 'wow') {
    // Convert human amount to atomic units
    const atomicUnits = Math.round(Number(amount) * 1e12);

    // Get wallet keys from state
    const senderViewKey = unlockedViewKeys.get(asset);
    const senderSpendKey = unlockedKeys.get(asset);
    if (!senderViewKey || !senderSpendKey) {
      throw new Error(`No ${asset} keys available`);
    }

    const state = await getWalletState();
    const senderKey = state.keys[asset];
    if (!senderKey) {
      throw new Error(`No ${asset} key found in wallet`);
    }

    // Get sender address
    const senderAddress = getAddressForAsset(asset, senderKey);

    const result = await sendXmrTransaction(
      asset as XmrAsset,
      senderAddress,
      bytesToHex(senderViewKey),
      bytesToHex(senderSpendKey),
      address,
      atomicUnits,
      'mainnet',
      false
    );

    // Track pending transaction
    await addPendingTx({
      txHash: result.txHash,
      asset,
      amount: result.actualAmount,
      fee: result.fee,
      timestamp: Date.now(),
    });

    return {
      txid: result.txHash,
      amount: (result.actualAmount / 1e12).toString(),
    };
  }

  throw new Error(`Unsupported asset: ${asset}`);
}

// =============================================================================
// Public Tip Claiming
// =============================================================================

/**
 * Handle claimPublicTip request from website.
 *
 * Claims a public tip using the URL fragment key.
 * Requires wallet to be unlocked and site to be connected.
 *
 * @param origin - Website origin
 * @param tipId - The tip ID
 * @param fragmentKey - Base64url-encoded encryption key from URL fragment
 * @returns Claim result with txid on success
 */
async function handleSmirkClaimPublicTip(
  origin: string,
  tipId: string,
  fragmentKey: string
): Promise<MessageResponse> {
  // Check if connected
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: false, error: 'Site is not connected. Call connect() first.' };
  }

  // Check if wallet is unlocked
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked. Please unlock your wallet first.' };
  }

  // Claim the tip
  const result = await handleClaimPublicTip(tipId, fragmentKey);

  if (result.success) {
    return {
      success: true,
      data: {
        success: true,
        txid: result.data.txid,
      },
    };
  } else {
    // Claim failed - return error at top level
    return {
      success: false,
      error: result.error,
    };
  }
}
