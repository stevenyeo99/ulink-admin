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
  createdAt: string;
  updatedAt: string;
  summary: string | null;
}

// GET /api/cases query — every field optional; the console's filters and dashboard links.
export interface CaseListQuery {
  source?: Source;
  status?: string;
  group?: string;
  module?: string;
  q?: string;
  sort?: 'updatedAt' | 'createdAt' | 'claimNo' | 'status';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// GET /api/cases/overview
export interface CaseOverview {
  total: number;
  newToday: number;
  groups: Record<string, number>;
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
  /** Every failed check, first = reasonCode (cases checked from 2026-09-29). */
  issues?: { reasonCode: string; reason: string }[];
  // Empty ({}) when IAS found no member (MEMBER_NOT_FOUND) — no comparison was made.
  checks?: { hard?: MemberVerifyHardChecks; soft?: Record<string, { extracted: unknown; ias: unknown }> };
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

// One API job run for the case (ulink_api_case_steps): what it received and produced.
export interface ApiCaseStep {
  id: string;
  job: string;
  status: 'DONE' | 'WAITING' | 'FAILED';
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// Explanation trail built by the API (modules/assessment-summary/summary.js): what was decided on this
// case, why, how sure, how it was verified, and where a person should look.
export interface AssessmentReview {
  reason: string;
  mightBeWrong: string[];
  check: string;
}

/** A reviewer already overrode the check this came from (ulink-api modules/case-override). */
export interface AssessmentOverride {
  at: string | null;
  /** "Overridden by <name> (<username>) — <why the check was wrong>: <reason>" */
  note: string;
}

export interface AssessmentLine {
  decision: string;
  overridden?: AssessmentOverride;
  result: string;
  status: 'ok' | 'issue' | 'not_checked';
  why: string;
  confidence: string | null;
  /** How it was verified: 'Rule', 'Cross-checked', 'AI self-rated' — plus ', AI translated' when Burmese text was translated first. */
  verified: string;
  review: AssessmentReview | null;
}

/** One stage of "why the case went this way" (ulink-api modules/assessment-summary/journey.js). */
export interface JourneyStep {
  stage: string;
  result: string;
  why: string | null;
}

export interface AssessmentSummary {
  /** The case's path so far, one step per stage, with the reason; the last step is where it is now. */
  journey?: JourneyStep[];
  lines: AssessmentLine[];
  reviewPoints: (AssessmentReview & { decision: string; overridden?: AssessmentOverride })[];
  needsReview: boolean;
}

// Whether a reviewer can override this case's check (ulink-api modules/case-override/override.js).
// allowed false + reason null: not an overridable status (nothing to show).
export interface CaseOverrideInfo {
  allowed: boolean;
  target?: string;
  reason?: string | null;
  /** Finding id → label: "why the check was wrong". */
  findings: Record<string, string>;
}

export interface GetCaseResponse {
  case: CaseDetail;
  events: CaseEvent[];
  documents: CaseDocument[];
  override: CaseOverrideInfo;
  assessmentSummary: AssessmentSummary;
  /** API cases only. Their CaseDetail fields (extractedFields, …) are filled from these by the API. */
  apiSteps?: ApiCaseStep[];
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

// Case status catalog (GET /api/cases/statuses — ulink-api modules/case-status/catalog.js). Codes stay
// internal; the console shows label / description and groups by module / group.
export type StatusGroup = 'in_progress' | 'waiting_customer' | 'needs_review' | 'done' | 'failed';

export interface CaseStatusInfo {
  module: string;
  group: StatusGroup;
  label: string;
  description: string;
}

export interface CaseStatusCatalog {
  statuses: Record<string, CaseStatusInfo>;
  modules: { id: string; label: string }[];
  groups: { id: StatusGroup; label: string }[];
}

// GET /api/cases/review-queue — cases a person should look at (ulink-api modules/review-queue/queue.js).
export interface ReviewQueueItem {
  id: string;
  source: Source;
  currentStatus: string;
  claimNo: string | null;
  tpaCaseNumber: string | null;
  recognizedType: string | null;
  createdAt: string;
  updatedAt: string;
  /** Most serious reason, e.g. "Data mismatch". */
  reason: string;
  /** What to check first. */
  check: string;
  reasons: string[];
  pointCount: number;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  counts: Record<string, number>;
  total: number;
}

// GET /api/cases/approvals — non-STP claims waiting for JD3 to approve in IAS.
export interface ApprovalItem {
  id: string;
  source: Source;
  currentStatus: string;
  claimNo: string | null;
  tpaCaseNumber: string | null;
  recognizedType: string | null;
  createdAt: string;
  updatedAt: string;
  /** "Decision: what to check" — the AI's review points for this claim. */
  reviewPoints: string[];
}

export interface ApprovalsResponse {
  items: ApprovalItem[];
  total: number;
}
