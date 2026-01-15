/**
 * Grin WASM initialization module.
 *
 * This module handles loading and initializing the MWC wallet WASM modules
 * in a cross-browser compatible way.
 *
 * The MWC wallet JS files are loaded via Vite's ?raw import to get their
 * source code, then executed in order with proper dependency handling.
 */

// Import the source files as raw strings
// Vite will inline these at build time
import bignumberSource from '../bignumber.js-9.1.1.js?raw';
import bech32Source from '../bech32-2.0.0.js?raw';
import commonSource from '../common.js?raw';
import bitReaderSource from '../bit_reader.js?raw';
import bitWriterSource from '../bit_writer.js?raw';
import secp256k1ZkpSource from '../secp256k1-zkp-0.0.29.js?raw';
import ed25519Source from '../Ed25519-0.0.22.js?raw';
import x25519Source from '../X25519-0.0.23.js?raw';
import blake2bSource from '../BLAKE2b-0.0.2.js?raw';
import consensusSource from '../consensus.js?raw';
import identifierSource from '../identifier.js?raw';
import seedSource from '../seed.js?raw';
import cryptoSource from '../crypto.js?raw';
import slateInputSource from '../slate_input.js?raw';
import slateOutputSource from '../slate_output.js?raw';
import slateKernelSource from '../slate_kernel.js?raw';
import slateParticipantSource from '../slate_participant.js?raw';
import slateSource from '../slate.js?raw';
import slatepackSource from '../slatepack.js?raw';

// Track initialization state
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Get the URL for a WASM file.
 * This is used by the Emscripten-generated code to locate WASM files.
 */
function getWasmUrl(filename: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    // Chrome/Edge extension context
    return chrome.runtime.getURL(`src/lib/grin/${filename}`);
  }
  if (typeof browser !== 'undefined' && (browser as any).runtime?.getURL) {
    // Firefox extension context
    return (browser as any).runtime.getURL(`src/lib/grin/${filename}`);
  }
  // Fallback for web context or testing
  return `/src/lib/grin/${filename}`;
}

/**
 * Set up the getResource function that WASM loaders expect.
 */
function setupGetResource(): void {
  (globalThis as any).getResource = (path: string): string => {
    // Extract filename from path like "./scripts/secp256k1-zkp-0.0.29.wasm"
    const filename = path.split('/').pop() || path;
    return getWasmUrl(filename);
  };
}

/**
 * Execute JavaScript source code in the global scope.
 * This is used to load the MWC wallet JS files.
 */
function executeScript(source: string, name: string): void {
  try {
    // Use indirect eval to execute in global scope
    const indirectEval = eval;
    indirectEval(source);
  } catch (error) {
    console.error(`Failed to execute ${name}:`, error);
    throw new Error(`Failed to load ${name}: ${error}`);
  }
}

/**
 * Remove jQuery dependencies from common.js source.
 * The MWC wallet uses jQuery for some DOM operations that we don't need.
 */
function stripJQueryFromCommon(source: string): string {
  // Remove the jQuery prototype extensions section
  // This is at the end of common.js after "// Check if jQuery exists"
  const jqueryCheckIndex = source.indexOf('// Check if jQuery exists');
  if (jqueryCheckIndex !== -1) {
    // Find the end of the jQuery block and keep only what's before it
    source = source.substring(0, jqueryCheckIndex);
  }

  // Also strip htmlEncode and htmlDecode which use jQuery
  // These are replaced with vanilla JS alternatives below
  source = source.replace(
    /static htmlEncode\(string\) \{[\s\S]*?return.*\$.*[\s\S]*?\}/,
    `static htmlEncode(string) {
      const div = document.createElement('div');
      div.textContent = string;
      return div.innerHTML
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\`/g, '&#96;');
    }`
  );

  source = source.replace(
    /static htmlDecode\(htmlString\) \{[\s\S]*?return.*\$.*[\s\S]*?\}/,
    `static htmlDecode(htmlString) {
      const div = document.createElement('div');
      div.innerHTML = htmlString;
      return div.textContent || '';
    }`
  );

  return source;
}

/**
 * Initialize the Grin WASM modules.
 *
 * This loads all the MWC wallet JS files in the correct dependency order
 * and initializes the WASM crypto modules.
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeGrin(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[Grin] Starting WASM initialization...');

    // Set up getResource before loading any WASM-dependent files
    setupGetResource();

    // Phase 1: Load core utilities (no dependencies)
    console.log('[Grin] Loading core utilities...');
    executeScript(bignumberSource, 'bignumber.js');
    executeScript(bech32Source, 'bech32.js');
    executeScript(stripJQueryFromCommon(commonSource), 'common.js');
    executeScript(bitReaderSource, 'bit_reader.js');
    executeScript(bitWriterSource, 'bit_writer.js');

    // Phase 2: Load WASM module wrappers
    console.log('[Grin] Loading WASM wrappers...');
    executeScript(secp256k1ZkpSource, 'secp256k1-zkp.js');
    executeScript(ed25519Source, 'Ed25519.js');
    executeScript(x25519Source, 'X25519.js');
    executeScript(blake2bSource, 'BLAKE2b.js');

    // Phase 3: Initialize WASM modules
    console.log('[Grin] Initializing secp256k1-zkp WASM...');
    await (globalThis as any).Secp256k1Zkp.initialize();

    console.log('[Grin] Initializing Ed25519 WASM...');
    await (globalThis as any).Ed25519.initialize();

    console.log('[Grin] Initializing X25519 WASM...');
    await (globalThis as any).X25519.initialize();

    console.log('[Grin] Initializing BLAKE2b WASM...');
    await (globalThis as any).Blake2b.initialize();

    // Phase 4: Load crypto-dependent modules
    console.log('[Grin] Loading crypto modules...');
    executeScript(consensusSource, 'consensus.js');
    executeScript(identifierSource, 'identifier.js');
    executeScript(seedSource, 'seed.js');
    executeScript(cryptoSource, 'crypto.js');

    // Phase 5: Load slate modules
    console.log('[Grin] Loading slate modules...');
    executeScript(slateInputSource, 'slate_input.js');
    executeScript(slateOutputSource, 'slate_output.js');
    executeScript(slateKernelSource, 'slate_kernel.js');
    executeScript(slateParticipantSource, 'slate_participant.js');
    executeScript(slateSource, 'slate.js');
    executeScript(slatepackSource, 'slatepack.js');

    initialized = true;
    console.log('[Grin] WASM initialization complete');
  })();

  return initPromise;
}

/**
 * Check if Grin WASM modules are initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

// Re-export the global classes for TypeScript access
export function getSecp256k1Zkp(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Secp256k1Zkp;
}

export function getEd25519(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Ed25519;
}

export function getX25519(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).X25519;
}

export function getBlake2b(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Blake2b;
}

export function getCommon(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Common;
}

export function getCrypto(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Crypto;
}

export function getConsensus(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Consensus;
}

export function getIdentifier(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Identifier;
}

export function getSeed(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Seed;
}

export function getSlate(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Slate;
}

export function getSlatepack(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).Slatepack;
}

export function getBigNumber(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).BigNumber;
}

export function getBech32(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).bech32;
}

export function getBech32m(): any {
  if (!initialized) throw new Error('Grin not initialized');
  return (globalThis as any).bech32m;
}

// Firefox browser API type
declare const browser: typeof chrome | undefined;
