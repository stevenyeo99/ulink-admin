import { request } from './client';

// How each prompt version performs (ulink-api modules/llm-calls/summary.js, SYSTEM_4 D2).
export interface PromptVersionSummary {
  promptName: string | null;
  promptVersion: string | null;
  /** The version in the prompt file on the server now. */
  current: boolean;
  firstCall: string | null;
  lastCall: string | null;
  calls: number;
  byStatus: { ok: number; error: number; timeout: number; too_long: number };
  avgDurationMs: number | null;
  avgPromptTokens: number | null;
  avgCompletionTokens: number | null;
  avgConfidence: number | null;
  /** Share of the calls with a confidence where it was at or below the threshold. */
  unsureShare: number | null;
}

export interface PromptSummary {
  threshold: number;
  prompts: PromptVersionSummary[];
}

// days: the last N days; null = all time.
export function getPromptSummary(days: number | null): Promise<PromptSummary> {
  return request<PromptSummary>(`/api/llm-calls/summary${days ? `?days=${days}` : ''}`);
}
