import { attachmentPath, documentPath } from '../api/casesApi';
import type { ApiCaseStep, CaseDetail, CaseDocument } from '../types/case';

/** One file of the case as the AI read it. name: the label the AI's page references use ("<name> - page N"). */
export interface ViewFile {
  key: string;
  name: string;
  path: string;
  pdf: boolean;
  group: string;
}

export interface PageRef {
  fileKey: string;
  page: number;
}

/**
 * The case's files under the names the AI's reading used (claim-recognition / api-claim-recognition): API console
 * images "<barcode>/<file>", case-page uploads "upload/<file>", API reply attachments "reply-N/<file>" (in the order the reply intake gathered them), email
 * attachments "<file>". So an evidence page "12345/page-002.jpg - page 1" finds its file.
 */
export function caseFiles(caseRecord: CaseDetail, documents: CaseDocument[], apiSteps: ApiCaseStep[] = []): ViewFile[] {
  const attachments = (caseRecord.EmailThreads ?? []).flatMap((t) => t.EmailMessages.flatMap((m) => m.EmailAttachments));
  const isPdf = (type: string | null, name: string) => type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
  if (caseRecord.source !== 'API') {
    return attachments.map((a) => {
      const name = a.originalFilename || 'attachment';
      return { key: a.id, name, path: attachmentPath(caseRecord.id, a.id), pdf: isPdf(a.contentType, name), group: 'Email attachments' };
    });
  }
  const consoleFiles = documents.map((d) => ({
    key: d.id, name: `${d.barcodeId ?? 'upload'}/${d.originalFilename}`, path: documentPath(caseRecord.id, d.id),
    pdf: isPdf(d.contentType, d.originalFilename), group: d.barcodeId ? `Console ${d.barcodeId}` : 'Uploaded on the case page',
  }));
  const reply = [...apiSteps].reverse().find((s) => s.job === 'api-reply-intake' && s.status === 'DONE');
  const replyIds = new Set(((reply?.output as { attachmentIds?: string[] } | null)?.attachmentIds) ?? []);
  // Numbered oldest first — the order api-claim-recognition read them in (createdAt ASC), so "reply-N" matches.
  const replyFiles = attachments
    .filter((a) => replyIds.has(a.id))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    .map((a, i) => {
      const file = a.originalFilename || 'attachment';
      return { key: a.id, name: `reply-${i + 1}/${file}`, path: attachmentPath(caseRecord.id, a.id), pdf: isPdf(a.contentType, file), group: 'Customer replies' };
    });
  return [...consoleFiles, ...replyFiles];
}

// "<name> - page N" (an evidence page) → the file and page; null when it names no file of this case.
export function pageRef(label: string | null | undefined, files: ViewFile[]): PageRef | null {
  const match = label?.match(/^(.*) - page (\d+)$/);
  const file = match && files.find((f) => f.name === match[1]);
  return file ? { fileKey: file.key, page: Number(match[2]) } : null;
}
