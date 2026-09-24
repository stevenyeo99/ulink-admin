// Mirrors ulink-api/src/controllers/cases/casesController.js's response shapes and
// db/models/case.js / caseEvent.js / emailThread.js / emailMessage.js / emailAttachment.js.

import type { Source } from './pipeline';

export interface CaseSummary {
  id: string;
  currentStatus: string;
  source: Source;
  claimNo: string | null;
  tpaCaseNumber: string | null;
  recognizedType: string | null;
  updatedAt: string;
  summary: string | null;
}

export interface ListCasesResponse {
  cases: CaseSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChecklistItem {
  code?: string;
  label: string;
  passed: boolean | null;
  confidence?: number | null;
  note?: string | null;
}

export interface DocumentCheckDetail {
  issue: string;
  code: string | null;
  reason: string | null;
}

export interface DocumentCheckResult {
  issues: string[];
  passed: boolean;
  details?: DocumentCheckDetail[];
  checklist?: ChecklistItem[];
}

export interface MemberVerifyHardChecks {
  coverageActive: boolean | null;
  dobMatch: boolean | null;
  bankNameMatch: boolean | null;
  bankAccountNameMatch: boolean | null;
  bankAccountNumberMatch: boolean | null;
  policyNoMatch: boolean | null;
}

export interface MemberVerifyResult {
  reasonCode?: string | null;
  reason?: string | null;
  checks?: { hard: MemberVerifyHardChecks; soft: Record<string, { extracted: unknown; ias: unknown }> };
  [key: string]: unknown;
}

export interface ClaimPickMeta {
  pick: Record<string, unknown> | null;
  confidence: number | null;
  candidates: unknown[];
  // Present on diagnosis only (diagnosisPicker.js) — true when `pick` is a fallback
  // (e.g. the R69 "unspecified" ICD-10 code) rather than a real confident AI pick.
  // benefitPicker.js's per-line picks have no fallback and never set this.
  defaulted?: boolean;
}

export interface ClaimPrepMeta {
  diagnosis: ClaimPickMeta & { text: string | null };
  lines: (ClaimPickMeta & { voucherType: string | null; subtotal: number | null })[];
}

export interface EmailAttachment {
  id: string;
  messageId: string;
  storageRef: string;
  originalFilename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sourceUrl: string | null;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  fromAddr: string | null;
  toAddr: string | null;
  ccAddr: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  EmailAttachments: EmailAttachment[];
}

export interface EmailThread {
  id: string;
  caseId: string;
  subjectHint: string | null;
  EmailMessages: EmailMessage[];
}

export interface CaseDetail {
  id: string;
  currentStatus: string;
  recognizedType: string | null;
  extractedFields: unknown;
  documentCheckResult: DocumentCheckResult | null;
  memberVerifyResult: MemberVerifyResult | null;
  iasMemberInfoResponse: unknown;
  iasClaimPayload: unknown;
  claimPrepMeta: ClaimPrepMeta | null;
  iasClaimResult: unknown;
  claimNo: string | null;
  source: Source;
  tpaCaseNumber: string | null;
  createdAt: string;
  updatedAt: string;
  EmailThreads: EmailThread[];
}

export interface CaseEvent {
  id: string;
  caseId: string;
  blockName: string;
  prevStatus: string | null;
  newStatus: string;
  reasonCode: string | null;
  message: string | null;
  createdAt: string;
}

// A case-level document (ulink_case_documents) — an API case's console image.
export interface CaseDocument {
  id: string;
  caseId: string;
  origin: 'CONSOLE';
  barcodeId: string;
  scanId: string | null;
  originalFilename: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface GetCaseResponse {
  case: CaseDetail;
  events: CaseEvent[];
  documents: CaseDocument[];
}

export interface OverrideCaseResponse {
  caseId: string;
  previousStatus: string;
  currentStatus: string;
}

export interface ResetCaseResponse {
  caseId: string;
  previousStatus: string;
  currentStatus: string;
  clearedFields: string[];
}
