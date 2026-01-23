/**
 * Content script for Smirk extension.
 *
 * Responsibilities:
 * 1. Inject window.smirk API into web pages
 * 2. Relay messages between page and background script
 * 3. Detect tip claim URLs and inject claim UI
 *
 * NOTE: Content scripts cannot use ES module imports, so browser API
 * code is inlined here rather than imported from @/lib/browser.
 */

// Inline browser API (content scripts can't import from chunks)
declare const globalThis: typeof global & {
  browser?: typeof chrome;
  chrome?: typeof chrome;
};

const isFirefox = typeof globalThis.browser !== 'undefined';
const browserAPI = (isFirefox ? globalThis.browser : globalThis.chrome) as typeof chrome;

const runtime = {
  sendMessage<T = unknown>(message: unknown): Promise<T> {
    if (isFirefox) {
      return browserAPI.runtime.sendMessage(message) as Promise<T>;
    }
    return new Promise((resolve) => {
      browserAPI.runtime.sendMessage(message, (response: T) => resolve(response));
    });
  },
  getURL(path: string): string {
    return browserAPI.runtime.getURL(path);
  },
};

// Response type (inlined to avoid import)
interface MessageResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// window.smirk API Injection
// ============================================================================

/**
 * Injects the smirk-api.ts script into the page context.
 * This is necessary because content scripts run in an isolated context
 * and cannot directly modify window objects visible to the page.
 */
function injectSmirkAPI() {
  const script = document.createElement('script');
  script.src = runtime.getURL('inject.js');
  script.type = 'module';

  // Insert at document_start if possible, otherwise append to head/body
  const parent = document.head || document.documentElement;
  parent.insertBefore(script, parent.firstChild);

  // Clean up after injection
  script.onload = () => {
    script.remove();
  };
}

/**
 * Listens for SMIRK_REQUEST messages from the injected script
 * and relays them to the background script.
 */
function setupMessageRelay() {
  window.addEventListener('message', async (event) => {
    // Only accept messages from same window (our injected script)
    if (event.source !== window) return;

    const { type, id, method, params } = event.data;

    // Only handle SMIRK_REQUEST messages
    if (type !== 'SMIRK_REQUEST') return;

    try {
      // Get current page info for the request
      const origin = window.location.origin;
      const siteName = document.title || origin;
      const favicon = getFavicon();

      // Send to background script
      const response = await runtime.sendMessage<MessageResponse<unknown>>({
        type: 'SMIRK_API',
        method,
        params,
        origin,
        siteName,
        favicon,
      });

      // Send response back to injected script
      if (response?.success) {
        window.postMessage(
          {
            type: 'SMIRK_RESPONSE',
            id,
            payload: response.data,
          },
          '*'
        );
      } else {
        window.postMessage(
          {
            type: 'SMIRK_RESPONSE',
            id,
            error: response?.error || 'Unknown error',
          },
          '*'
        );
      }
    } catch (err) {
      // Send error back to injected script
      window.postMessage(
        {
          type: 'SMIRK_RESPONSE',
          id,
          error: err instanceof Error ? err.message : 'Unknown error',
        },
        '*'
      );
    }
  });
}

/**
 * Gets the page's favicon URL.
 */
function getFavicon(): string | undefined {
  // Try to find favicon link
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );

  for (const link of links) {
    if (link.href) {
      return link.href;
    }
  }

  // Fallback to /favicon.ico
  return `${window.location.origin}/favicon.ico`;
}

// ============================================================================
// Claim Page Detection (existing functionality)
// ============================================================================

const CLAIM_URL_PATTERN = /\/claim\/([a-zA-Z0-9_-]+)/;

interface ClaimPageData {
  linkId: string;
  fragmentKey?: string;
}

/**
 * Extracts claim data from the current URL.
 */
function extractClaimData(): ClaimPageData | null {
  const match = window.location.pathname.match(CLAIM_URL_PATTERN);
  if (!match) return null;

  const linkId = match[1];
  const fragmentKey = window.location.hash.slice(1) || undefined;

  return { linkId, fragmentKey };
}

/**
 * Sends a message to the background script.
 */
async function sendMessage<T>(message: unknown): Promise<T> {
  const response = await runtime.sendMessage<MessageResponse<T>>(message);
  if (response?.success) {
    return response.data as T;
  }
  throw new Error(response?.error || 'Unknown error');
}

/**
 * Injects claim UI into the page.
 */
function injectClaimUI(claimData: ClaimPageData) {
  // Create a floating button for claiming
  const button = document.createElement('button');
  button.id = 'smirk-claim-button';
  button.textContent = '🎁 Claim with Smirk Wallet';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    z-index: 999999;
    transition: transform 0.2s, box-shadow 0.2s;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.5)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
  });

  button.addEventListener('click', async () => {
    try {
      button.textContent = '⏳ Claiming...';
      button.disabled = true;

      // Get wallet state
      const state = await sendMessage<{ isUnlocked: boolean; hasWallet: boolean }>({
        type: 'GET_WALLET_STATE',
      });

      if (!state.hasWallet) {
        alert('Please set up your Smirk Wallet first by clicking the extension icon.');
        button.textContent = '🎁 Claim with Smirk Wallet';
        button.disabled = false;
        return;
      }

      if (!state.isUnlocked) {
        alert('Please unlock your Smirk Wallet first by clicking the extension icon.');
        button.textContent = '🎁 Claim with Smirk Wallet';
        button.disabled = false;
        return;
      }

      // TODO: Fetch tip info and claim
      // For now, just show success message
      button.textContent = '✅ Ready to claim!';

      // Open popup for full claim flow
      // Note: Content scripts can't directly open popup, so we notify background
      runtime.sendMessage({
        type: 'OPEN_CLAIM_POPUP',
        linkId: claimData.linkId,
        fragmentKey: claimData.fragmentKey,
      });
    } catch (err) {
      console.error('Claim error:', err);
      button.textContent = '❌ Error - Try Again';
      button.disabled = false;
    }
  });

  document.body.appendChild(button);
}

// ============================================================================
// Initialization
// ============================================================================

function init() {
  // Always inject the smirk API
  injectSmirkAPI();
  setupMessageRelay();

  // Check for claim page
  const claimData = extractClaimData();
  if (claimData) {
    console.log('Smirk: Detected claim page', claimData);
    injectClaimUI(claimData);
  }
}

// Run when DOM is ready - but inject API as early as possible
if (document.readyState === 'loading') {
  // Inject API immediately, don't wait for DOMContentLoaded
  injectSmirkAPI();
  setupMessageRelay();

  // Wait for body to inject claim UI
  document.addEventListener('DOMContentLoaded', () => {
    const claimData = extractClaimData();
    if (claimData) {
      console.log('Smirk: Detected claim page', claimData);
      injectClaimUI(claimData);
    }
  });
} else {
  init();
}

console.log('Smirk Wallet content script loaded');
