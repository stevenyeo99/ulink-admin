import { request } from './client';
import type { GetRunResponse, ListRunsResponse, PipelineRun, RunPipelineResponse } from '../types/pipeline';

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
