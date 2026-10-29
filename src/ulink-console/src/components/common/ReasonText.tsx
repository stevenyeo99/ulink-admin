import clsx from 'clsx';

// Display only (SYSTEM_6, owner 2026-10-29): the reason text is never changed, only laid out — one line per sentence
// or "; " part, quoted values ('SPEC', "For making glasses") as highlighted labels.
// The ";" stays at the end of its line. Not after an abbreviation (e.g., i.e., No., Dr.).
const SPLIT = /(?<!\b[A-Za-z]\.[A-Za-z]\.)(?<!\b(?:No|Dr|Mr|Mrs|Ms|Mdm|vs|St)\.)(?<=[.!?])\s+(?=[A-Z('"])|(?<=;)\s+/;
// A quote that opens after a space or "(" and closes before a space or punctuation: not an apostrophe (Let's, voucher's).
const QUOTED = /((?<=^|[\s(])['"][^'"\n]+?['"](?=[\s.,;:)]|$))/;

function withLabels(line: string) {
  return line.split(QUOTED).map((part, i) =>
    i % 2 ? <code key={i} className="rounded bg-ulink-teal/10 px-1 font-sans text-ulink-teal-dark">{part.slice(1, -1)}</code> : part);
}

/** A check's or the AI's reason, readable: the same words, one line per sentence, quoted values highlighted. */
export function ReasonText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const lines = text.split(SPLIT).filter(Boolean);
  const box = clsx('mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700', className);
  if (lines.length === 1) return <p className={box}>{withLabels(text)}</p>;
  return <ul className={clsx(box, 'list-disc space-y-1 pl-6')}>{lines.map((line, i) => <li key={i}>{withLabels(line)}</li>)}</ul>;
}
