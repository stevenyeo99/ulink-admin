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

// Every correction, "✓ Right" and override of the AI (ulink-api modules/ai-feedback/report.js, SYSTEM_4 F2).
export interface FeedbackRow {
  at: string;
  caseId: string;
  claimNo: string | null;
  tpaCaseNumber: string | null;
  source: string | null;
  type: 'Correction' | 'Confirmed right' | 'Override' | 'Member finding accepted (not AI)' | 'Accepted as an exception (not AI)';
  item: string;
  aiFinding: string;
  aiConfidence: number | null;
  decision: string;
  comment: string;
  by: string;
  /** A correction a second super admin agreed with; null for confirmations and overrides. */
  trusted: boolean | null;
}

// from / to: ISO times (from included, to excluded); null = no limit. truncated: the oldest rows were cut (row limit).
export interface FeedbackReport {
  rows: FeedbackRow[];
  truncated: boolean;
}

export function getFeedbackReport(from: string | null, to: string | null): Promise<FeedbackReport> {
  const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  return request<FeedbackReport>(`/api/llm-calls/feedback-report${query ? `?${query}` : ''}`);
}
