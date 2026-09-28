import { getSession, goToLogin } from '../lib/session';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3088';

// ulink-api applies express-rate-limit globally to every route (app.js), a shared budget
// across every client hitting the same API — this console's own polling, cron-triggered job
// calls, anyone else. usePipelineRun.ts checks for this specifically (via `instanceof`) to
// back off using the server's own Retry-After instead of continuing to poll at its normal
// cadence and just digging the hole deeper. Shared here so casesApi.ts gets the same
// handling without duplicating it.
export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super('Rate limited by the API — backing off');
  }
}

export interface ApiErrorBody {
  error?: { message?: string; status?: number };
}

/** fetch() against the API with the logged-in user's token; an expired or missing login goes back to the login page. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getSession()?.token;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (response.status === 401 && !path.startsWith('/api/auth/login')) goToLogin();
  return response;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get('Retry-After'));
    throw new RateLimitedError((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30) * 1000);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message || `${init?.method ?? 'GET'} ${path} failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}
