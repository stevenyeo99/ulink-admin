import { Image } from 'lucide-react';
import { getDocumentUrl } from '../../api/casesApi';
import { formatBytes } from '../../lib/formatBytes';
import type { CaseDocument } from '../../types/case';

/** An API case's console images, grouped by barcode (one group per console submission). */
export function CaseDocumentsSection({ caseId, documents }: { caseId: string; documents: CaseDocument[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-slate-400">No console documents yet.</p>;
  }

  const byBarcode = new Map<string, CaseDocument[]>();
  for (const doc of documents) byBarcode.set(doc.barcodeId, [...(byBarcode.get(doc.barcodeId) ?? []), doc]);

  return (
    <div className="space-y-3">
      {[...byBarcode.entries()].map(([barcodeId, docs]) => (
        <div key={barcodeId}>
          <p className="mb-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{barcodeId}</span>
            {docs[0].scanId && <span className="ml-2 font-mono">{docs[0].scanId}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {docs.map((doc) => (
              <a
                key={doc.id}
                href={getDocumentUrl(caseId, doc.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-900/10 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-ulink-orange/40 hover:text-ulink-orange-dark"
              >
                <Image size={12} />
                {doc.originalFilename}
                <span className="text-slate-400">{formatBytes(doc.sizeBytes)}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
