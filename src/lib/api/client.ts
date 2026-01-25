/**
 * Base API client with request handling.
 */

// Vite environment variable type
declare const import_meta_env: { VITE_API_BASE?: string };

// API base URL - set via environment or default to production server
const API_BASE = (import.meta as unknown as { env: typeof import_meta_env }).env.VITE_API_BASE || 'http://45.84.59.17:8080/api/v1';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Base API client class with authentication support.
 */
export class ApiClient {
  private accessToken: string | null = null;

  constructor(protected baseUrl: string = API_BASE) {}

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  protected async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';

    // Debug logging for Grin endpoints
    if (endpoint.includes('/grin/')) {
      console.log(`[API] ${method} ${url}`, {
        hasAuth: !!this.accessToken,
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
