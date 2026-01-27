/**
 * Base API client with request handling.
 */

// Vite environment variable type
declare const import_meta_env: { VITE_API_BASE?: string };

// API base URL - set via environment or default to production server
const API_BASE = (import.meta as unknown as { env: typeof import_meta_env }).env.VITE_API_BASE || 'http://45.84.59.17:8080/api/v1';

// Use globalThis to store the access token so it's shared across all module instances
// This is needed because Vite's chunking can create multiple copies of the api module
const GLOBAL_TOKEN_KEY = '__smirk_api_token__';

function getGlobalToken(): string | null {
  return (globalThis as Record<string, unknown>)[GLOBAL_TOKEN_KEY] as string | null ?? null;
}

function setGlobalToken(token: string | null): void {
  (globalThis as Record<string, unknown>)[GLOBAL_TOKEN_KEY] = token;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Base API client class with authentication support.
 */
export class ApiClient {
  constructor(protected baseUrl: string = API_BASE) {}

  setAccessToken(token: string | null) {
    setGlobalToken(token);
    console.log('[API] Token set:', token ? 'yes' : 'no');
  }

  getAccessToken(): string | null {
    return getGlobalToken();
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const accessToken = getGlobalToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';

    // Debug logging for Grin and social tips endpoints
    if (endpoint.includes('/grin/') || endpoint.includes('/tips/social')) {
      console.log(`[API] ${method} ${url}`, {
        hasAuth: !!accessToken,
        body: options.body ? JSON.parse(options.body as string) : undefined,
      });
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        if (endpoint.includes('/grin/')) {
          console.error(`[API] ${method} ${url} FAILED:`, response.status, error);
        }
        return { error: error.error || `HTTP ${response.status}` };
      }

      const data = await response.json();
      if (endpoint.includes('/grin/')) {
        console.log(`[API] ${method} ${url} OK:`, data);
      }
      return { data };
    } catch (err) {
      if (endpoint.includes('/grin/')) {
        console.error(`[API] ${method} ${url} EXCEPTION:`, err);
      }
      return { error: err instanceof Error ? err.message : 'Network error' };
    }
  }
}
