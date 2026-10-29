import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Capped } from '../../types/case';

// The search runs this long after the last key, so the API is not asked on every key press.
const WAIT_MS = 300;

/**
 * Search box for the waiting lists (review queue, approvals): searched on the server, like the Cases page — claim no.,
 * TPA case no., case id, the claimant's name and NRC / passport — so every waiting case can be found, not only the
 * ones loaded.
 */
export function ClaimSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  // The latest onChange, so a page's re-render (a new arrow function) does not restart the wait.
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => setText(value), [value]); // cleared or changed elsewhere (a link, Back)
  useEffect(() => {
    if (text === value) return undefined;
    const timer = setTimeout(() => latest.current(text), WAIT_MS);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <label className="relative block w-full max-w-sm">
      <span className="sr-only">Search by claim no., TPA case no., name or NRC</span>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search claim no., TPA case no., name or NRC"
        className="w-full rounded-full border border-slate-900/10 bg-white/80 py-2 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-ulink-teal focus:outline-none focus:ring-2 focus:ring-ulink-teal/30"
      />
    </label>
  );
}

/** Under the search box when more wait than the page loaded (the oldest first): the others are found by searching. */
export function CappedNote({ capped, what }: { capped: Capped | null | undefined; what: string }) {
  if (!capped) return null;
  return (
    <p className="mt-2 text-xs text-slate-500">
      Showing the oldest {capped.at} of {capped.of} {what}. Search to find the others.
    </p>
  );
}
