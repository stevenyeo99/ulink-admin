import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, Check, ChevronDown, FileText, Pencil, X } from 'lucide-react';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { useConfidenceThreshold } from '../../hooks/useConfidenceThreshold';
import type { AssessmentLine, ChecklistItem, CorrectionOption, FieldRead, WrongStep } from '../../types/case';
import { pageRef, type PageRef, type ViewFile } from '../../lib/caseFiles';
import { InlineCorrection } from './InlineCorrection';
import { CONFIRM_QUICK_REASON, CONTRACT_EXCLUSION_ITEM, isBypassItem, draftItem, draftLine, draftProblem, newDraft, reasonProblem, type CorrectionDraft, type PendingCorrections } from '../../lib/correctionDraft';
import { createCorrections } from '../../api/casesApi';
import { getAiChecklist, type AiCheck } from '../../api/aiChecklistApi';
import { Button } from '../common/Button';

/** One thing the AI decided or read, as the review workspace lists it. correct: the correction item ("value:…" / "verdict:…"). */
interface Finding {
  key: string;
  /** The check's code (AI checklist catalog), for What to do and the risk; null for a value the AI read. */
  code?: string | null;
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
    .map((c) => {
      const edits = (c.editItems ?? []).map((item) => `value:${item}`).filter((item) => canCorrect(item));
      return {
        key: `check-${c.code}`, code: c.code ?? null, label: c.label, passed: c.passed, confidence: c.confidence ?? null,
        why: c.note ?? c.reason ?? null, page: pageOf(c.usedFields), correct: canCorrect(`verdict:${c.code}`),
        // A check with no verdict of its own (the values check): "✓ Right" confirms the values it named, as read.
        confirms: canCorrect(`verdict:${c.code}`) ? [`verdict:${c.code}`] : edits,
        edits,
      };
    });
  if (mandatory.length) {
    checks.push({
      key: 'check-mandatory', code: 'MISSING_MANDATORY_FIELD', label: 'Mandatory fields', passed: missing.length === 0, confidence: null,
      why: missing.length ? `Not found: ${missing.join('; ')}` : `All ${mandatory.length} found.`, page: null, correct: null, confirms: [],
      // A missing field a person can correct (an "unclear" reading the document shows elsewhere): ✎ Edit on this row.
      edits: mandatory.filter((c) => c.passed === false).flatMap((c) => c.editItems ?? []).map((item) => `value:${item}`).filter((item) => canCorrect(item)),
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
  onPendingChange,
  saveBelow = false,
  onSaved,
}: {
  /** After a save: what happened, for the page to show. */
  onSaved?: (message: string) => void;
  /** The open changes, each time they change — for a save elsewhere on the page (the claim preparation stop). */
  onPendingChange?: (pending: PendingCorrections) => void;
  /** The changes are saved with the claim preparation below, in one save: no save button here. */
  saveBelow?: boolean;
  /** Mark OK on an unsure value: the reviewer checked it against the document (SYSTEM_4 E5b), with a reason; null when they can't. */
  onConfirm: ((items: string[], reason: string) => Promise<boolean>) | null;
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
  // Checks that had nothing to compare: nothing to do, so folded like the passed ones.
  const [showNotChecked, setShowNotChecked] = useState(false);
  // Changes not saved yet, by where they were opened ("finding key", "finding key|item" or the option item): several at
  // once, saved together with "Save all and check again" (owner, 2026-10-20 — not one finding per pipeline run).
  const [drafts, setDrafts] = useState<Record<string, CorrectionDraft>>({});
  const openDraft = (key: string, option: CorrectionOption, passed?: boolean, wrongStep?: WrongStep) => setDrafts((d) => ({ ...d, [key]: newDraft(option, passed, wrongStep) }));
  const closeDraft = (key: string) => {
    setDrafts(({ [key]: _closed, ...rest }) => rest);
    setDone(({ [key]: _done, ...rest }) => rest);
  };
  // Decision cards the reviewer folded with Done (SYSTEM_5 review actions): one line with Change and Undo.
  const [done, setDone] = useState<Record<string, boolean>>({});
  // Mark OK on an unsure value: saved at once (learning data), so its reason box lives here, not in a draft.
  const [confirmReason, setConfirmReason] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  // What it checks, what you can do and the risk if you mark it OK (AI checklist catalog). Super admin only, like the
  // corrections: without it the findings still show, with no What to do line.
  const { data: checklistCatalog } = useQuery({ queryKey: ['ai-checklist'], queryFn: getAiChecklist, enabled: canCorrect, staleTime: 5 * 60_000 });
  const checkOf = (code?: string | null): AiCheck | undefined => (code ? checklistCatalog?.checks.find((c) => c.code === code || c.item === code) : undefined);
  // One draft per value or check: a value offered in two places (a finding and a rule check's ✎ Edit) opens once.
  const hasDraft = (option: CorrectionOption) => Object.values(drafts).some((d) => d.option.kind === option.kind && d.option.item === option.item);
  const draftForm = (key: string, risk?: string | null) => drafts[key] && (
    <InlineCorrection
      draft={drafts[key]}
      onChange={(draft) => setDrafts((d) => ({ ...d, [key]: draft }))}
      onUndo={() => closeDraft(key)}
      risk={risk}
      done={!!done[key]}
      onDone={(isDone) => setDone((d) => ({ ...d, [key]: isDone }))}
    />
  );
  const pending = Object.values(drafts);
  const notReady = pending.filter((d) => draftProblem(d)).length;
  const queryClient = useQueryClient();
  const saveAll = useMutation({
    mutationFn: () => createCorrections(caseId, pending.map(draftItem)),
    onSuccess: () => {
      setDrafts({});
      setDone({});
      setReviewOpen(false);
      onSaved?.('Saved. The case is checked again on the next pipeline run.');
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  useEffect(() => {
    onPendingChange?.({ items: pending.map(draftItem), notReady, lines: pending.map(draftLine) });
    // pending and notReady are derived from drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, onPendingChange]);
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

  // What to do (SYSTEM_5 review actions 4.0): from the catalog for a check; for a value the AI was unsure of, the same
  // plain advice every time.
  const whatToDo = (f: Finding) => {
    const check = checkOf(f.code);
    if (check) return { does: check.does, can: check.reviewerCan.join('. '), risk: check.riskIfOk };
    if (f.code == null && isUnsure(f)) {
      return {
        does: 'The AI was not sure it read this value right.',
        can: 'Open the page. If the value is right, Mark OK. If it is wrong, Revise it.',
        risk: 'A misread value may go to IAS, or a check may use the wrong value.',
      };
    }
    return null;
  };
  // Decided: a complete draft (reason long enough) or a Mark OK already saved — an empty card is not a decision.
  const hasDecision = (f: Finding) => Object.entries(drafts).some(([k, d]) => (k === f.key || k.startsWith(`${f.key}|`)) && !draftProblem(d)) || isConfirmed(f);
  const memberDecided = (o: CorrectionOption) => !!drafts[o.item] && !draftProblem(drafts[o.item]);

  // A failed or unsure finding (SYSTEM_5 review actions 4.1): a card with "Needs your decision", What to do, and clear
  // buttons — Mark OK and Revise first.
  const openRow = (f: Finding) => {
    const ref = pageRef(f.page, files);
    const option = optionOf(f.correct);
    const guide = whatToDo(f);
    const decided = hasDecision(f);
    const confirmItems = toConfirm(f);
    const confirmOpen = confirmReason[f.key] != null;
    const canMarkOk = canCorrect && option?.kind === 'verdict' && option.current === false && !hasDraft(option);
    // Mark OK on an unsure value (saved at once) — never on a failed check, whose Mark OK is the draft above.
    const canConfirm = isUnsure(f) && !(option?.kind === 'verdict' && option.current === false) && !(option && hasDraft(option))
      && onConfirm && confirmItems.length > 0 && !isConfirmed(f) && !confirmOpen;
    const revise = canCorrect ? [
      ...(option?.kind === 'value' && !hasDraft(option) ? [{ key: f.key, o: option, label: 'Revise' }] : []),
      ...(f.edits ?? []).map((item) => optionOf(item)!).filter((o) => !hasDraft(o)).map((o) => ({
        key: `${f.key}|${o.kind}:${o.item}`, o,
        label: `Revise ${o.label}${o.current != null ? ` (${typeof o.current === 'number' ? o.current.toLocaleString('en-US') : String(o.current)})` : ''}`,
      })),
    ] : [];
    const canMarkWrong = canCorrect && option?.kind === 'verdict' && option.current === true && option.canFail && !hasDraft(option);
    return (
      <li key={f.key} className={clsx('my-2 rounded-lg border-l-4 bg-white/80 p-3 text-sm shadow-glass', decided ? 'border-ulink-teal' : f.passed === false ? 'border-red-500' : 'border-amber-500')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {canCorrect && (decided
            ? <span className="rounded-full bg-ulink-teal/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ulink-teal-dark">Decided</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800"><AlertTriangle size={12} /> Needs your decision</span>)}
          <span className="font-medium text-slate-800">{f.label}</span>
          {f.value != null && <span className="text-slate-700">"{f.value}"</span>}
          {f.confidence != null && <ConfidenceBadge confidence={f.confidence} failed={f.passed === false} />}
        </div>
        {f.why && <p className="mt-1 text-xs text-slate-600">{f.why}</p>}
        {guide && (
          <details className="mt-1 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-ulink-teal-dark">What to do</summary>
            <dl className="mt-1 space-y-1 pl-3">
              <div><dt className="inline font-semibold">What it checks: </dt><dd className="inline">{guide.does}</dd></div>
              {guide.can && <div><dt className="inline font-semibold">What you can do: </dt><dd className="inline">{guide.can}</dd></div>}
              {guide.risk && <div><dt className="inline font-semibold">Risk if you mark it OK: </dt><dd className="inline">{guide.risk}</dd></div>}
            </dl>
          </details>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {canMarkOk && (
            <Button size="sm" aria-label={`Mark OK: ${f.label}`} onClick={() => openDraft(f.key, option!, true)} className="border border-ulink-teal bg-white text-ulink-teal-dark shadow-none hover:bg-ulink-teal/10">
              <Check size={14} /> Mark OK
            </Button>
          )}
          {canConfirm && (
            <Button size="sm" aria-label={`Mark OK: ${f.label}`} disabled={confirming} onClick={() => setConfirmReason((r) => ({ ...r, [f.key]: CONFIRM_QUICK_REASON }))} className="border border-ulink-teal bg-white text-ulink-teal-dark shadow-none hover:bg-ulink-teal/10">
              <Check size={14} /> Mark OK
            </Button>
          )}
          {isConfirmed(f) && <span className="inline-flex items-center gap-1 text-ulink-teal-dark"><Check size={14} /> Marked OK by you</span>}
          {revise.map(({ key, o, label }) => (
            <Button key={key} size="sm" aria-label={`${label}: ${f.label}`} onClick={() => openDraft(key, o)} className="border border-ulink-orange bg-white text-ulink-orange-dark shadow-none hover:bg-ulink-orange/10">
              <Pencil size={14} /> {label}
            </Button>
          ))}
          {canMarkWrong && (
            <Button size="sm" variant="ghost" aria-label={`Mark wrong: ${f.label}`} onClick={() => openDraft(f.key, option!, false)} className="border border-red-300 text-red-700 shadow-none">
              <X size={14} /> Mark wrong
            </Button>
          )}
          {ref ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenPage(ref)} className="shadow-none"><FileText size={14} /> View {f.page}</Button>
          ) : (
            f.page && <span className="self-center text-xs text-slate-400">{f.page} (file not on this case)</span>
          )}
        </div>
        {confirmOpen && (
          <div className="mt-2 rounded-lg border border-ulink-teal/40 bg-ulink-teal/5 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-800">Mark OK: {f.label}</p>
            {guide?.risk && <p className="mb-2 text-xs text-amber-800"><span className="font-semibold">Risk if you mark it OK:</span> {guide.risk}</p>}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Reason (required)</span>
              <textarea
                value={confirmReason[f.key]}
                onChange={(e) => setConfirmReason((r) => ({ ...r, [f.key]: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={confirming || !!reasonProblem(confirmReason[f.key])}
                onClick={async () => {
                  // Kept until the save worked: on an error the reviewer's reason is still there.
                  if (await onConfirm!(confirmItems, confirmReason[f.key].trim())) setConfirmReason(({ [f.key]: _sent, ...rest }) => rest);
                }}
              >
                <Check size={14} /> Mark OK
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReason(({ [f.key]: _closed, ...rest }) => rest)}>Cancel</Button>
              <span className="text-xs text-slate-500">{reasonProblem(confirmReason[f.key]) ?? 'Saved at once. It does not move the case by itself.'}</span>
            </div>
          </div>
        )}
        {draftForm(f.key, guide?.risk)}
        {(f.edits ?? []).map((item) => <div key={item}>{draftForm(`${f.key}|${item}`)}</div>)}
      </li>
    );
  };

  const row = (f: Finding) => {
    if (open.includes(f) && !documentsOverridden) return openRow(f);
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
          {/* A passed line needs no Mark OK: every Mark OK is on an open finding, with a reason (SYSTEM_5 review actions). */}
          {isConfirmed(f) && <span className="text-ulink-teal-dark">✓ Marked OK by you</span>}
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
  const needDecision = unsure.length + failed.length + memberFindings.length;
  const decidedCount = [...unsure, ...failed].filter(hasDecision).length + memberFindings.filter(memberDecided).length;
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
      {findings.length > 0 && !canCorrect && <p className="mb-3 text-xs text-slate-500">Corrections are closed at this step.</p>}
      {canCorrect && needDecision > 0 && (
        <p className={clsx('mb-3 rounded-lg px-3 py-2 text-sm font-medium', decidedCount >= needDecision ? 'bg-ulink-teal/10 text-ulink-teal-dark' : 'bg-amber-50 text-amber-800')}>
          {needDecision} finding{needDecision === 1 ? '' : 's'} need{needDecision === 1 ? 's' : ''} your decision · {decidedCount} decided
        </p>
      )}
      {section('Unsure', unsure, 'text-amber-700')}
      {section('Failed', failed, 'text-red-700')}
      {section('Handled by a person (override)', handled, 'text-slate-500')}
      {notChecked.length > 0 && (
        <section className="mb-4">
          <button onClick={() => setShowNotChecked((s) => !s)} aria-expanded={showNotChecked} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <ChevronDown size={14} className={clsx(showNotChecked && 'rotate-180')} /> Not checked (nothing to compare, or turned off) · {notChecked.length}
          </button>
          {showNotChecked && <ul className="divide-y divide-slate-900/5">{notChecked.map(row)}</ul>}
        </section>
      )}
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
            {memberFindings.map((o) => {
              const check = checkOf(o.item);
              const okButton = 'border border-ulink-teal bg-white text-ulink-teal-dark shadow-none hover:bg-ulink-teal/10';
              return (
                <li key={o.item} className={clsx('my-2 rounded-lg border-l-4 bg-white/80 p-3 text-sm shadow-glass', memberDecided(o) ? 'border-ulink-teal' : 'border-red-500')}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {canCorrect && (memberDecided(o)
                      ? <span className="rounded-full bg-ulink-teal/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ulink-teal-dark">Decided</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800"><AlertTriangle size={12} /> Needs your decision</span>)}
                    <span className="font-medium text-slate-800">{o.label}</span>
                  </div>
                  {o.note && <p className="mt-1 text-xs text-slate-600">{o.note}</p>}
                  {check && (
                    <details className="mt-1 text-xs text-slate-600">
                      <summary className="cursor-pointer font-medium text-ulink-teal-dark">What to do</summary>
                      <dl className="mt-1 space-y-1 pl-3">
                        <div><dt className="inline font-semibold">What it checks: </dt><dd className="inline">{check.does}</dd></div>
                        <div><dt className="inline font-semibold">What you can do: </dt><dd className="inline">{check.reviewerCan.join('. ')}</dd></div>
                        {check.riskIfOk && <div><dt className="inline font-semibold">Risk if you mark it OK: </dt><dd className="inline">{check.riskIfOk}</dd></div>}
                      </dl>
                    </details>
                  )}
                  {canCorrect && !hasDraft(o) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {o.item === CONTRACT_EXCLUSION_ITEM ? (
                        // A policy contract exclusion (SYSTEM_5): the reviewer reads the clause, the confidence and the
                        // AI's reason above, then answers — both with a reason.
                        <>
                          <Button size="sm" onClick={() => openDraft(o.item, o, true, 'check')} className={okButton}><Check size={14} /> Does not apply</Button>
                          <Button size="sm" onClick={() => openDraft(o.item, o, true, 'exception')} className="border border-ulink-orange bg-white text-ulink-orange-dark shadow-none hover:bg-ulink-orange/10">Let it go on (no STP)</Button>
                        </>
                      ) : (
                        // A short balance or an exclusion in IAS (SYSTEM_5): the only action is a bypass with a reason.
                        <Button size="sm" aria-label={`${isBypassItem(o.item) ? 'Bypass' : 'Mark OK'}: ${o.label}`} onClick={() => openDraft(o.item, o, true)} className={okButton}>
                          <Check size={14} /> {isBypassItem(o.item) ? 'Bypass' : 'Mark OK'}
                        </Button>
                      )}
                    </div>
                  )}
                  {draftForm(o.item, check?.riskIfOk)}
                </li>
              );
            })}
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
            {pending.length - notReady} decision{pending.length - notReady === 1 ? '' : 's'} ready{notReady ? ` · ${notReady} not complete` : ''}.
            {saveBelow && ' Saved with the claim preparation below, in one save.'}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={saveAll.isPending} onClick={() => { setDrafts({}); setDone({}); }}>Discard all</Button>
            {saveBelow ? (
              <Button onClick={() => document.getElementById('preparation-save')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Go to save</Button>
            ) : (
              <AlertDialog.Root open={reviewOpen} onOpenChange={setReviewOpen}>
                <AlertDialog.Trigger asChild>
                  <Button disabled={notReady > 0 || saveAll.isPending}>Review and save</Button>
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
                  <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl2 bg-white p-5 shadow-glass">
                    <AlertDialog.Title className="text-sm font-semibold text-slate-900">Save {pending.length} decision{pending.length === 1 ? '' : 's'}?</AlertDialog.Title>
                    <AlertDialog.Description asChild>
                      <div className="mt-2 text-sm text-slate-600">
                        <ul className="list-disc space-y-1 pl-5">{pending.map((d) => <li key={`${d.option.kind}:${d.option.item}`}>{draftLine(d)}</li>)}</ul>
                        <p className="mt-3">The case is checked again on the next pipeline run. Each decision is logged with your name and reason.</p>
                      </div>
                    </AlertDialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialog.Cancel asChild><Button variant="ghost">Back</Button></AlertDialog.Cancel>
                      <Button disabled={saveAll.isPending} onClick={() => saveAll.mutate()}>{saveAll.isPending ? 'Saving…' : 'Save all and check again'}</Button>
                    </div>
                    {saveAll.isError && <p className="mt-3 text-sm text-red-600">{(saveAll.error as Error).message}</p>}
                  </AlertDialog.Content>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            )}
          </div>
          {saveAll.isError && <p className="w-full text-sm text-red-600">{(saveAll.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
