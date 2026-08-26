import { API_BASE_URL, request } from './client';
import type { GetCaseResponse, ListCasesResponse, OverrideCaseResponse, ResetCaseResponse } from '../types/case';

export function listCases(status?: string): Promise<ListCasesResponse> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<ListCasesResponse>(`/api/cases${query}`);
}

export function getCase(id: string): Promise<GetCaseResponse> {
  return request<GetCaseResponse>(`/api/cases/${id}`);
}

export function overrideCase(id: string, reason: string, operatorName: string): Promise<OverrideCaseResponse> {
  return request<OverrideCaseResponse>(`/api/cases/${id}/override`, {
    method: 'POST',
    body: JSON.stringify({ reason, operatorName }),
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
export function getAttachmentUrl(caseId: string, attachmentId: string): string {
  return `${API_BASE_URL}/api/cases/${caseId}/attachments/${attachmentId}`;
}
