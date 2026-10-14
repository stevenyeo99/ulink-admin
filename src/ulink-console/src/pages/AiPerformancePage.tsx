import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getPromptSummary, type PromptVersionSummary } from '../api/llmCallsApi';

const PERIODS: { days: number | null; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: null, label: 'All time' },
];

const percent = (share: number | null) => (share == null ? '—' : `${Math.round(share * 100)}%`);
const tokens = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');

/**
 * AI performance (SYSTEM_4 D2): how each prompt version does, from the AI call log — calls by status, time, tokens,
 * confidence and how often the AI was unsure. After a prompt change, the old and new versions sit side by side.
 * Super admin.
 */
export function AiPerformancePage() {
  const [days, setDays] = useState<number | null>(30);
  const { data, isLoading, isError } = useQuery({ queryKey: ['llm-summary', days], queryFn: () => getPromptSummary(days) });

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Every call to the AI, by prompt and version. A changed prompt file is a new version, so its numbers can be compared
          with the version before. <b>Unsure</b> = the AI's confidence at or below {data ? `${Math.round(data.threshold * 100)}%` : 'the threshold'} (STP settings).
        </p>
        <div role="tablist" aria-label="Period" className="flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              role="tab"
              aria-selected={days === p.days}
              onClick={() => setDays(p.days)}
              className={clsx('rounded-full px-3.5 py-1.5 text-sm font-medium', days === p.days ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the AI performance.</p>}
      {data && (
        <div className="overflow-x-auto rounded-xl2 border border-slate-900/10 bg-white/80 shadow-glass">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                {['Prompt', 'Version', 'In use', 'Calls', 'OK / error / timeout / too long', 'Avg time', 'Avg tokens in / out', 'Avg confidence', 'Unsure'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/5">
              {data.prompts.map((p) => (
                <Row key={`${p.promptName}-${p.promptVersion}`} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ p }: { p: PromptVersionSummary }) {
  const failed = p.byStatus.error + p.byStatus.timeout + p.byStatus.too_long;
  return (
    <tr className={clsx(!p.current && 'text-slate-400')}>
      <td className="px-3 py-2 font-medium text-slate-800">{p.promptName ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {p.promptVersion ?? '—'}
        {p.current && <span className="ml-1.5 rounded-full bg-ulink-teal/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ulink-teal-dark">current</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{p.calls ? `${day(p.firstCall)} – ${day(p.lastCall)}` : 'no calls yet'}</td>
      <td className="px-3 py-2">{p.calls}</td>
      <td className={clsx('whitespace-nowrap px-3 py-2', failed > 0 && 'text-red-700')}>
        {p.byStatus.ok} / {p.byStatus.error} / {p.byStatus.timeout} / {p.byStatus.too_long}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{p.avgDurationMs == null ? '—' : `${(p.avgDurationMs / 1000).toFixed(1)} s`}</td>
      <td className="whitespace-nowrap px-3 py-2">
        {tokens(p.avgPromptTokens)} / {tokens(p.avgCompletionTokens)}
      </td>
      <td className="px-3 py-2">{percent(p.avgConfidence)}</td>
      <td className="px-3 py-2">{percent(p.unsureShare)}</td>
    </tr>
  );
}
