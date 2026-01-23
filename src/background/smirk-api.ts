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
import { getWalletState, isOriginConnected, addConnectedSite, touchConnectedSite, removeConnectedSite, getConnectedSites, type ConnectedSite } from '@/lib/storage';
import { runtime, windows } from '@/lib/browser';
import {
  isUnlocked,
  unlockedKeys,
  pendingApprovals,
  incrementApprovalRequestId,
  type PendingApprovalRequest,
} from './state';

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
    case 'connect':
      return handleSmirkConnect(origin, siteName, favicon);

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
  favicon?: string
): Promise<MessageResponse> {
  // Check if wallet exists and is unlocked
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked. Please unlock your Smirk wallet first.' };
  }

  // Check if already connected
  const connected = await isOriginConnected(origin);
  if (connected) {
    // Already connected, just return public keys
    await touchConnectedSite(origin);
    return await getPublicKeysResponse();
  }

  // Not connected - need user approval
  return openApprovalPopup('connect', origin, siteName, favicon);
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
  return await getPublicKeysResponse();
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
  // Check if wallet is unlocked
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked. Please unlock your Smirk wallet first.' };
  }

  // Check if connected
  const connected = await isOriginConnected(origin);
  if (!connected) {
    return { success: false, error: 'Site is not connected. Call connect() first.' };
  }

  // Need user approval for signing
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
 * response (public keys for connect, signatures for sign).
 *
 * @param type - Request type (connect or sign)
 * @param origin - Website origin
 * @param siteName - Site name for display
 * @param favicon - Site favicon
 * @param message - Message to sign (for sign requests)
 * @returns Promise that resolves with the response
 */
function openApprovalPopup(
  type: 'connect' | 'sign',
  origin: string,
  siteName: string,
  favicon?: string,
  message?: string
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
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // Open approval popup
    const popupUrl = runtime.getURL(`popup.html?mode=approve&requestId=${id}`);

    windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: type === 'sign' ? 500 : 400, // Sign needs more height for message
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
    // Add to connected sites
    await addConnectedSite({
      origin: pending.origin,
      name: pending.siteName,
      favicon: pending.favicon,
      connectedAt: Date.now(),
      lastUsed: Date.now(),
    });

    // Return public keys
    pending.resolve(await getPublicKeysResponse());
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
 * Get public keys response for all assets.
 *
 * @returns Public keys for BTC, LTC, XMR, WOW, Grin
 */
async function getPublicKeysResponse(): Promise<MessageResponse> {
  const state = await getWalletState();

  const publicKeys: Record<string, string> = {
    btc: state.keys.btc?.publicKey || '',
    ltc: state.keys.ltc?.publicKey || '',
    xmr: state.keys.xmr?.publicSpendKey || state.keys.xmr?.publicKey || '',
    wow: state.keys.wow?.publicSpendKey || state.keys.wow?.publicKey || '',
    grin: state.keys.grin?.publicKey || '',
  };

  return {
    success: true,
    data: publicKeys,
  };
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
  // Import crypto libraries
  const { secp256k1 } = await import('@noble/curves/secp256k1');
  const { ed25519 } = await import('@noble/curves/ed25519');
  const { sha256 } = await import('@noble/hashes/sha256');

  const state = await getWalletState();
  const signatures: Array<{ asset: AssetType; signature: string; publicKey: string }> = [];

  // Helper to convert bytes to hex
  function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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
   * Create Ed25519 message hash (SHA256 of the message).
   * We hash first for domain separation, then Ed25519 does its own hashing.
   */
  function ed25519MessageHash(msg: string): Uint8Array {
    const encoder = new TextEncoder();
    return sha256(encoder.encode(msg));
  }

  // Sign with BTC key (ECDSA secp256k1)
  if (unlockedKeys.has('btc') && state.keys.btc) {
    try {
      const privateKey = unlockedKeys.get('btc')!;
      const msgHash = bitcoinMessageHash(message);
      const sig = secp256k1.sign(msgHash, privateKey);
      signatures.push({
        asset: 'btc',
        signature: sig.toCompactHex(),
        publicKey: state.keys.btc.publicKey,
      });
    } catch (err) {
      console.error('[SignMessage] BTC signing failed:', err);
      signatures.push({ asset: 'btc', signature: '', publicKey: state.keys.btc.publicKey });
    }
  }

  // Sign with LTC key (ECDSA secp256k1, same format as BTC)
  if (unlockedKeys.has('ltc') && state.keys.ltc) {
    try {
      const privateKey = unlockedKeys.get('ltc')!;
      const msgHash = bitcoinMessageHash(message);
      const sig = secp256k1.sign(msgHash, privateKey);
      signatures.push({
        asset: 'ltc',
        signature: sig.toCompactHex(),
        publicKey: state.keys.ltc.publicKey,
      });
    } catch (err) {
      console.error('[SignMessage] LTC signing failed:', err);
      signatures.push({ asset: 'ltc', signature: '', publicKey: state.keys.ltc.publicKey });
    }
  }

  // Sign with XMR key (Ed25519 using private spend key)
  if (unlockedKeys.has('xmr') && state.keys.xmr) {
    try {
      const privateKey = unlockedKeys.get('xmr')!;
      const publicKey = state.keys.xmr.publicSpendKey || state.keys.xmr.publicKey;
      const msgHash = ed25519MessageHash(message);
      const sig = ed25519.sign(msgHash, privateKey);
      signatures.push({
        asset: 'xmr',
        signature: toHex(sig),
        publicKey,
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
      const publicKey = state.keys.wow.publicSpendKey || state.keys.wow.publicKey;
      const msgHash = ed25519MessageHash(message);
      const sig = ed25519.sign(msgHash, privateKey);
      signatures.push({
        asset: 'wow',
        signature: toHex(sig),
        publicKey,
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
      const publicKey = state.keys.grin.publicKey;
      const msgHash = ed25519MessageHash(message);
      const sig = ed25519.sign(msgHash, privateKey);
      signatures.push({
        asset: 'grin',
        signature: toHex(sig),
        publicKey,
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
