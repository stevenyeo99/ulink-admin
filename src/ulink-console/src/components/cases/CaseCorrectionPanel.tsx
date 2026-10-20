import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { trustCorrection } from '../../api/casesApi';
import { getSession, isSuperAdmin } from '../../lib/session';
import { Button } from '../common/Button';
import type { Correction, CorrectionsInfo, WrongStep } from '../../types/case';

const WRONG_STEPS: Record<WrongStep, string> = {
  reading: 'The page was misread',
  mapping: 'Read right, but put in the wrong field',
  check: "The check's decision was wrong",
  ias_outdated: 'The IAS record is out of date',
  exception: 'The AI was right, accepted as an exception',
};

const shown = (v: Correction['aiValue']) => (v === true ? 'passed' : v === false ? 'failed' : v == null ? '—' : String(v));

/**
 * Corrections made on a case (SYSTEM_4 E4-12): the AI's value or verdict, the correction, who and why, and "Trusted" —
 * a second person agrees, so the correction may teach the AI later (E4-15). Corrections are made per finding on the
 * review page (InlineCorrection: Edit / Mark OK / Mark wrong next to each finding); the case page links there.
 */
export function CaseCorrectionPanel({ caseId, corrections, linkToReview = false }: { caseId: string; corrections: CorrectionsInfo; linkToReview?: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const trust = useMutation({ mutationFn: (feedbackId: string) => trustCorrection(caseId, feedbackId), onSuccess: refresh });

  const mayCorrect = corrections.allowed && isSuperAdmin(); // the API requires super admin, as for override
  // Confirmations ("✓ Right", E5b) are not corrections — the review workspace shows them on each finding.
  const list = corrections.list.filter((c) => c.kind !== 'confirm');
  const showLink = linkToReview && mayCorrect;
  if (!showLink && list.length === 0) return null;
  const me = getSession()?.user.username;

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-slate-800">Corrections made</h2>
      {showLink && (
        <p className="mt-1 text-sm text-slate-600">
          Correct a finding on the{' '}
          <Link to={`/cases/${caseId}/review`} className="text-ulink-teal-dark hover:underline">review page</Link>
          {' '}— each finding has its own Edit, Mark OK or Mark wrong, next to its document page.
        </p>
      )}
      {list.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-900/5 border-t border-slate-900/5">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div>
                <p className="text-slate-700">
                  {c.label}: AI <span className="font-medium">{shown(c.aiValue)}</span> → <span className="font-medium">{shown(c.correctedValue)}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.createdBy} — {c.wrongStep ? `${WRONG_STEPS[c.wrongStep].toLowerCase()}: ` : ''}{c.reason}
                  {c.page ? ` (${c.page})` : ''}
                </p>
                {!c.applied && <p className="mt-0.5 text-xs text-amber-700">No longer applied — the case was read again (e.g. new documents). Correct it again if it still applies.</p>}
              </div>
              {c.trusted ? (
                <span className="inline-flex items-center gap-1 text-xs text-ulink-teal-dark">
                  <CheckCircle2 size={13} /> Trusted by {c.trustedBy}
                </span>
              ) : isSuperAdmin() && c.createdBy !== me ? (
                <Button variant="ghost" disabled={trust.isPending} onClick={() => trust.mutate(c.id)}>Mark trusted</Button>
              ) : (
                <span className="text-xs text-slate-400">Not trusted yet{c.createdBy === me ? ' — another person marks it' : ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
