import { Check, Minus, X } from 'lucide-react';
import clsx from 'clsx';
import type { ChecklistItem } from '../../types/case';

// `passed` is a tri-state, not a boolean: `null` means the check couldn't be evaluated
// (e.g. a judgment that never ran because an upstream field was missing), which is a
// distinct, non-alarming state from an actual failure — rendered as a dash, not a red X.
function ChecklistRow({ item, reason }: { item: ChecklistItem; reason?: string | null }) {
  const Icon = item.passed === true ? Check : item.passed === false ? X : Minus;
  const color =
    item.passed === true ? 'text-ulink-teal-dark' : item.passed === false ? 'text-red-600' : 'text-slate-300';

  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <Icon size={15} className={clsx('mt-0.5 shrink-0', color)} />
      <div>
        <p className="text-slate-700">{item.label}</p>
        {item.passed === false && reason && <p className="mt-0.5 text-xs text-slate-500">{reason}</p>}
      </div>
    </li>
  );
}

export function ChecklistTable({ items, reasonByCode }: { items: ChecklistItem[]; reasonByCode?: Record<string, string> }) {
  if (items.length === 0) return <p className="text-sm italic text-slate-400">No checklist data</p>;

  return (
    <ul className="divide-y divide-slate-900/5">
      {items.map((item, index) => (
        <ChecklistRow key={item.code ?? index} item={item} reason={item.code ? reasonByCode?.[item.code] : undefined} />
      ))}
    </ul>
  );
}
