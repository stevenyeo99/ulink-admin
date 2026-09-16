import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import type { CaseDetail } from '../../types/case';

export interface ConfidenceEntry {
  label: string;
  confidence: number;
  note: string | null;
}

// Below this, the console calls it out — same threshold every confidence-gated judge in the
// backend uses (identityJudgment.js, ias-claim-preparation's pickers, policy-exclusion).
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Pulls together every confidence score already computed anywhere on this case — document-
 * checking's presence checks (medical record / invoice, see checklist.js's
 * buildEvaluatorChecklist) and claim-preparation's diagnosis/benefit picks (claimPrepMeta) —
 * into one flat, sorted (lowest-confidence-first) list. Pure aggregation over data the backend
 * already stores; adds no new field, computes nothing, can't change any decision the pipeline
 * already made — this is a display-only read of `caseRecord`.
 */
export function collectConfidenceEntries(caseRecord: CaseDetail): ConfidenceEntry[] {
  const entries: ConfidenceEntry[] = [];

  for (const item of caseRecord.documentCheckResult?.checklist ?? []) {
    if (item.confidence != null) {
      entries.push({ label: item.label, confidence: item.confidence, note: item.note ?? null });
    }
  }

  const meta = caseRecord.claimPrepMeta;
  if (meta?.diagnosis?.confidence != null) {
    entries.push({
      label: 'Diagnosis code pick',
      confidence: meta.diagnosis.confidence,
      note: meta.diagnosis.pick
        ? `Picked from ${meta.diagnosis.candidates.length} candidate(s) considered`
        : 'No candidate met the confidence threshold — left blank rather than guessed',
    });
  }
  (meta?.lines ?? []).forEach((line, index) => {
    if (line.confidence != null) {
      entries.push({
        label: `Benefit code pick — voucher ${index + 1}${line.voucherType ? ` (${line.voucherType})` : ''}`,
        confidence: line.confidence,
        note: line.pick
          ? `Picked from ${line.candidates.length} candidate(s) considered`
          : 'No candidate met the confidence threshold — left blank rather than guessed',
      });
    }
  });

  return entries.sort((a, b) => a.confidence - b.confidence);
}

/**
 * Top-of-page summary so a reviewer (or a demo audience) sees at a glance whether the AI was
 * confident everywhere on this case, or where it wasn't and why — instead of that reasoning
 * being scattered across each section's own checklist further down the page. Renders nothing
 * when no confidence score has been computed yet (e.g. a case still early in the pipeline).
 */
export function ConfidenceSummary({ caseRecord }: { caseRecord: CaseDetail }) {
  const entries = collectConfidenceEntries(caseRecord);
  if (entries.length === 0) return null;

  const anyLow = entries[0].confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <section
      className={clsx(
        'mb-6 rounded-xl2 border p-5 shadow-glass backdrop-blur-xl',
        anyLow ? 'border-ulink-orange/30 bg-ulink-orange/5' : 'border-ulink-teal/20 bg-ulink-teal/5'
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {anyLow ? (
          <AlertTriangle size={16} className="text-ulink-orange-dark" />
        ) : (
          <CheckCircle2 size={16} className="text-ulink-teal-dark" />
        )}
        <h2 className={clsx('text-xs font-semibold uppercase tracking-wide', anyLow ? 'text-ulink-orange-dark' : 'text-ulink-teal-dark')}>
          AI Confidence &amp; Reasoning
        </h2>
      </div>
      <ul className="divide-y divide-slate-900/5">
        {entries.map((entry, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-1.5 text-sm">
            <div>
              <p className="text-slate-700">{entry.label}</p>
              {entry.note && <p className="mt-0.5 text-xs text-slate-500">{entry.note}</p>}
            </div>
            <span
              className={clsx(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                entry.confidence < LOW_CONFIDENCE_THRESHOLD
                  ? 'bg-ulink-orange/15 text-ulink-orange-dark'
                  : 'bg-ulink-teal/15 text-ulink-teal-dark'
              )}
            >
              {Math.round(entry.confidence * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
