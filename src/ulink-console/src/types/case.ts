// Mirrors ulink-api/src/controllers/cases/casesController.js's response shapes and
// db/models/case.js / caseEvent.js / emailThread.js / emailMessage.js / emailAttachment.js.

export interface CaseSummary {
  id: string;
  currentStatus: string;
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
  claimPrepMeta: unknown;
  iasClaimResult: unknown;
  claimNo: string | null;
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

export interface GetCaseResponse {
  case: CaseDetail;
  events: CaseEvent[];
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
