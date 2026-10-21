import { Search } from 'lucide-react';

/**
 * Search box for a list already in the page (review queue, approvals): filters by claim no. or TPA case no. as you type
 * (lib/claimSearch.ts matchesClaim). The Cases page has its own search, through the API, which also finds names and NRC.
 */
export function ClaimSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block w-full max-w-sm">
      <span className="sr-only">Search by claim no. or TPA case no.</span>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search claim no. or TPA case no."
        className="w-full rounded-full border border-slate-900/10 bg-white/80 py-2 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-ulink-teal focus:outline-none focus:ring-2 focus:ring-ulink-teal/30"
      />
    </label>
  );
}
