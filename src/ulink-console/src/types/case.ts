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

export interface DocumentCheckResult {
  issues: string[];
  passed: boolean;
}

export interface MemberVerifyResult {
  reasonCode?: string | null;
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
