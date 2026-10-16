import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getFeedbackReport, getPromptSummary, type FeedbackRow, type PromptVersionSummary } from '../api/llmCallsApi';

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

      <FeedbackReport />
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

// YYYY-MM-DD of a local date, for <input type="date">.
const dayInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// A picked day's local midnight as an ISO time; plusDays 1 = the end of that day.
const midnight = (day: string, plusDays = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + plusDays).toISOString();
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const caseName = (r: FeedbackRow) => r.claimNo || r.tpaCaseNumber || r.caseId.slice(0, 8);

const CSV_COLUMNS: [string, (r: FeedbackRow) => string | number | null][] = [
  ['Date', (r) => r.at],
  ['Claim no.', (r) => r.claimNo],
  ['TPA case no.', (r) => r.tpaCaseNumber],
  ['Source', (r) => r.source],
  ['Case ID', (r) => r.caseId],
  ['Type', (r) => r.type],
  ['Item', (r) => r.item],
  ['AI finding', (r) => r.aiFinding],
  ['AI confidence', (r) => (r.aiConfidence == null ? null : Math.round(r.aiConfidence * 100))],
  ['Decision', (r) => r.decision],
  ['Comment', (r) => r.comment],
  ['By', (r) => r.by],
  ['Trusted', (r) => (r.trusted == null ? null : r.trusted ? 'yes' : 'no')],
];

// Quotes every cell; a cell that starts like a formula gets a leading ' so Excel shows it as text, not runs it.
const csvCell = (v: string | number | null) => {
  const text = v == null ? '' : String(v);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

function downloadCsv(rows: FeedbackRow[], from: string, to: string) {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)), ...rows.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))))].map((l) => l.join(','));
  // The BOM makes Excel read the file as UTF-8 (Burmese names and comments).
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-feedback_${from || 'start'}_${to || 'today'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const TYPES: FeedbackRow['type'][] = ['Correction', 'Confirmed right', 'Override'];
const inputClass = 'rounded-lg border border-slate-900/10 bg-white px-2 py-1.5 text-sm text-slate-800';

/**
 * Feedback report (SYSTEM_4 E4-14, F2): every time a person corrected, confirmed or overrode the AI. Filter by days,
 * type and item; Download CSV exports what is shown, for Excel.
 */
function FeedbackReport() {
  const [from, setFrom] = useState(() => dayInput(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => dayInput(new Date()));
  const [type, setType] = useState('');
  const [item, setItem] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['feedback-report', from, to],
    queryFn: () => getFeedbackReport(from ? midnight(from) : null, to ? midnight(to, 1) : null),
  });

  const allRows = data?.rows ?? [];
  // The picked item stays listed after the dates change, so a filter hiding every row is never invisible.
  const items = [...new Set([...allRows.map((r) => r.item), ...(item ? [item] : [])])].sort();
  const rows = allRows.filter((r) => (!type || r.type === type) && (!item || r.item === item));

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold text-slate-900">Feedback report</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">
        Every time a person corrected the AI, confirmed it was right, or overrode a check. An item that is corrected often
        needs a better prompt or rule.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={clsx('mt-1 block', inputClass)} />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={clsx('mt-1 block', inputClass)} />
        </label>
        <label className="text-xs text-slate-500">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={clsx('mt-1 block', inputClass)}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Item
          <select value={item} onChange={(e) => setItem(e.target.value)} className={clsx('mt-1 block max-w-[16rem]', inputClass)}>
            <option value="">All items</option>
            {items.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!rows.length}
          onClick={() => downloadCsv(rows, from, to)}
          className="rounded-full bg-ulink-teal px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Download CSV
        </button>
        {data && <span className="pb-1.5 text-sm text-slate-500">{rows.length} of {allRows.length} rows{data.truncated && ' (newest only — pick fewer days for all)'}</span>}
      </div>

      {isLoading && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
      {isError && <p className="mt-3 text-sm text-red-600">Could not load the feedback report.</p>}
      {data && !rows.length && <p className="mt-3 text-sm text-slate-500">Nothing in these days and filters.</p>}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl2 border border-slate-900/10 bg-white/80 shadow-glass">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                {['When', 'Case', 'Type', 'Item', 'AI found', 'AI sure', 'Decision', 'Comment', 'By'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/5 align-top">
              {rows.map((r, i) => (
                <tr key={`${r.caseId}-${r.at}-${i}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{when(r.at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={`/cases/${r.caseId}`} className="font-medium text-ulink-teal-dark hover:underline">
                      {caseName(r)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2">{r.item}</td>
                  <td className="max-w-[14rem] break-words px-3 py-2 text-slate-600">{r.aiFinding}</td>
                  <td className="px-3 py-2">{percent(r.aiConfidence)}</td>
                  <td className="max-w-[14rem] break-words px-3 py-2">
                    {r.decision}
                    {r.trusted && <span className="ml-1.5 rounded-full bg-ulink-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-ulink-teal-dark">trusted</span>}
                  </td>
                  <td className="max-w-[16rem] break-words px-3 py-2 text-slate-600">{r.comment}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
