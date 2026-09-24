import { request } from './client';
import type { GetRunResponse, ListRunsResponse, PipelineRun, RunPipelineResponse, Source } from '../types/pipeline';

// Each workflow has its own orchestrator endpoints; runs never cross between them.
const BASE: Record<Source, string> = { EMAIL: '/api/jobs/pipeline', API: '/api/jobs/api-pipeline' };

// `steps` runs only those steps (debugging one job); omitted, the whole pipeline runs.
export function runPipeline(source: Source, steps?: string[]): Promise<RunPipelineResponse> {
  return request<RunPipelineResponse>(`${BASE[source]}/run`, {
    method: 'POST',
    ...(steps ? { body: JSON.stringify({ steps }) } : {}),
  });
}

export async function getRun(source: Source, id: string): Promise<PipelineRun> {
  const { run } = await request<GetRunResponse>(`${BASE[source]}/runs/${id}`);
  return run;
}

export async function getLatestRun(source: Source): Promise<PipelineRun | null> {
  const { runs } = await request<ListRunsResponse>(`${BASE[source]}/runs?limit=1`);
  return runs[0] ?? null;
}
