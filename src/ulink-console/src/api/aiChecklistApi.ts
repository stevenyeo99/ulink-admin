import { request } from './client';

// Every member and document check the system runs (ulink-api modules/ai-checklist/catalog.js, SYSTEM_5 phase A).
export interface AiCheckSection {
  key: string;
  /** The step it belongs to: the member check, then the document check. */
  group: 'member' | 'document';
  title: string;
  intro: string;
}

export interface AiCheck {
  code: string;
  /** The member finding it raises, when that differs from the code (the policy contract exclusion). */
  item?: string;
  /** The paper it looks at (AiCheckSection.key), in the order the system runs. */
  section: string;
  group: 'member' | 'document';
  /** The check as a plain question. */
  question: string;
  /** The line's name on the case page. */
  label: string;
  /** What the check does, in plain words. */
  does: string;
  /** stops: stops the case; warning: shown, never stops the case; info: shown only; off: not run. */
  effect: 'stops' | 'warning' | 'info' | 'off';
  /** May never be switched off (phase B). */
  locked: boolean;
  /** What happens when it fails (null when off). A document check quotes the customer's sentence. */
  ifFails: string | null;
  /** What a person can do about it on a case (from the correction panel's rules). */
  reviewerCan: string[];
  /** The risk of marking it OK (SYSTEM_5 review actions); null for an information line or a check that is off. */
  riskIfOk: string | null;
  /** Its switch (phase B): on unless a super admin switched it off. */
  enabled: boolean;
  /** Can be switched: not locked, not an information line, not off in the code. */
  switchable: boolean;
  lastChange: { enabled: boolean; reason: string; by: string; at: string } | null;
}

// Switch a check off or on, with a reason (SYSTEM_5 phase B). Applies to cases checked from now on.
export function setCheckSwitch(code: string, enabled: boolean, reason: string): Promise<{ code: string; enabled: boolean }> {
  return request(`/api/ai-checklist/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ enabled, reason }) });
}

export function getAiChecklist(): Promise<{ sections: AiCheckSection[]; checks: AiCheck[] }> {
  return request<{ sections: AiCheckSection[]; checks: AiCheck[] }>('/api/ai-checklist');
}
