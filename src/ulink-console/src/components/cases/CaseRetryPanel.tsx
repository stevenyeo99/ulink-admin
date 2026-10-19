import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { retryCase } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { RetryInfo } from '../../types/case';

/**
 * "Try again" on a case IAS or the console refused (ulink-api modules/case-retry/retry.js): after the person fixed the
 * cause, the case goes back one step with their comment, and the next pipeline run does the rest. Any logged-in user.
 */
export function CaseRetryPanel({ caseId, retry }: { caseId: string; retry: RetryInfo | null }) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const run = useMutation({
    mutationFn: (action: string) => retryCase(caseId, action, comment.trim()),
    onSuccess: () => {
      setComment('');
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (!retry) return null;

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><RotateCcw size={15} /> Try again</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">{retry.note}</p>
      {retry.actions.length > 0 && (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Comment — what was fixed</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="e.g. Benefit head OV added to the member's plan in IAS."
              className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
            />
          </label>
          {run.isError && <p className="mt-2 text-sm text-red-600">{(run.error as Error).message}</p>}
          {run.isSuccess && <p className="mt-2 text-sm text-ulink-teal-dark">Done — the next pipeline run takes it from here.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {retry.actions.map((a) => (
              <Button
                key={a.id}
                variant={a.id === 'prepare' ? 'ghost' : undefined}
                disabled={comment.trim().length < 3 || run.isPending}
                // Send / Upload again goes out to IAS or the console on the next run, unchanged: confirm first.
                onClick={() => (a.id === 'prepare' || window.confirm(`${a.label}: the next pipeline run sends it again as it is. Continue?`)) && run.mutate(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
