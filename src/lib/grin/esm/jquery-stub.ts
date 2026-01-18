/**
 * Minimal jQuery stub for MWC wallet event system.
 *
 * The MWC wallet code uses jQuery's event system for worker communication:
 * - $(document).trigger(eventName, [data]) - emit event
 * - $(document).one(eventName, handler) - listen once
 * - $(window).on('beforeunload', handler) - window events (ignored in service worker)
 *
 * This stub provides a simple EventEmitter replacement.
 */

// Simple event emitter for worker communication
class EventEmitter {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private oneTimeListeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  on(event: string, handler: (...args: any[]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  one(event: string, handler: (...args: any[]) => void): this {
    if (!this.oneTimeListeners.has(event)) {
      this.oneTimeListeners.set(event, new Set());
    }
    this.oneTimeListeners.get(event)!.add(handler);
    return this;
  }

  trigger(event: string, args?: any[]): this {
    // Call regular listeners
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          // jQuery trigger passes event object as first arg, then spread args
          handler({}, ...(args || []));
        } catch (e) {
          console.error('[jQuery stub] Error in event handler:', e);
        }
      });
    }

    // Call one-time listeners and remove them
    const oneTimeHandlers = this.oneTimeListeners.get(event);
    if (oneTimeHandlers) {
      oneTimeHandlers.forEach(handler => {
        try {
          handler({}, ...(args || []));
        } catch (e) {
          console.error('[jQuery stub] Error in one-time handler:', e);
        }
      });
      this.oneTimeListeners.delete(event);
    }

    return this;
  }

  off(event?: string, handler?: (...args: any[]) => void): this {
    if (!event) {
      this.listeners.clear();
      this.oneTimeListeners.clear();
    } else if (!handler) {
      this.listeners.delete(event);
      this.oneTimeListeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(handler);
      this.oneTimeListeners.get(event)?.delete(handler);
    }
    return this;
  }
}

// Shared emitters for document and window
const documentEmitter = new EventEmitter();
const windowEmitter = new EventEmitter();

/**
 * jQuery-like wrapper that returns an object with event methods.
 * In service workers, document/window don't exist, so we use string matching.
 */
function jQueryStub(selector: any): EventEmitter {
  // Check if selector looks like document (could be the actual document object or a string)
  if (selector && (
    (typeof selector === 'object' && selector.nodeType === 9) || // Document node
    selector === 'document' ||
    (typeof globalThis !== 'undefined' && selector === (globalThis as any).document)
  )) {
    return documentEmitter;
  }
  // Check if selector looks like window
  if (selector && (
    (typeof selector === 'object' && selector === selector.window) || // Window object
    selector === 'window' ||
    selector === globalThis ||
    (typeof globalThis !== 'undefined' && selector === (globalThis as any).window)
  )) {
    return windowEmitter;
  }
  // For any other selector, return the document emitter (most common use case)
  // This handles cases where the MWC code passes document but it's undefined in SW
  return documentEmitter;
}

// Make it look like jQuery
(jQueryStub as any).fn = {};
(jQueryStub as any).extend = function() { return {}; };

// Export as $ for global use
export const $ = jQueryStub;
export default jQueryStub;
