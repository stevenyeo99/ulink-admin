import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, FileText } from 'lucide-react';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { useConfidenceThreshold } from '../../hooks/useConfidenceThreshold';
import type { AssessmentLine, ChecklistItem, CorrectionOption, FieldRead } from '../../types/case';
import { pageRef, type PageRef, type ViewFile } from '../../lib/caseFiles';
import { InlineCorrection } from './InlineCorrection';
import { draftItem, draftProblem, newDraft, type CorrectionDraft } from '../../lib/correctionDraft';
import { createCorrections } from '../../api/casesApi';
import { Button } from '../common/Button';

/** One thing the AI decided or read, as the review workspace lists it. correct: the correction item ("value:…" / "verdict:…"). */
interface Finding {
  key: string;
  label: string;
  value?: string | number | null;
  passed: boolean | null;
  confidence: number | null;
  why: string | null;
  page: string | null;
  correct: string | null;
  /** What "✓ Right" confirms: the item itself — for a voucher both its amount and its date (one evidence covers both). */
  confirms: string[];
  /** A rule check: the values it compared ("value:…"), each offered for ✎ Edit on the check's own line. */
  edits?: string[];
}

// A voucher's evidence ("voucher 2") covers its amount and its date: Right confirms both.
const confirmItemsFor = (field: string) => {
  const voucher = field.match(/^voucher (\d+)$/);
  return voucher ? [`value:invoices.items.${Number(voucher[1]) - 1}.subtotal`, `value:invoices.items.${Number(voucher[1]) - 1}.date`] : [`value:${field}`];
};

// A voucher's evidence ("voucher 2") → its amount, the correction item a person most often needs.
const correctionItemFor = (field: string) => {
  const voucher = field.match(/^voucher (\d+)$/);
  return voucher ? `value:invoices.items.${Number(voucher[1]) - 1}.subtotal` : `value:${field}`;
};

/**
 * The findings of a case, built from what the checks stored (no AI): every value the AI read with its evidence
 * (E3b), every checklist line (the mandatory fields as one line), and the member / claim decisions read-only.
 * A checklist line takes the page of the least sure value it used.
 */
function buildFindings(checklist: ChecklistItem[], options: CorrectionOption[]): Finding[] {
  const canCorrect = (item: string) => (options.some((o) => `${o.kind}:${o.item}` === item) ? item : null);
  const read: FieldRead[] = checklist.find((c) => c.code === 'FIELDS_READ')?.fields ?? [];
  const pageOf = (fields?: string[]) => read.find((f) => fields?.includes(f.field) && f.page)?.page ?? null;

  const values: Finding[] = read.map((f) => ({
    key: `value-${f.field}`, label: f.label, value: f.value, passed: true, confidence: f.confidence,
    why: f.reportedBy ? `${f.reason ?? ''} (reported on its check)`.trim() : f.reason, page: f.page, correct: canCorrect(correctionItemFor(f.field)),
    confirms: confirmItemsFor(f.field).filter((item) => canCorrect(item)),
  }));
  const mandatory = checklist.filter((c) => c.code === 'MISSING_MANDATORY_FIELD');
  const missing = mandatory.filter((c) => c.passed === false).map((c) => c.label);
  // Benefit type and documents found: information only, so never "unsure" (the AI's confidence is in the text, not on the
  // row); one row per page, opening that page.
  const benefit = checklist.find((c) => c.code === 'BENEFIT_TYPE');
  const benefitValue = benefit?.benefitType
    ? `${benefit.benefitType.code} ${benefit.benefitType.desc}${benefit.benefitType.treatment ? ` (${benefit.benefitType.treatment})` : ''}`
    : null;
  const info: Finding[] = benefit
    ? [{ key: 'benefit-type', label: 'Benefit type', value: benefitValue, passed: true, confidence: null, why: benefit.note ?? null, page: null, correct: null, confirms: [] }]
    : [];
  // Medical documents dated: a rule, not the AI's score — an undated document is an open finding (no "AI 0%" badge).
  const dates = checklist.find((c) => c.code === 'DOCUMENT_DATES');
  const datesRow: Finding[] = dates
    ? [{ key: 'document-dates', label: dates.label, passed: (dates.confidence ?? null) === 0 ? false : true, confidence: null, why: dates.note ?? null, page: null, correct: null, confirms: [] }]
    : [];
  const documents: Finding[] = (checklist.find((c) => c.code === 'DOCUMENT_LIST')?.documents ?? []).map((d, i) => ({
    key: `document-${i}`, label: `Document: ${d.label}`, value: d.date, passed: true, confidence: null,
    why: [d.date ? null : d.dateRead ? `Date unclear: "${d.dateRead}"` : 'No date on this page', d.confidence != null ? `AI ${Math.round(d.confidence * 100)}%` : null, d.reason]
      .filter(Boolean).join(' — '),
    page: d.page, correct: null, confirms: [],
  }));
  const checks: Finding[] = checklist
    .filter((c) => !['FIELDS_READ', 'MISSING_MANDATORY_FIELD', 'DOCUMENT_LIST', 'BENEFIT_TYPE', 'DOCUMENT_DATES'].includes(c.code ?? ''))
    .map((c) => ({
      key: `check-${c.code}`, label: c.label, passed: c.passed, confidence: c.confidence ?? null,
      why: c.note ?? c.reason ?? null, page: pageOf(c.usedFields), correct: canCorrect(`verdict:${c.code}`),
      confirms: canCorrect(`verdict:${c.code}`) ? [`verdict:${c.code}`] : [],
      edits: (c.editItems ?? []).map((item) => `value:${item}`).filter((item) => canCorrect(item)),
    }));
  if (mandatory.length) {
    checks.push({
      key: 'check-mandatory', label: 'Mandatory fields', passed: missing.length === 0, confidence: null,
      why: missing.length ? `Not found: ${missing.join('; ')}` : `All ${mandatory.length} found.`, page: null, correct: null, confirms: [],
    });
  }
  return [...values, ...checks, ...datesRow, ...info, ...documents];
}

/**
 * Right side of the review workspace (SYSTEM_4 E4-20): unsure first (at or below the AI confidence threshold), then
 * failed, then passed (collapsed). Each finding: confidence, why, and the page it came from (opens on the left);
 * Correct opens the correction form with that item chosen. Member and claim decisions are shown read-only.
 */
export function FindingsPanel({
  checklist,
  lines,
  options,
  files,
  onOpenPage,
  caseId,
  canCorrect,
  onConfirm,
  confirming = false,
  confirmed,
  documentsOverridden = false,
}: {
  /** "✓ Right": the reviewer checked it against the document (SYSTEM_4 E5b); null when they can't. */
  onConfirm: ((items: string[]) => void) | null;
  /** A confirmation is being saved — the buttons wait (no double count). */
  confirming?: boolean;
  /** Items ("value:…" / "verdict:…") this reviewer already confirmed, with the value they confirmed. */
  confirmed: Map<string, unknown>;
  checklist: ChecklistItem[];
  /** A person overrode the document check: its failed / unsure findings are handled, not open. */
  documentsOverridden?: boolean;
  lines: AssessmentLine[];
  options: CorrectionOption[];
  files: ViewFile[];
  onOpenPage: (ref: PageRef) => void;
  caseId: string;
  /** Corrections allowed now and by this person: each finding offers Edit / Mark OK / Mark wrong in place. */
  canCorrect: boolean;
}) {
  const threshold = useConfidenceThreshold();
  // The value / verdict a "✓ Right" would confirm now (as the API's option.current); items read as nothing are skipped.
  const currentOf = (item: string) => options.find((o) => `${o.kind}:${o.item}` === item)?.current ?? null;
  const toConfirm = (f: Finding) => f.confirms.filter((item) => currentOf(item) != null);
  const isConfirmed = (f: Finding) => toConfirm(f).length > 0 && toConfirm(f).every((item) => confirmed.has(item) && confirmed.get(item) === currentOf(item));
  const [showPassed, setShowPassed] = useState(false);
  // Changes not saved yet, by where they were opened ("finding key", "finding key|item" or the option item): several at
  // once, saved together with "Save all and check again" (owner, 2026-10-20 — not one finding per pipeline run).
  const [drafts, setDrafts] = useState<Record<string, CorrectionDraft>>({});
  const openDraft = (key: string, option: CorrectionOption, passed?: boolean) => setDrafts((d) => ({ ...d, [key]: newDraft(option, passed) }));
  const closeDraft = (key: string) => setDrafts(({ [key]: _closed, ...rest }) => rest);
  // One draft per value or check: a value offered in two places (a finding and a rule check's ✎ Edit) opens once.
  const hasDraft = (option: CorrectionOption) => Object.values(drafts).some((d) => d.option.kind === option.kind && d.option.item === option.item);
  const draftForm = (key: string) => drafts[key] && (
    <InlineCorrection draft={drafts[key]} onChange={(draft) => setDrafts((d) => ({ ...d, [key]: draft }))} onCancel={() => closeDraft(key)} />
  );
  const pending = Object.values(drafts);
  const notReady = pending.filter((d) => draftProblem(d)).length;
  const queryClient = useQueryClient();
  const saveAll = useMutation({
    mutationFn: () => createCorrections(caseId, pending.map(draftItem)),
    onSuccess: () => {
      setDrafts({});
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  // Corrections no longer allowed (the case moved, someone else decided it): open changes can't be saved.
  useEffect(() => {
    if (!canCorrect) setDrafts({});
  }, [canCorrect]);
  // Unsaved changes: the browser asks before the tab is closed or reloaded.
  useEffect(() => {
    if (!pending.length) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);
  const optionOf = (item: string | null) => (item ? options.find((o) => `${o.kind}:${o.item}` === item) ?? null : null);
  const findings = buildFindings(checklist, options);
  const notChecked = findings.filter((f) => f.passed === null);
  const isUnsure = (f: Finding) => f.passed === true && f.confidence != null && f.confidence <= threshold;
  const open = findings.filter((f) => f.passed === false || isUnsure(f));
  const unsure = documentsOverridden ? [] : open.filter(isUnsure);
  const failed = documentsOverridden ? [] : open.filter((f) => f.passed === false);
  const handled = documentsOverridden ? open : [];
  const passed = findings.filter((f) => !open.includes(f) && !notChecked.includes(f));
  const decisions = lines.filter((l) => l.area === 'member' || l.area === 'claim');
  // Values claim preparation reads that are picked from a list (voucher type, type of patient): shown so a wrong one can
  // be corrected before the claim goes to IAS.
  const choiceValues = options.filter((o) => o.type === 'choice');
  // Open member findings, each marked OK on its own (not coverage: the whole-check override covers that).
  const memberFindings = options.filter((o) => o.kind === 'verdict' && o.item.startsWith('member:'));

  const row = (f: Finding) => {
    const ref = pageRef(f.page, files);
    return (
      <li key={f.key} className="py-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800">{f.label}</span>
          {f.value != null && <span className="text-slate-700">"{f.value}"</span>}
          {f.confidence != null && <ConfidenceBadge confidence={f.confidence} failed={f.passed === false} />}
        </div>
        {f.why && <p className="mt-0.5 text-xs text-slate-500">{f.why}</p>}
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {ref ? (
            <button onClick={() => onOpenPage(ref)} className="inline-flex items-center gap-1 text-ulink-teal-dark hover:underline">
              <FileText size={12} /> {f.page}
            </button>
          ) : (
            f.page && <span className="text-slate-400">{f.page} (file not on this case)</span>
          )}
          {isConfirmed(f) ? (
            <span className="text-ulink-teal-dark">✓ Confirmed by you</span>
          ) : (
            onConfirm && toConfirm(f).length > 0 && (
              <button disabled={confirming} onClick={() => onConfirm(toConfirm(f))} className="text-ulink-teal-dark hover:underline disabled:opacity-50">✓ Right</button>
            )
          )}
          {canCorrect && optionOf(f.correct) && !hasDraft(optionOf(f.correct)!) && (() => {
            const option = optionOf(f.correct)!;
            const action = (label: string, passed?: boolean) => (
              <button onClick={() => openDraft(f.key, option, passed)} className="text-ulink-orange-dark hover:underline">{label}</button>
            );
            if (option.kind === 'value') return action('✎ Edit');
            if (option.current === false) return action('Mark OK', true);
            return option.canFail ? action('Mark wrong', false) : null;
          })()}
        </div>
        {/* A failed or unsure rule check: fix the value it compared, right here (usually better than Mark OK — the
            corrected value is what goes to IAS). */}
        {canCorrect && f.edits?.length && open.includes(f) ? (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {f.edits.filter((item) => !hasDraft(optionOf(item)!)).map((item) => {
              const o = optionOf(item)!;
              return (
                <button key={item} onClick={() => openDraft(`${f.key}|${item}`, o)} className="text-ulink-orange-dark hover:underline">
                  ✎ Edit {o.label}{o.current != null ? ` (${typeof o.current === 'number' ? o.current.toLocaleString('en-US') : String(o.current)})` : ''}
                </button>
              );
            })}
          </div>
        ) : null}
        {draftForm(f.key)}
        {(f.edits ?? []).map((item) => <div key={item}>{draftForm(`${f.key}|${item}`)}</div>)}
      </li>
    );
  };
  const section = (title: string, items: Finding[], tone: string) =>
    items.length > 0 && (
      <section className="mb-4">
        <h3 className={clsx('mb-1 text-xs font-semibold uppercase tracking-wide', tone)}>{title} · {items.length}</h3>
        <ul className="divide-y divide-slate-900/5">{items.map(row)}</ul>
      </section>
    );

  return (
    <div>
      {findings.length === 0 && <p className="text-sm text-slate-500">The documents haven't been checked yet.</p>}
      {section('Unsure', unsure, 'text-amber-700')}
      {section('Failed', failed, 'text-red-700')}
      {section('Handled by a person (override)', handled, 'text-slate-500')}
      {section('Not checked (nothing to compare)', notChecked, 'text-slate-500')}
      {passed.length > 0 && (
        <section className="mb-4">
          <button onClick={() => setShowPassed((s) => !s)} aria-expanded={showPassed} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ulink-teal-dark">
            <ChevronDown size={14} className={clsx(showPassed && 'rotate-180')} /> Passed · {passed.length}
          </button>
          {showPassed && <ul className="divide-y divide-slate-900/5">{passed.map(row)}</ul>}
        </section>
      )}
      {memberFindings.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">Member findings · {memberFindings.length}</h3>
          <ul className="divide-y divide-slate-900/5">
            {memberFindings.map((o) => (
              <li key={o.item} className="py-2 text-sm">
                <span className="font-medium text-slate-800">{o.label}</span>
                {o.note && <p className="mt-0.5 text-xs text-slate-500">{o.note}</p>}
                {canCorrect && !hasDraft(o) && (
                  <button onClick={() => openDraft(o.item, o, true)} className="mt-1 text-xs text-ulink-orange-dark hover:underline">Mark OK</button>
                )}
                {draftForm(o.item)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {choiceValues.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Used for the IAS claim</h3>
          <ul className="divide-y divide-slate-900/5">
            {choiceValues.map((o) => (
              <li key={o.item} className="py-2 text-sm">
                <span className="font-medium text-slate-800">{o.label}</span>{' '}
                <span className="text-slate-700">"{o.current == null ? 'not read' : String(o.current)}"</span>
                {canCorrect && !hasDraft(o) && (
                  <button onClick={() => openDraft(o.item, o)} className="ml-3 text-xs text-ulink-orange-dark hover:underline">✎ Edit</button>
                )}
                {draftForm(o.item)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {decisions.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Member and claim</h3>
          <ul className="divide-y divide-slate-900/5">
            {decisions.map((l) => (
              <li key={`${l.area}-${l.decision}`} className="py-2 text-sm">
                <span className="font-medium text-slate-800">{l.decision}</span>: {l.result}
                {l.confidence != null && <span className="ml-2"><ConfidenceBadge confidence={l.confidence} failed={l.status === 'issue'} /></span>}
                <p className="mt-0.5 text-xs text-slate-500">{l.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pending.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ulink-orange/30 bg-white px-3 py-2 shadow-glass">
          <p className="text-sm text-slate-700">
            {pending.length} change{pending.length === 1 ? '' : 's'} not saved{notReady ? ` — ${notReady} not ready yet` : ''}.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={saveAll.isPending} onClick={() => setDrafts({})}>Discard all</Button>
            <Button disabled={notReady > 0 || saveAll.isPending} onClick={() => saveAll.mutate()}>{saveAll.isPending ? 'Saving…' : 'Save all and check again'}</Button>
          </div>
          {saveAll.isError && <p className="w-full text-sm text-red-600">{(saveAll.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
