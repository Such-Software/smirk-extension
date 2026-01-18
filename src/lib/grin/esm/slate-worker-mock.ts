/**
 * Mock Slate Worker for service worker compatibility.
 *
 * The MWC wallet Slate class uses a Web Worker for async operations.
 * Service workers can't create regular Workers, so we mock the worker
 * interface and handle operations inline using message passing simulation.
 *
 * Request types:
 * - INITIALIZE_REQUEST_TYPE (0)
 * - UNINITIALIZE_REQUEST_TYPE (1)
 * - PARSE_SLATE_REQUEST_TYPE (2)
 * - ADD_OUTPUTS_REQUEST_TYPE (3)
 * - ADD_INPUTS_REQUEST_TYPE (4)
 * - VERIFY_AFTER_FINALIZE_REQUEST_TYPE (5)
 */

// Message offsets (matching slate.esm.js)
const MESSAGE_REQUEST_INDEX_OFFSET = 0;
const MESSAGE_TYPE_OFFSET = 1;
const MESSAGE_STATUS_OFFSET = 2;
const MESSAGE_RESPONSE_OFFSET = 2;

// Request types (matching slate.esm.js)
const INITIALIZE_REQUEST_TYPE = 0;
const UNINITIALIZE_REQUEST_TYPE = 1;
const PARSE_SLATE_REQUEST_TYPE = 2;
const ADD_OUTPUTS_REQUEST_TYPE = 3;
const ADD_INPUTS_REQUEST_TYPE = 4;
const VERIFY_AFTER_FINALIZE_REQUEST_TYPE = 5;

// Status
const STATUS_SUCCESS = true;

/**
 * Mock Worker class that handles messages inline.
 */
export class MockSlateWorker {
  public onmessage: ((event: { data: any }) => void) | null = null;
  public onerror: ((error: any) => void) | null = null;

  constructor(_url?: string) {
    // URL is ignored - we handle everything inline
    console.log('[MockSlateWorker] Created');
  }

  /**
   * Handle incoming messages and respond synchronously.
   */
  postMessage(message: any[], _transfer?: Transferable[]): void {
    const requestIndex = message[MESSAGE_REQUEST_INDEX_OFFSET];
    const requestType = message[MESSAGE_TYPE_OFFSET];

    // console.log('[MockSlateWorker] Received message type:', requestType, 'index:', requestIndex);

    // Process the request and build response
    let response: any[];

    try {
      switch (requestType) {
        case INITIALIZE_REQUEST_TYPE:
          // Initialize - just succeed
          response = [requestIndex, INITIALIZE_REQUEST_TYPE, STATUS_SUCCESS];
          break;

        case UNINITIALIZE_REQUEST_TYPE:
          // Uninitialize - just succeed (no response needed typically)
          response = [requestIndex, UNINITIALIZE_REQUEST_TYPE, STATUS_SUCCESS];
          break;

        case PARSE_SLATE_REQUEST_TYPE:
          // Parse slate - the actual parsing is done in the main thread
          // Worker just returns success
          response = [requestIndex, PARSE_SLATE_REQUEST_TYPE, STATUS_SUCCESS];
          break;

        case ADD_OUTPUTS_REQUEST_TYPE:
          // Add outputs - the actual work is done in the main thread
          // Worker format: [requestIndex, type, ...outputs data]
          // Response format: [requestIndex, type, response]
          // For ADD_OUTPUTS, return empty array (outputs already added in main thread)
          response = [requestIndex, ADD_OUTPUTS_REQUEST_TYPE, []];
          break;

        case ADD_INPUTS_REQUEST_TYPE:
          // Add inputs - similar to outputs
          response = [requestIndex, ADD_INPUTS_REQUEST_TYPE, []];
          break;

        case VERIFY_AFTER_FINALIZE_REQUEST_TYPE:
          // Verify after finalize - just return success
          response = [requestIndex, VERIFY_AFTER_FINALIZE_REQUEST_TYPE, STATUS_SUCCESS];
          break;

        default:
          console.warn('[MockSlateWorker] Unknown request type:', requestType);
          response = [requestIndex, requestType, false];
      }

      // Send response back via onmessage callback
      if (this.onmessage) {
        // Use setTimeout to make it async like a real worker
        setTimeout(() => {
          this.onmessage!({ data: response });
        }, 0);
      }
    } catch (error) {
      console.error('[MockSlateWorker] Error processing message:', error);
      if (this.onerror) {
        this.onerror(error);
      }
    }
  }

  /**
   * Terminate the worker (no-op for mock).
   */
  terminate(): void {
    console.log('[MockSlateWorker] Terminated');
  }
}

/**
 * Install the mock Worker globally if real Worker is not available.
 */
export function installMockWorker(): void {
  if (typeof Worker === 'undefined' || typeof globalThis.Worker === 'undefined') {
    console.log('[MockSlateWorker] Installing mock Worker globally');
    (globalThis as any).Worker = MockSlateWorker;
  }
}
