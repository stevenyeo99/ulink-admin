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

// Settings changed on this page (ulink-api modules/settings/settings.js DEFAULTS).
export interface Switches {
  // Human-in-the-loop switches — both off until Ulink decides.
  stpBlockOnReviewPoints: boolean;
  holdUnsureMissingDocsEmail: boolean;
  // Passed, but the AI unsure: a person confirms first (SYSTEM_4 E4-09).
  holdUnsureDocumentPass: boolean;
  // Which cases the system works on (SYSTEM_4 E4-01); a source switched off has no pipeline runs and no tab.
  emailCasesEnabled: boolean;
  apiCasesEnabled: boolean;
  // Read the mailbox (IMAP); off: the inbox step is skipped (SYSTEM_4 E4-02).
  mailboxEnabled: boolean;
  // API cases: the customer's missing-documents email (SYSTEM_4 E4-03).
  apiSendMissingDocumentsEmail: boolean;
  // At or below this (0–1) the AI counts as unsure (SYSTEM_4 E4-07).
  aiConfidenceThreshold: number;
}

export type SwitchKey = { [K in keyof Switches]: Switches[K] extends boolean ? K : never }[keyof Switches];

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
