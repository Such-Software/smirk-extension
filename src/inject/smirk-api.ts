/**
 * Smirk API - Injected into web pages to provide window.smirk interface.
 *
 * This script runs in the page context (not content script context).
 * Communication with the extension happens via window.postMessage.
 *
 * Similar to MetaMask's window.ethereum pattern.
 */

type AssetName = 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';

export type SmirkPublicKeys = Partial<Record<AssetName, string>>;

export type SmirkAddresses = Partial<Record<AssetName, string>>;

export interface SmirkSignature {
  asset: 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';
  signature: string; // Hex encoded signature
  publicKey: string; // Public key that signed (hex)
}

export interface SmirkSignResult {
  message: string;
  signatures: SmirkSignature[];
}

export interface SmirkPaymentRequest {
  asset: 'btc' | 'ltc' | 'xmr' | 'wow';
  amount: string;    // Human-readable amount (e.g., "1.0", "9.0")
  address: string;   // Recipient address
  memo?: string;     // Optional description (e.g., "Direct mode entry fee")
}

export interface SmirkPaymentResult {
  txid: string;
  amount: string;    // Actual amount sent (may differ slightly due to fees)
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// Request ID counter
let requestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

// Listen for responses from content script
window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return;

  const { type, id, payload, error } = event.data;

  // Only handle SMIRK_RESPONSE messages
  if (type !== 'SMIRK_RESPONSE') return;

  const pending = pendingRequests.get(id);
  if (!pending) return;

  pendingRequests.delete(id);

  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(payload);
  }
});

/**
 * Sends a request to the extension via content script.
 */
function sendRequest<T>(method: string, params?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // Send message to content script
    window.postMessage(
      {
        type: 'SMIRK_REQUEST',
        id,
        method,
        params,
      },
      '*'
    );

    // Timeout after 5 minutes (for long approval flows)
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timed out'));
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * The window.smirk API object.
 */
const smirk = {
  /**
   * Check if Smirk extension is installed and ready.
   */
  isSmirk: true,

  /**
   * Connect to Smirk wallet - requests user approval to share public keys.
   * @param assets - Optional array of assets to request (e.g. ['xmr', 'wow']).
   *                 If omitted, requests all assets.
   * Returns public keys only for the approved assets.
   */
  async connect(assets?: AssetName[]): Promise<SmirkPublicKeys> {
    const validAssets: AssetName[] = ['btc', 'ltc', 'xmr', 'wow', 'grin'];
    if (assets) {
      for (const a of assets) {
        if (!validAssets.includes(a)) {
          throw new Error(`Invalid asset: ${a}. Must be one of: ${validAssets.join(', ')}`);
        }
      }
    }
    return sendRequest<SmirkPublicKeys>('connect', { assets: assets || validAssets });
  },

  /**
   * Check if the current site is connected (approved).
   */
  async isConnected(): Promise<boolean> {
    return sendRequest<boolean>('isConnected');
  },

  /**
   * Disconnect from Smirk wallet - revokes site access.
   */
  async disconnect(): Promise<void> {
    return sendRequest<void>('disconnect');
  },

  /**
   * Sign a message with wallet keys for connected assets.
   * Requires prior connection (connect() must have been called).
   * User will see the message and must approve signing.
   *
   * Signature formats (non-standard, designed for Smirk backend verification):
   * - BTC/LTC: Bitcoin message signing (double SHA256 with magic prefix), compact r||s hex.
   *   NOTE: Does not include recovery byte or Base64 encoding (not BIP-137 compatible).
   * - XMR/WOW/Grin: Ed25519 signature over SHA256(message), not raw message.
   *   NOTE: This is NOT standard RFC 8032. The message is pre-hashed with SHA-256
   *   before signing. Verifiers must pre-hash the message the same way.
   *
   * For website authentication (challenge-response), use the Smirk backend's
   * /auth/verify endpoint which understands these formats.
   */
  async signMessage(message: string): Promise<SmirkSignResult> {
    if (typeof message !== 'string' || message.length === 0) {
      throw new Error('Message must be a non-empty string');
    }
    if (message.length > 10000) {
      throw new Error('Message too long (max 10000 characters)');
    }
    return sendRequest<SmirkSignResult>('signMessage', { message });
  },

  /**
   * Get public keys without prompting user (only works if already connected).
   */
  async getPublicKeys(): Promise<SmirkPublicKeys | null> {
    return sendRequest<SmirkPublicKeys | null>('getPublicKeys');
  },

  /**
   * Get wallet addresses for all assets.
   * Requires prior connection (connect() must have been called).
   * Unlike getPublicKeys(), this returns actual blockchain addresses
   * that can receive funds.
   */
  async getAddresses(): Promise<SmirkAddresses | null> {
    return sendRequest<SmirkAddresses | null>('getAddresses');
  },

  /**
   * Request a payment from the user's wallet.
   * Opens an approval popup showing the payment details.
   * Requires prior connection (connect() must have been called).
   * Grin is not supported (requires interactive slatepack exchange).
   */
  async requestPayment(request: SmirkPaymentRequest): Promise<SmirkPaymentResult> {
    if (!request || typeof request !== 'object') {
      throw new Error('Payment request must be an object');
    }
    const { asset, amount, address } = request;
    const validAssets = ['btc', 'ltc', 'xmr', 'wow'];
    if (!validAssets.includes(asset)) {
      throw new Error(`Invalid asset: ${asset}. Must be one of: ${validAssets.join(', ')}`);
    }
    if (typeof amount !== 'string' || amount.length === 0) {
      throw new Error('Amount must be a non-empty string');
    }
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      throw new Error('Amount must be a positive number');
    }
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error('Address must be a non-empty string');
    }
    return sendRequest<SmirkPaymentResult>('requestPayment', request);
  },

  /**
   * Claim a public tip using the URL fragment key.
   * @param tipId - The tip ID from the URL
   * @param fragmentKey - The base64url-encoded key from the URL fragment
   */
  async claimPublicTip(tipId: string, fragmentKey: string): Promise<{ success: boolean; txid?: string; error?: string }> {
    if (!tipId || !fragmentKey) {
      throw new Error('tipId and fragmentKey are required');
    }
    return sendRequest<{ success: boolean; txid?: string; error?: string }>('claimPublicTip', { tipId, fragmentKey });
  },
};

// Freeze the API to prevent modification
Object.freeze(smirk);

// Expose on window
declare global {
  interface Window {
    smirk: typeof smirk;
  }
}

// Only inject if not already present
if (typeof window.smirk === 'undefined') {
  Object.defineProperty(window, 'smirk', {
    value: smirk,
    writable: false,
    configurable: false,
  });
}
