import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import type { AssessmentLine, AssessmentSummary } from '../../types/case';

const STATUS_PILL: Record<AssessmentLine['status'], string> = {
  ok: 'bg-ulink-teal/15 text-ulink-teal-dark',
  issue: 'bg-ulink-orange/15 text-ulink-orange-dark',
  not_checked: 'bg-slate-900/5 text-slate-500',
};

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
              <li key={index}>
                <span className="font-medium">{point.decision}</span> — {point.reason}. {point.check}
                {point.mightBeWrong.length > 0 && (
                  <span className="text-xs text-slate-500"> (might be wrong: {point.mightBeWrong.join(', ')})</span>
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
