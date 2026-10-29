import { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

// Display only (SYSTEM_6, owner 2026-10-29): the reason text is never changed, only laid out — one line per sentence
// or "; " part, quoted values ('SPEC', "For making glasses") as highlighted labels.
// The ";" stays at the end of its line. Not after an abbreviation (e.g., i.e., No., Dr.).
const SPLIT = /(?<!\b[A-Za-z]\.[A-Za-z]\.)(?<!\b(?:No|Dr|Mr|Mrs|Ms|Mdm|vs|St)\.)(?<=[.!?])\s+(?=[A-Z('"])|(?<=;)\s+/;
// A quote that opens after a space or "(" and closes before a space or punctuation: not an apostrophe (Let's, voucher's).
const QUOTED = /((?<=^|[\s(])['"][^'"\n]+?['"](?=[\s.,;:)]|$))/;
// More lines than this: the reason starts closed, with a button to open it (owner, 2026-10-29).
const OPEN_UP_TO = 3;

function withLabels(line: string) {
  return line.split(QUOTED).map((part, i) =>
    i % 2 ? <code key={i} className="rounded bg-ulink-teal/10 px-1 font-sans text-ulink-teal-dark">{part.slice(1, -1)}</code> : part);
}

/**
 * A check's or the AI's reason, readable: the same words, one line per sentence, quoted values highlighted. A long one
 * starts closed. label: its caption ("AI reasoning"; "Reason" when left out). plain: no box, for rows that need no
 * decision (passed findings, the case's path).
 */
export function ReasonText({ text, label, plain, className }: { text: string | null | undefined; label?: string; plain?: boolean; className?: string }) {
  const lines = text ? text.split(SPLIT).filter(Boolean) : [];
  const long = lines.length > OPEN_UP_TO;
  const [open, setOpen] = useState(false);
  if (!text) return null;

  const caption = label ?? 'Reason';
  const body = lines.length === 1
    ? <p>{withLabels(text)}</p>
    : <ul className="list-disc space-y-1 pl-4">{lines.map((line, i) => <li key={i}>{withLabels(line)}</li>)}</ul>;
  return (
    <div className={clsx('mt-1 text-sm leading-relaxed', plain ? 'text-slate-600' : 'rounded-lg bg-slate-50 px-3 py-2 text-slate-700', className)}>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
        >
          <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
          {caption} · {lines.length} lines
        </button>
      ) : (
        label && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      )}
      {(!long || open) && <div className={clsx(long && 'mt-1')}>{body}</div>}
    </div>
  );
}
