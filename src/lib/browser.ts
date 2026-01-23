/**
 * Browser API abstraction layer.
 *
 * Provides a unified interface for Chrome, Firefox, and Safari extensions.
 * Firefox uses `browser.*` with Promises, Chrome uses `chrome.*` with callbacks.
 * This wrapper normalizes the API to always use Promises.
 */

// Type declarations for browser globals
declare const globalThis: typeof global & {
  browser?: typeof chrome;
  chrome?: typeof chrome;
};

// Detect browser environment
const isFirefox = typeof globalThis.browser !== 'undefined';
const browserAPI = (isFirefox ? globalThis.browser : globalThis.chrome) as typeof chrome;

/**
 * Storage API wrapper.
 */
export const storage = {
  local: {
    async get<T = Record<string, unknown>>(keys: string | string[]): Promise<T> {
      if (isFirefox) {
        return browserAPI.storage.local.get(keys) as Promise<T>;
      }
      return new Promise((resolve) => {
        browserAPI.storage.local.get(keys, (result) => resolve(result as T));
      });
    },

    async set(items: Record<string, unknown>): Promise<void> {
      if (isFirefox) {
        return browserAPI.storage.local.set(items);
      }
      return new Promise((resolve) => {
        browserAPI.storage.local.set(items, () => resolve());
      });
    },

    async remove(keys: string | string[]): Promise<void> {
      if (isFirefox) {
        return browserAPI.storage.local.remove(keys);
      }
      return new Promise((resolve) => {
        browserAPI.storage.local.remove(keys, () => resolve());
      });
    },

    async clear(): Promise<void> {
      if (isFirefox) {
        return browserAPI.storage.local.clear();
      }
      return new Promise((resolve) => {
        browserAPI.storage.local.clear(() => resolve());
      });
    },
  },

  /**
   * Session storage - persists across service worker restarts but clears on browser close.
   * Useful for keeping unlock state without storing sensitive data permanently.
   * Note: Firefox doesn't support storage.session, falls back to local storage.
   */
  session: {
    async get<T = Record<string, unknown>>(keys: string | string[]): Promise<T> {
      // Firefox doesn't have storage.session, fall back to in-memory behavior
      if (isFirefox || !browserAPI.storage.session) {
        return {} as T;
      }
      return new Promise((resolve) => {
        browserAPI.storage.session.get(keys, (result) => resolve(result as T));
      });
    },

    async set(items: Record<string, unknown>): Promise<void> {
      if (isFirefox || !browserAPI.storage.session) {
        return;
      }
      return new Promise((resolve) => {
        browserAPI.storage.session.set(items, () => resolve());
      });
    },

    async remove(keys: string | string[]): Promise<void> {
      if (isFirefox || !browserAPI.storage.session) {
        return;
      }
      return new Promise((resolve) => {
        browserAPI.storage.session.remove(keys, () => resolve());
      });
    },

    async clear(): Promise<void> {
      if (isFirefox || !browserAPI.storage.session) {
        return;
      }
      return new Promise((resolve) => {
        browserAPI.storage.session.clear(() => resolve());
      });
    },
  },
};

/**
 * Runtime API wrapper.
 */
export const runtime = {
  sendMessage<T = unknown>(message: unknown): Promise<T> {
    if (isFirefox) {
      return browserAPI.runtime.sendMessage(message) as Promise<T>;
    }
    return new Promise((resolve) => {
      browserAPI.runtime.sendMessage(message, (response: T) => resolve(response));
    });
  },

  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void {
      browserAPI.runtime.onMessage.addListener(callback);
    },

    removeListener(
      callback: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void {
      browserAPI.runtime.onMessage.removeListener(callback);
    },
  },

  onInstalled: {
    addListener(
      callback: (details: chrome.runtime.InstalledDetails) => void
    ): void {
      browserAPI.runtime.onInstalled.addListener(callback);
    },
  },

  getURL(path: string): string {
    return browserAPI.runtime.getURL(path);
  },

  get id(): string | undefined {
    return browserAPI.runtime.id;
  },
};

/**
 * Notifications API wrapper.
 */
export const notifications = {
  create(
    notificationId: string | undefined,
    options: chrome.notifications.NotificationOptions<true>
  ): Promise<string> {
    return new Promise((resolve) => {
      if (notificationId) {
        browserAPI.notifications.create(notificationId, options, (id) => resolve(id));
      } else {
        browserAPI.notifications.create(options, (id) => resolve(id));
      }
    });
  },

  clear(notificationId: string): Promise<boolean> {
    return new Promise((resolve) => {
      browserAPI.notifications.clear(notificationId, (wasCleared) =>
        resolve(wasCleared)
      );
    });
  },
};

/**
 * Alarms API wrapper.
 * Used for persistent timers that survive service worker restarts.
 */
export const alarms = {
  async create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void> {
    if (isFirefox) {
      return browserAPI.alarms.create(name, alarmInfo);
    }
    return new Promise((resolve) => {
      browserAPI.alarms.create(name, alarmInfo);
      resolve();
    });
  },

  async clear(name: string): Promise<boolean> {
    if (isFirefox) {
      return browserAPI.alarms.clear(name);
    }
    return new Promise((resolve) => {
      browserAPI.alarms.clear(name, (wasCleared: boolean) => resolve(wasCleared));
    });
  },

  async get(name: string): Promise<chrome.alarms.Alarm | undefined> {
    if (isFirefox) {
      return browserAPI.alarms.get(name);
    }
    return new Promise((resolve) => {
      browserAPI.alarms.get(name, (alarm: chrome.alarms.Alarm | undefined) => resolve(alarm));
    });
  },

  onAlarm: {
    addListener(callback: (alarm: chrome.alarms.Alarm) => void): void {
      browserAPI.alarms.onAlarm.addListener(callback);
    },
  },
};

/**
 * Tabs API wrapper.
 */
export const tabs = {
  async query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    if (isFirefox) {
      return browserAPI.tabs.query(queryInfo);
    }
    return new Promise((resolve) => {
      browserAPI.tabs.query(queryInfo, (tabs: chrome.tabs.Tab[]) => resolve(tabs));
    });
  },

  async sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
    if (isFirefox) {
      return browserAPI.tabs.sendMessage(tabId, message) as Promise<T>;
    }
    return new Promise((resolve) => {
      browserAPI.tabs.sendMessage(tabId, message, (response: T) => resolve(response));
    });
  },

  async create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    if (isFirefox) {
      return browserAPI.tabs.create(createProperties);
    }
    return new Promise((resolve) => {
      browserAPI.tabs.create(createProperties, (tab: chrome.tabs.Tab) => resolve(tab));
    });
  },
};

/**
 * Windows API wrapper.
 * Used for creating pop-out windows.
 */
export const windows = {
  async create(createData: chrome.windows.CreateData): Promise<chrome.windows.Window | undefined> {
    if (isFirefox) {
      return browserAPI.windows.create(createData);
    }
    return new Promise((resolve) => {
      browserAPI.windows.create(createData, (window) => resolve(window));
    });
  },

  async getCurrent(): Promise<chrome.windows.Window> {
    if (isFirefox) {
      return browserAPI.windows.getCurrent();
    }
    return new Promise((resolve) => {
      browserAPI.windows.getCurrent((window) => resolve(window));
    });
  },

  async remove(windowId: number): Promise<void> {
    if (isFirefox) {
      return browserAPI.windows.remove(windowId);
    }
    return new Promise((resolve) => {
      browserAPI.windows.remove(windowId, () => resolve());
    });
  },
};

// Re-export for convenience
export { browserAPI, isFirefox };
