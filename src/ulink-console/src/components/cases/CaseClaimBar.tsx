import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import { claimCase, releaseCase } from '../../api/casesApi';
import { getSession } from '../../lib/session';
import { Button } from '../common/Button';
import type { CaseClaim } from '../../types/case';

/**
 * "Being reviewed by …" (SYSTEM_4 E4-22): claim a case before working on it, so nobody else overrides, corrects, resets
 * or uploads at the same time. Others can still view it. Lasts 30 minutes from your last action; taking over
 * someone else's case needs a comment (kept in the case history).
 */
export function CaseClaimBar({ caseId, claim }: { caseId: string; claim: CaseClaim | null }) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [takingOver, setTakingOver] = useState(false);
  const me = getSession()?.user.username;
  const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mine = claim?.username === me;

  const refresh = () => {
    setTakingOver(false);
    setComment('');
    for (const key of ['case', 'review-queue', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  // When the claim runs out, reload the case so the bar never shows a claim that is already gone.
  useEffect(() => {
    if (!claim) return undefined;
    const ms = new Date(claim.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: ['case'] }), Math.max(ms, 0) + 1000);
    return () => clearTimeout(timer);
  }, [claim, queryClient]);
  const take = useMutation({ mutationFn: (over: boolean) => claimCase(caseId, over, comment.trim()), onSuccess: refresh });
  const give = useMutation({ mutationFn: () => releaseCase(caseId), onSuccess: refresh });
  // A new attempt clears the other button's old error.
  const claimIt = (over: boolean) => { give.reset(); take.mutate(over); };
  const releaseIt = () => { take.reset(); give.mutate(); };
  const error = (take.error ?? give.error) as Error | null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
      <UserCheck size={16} className={claim ? 'text-ulink-teal-dark' : 'text-slate-400'} />
      {!claim && (
        <>
          <span className="text-slate-600">Nobody is reviewing this case.</span>
          <Button variant="ghost" disabled={take.isPending} onClick={() => claimIt(false)}>Review this case</Button>
        </>
      )}
      {claim && mine && (
        <>
          <span className="text-slate-700">You are reviewing this case (until {at(claim.expiresAt)}, renewed when you act).</span>
          <Button variant="ghost" disabled={give.isPending} onClick={releaseIt}>Release</Button>
        </>
      )}
      {claim && !mine && (
        <>
          <span className="text-slate-700">
            Being reviewed by <span className="font-medium">{claim.name}</span> since {at(claim.claimedAt)} — you can view it; actions wait for them.
          </span>
          {!takingOver ? (
            <Button variant="ghost" onClick={() => setTakingOver(true)}>Take over</Button>
          ) : (
            <span className="flex flex-1 flex-wrap items-center gap-2">
              <label className="min-w-[14rem] flex-1">
                <span className="sr-only">Why you take it over</span>
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={`Why you take it over from ${claim.name}`}
                  className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
                />
              </label>
              <Button disabled={comment.trim().length < 3 || take.isPending} onClick={() => claimIt(true)}>Take over</Button>
              <Button variant="ghost" onClick={() => { setTakingOver(false); setComment(''); take.reset(); }}>Cancel</Button>
            </span>
          )}
        </>
      )}
      {error && <p className="w-full text-sm text-red-600">{error.message}</p>}
    </div>
  );
}
