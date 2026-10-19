import { Image } from 'lucide-react';
import { documentPath } from '../../api/casesApi';
import { FileLink } from '../common/FileLink';
import { formatBytes } from '../../lib/formatBytes';
import type { CaseDocument } from '../../types/case';

/** An API case's console images, grouped by barcode (one group per console submission), then the case-page uploads. */
export function CaseDocumentsSection({ caseId, documents }: { caseId: string; documents: CaseDocument[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-slate-400">No console documents yet.</p>;
  }

  const UPLOADS = 'Uploaded on the case page';
  const byBarcode = new Map<string, CaseDocument[]>();
  for (const doc of documents) {
    const group = doc.barcodeId ?? UPLOADS;
    byBarcode.set(group, [...(byBarcode.get(group) ?? []), doc]);
  }

  return (
    <div className="space-y-3">
      {[...byBarcode.entries()].map(([group, docs]) => (
        <div key={group}>
          <p className="mb-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{group}</span>
            {docs[0].scanId && <span className="ml-2 font-mono">{docs[0].scanId}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {docs.map((doc) => (
              <FileLink
                key={doc.id}
                path={documentPath(caseId, doc.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-ulink-orange/40 hover:text-ulink-orange-dark"
              >
                <Image size={12} />
                {doc.originalFilename}
                <span className="text-slate-400">{formatBytes(doc.sizeBytes)}</span>
              </FileLink>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
