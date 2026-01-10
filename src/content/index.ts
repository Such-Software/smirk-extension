/**
 * Content script for Smirk extension.
 *
 * Injected into claim pages to:
 * - Detect tip claim URLs
 * - Extract URL fragment keys
 * - Communicate with background for claiming
 */

import type { MessageResponse } from '@/types';
import { runtime } from '@/lib/browser';

// Check if we're on a tip claim page
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

// Initialize on page load
function init() {
  const claimData = extractClaimData();

  if (claimData) {
    console.log('Smirk: Detected claim page', claimData);
    injectClaimUI(claimData);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('Smirk Wallet content script loaded');
