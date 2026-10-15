import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bot, Cog, Landmark, Mail, User } from 'lucide-react';
import { getTimeline } from '../../api/casesApi';
import { formatTimestamp } from '../../lib/formatTimestamp';
import type { TimelineKind } from '../../types/case';

const KINDS: { kind: TimelineKind; label: string; Icon: typeof User }[] = [
  { kind: 'people', label: 'People', Icon: User },
  { kind: 'ai', label: 'AI', Icon: Bot },
  { kind: 'email', label: 'Emails', Icon: Mail },
  { kind: 'ias', label: 'IAS', Icon: Landmark },
  { kind: 'system', label: 'System', Icon: Cog },
];

/**
 * The case's single timeline (SYSTEM_4 E4-24): who changed what and why, newest first — status moves, people's actions
 * with their comments, AI calls (grouped per job run), emails and IAS calls. Filter by kind. The raw AI answers stay in
 * the technical details.
 */
export function CaseTimeline({ caseId }: { caseId: string }) {
  const [chosen, setKind] = useState<TimelineKind | ''>('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['case', caseId, 'timeline'], queryFn: () => getTimeline(caseId) });
  const entries = data?.entries ?? [];
  const count = (k: TimelineKind) => entries.filter((e) => e.kind === k).length;
  // A filter whose kind has no entries any more (after a refresh) falls back to All.
  const kind = chosen && count(chosen) > 0 ? chosen : '';
  const shown = kind ? entries.filter((e) => e.kind === kind) : entries;

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (isError) return <p className="text-sm text-red-600">Couldn't load the timeline.</p>;
  if (entries.length === 0) return <p className="text-sm text-slate-500">Nothing has happened to this case yet.</p>;

  return (
    <div>
      <div className="mb-3 flex w-fit flex-wrap items-center gap-1 rounded-full bg-slate-100/80 p-1">
        {[{ kind: '' as const, label: 'All', n: entries.length }, ...KINDS.map((k) => ({ kind: k.kind, label: k.label, n: count(k.kind) }))]
          .filter((k) => k.kind === '' || k.n > 0)
          .map((k) => (
            <button
              key={k.kind || 'all'}
              onClick={() => setKind(k.kind)}
              aria-pressed={kind === k.kind}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
                kind === k.kind ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              {k.label} <span className="tabular-nums text-slate-400">{k.n}</span>
            </button>
          ))}
      </div>
      <ol className="space-y-3">
        {shown.map((e, i) => {
          const { Icon, label } = KINDS.find((k) => k.kind === e.kind) ?? KINDS[4];
          return (
            <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
              <Icon size={14} aria-label={label} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-slate-700">{e.what}</p>
                {e.why && <p className="mt-0.5 break-words text-xs text-slate-500">{e.why}</p>}
                <p className="mt-0.5 text-xs text-slate-400">{formatTimestamp(e.at)} · {e.source}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
