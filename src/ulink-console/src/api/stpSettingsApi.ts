import { request } from './client';
import type { Source } from '../types/pipeline';

export interface StpRule {
  id: string;
  caseSource: Source;
  benefitType: string;
  currency: string;
  stpAllowed: boolean;
  amountLimit: number | null;
}

export interface StpBlockedDiagnosis {
  id: string;
  codePrefix: string;
  note: string | null;
}

// Human-in-the-loop switches (ulink-api modules/settings/settings.js) — both off until Ulink decides.
export interface Switches {
  stpBlockOnReviewPoints: boolean;
  holdUnsureMissingDocsEmail: boolean;
}

export function updateSwitches(changes: Partial<Switches>): Promise<{ switches: Switches }> {
  return request('/api/stp-settings/switches', { method: 'PUT', body: JSON.stringify(changes) });
}

export function getStpSettings(): Promise<{ rules: StpRule[]; blockedDiagnoses: StpBlockedDiagnosis[]; switches: Switches }> {
  return request('/api/stp-settings');
}

export function updateStpRule(id: string, body: { stpAllowed: boolean; amountLimit: number | null }): Promise<{ rule: StpRule }> {
  return request(`/api/stp-settings/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function addBlockedDiagnosis(codePrefix: string, note: string): Promise<{ blockedDiagnosis: StpBlockedDiagnosis }> {
  return request('/api/stp-settings/blocked-diagnoses', { method: 'POST', body: JSON.stringify({ codePrefix, note }) });
}

export function removeBlockedDiagnosis(id: string): Promise<{ removed: boolean }> {
  return request(`/api/stp-settings/blocked-diagnoses/${id}`, { method: 'DELETE' });
}
