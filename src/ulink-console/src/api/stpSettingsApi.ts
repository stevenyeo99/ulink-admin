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

export function getStpSettings(): Promise<{ rules: StpRule[]; blockedDiagnoses: StpBlockedDiagnosis[] }> {
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
