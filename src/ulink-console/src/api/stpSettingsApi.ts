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

export interface StpSettings {
  rules: StpRule[];
  blockedDiagnoses: StpBlockedDiagnosis[];
  switches: Switches;
}

// What the one Save sends: the rules, the complete never-STP list, the switches (saved all or nothing).
export interface StpSettingsForm {
  rules: { id: string; stpAllowed: boolean; amountLimit: number | null }[];
  blockedDiagnoses: { codePrefix: string; note: string | null }[];
  switches: Switches;
}

export function getStpSettings(): Promise<StpSettings> {
  return request('/api/stp-settings');
}

export function saveStpSettings(form: StpSettingsForm): Promise<StpSettings> {
  return request('/api/stp-settings', { method: 'PUT', body: JSON.stringify(form) });
}
