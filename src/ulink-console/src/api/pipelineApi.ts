import type { GetRunResponse, ListRunsResponse, PipelineRun, RunPipelineResponse } from '../types/pipeline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3088';

// ulink-api applies express-rate-limit globally to every route (app.js), a shared budget
// across this console's own polling, cron-triggered job calls, and anyone else hitting the
// same API. usePipelineRun.ts checks for this specifically (via `instanceof`) to back off
// using the server's own Retry-After instead of continuing to poll at its normal cadence
// and just digging the hole deeper.
export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super('Rate limited by the API — backing off');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get('Retry-After'));
    throw new RateLimitedError((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30) * 1000);
  }

  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export function runPipeline(): Promise<RunPipelineResponse> {
  return request<RunPipelineResponse>('/api/jobs/pipeline/run', { method: 'POST' });
}

export async function getRun(id: string): Promise<PipelineRun> {
  const { run } = await request<GetRunResponse>(`/api/jobs/pipeline/runs/${id}`);
  return run;
}

export async function getLatestRun(): Promise<PipelineRun | null> {
  const { runs } = await request<ListRunsResponse>('/api/jobs/pipeline/runs?limit=1');
  return runs[0] ?? null;
}
