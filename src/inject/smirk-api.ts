/**
 * Smirk API - Injected into web pages to provide window.smirk interface.
 *
 * This script runs in the page context (not content script context).
 * Communication with the extension happens via window.postMessage.
 *
 * Similar to MetaMask's window.ethereum pattern.
 */

export interface SmirkPublicKeys {
  btc: string; // Compressed public key (hex)
  ltc: string; // Compressed public key (hex)
  xmr: string; // Public spend key (hex)
  wow: string; // Public spend key (hex)
  grin: string; // Public key (hex)
}

export interface SmirkSignature {
  asset: 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';
  signature: string; // Hex encoded signature
  publicKey: string; // Public key that signed (hex)
}

export interface SmirkSignResult {
  message: string;
  signatures: SmirkSignature[];
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
   * Returns public keys for all 5 supported assets.
   */
  async connect(): Promise<SmirkPublicKeys> {
    return sendRequest<SmirkPublicKeys>('connect');
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
   * Sign a message with all 5 wallet keys.
   * Requires prior connection (connect() must have been called).
   * User will see the message and must approve signing.
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
