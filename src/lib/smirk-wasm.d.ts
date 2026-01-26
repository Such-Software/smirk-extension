/**
 * TypeScript declarations for smirk-wasm (wasm-bindgen generated)
 */

export function test(): string;
export function version(): string;
export function validate_address(address: string): string;
export function estimate_fee(
  inputs: number,
  outputs: number,
  fee_per_byte: bigint,
  fee_mask: bigint
): string;
export function sign_transaction(params_json: string): string;
export function derive_output_key_image(
  view_key: string,
  spend_key: string,
  tx_pub_key: string,
  output_index: number,
  output_key: string
): string;
export function compute_key_image(
  view_key: string,
  spend_key: string,
  tx_pub_key: string,
  output_index: number
): string;

/** Synchronous initialization with pre-compiled WebAssembly.Module */
export function initSync(module: WebAssembly.Module): void;

/** Async initialization (not usable in Service Workers due to dynamic import) */
export default function init(module_or_path?: { module_or_path: string } | string): Promise<void>;
