import { request } from './client';
import type { ApprovalsResponse, CaseClaim, Correction, WrongStep, CaseListQuery, CaseOverview, ReviewQueueResponse, CaseStatusCatalog, GetCaseResponse, ListCasesResponse, LlmCall, OverrideCaseResponse, ResetCaseResponse } from '../types/case';
import type { Source } from '../types/pipeline';

export function listCases(query: CaseListQuery = {}): Promise<ListCasesResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return request<ListCasesResponse>(`/api/cases${qs ? `?${qs}` : ''}`);
}

export function getReviewQueue(source?: Source): Promise<ReviewQueueResponse> {
  return request<ReviewQueueResponse>(`/api/cases/review-queue${source ? `?source=${source}` : ''}`);
}

export function getApprovals(source?: Source): Promise<ApprovalsResponse> {
  return request<ApprovalsResponse>(`/api/cases/approvals${source ? `?source=${source}` : ''}`);
}

export function getCaseOverview(source?: Source): Promise<CaseOverview> {
  return request<CaseOverview>(`/api/cases/overview${source ? `?source=${source}` : ''}`);
}

export function getCaseStatuses(): Promise<CaseStatusCatalog> {
  return request<CaseStatusCatalog>('/api/cases/statuses');
}

export function getCase(id: string): Promise<GetCaseResponse> {
  return request<GetCaseResponse>(`/api/cases/${id}`);
}

// The AI calls made for one case (casesController.js::getLlmCalls, SYSTEM_4 E4-26).
export function getLlmCalls(id: string): Promise<{ calls: LlmCall[] }> {
  return request<{ calls: LlmCall[] }>(`/api/cases/${id}/llm-calls`);
}

// finding: why the check was wrong (an id from the case's override.findings). Who overrode is the
// logged-in user (the API reads it from the token).
export function overrideCase(id: string, reason: string, finding: string): Promise<OverrideCaseResponse> {
  return request<OverrideCaseResponse>(`/api/cases/${id}/override`, {
    method: 'POST',
    body: JSON.stringify({ reason, finding }),
  });
}

// Correct one value the AI read or one check's verdict (correctionsController.js, SYSTEM_4 E4-12); the case is checked
// again from the member check. value: kind=value; passed: kind=verdict.
export function createCorrection(
  id: string,
  correction: { kind: 'value' | 'verdict'; item: string; value?: string; passed?: boolean; reason: string; wrongStep: WrongStep }
): Promise<{ caseId: string; currentStatus: string }> {
  return request(`/api/cases/${id}/corrections`, { method: 'POST', body: JSON.stringify(correction) });
}

// "✓ Right" (review workspace, SYSTEM_4 E5b): the AI's value or verdict was checked and is right — learning data only.
export function confirmFinding(id: string, kind: 'value' | 'verdict', item: string): Promise<{ confirmation: Correction }> {
  return request(`/api/cases/${id}/confirmations`, { method: 'POST', body: JSON.stringify({ kind, item }) });
}

// A second person agrees with a correction, so it may teach the AI later (super admin, not the one who made it).
export function trustCorrection(id: string, feedbackId: string): Promise<{ correction: Correction }> {
  return request(`/api/cases/${id}/corrections/${feedbackId}/trust`, { method: 'POST' });
}

// The case to review next (review workspace, SYSTEM_4 E4-20): the next in queue order after `after`, not held by
// someone else; both sources unless one is given.
export function getNextCase(after: string, source?: Source): Promise<{ id: string | null }> {
  return request(`/api/cases/next?${new URLSearchParams({ after, ...(source ? { source } : {}) })}`);
}

// "Being reviewed by me" (claimController.js, SYSTEM_4 E4-22). takeOver + comment: from someone else.
export function claimCase(id: string, takeOver = false, comment = ''): Promise<{ claim: CaseClaim }> {
  return request(`/api/cases/${id}/claim`, { method: 'POST', body: JSON.stringify({ takeOver, comment }) });
}

export function releaseCase(id: string): Promise<{ released: boolean }> {
  return request(`/api/cases/${id}/release`, { method: 'POST' });
}

// Always rewinds to READY_FOR_DOCUMENT_READING (the only target the console exposes) — see
// A case held by the switch "hold the missing-documents email when the AI is unsure": a person checked
// and the documents really are missing — send the customer the request (casesController.js::releaseMissingDocuments).
// Upload the documents the customer sent to the IAS console (casesController.js::uploadCaseDocuments, SYSTEM_4 E4-04).
// files: base64 data; comment: required, kept in the case history.
export function uploadCaseDocuments(
  id: string,
  comment: string,
  files: { filename: string; contentType: string; data: string }[]
): Promise<{ caseId: string; currentStatus: string; files: string[] }> {
  return request(`/api/cases/${id}/documents`, { method: 'POST', body: JSON.stringify({ comment, files }) });
}

// comment: what the person checked — required, kept in the case history (SYSTEM_4 E4-11).
export function releaseMissingDocuments(id: string, comment: string): Promise<{ caseId: string; currentStatus: string }> {
  return request(`/api/cases/${id}/release-missing-documents`, { method: 'POST', body: JSON.stringify({ comment }) });
}

// casesController.js::resetCase. Fails with 409 if the case already has a real IAS claimNo.
// comment: why — required, kept in the case history (SYSTEM_4 E4-11).
export function resetCase(id: string, comment: string): Promise<ResetCaseResponse> {
  return request<ResetCaseResponse>(`/api/cases/${id}/reset`, { method: 'POST', body: JSON.stringify({ comment }) });
}

// Not a fetch wrapper — the browser handles the actual GET itself (opened via
// <a target="_blank">), so it can render the PDF/image with its own native viewer instead of
// this app building one.
// API paths of a case's files — opened with the login token by components/common/FileLink.tsx.
export function attachmentPath(caseId: string, attachmentId: string): string {
  return `/api/cases/${caseId}/attachments/${attachmentId}`;
}

export function documentPath(caseId: string, documentId: string): string {
  return `/api/cases/${caseId}/documents/${documentId}`;
}
