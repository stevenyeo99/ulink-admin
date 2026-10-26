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
}

export function getAiChecklist(): Promise<{ sections: AiCheckSection[]; checks: AiCheck[] }> {
  return request<{ sections: AiCheckSection[]; checks: AiCheck[] }>('/api/ai-checklist');
}
