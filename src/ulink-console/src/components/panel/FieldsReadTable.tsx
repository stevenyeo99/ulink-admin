import type { FieldRead } from '../../types/case';
import { ConfidenceBadge } from '../common/ConfidenceBadge';

/**
 * What the AI read (SYSTEM_4 E3b, E4-08): each key value and voucher with how sure the AI was, why, and the page it
 * was read from — so a reviewer checks the unsure ones against that page. From the document check's FIELDS_READ line.
 */
export function FieldsReadTable({ fields }: { fields: FieldRead[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">Value</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Read as</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Confidence</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Why</th>
            <th scope="col" className="py-1.5 font-medium">Page</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900/5">
          {fields.map((f) => (
            <tr key={f.field} className="align-top">
              <td className="py-1.5 pr-3 text-slate-700">{f.label}</td>
              <td className="py-1.5 pr-3 text-slate-800">{f.value ?? '—'}</td>
              <td className="py-1.5 pr-3">
                {f.confidence != null ? <ConfidenceBadge confidence={f.confidence} /> : <span className="text-xs text-slate-400">not recorded</span>}
              </td>
              <td className="py-1.5 pr-3 text-xs text-slate-500">{f.reason ?? '—'}</td>
              <td className="py-1.5 text-xs text-slate-500">{f.page ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
