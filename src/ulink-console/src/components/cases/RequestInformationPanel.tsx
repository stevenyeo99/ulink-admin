import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { requestInformation } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { RequestsInfo } from '../../types/case';

/**
 * "Request more information" (SYSTEM_4 E4-28): the reviewer's own checklist lines for this case — what the AI's
 * predefined checklist doesn't cover, e.g. "Need to fill treatment date in the eye test record". The lines replace the
 * open ones, the case waits for documents, and the team is emailed to contact the customer (the lines are never in the
 * customer's email). When documents come in, the case stops for a person to check them against the lines.
 */
export function RequestInformationPanel({ caseId, requests }: { caseId: string; requests: RequestsInfo }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => requests.open.map((r) => r.text).join('\n'));
  const [comment, setComment] = useState('');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const mutation = useMutation({
    mutationFn: () => requestInformation(caseId, lines, comment.trim()),
    onSuccess: () => {
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals', 'timeline']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (!requests.allowed && !requests.open.length) return null;

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-slate-800">Request more information</h2>
      {requests.open.length > 0 && (
        <div className="mt-2 text-sm text-slate-600">
          <p className="mb-1">Open requests — the AI can't check these; a person confirms them:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {requests.open.map((r) => (
              <li key={r.id}>
                {r.text} <span className="text-xs text-slate-400">— asked by {r.by}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {requests.allowed && (
        <>
          <p className="mb-4 mt-2 text-sm text-slate-600">
            Ask for something the checklist doesn't cover. One item per line. The team is emailed to contact the customer
            — these lines are never in the customer's email. When documents come in, the case stops here for a person to
            check them against your lines.
          </p>
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium text-slate-700">What is needed (one per line, up to 10)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="e.g. Need to fill treatment date in the eye test record"
              className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
            />
          </label>
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Comment</span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Why this is needed"
              className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
            />
          </label>
          <Button onClick={() => mutation.mutate()} disabled={!lines.length || comment.trim().length < 3 || mutation.isPending}>
            {mutation.isPending ? 'Sending…' : 'Request more information'}
          </Button>
          {mutation.isError && <p className="mt-3 text-sm text-red-600">{(mutation.error as Error).message}</p>}
        </>
      )}
    </section>
  );
}
