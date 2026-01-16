/**
 * WASM resource loader utility.
 *
 * Provides the getResource function that WASM loaders expect,
 * returning proper URLs for the extension context.
 */

/**
 * Get the URL for a WASM file.
 * This is used by the Emscripten-generated code to locate WASM files.
 */
export function getWasmUrl(filename: string): string {
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
 * Get resource function for legacy WASM loaders.
 * Maps paths like "./scripts/foo.wasm" to proper URLs.
 */
export function getResource(path: string): string {
  // Extract filename from path like "./scripts/secp256k1-zkp-0.0.29.wasm"
  const filename = path.split('/').pop() || path;
  return getWasmUrl(filename);
}

// Set up global getResource for WASM loaders that expect it
if (typeof globalThis !== 'undefined') {
  (globalThis as any).getResource = getResource;
}

// Firefox browser API type
declare const browser: typeof chrome | undefined;
