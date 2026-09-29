import { AlertTriangle, CheckCircle2, Route } from 'lucide-react';
import clsx from 'clsx';
import type { AssessmentLine, AssessmentOverride, AssessmentSummary } from '../../types/case';

const STATUS_PILL: Record<AssessmentLine['status'], string> = {
  ok: 'bg-ulink-teal/15 text-ulink-teal-dark',
  issue: 'bg-ulink-orange/15 text-ulink-orange-dark',
  not_checked: 'bg-slate-900/5 text-slate-500',
};

/** A point a reviewer already dealt with: kept visible (the AI's finding is part of the record), marked as handled. */
function OverriddenNote({ override }: { override: AssessmentOverride }) {
  return (
    <span className="text-ulink-teal-dark">
      ✔ {override.note}
      {override.at && <span className="text-slate-500"> · {new Date(override.at).toLocaleString()}</span>}
    </span>
  );
}

/**
 * "Why the case went this way": each stage the case reached, its result and the reason, ending with
 * where it is now — the same list the internal emails start with. The detail behind each step is in
 * the assessment below. Display only; the API builds it (modules/assessment-summary/journey.js).
 */
export function CaseJourneyPanel({ summary }: { summary: AssessmentSummary | undefined }) {
  const journey = summary?.journey ?? [];
  if (journey.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2">
        <Route size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">Why the case went this way</h2>
      </div>
      <ol className="space-y-2">
        {journey.map((step, index) => {
          const isNow = index === journey.length - 1 && step.stage === 'Now';
          return (
            <li key={index} className="grid grid-cols-[1.5rem_7rem_1fr] gap-x-2 text-sm sm:grid-cols-[1.5rem_8rem_1fr]">
              <span className="text-slate-400">{index + 1}.</span>
              <span className={clsx('font-medium', isNow ? 'text-ulink-orange-dark' : 'text-slate-700')}>{step.stage}</span>
              <span className="min-w-0 text-slate-700">
                <span className="font-medium">{step.result}</span>
                {step.why && <span className="text-slate-500"> — {step.why}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Top-of-page explanation of the case: every decision the system or the AI made, why, how sure,
 * and how that was verified — "AI self-rated" means only the model's own confidence, a hint rather
 * than proof. Review points (what a person should check first, and who might be wrong) come first.
 * Display only; the API builds the content (modules/assessment-summary/summary.js). Renders nothing
 * for a case with no results yet.
 */
export function AssessmentSummaryPanel({ summary }: { summary: AssessmentSummary | undefined }) {
  if (!summary || summary.lines.length === 0) return null;
  const { lines, reviewPoints, needsReview } = summary;

  return (
    <section
      className={clsx(
        'mb-6 rounded-xl2 border p-5 shadow-glass backdrop-blur-xl',
        needsReview ? 'border-ulink-orange/30 bg-ulink-orange/5' : 'border-ulink-teal/20 bg-ulink-teal/5'
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {needsReview ? (
          <AlertTriangle size={16} className="text-ulink-orange-dark" />
        ) : (
          <CheckCircle2 size={16} className="text-ulink-teal-dark" />
        )}
        <h2 className={clsx('text-sm font-semibold', needsReview ? 'text-ulink-orange-dark' : 'text-ulink-teal-dark')}>
          AI assessment: what was decided and why
        </h2>
      </div>

      {reviewPoints.length > 0 && (
        <div className="mb-4 rounded-lg border border-ulink-orange/30 bg-white/70 p-3">
          <p className="mb-1.5 text-xs font-semibold text-ulink-orange-dark">Review points</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {reviewPoints.map((point, index) => (
              <li key={index} className={clsx(point.overridden && 'text-slate-500')}>
                <span className="font-medium">{point.decision}</span> — {point.reason}.{' '}
                {point.overridden ? (
                  <OverriddenNote override={point.overridden} />
                ) : (
                  <>
                    {point.check}
                    {point.mightBeWrong.length > 0 && (
                      <span className="text-xs text-slate-500"> (might be wrong: {point.mightBeWrong.join(', ')})</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <ul className="divide-y divide-slate-900/5">
        {lines.map((line, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="text-slate-700">
                {line.decision}: <span className="font-medium">{line.result}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{line.why}</p>
              {line.review && (
                <p className="mt-0.5 text-xs text-ulink-orange-dark">
                  {line.review.reason}
                  {line.review.mightBeWrong.length > 0 && ` · might be wrong: ${line.review.mightBeWrong.join(', ')}`}
                </p>
              )}
              {line.overridden && (
                <p className="mt-0.5 text-xs">
                  <OverriddenNote override={line.overridden} />
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_PILL[line.status])}>
                {line.status === 'not_checked' ? 'Not checked' : line.status === 'issue' ? 'Issue' : 'OK'}
              </span>
              <span className="text-[11px] text-slate-400">
                {line.verified}
                {line.confidence != null && ` · ${Math.round(Number(line.confidence) * 100)}%`}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
