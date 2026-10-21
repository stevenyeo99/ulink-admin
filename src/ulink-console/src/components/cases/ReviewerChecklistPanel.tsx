import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { getEmailDraft, markRequestDone, requestInformation } from '../../api/casesApi';
import { formatTimestamp } from '../../lib/formatTimestamp';
import { Button } from '../common/Button';
import { isSuperAdmin } from '../../lib/session';
import type { RequestsInfo } from '../../types/case';

const MAX_LINES = 10;
const inputClass = 'w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';
const REFRESH = ['case', 'cases', 'review-queue', 'cases-overview', 'approvals', 'timeline', 'email-draft'];

/**
 * Reviewer checklist (SYSTEM_4 E4-28, E4-29): a person's own lines for this case, apart from the system checklist (the
 * AI and the rules). One row per line: open lines with *Done* (the documents arrived) and *Remove*; new rows with ×.
 * *Save and request* sends only the change; the case waits for documents and the team contacts the customer — the
 * lines are never in the customer's email. Below it, the email draft with both checklists, to copy. Everyone else
 * (and a case with nothing to edit) sees the draft alone.
 */
export function ReviewerChecklistPanel({ caseId, requests }: { caseId: string; requests: RequestsInfo }) {
  const queryClient = useQueryClient();
  const refresh = () => REFRESH.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const [newRows, setNewRows] = useState<string[]>(() => (requests.open.length ? [] : ['']));
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [doneId, setDoneId] = useState<string | null>(null);
  const [doneComment, setDoneComment] = useState('');

  const added = newRows.map((r) => r.trim()).filter(Boolean);
  const kept = requests.open.filter((r) => !removed.has(r.id));
  const lines = [...kept.map((r) => r.text), ...added];
  const changedSomething = added.length > 0 || removed.size > 0;

  const save = useMutation({
    mutationFn: () => requestInformation(caseId, added, [...removed], comment.trim()),
    // Saved: the new rows are open lines now — start a clean edit. (Done on one line keeps unsaved edits.)
    onSuccess: () => { setNewRows([]); setRemoved(new Set()); setComment(''); refresh(); },
  });
  const done = useMutation({
    mutationFn: (requestId: string) => markRequestDone(caseId, requestId, doneComment.trim()),
    onSuccess: () => { setDoneId(null); setDoneComment(''); refresh(); },
  });

  if (!isSuperAdmin() || (!requests.allowed && !requests.open.length)) return <EmailDraftPanel caseId={caseId} lines={null} />;

  return (
    <>
      <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="text-sm font-semibold text-slate-800">Ask for more information</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">
          Your own lines for this case — what the system checklist doesn't cover. The AI can't check them: a person marks
          each one done. They are never in the customer's email; the team is emailed to contact the customer.
        </p>

        {requests.open.length > 0 && (
          <ul className="mb-3 divide-y divide-slate-900/5 rounded-lg border border-slate-900/10">
            {requests.open.map((r) => (
              <li key={r.id} className={clsx('px-3 py-2 text-sm', removed.has(r.id) && 'bg-slate-50 text-slate-400 line-through')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-slate-800">{r.text}</p>
                    <p className="text-xs text-slate-400">Added by {r.by} · {formatTimestamp(r.at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => setDoneId(doneId === r.id ? null : r.id)} disabled={removed.has(r.id)}>Done</Button>
                    {requests.allowed && (
                      <Button variant="ghost" onClick={() => setRemoved((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                        {removed.has(r.id) ? 'Keep' : 'Remove'}
                      </Button>
                    )}
                  </div>
                </div>
                {doneId === r.id && (
                  <div className="mt-2 flex gap-2">
                    <input value={doneComment} onChange={(e) => setDoneComment(e.target.value)} placeholder="What arrived (e.g. eye test record with date, page 2)" className={inputClass} />
                    <Button onClick={() => done.mutate(r.id)} disabled={doneComment.trim().length < 3 || done.isPending}>{done.isPending ? 'Saving…' : 'Mark done'}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {done.isError && <p className="mb-3 text-sm text-red-600">{(done.error as Error).message}</p>}

        {requests.allowed && (
          <>
            {newRows.map((row, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input
                  value={row}
                  onChange={(e) => setNewRows((rows) => rows.map((r, j) => (j === i ? e.target.value : r)))}
                  placeholder="e.g. Need to fill treatment date in the eye test record"
                  maxLength={300}
                  className={inputClass}
                />
                <button type="button" aria-label="Delete this line" onClick={() => setNewRows((rows) => rows.filter((_, j) => j !== i))} className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setNewRows((rows) => [...rows, ''])}
              disabled={lines.length + newRows.filter((r) => !r.trim()).length >= MAX_LINES}
              className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ulink-teal-dark hover:underline disabled:opacity-40"
            >
              <Plus size={14} /> Add line
            </button>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Comment</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why this is needed" className={inputClass} />
            </label>
            <Button onClick={() => save.mutate()} disabled={!changedSomething || !lines.length || lines.length > MAX_LINES || comment.trim().length < 3 || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save and request'}
            </Button>
            {save.isError && <p className="mt-3 text-sm text-red-600">{(save.error as Error).message}</p>}
          </>
        )}
      </section>

      <EmailDraftPanel caseId={caseId} lines={lines} />
    </>
  );
}

/**
 * The customer missing-documents email as it would read now: the approved template with the system checklist's open
 * items and the reviewer lines being edited. Copy only — the system never sends it.
 */
// lines: the reviewer lines being edited; null = the open ones saved.
function EmailDraftPanel({ caseId, lines }: { caseId: string; lines: string[] | null }) {
  // Asked again a moment after the lines stop changing, not on every key.
  const key = JSON.stringify(lines);
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setSettled(key), 400);
    return () => clearTimeout(t);
  }, [key]);
  const { data, isError } = useQuery({ queryKey: ['email-draft', caseId, settled], queryFn: () => getEmailDraft(caseId, JSON.parse(settled) as string[] | null) });
  const [copied, setCopied] = useState(false);

  if (isError) return <p className="mb-6 text-sm text-red-600">Could not build the email draft.</p>;
  if (!data?.text) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(data.text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Email draft to the customer</h2>
        <Button variant="ghost" onClick={copy}>
          <Copy size={14} className="mr-1 inline" /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mb-3 text-sm text-slate-600">Not sent by the system — copy it into your own email.</p>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <DraftList title="System checklist" items={data.system} empty="Nothing open." />
        <DraftList title="Reviewer checklist" items={data.reviewer} empty="No lines." />
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{data.text}</pre>
    </section>
  );
}

function DraftList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-slate-900/10 p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
          {items.map((item) => <li key={item} className="whitespace-pre-wrap">{item}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
}
