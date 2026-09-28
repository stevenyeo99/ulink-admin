import { request } from './client';
import type { ApprovalsResponse, CaseListQuery, CaseOverview, ReviewQueueResponse, CaseStatusCatalog, GetCaseResponse, ListCasesResponse, OverrideCaseResponse, ResetCaseResponse } from '../types/case';
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

// finding: why the check was wrong (an id from the case's override.findings). Who overrode is the
// logged-in user (the API reads it from the token).
export function overrideCase(id: string, reason: string, finding: string): Promise<OverrideCaseResponse> {
  return request<OverrideCaseResponse>(`/api/cases/${id}/override`, {
    method: 'POST',
    body: JSON.stringify({ reason, finding }),
  });
}

// Always rewinds to READY_FOR_DOCUMENT_READING (the only target the console exposes) — see
// casesController.js::resetCase. Fails with 409 if the case already has a real IAS claimNo.
export function resetCase(id: string): Promise<ResetCaseResponse> {
  return request<ResetCaseResponse>(`/api/cases/${id}/reset`, { method: 'POST' });
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
