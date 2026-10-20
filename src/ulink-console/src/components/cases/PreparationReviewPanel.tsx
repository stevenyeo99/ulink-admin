import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { choosePreparation, searchDiagnosis } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { BenefitCandidate, CaseDetail, DiagnosisCandidate } from '../../types/case';

const selectClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';
const percent = (c: number | null | undefined) => (typeof c === 'number' ? ` (${Math.round(c * 100)}%)` : '');
const named = (code: string | null | undefined, desc: string | null | undefined) => (code ? `${code}${desc ? ` ${desc}` : ''}` : '(none)');

type Choice = { type: string; head: string };
// A voucher's manual rejection as typed; removed: no rejection on this voucher.
type Rejection = { amount: string; remark: string; removed: boolean };
const money = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

/**
 * Step 2 of 2 — the claim preparation stop (API_PREPARATION_REVIEW, ulink-api preparationController.js): the AI wasn't
 * sure of the diagnosis code or of a voucher's benefit. What needs a person is open; what the AI was sure of is folded
 * and can still be changed. A benefit is a type, then a head under it, from the member's own plan; vouchers on one claim
 * may have different types. With vitamins / supplements on the claim, each voucher's manual rejection (IAS man_rej set 1:
 * amount and remark) can be edited, removed or added on any voucher — the vouchers the AI was unsure of must be set.
 * One comment, one save; claim preparation then runs again with these. Super admin.
 */
export function PreparationReviewPanel({ caseRecord }: { caseRecord: CaseDetail }) {
  const queryClient = useQueryClient();
  const meta = caseRecord.claimPrepMeta;
  const review = meta?.review ?? { diagnosis: false, vouchers: [] };
  const flaggedRejections = review.rejections ?? [];
  const diagnosis = meta?.diagnosis;
  const aiCode = diagnosis?.pick as DiagnosisCandidate | null | undefined;
  const lines = meta?.lines ?? [];
  // The member's plan: every line carries the same candidate list (benefitPicker.js).
  const plan = (lines.find((l) => l.candidates?.length)?.candidates ?? []) as BenefitCandidate[];
  const types = plan.filter((c, i) => plan.findIndex((o) => o.type === c.type) === i);
  const headsOf = (type: string) => plan.filter((c) => c.type === type && c.head);

  const [code, setCode] = useState('');
  const [changeDiagnosis, setChangeDiagnosis] = useState(review.diagnosis);
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [showSure, setShowSure] = useState(false);
  const [comment, setComment] = useState('');
  // Flagged vouchers start open with the AI's rejection, if any, to check.
  const [rejections, setRejections] = useState<Record<number, Rejection>>(() => Object.fromEntries(flaggedRejections.map((i) => {
    const ai = meta?.lines[i]?.vitamin?.ai;
    return [i, { amount: ai?.vitamin_exclude_amount != null ? String(ai.vitamin_exclude_amount) : '', remark: ai?.vitamin_remark ?? '', removed: false }];
  })));
  const search = useMutation({ mutationFn: () => searchDiagnosis(caseRecord.id, text.trim()) });
  const save = useMutation({
    mutationFn: () =>
      choosePreparation(caseRecord.id, {
        ...(code ? { diagCode: code } : {}),
        benefits: Object.entries(choices).map(([i, c]) => ({ voucher: Number(i), benefitType: c.type, benefitHead: c.head || null })),
        rejections: Object.entries(rejections).map(([i, r]) => ({ voucher: Number(i), amount: r.removed ? null : Number(r.amount), remark: r.removed ? null : r.remark.trim() })),
        comment: comment.trim(),
      }),
    onSuccess: () => {
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (caseRecord.currentStatus !== 'API_PREPARATION_REVIEW' || !meta) return null;

  const flagged = review.vouchers;
  const sure = lines.map((_, i) => i).filter((i) => !flagged.includes(i));
  const setChoice = (i: number, c: Choice | null) => setChoices(({ [i]: _old, ...rest }) => (c ? { ...rest, [i]: c } : rest));
  // A voucher choice is complete with a type, and a head when the plan has heads for that type.
  const complete = (c?: Choice) => Boolean(c?.type) && (!headsOf(c!.type).length || Boolean(c!.head));
  const setRejection = (i: number, r: Rejection | null) => setRejections(({ [i]: _old, ...rest }) => (r ? { ...rest, [i]: r } : rest));
  // A rejection is complete when removed, or with an amount above 0 up to the voucher's, and a remark.
  const rejectionProblem = (i: number, r: Rejection) => {
    if (r.removed) return null;
    const amount = Number(r.amount);
    if (!r.amount.trim() || !Number.isFinite(amount) || amount <= 0) return 'an amount above 0';
    if (typeof lines[i]?.subtotal === 'number' && amount > lines[i].subtotal!) return `at most ${money(lines[i].subtotal)}`;
    return r.remark.trim() ? null : 'a remark';
  };
  const missing = [
    ...(review.diagnosis && !code ? ['the diagnosis code'] : []),
    ...flagged.filter((i) => !complete(choices[i])).map((i) => `voucher ${i + 1}`),
    ...Object.entries(choices).filter(([, c]) => !complete(c)).map(([i]) => `voucher ${Number(i) + 1}`),
    ...Object.entries(rejections).map(([i, r]) => [i, rejectionProblem(Number(i), r)] as const).filter(([, p]) => p)
      .map(([i, p]) => `voucher ${Number(i) + 1} rejection (${p})`),
  ].filter((m, i, all) => all.indexOf(m) === i);
  const changed = Boolean(code) || Object.keys(choices).length > 0 || Object.keys(rejections).length > 0;
  // Shown only on a claim with vitamins / supplements: the AI found some, one was rejected, or the AI was unsure.
  const vitaminCase = flaggedRejections.length > 0 || lines.some((l) => l.vitamin?.found === true || l.vitamin?.rejection);
  const rejectionRows = lines.map((_, i) => i).filter((i) => rejections[i] || lines[i].vitamin?.rejection);
  const addable = lines.map((_, i) => i).filter((i) => !rejectionRows.includes(i));

  const codes = [aiCode, ...((diagnosis?.candidates ?? []) as DiagnosisCandidate[]), ...(search.data?.candidates ?? [])]
    .filter((c): c is DiagnosisCandidate => Boolean(c?.diagCode))
    .filter((c, i, all) => all.findIndex((o) => o.diagCode === c.diagCode) === i);

  const voucherRow = (i: number) => {
    const line = lines[i];
    const ai = line.pick as { benefitType?: string; benefitHead?: string | null } | null;
    const c = choices[i];
    const aiName = ai?.benefitType
      ? `${named(ai.benefitType, plan.find((p) => p.type === ai.benefitType)?.typeDesc)} / ${named(ai.benefitHead, plan.find((p) => p.type === ai.benefitType && p.head === ai.benefitHead)?.headDesc)}`
      : 'none';
    const firstChosen = Object.entries(choices).find(([j, other]) => Number(j) !== i && complete(other));
    return (
      <li key={i} className="py-2 text-sm">
        <p className="text-slate-800">
          <span className="font-medium">Voucher {i + 1}</span>
          {line.voucherType ? ` · ${line.voucherType}` : ''}
          {line.subtotal != null ? ` · ${line.subtotal.toLocaleString('en-US')}` : ''}
          <span className="text-slate-500"> — AI: {aiName}{percent(line.confidence)}</span>
        </p>
        {line.reason && <p className="mt-0.5 text-xs text-slate-500">AI: {line.reason}</p>}
        {c ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select value={c.type} onChange={(e) => setChoice(i, { type: e.target.value, head: '' })} className={selectClass}>
              <option value="">Benefit type</option>
              {types.map((t) => <option key={t.type} value={t.type}>{named(t.type, t.typeDesc)}</option>)}
            </select>
            <select value={c.head} disabled={!c.type || !headsOf(c.type).length} onChange={(e) => setChoice(i, { ...c, head: e.target.value })} className={selectClass}>
              <option value="">{c.type && !headsOf(c.type).length ? 'No head for this type' : 'Benefit head'}</option>
              {headsOf(c.type).map((h) => <option key={h.head!} value={h.head!}>{named(h.head, h.headDesc)}</option>)}
            </select>
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {!c && (
            <button onClick={() => setChoice(i, { type: ai?.benefitType ?? '', head: ai?.benefitHead ?? '' })} className="text-ulink-orange-dark hover:underline">
              {flagged.includes(i) ? 'Choose' : 'Change'}
            </button>
          )}
          {firstChosen && (
            <button onClick={() => setChoice(i, firstChosen[1])} className="text-ulink-orange-dark hover:underline">Same as voucher {Number(firstChosen[0]) + 1}</button>
          )}
          {c && !flagged.includes(i) && <button onClick={() => setChoice(i, null)} className="text-slate-500 hover:underline">Keep the AI's</button>}
        </div>
      </li>
    );
  };

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Stethoscope size={15} /> Step 2 of 2: check the claim preparation</h2>
      <p className="mt-1 text-sm text-slate-600">
        The documents are done. Check what the AI wasn't sure of below; the revision is prepared with your choices and only then goes to IAS.
      </p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnosis code</h3>
      {!changeDiagnosis ? (
        <p className="mt-1 text-sm text-slate-700">
          {named(aiCode?.diagCode, aiCode?.diagDesc)}{percent(diagnosis?.confidence)}{' '}
          <button onClick={() => setChangeDiagnosis(true)} className="text-xs text-ulink-orange-dark hover:underline">Change</button>
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            The AI read “{diagnosis?.text || 'no diagnosis text'}” and {diagnosis?.defaulted ? 'found no confident match, so it used' : 'picked'}{' '}
            <span className="font-mono">{aiCode?.diagCode ?? 'none'}</span>{percent(diagnosis?.confidence)}.{diagnosis?.reason ? ` AI: ${diagnosis.reason}` : ''}
          </p>
          <fieldset className="mt-2 space-y-1">
            {codes.map((c) => (
              <label key={c.diagCode} className="flex items-start gap-2 text-sm text-slate-700">
                <input type="radio" name="diagCode" value={c.diagCode} checked={code === c.diagCode} onChange={() => setCode(c.diagCode)} className="mt-1" />
                <span><span className="font-mono">{c.diagCode}</span> {c.diagDesc}{c.diagCode === aiCode?.diagCode ? <span className="text-slate-500"> — the AI's code</span> : null}</span>
              </label>
            ))}
          </fieldset>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) search.mutate(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search ICD-10, e.g. chronic gingivitis" className={`flex-1 ${selectClass}`} />
            <Button type="submit" variant="ghost" disabled={text.trim().length < 3 || search.isPending}>{search.isPending ? 'Searching…' : 'Search'}</Button>
          </form>
          {search.isError && <p className="mt-2 text-sm text-red-600">{(search.error as Error).message}</p>}
          {!review.diagnosis && (
            <button onClick={() => { setCode(''); setChangeDiagnosis(false); }} className="mt-1 text-xs text-slate-500 hover:underline">Keep the AI's code</button>
          )}
        </>
      )}

      {lines.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Benefit per voucher</h3>
          {flagged.length > 0 && <ul className="divide-y divide-slate-900/5">{flagged.map(voucherRow)}</ul>}
          {sure.length > 0 && (
            <>
              <button onClick={() => setShowSure((s) => !s)} aria-expanded={showSure} className="mt-1 text-xs text-ulink-teal-dark hover:underline">
                {showSure ? 'Hide' : 'Show'} {sure.length} voucher{sure.length === 1 ? '' : 's'} the AI was sure of
              </button>
              {showSure && <ul className="divide-y divide-slate-900/5">{sure.map(voucherRow)}</ul>}
            </>
          )}
        </>
      )}

      {vitaminCase && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Manual rejection (vitamins / supplements)</h3>
          {flaggedRejections.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">The AI was not sure of voucher {flaggedRejections.map((i) => i + 1).join(', ')}: check the bill and set the rejection, or No rejection.</p>
          )}
          <ul className="divide-y divide-slate-900/5">
            {rejectionRows.map((i) => {
              const line = lines[i];
              const r = rejections[i];
              const sent = line.vitamin?.rejection;
              return (
                <li key={i} className="py-2 text-sm">
                  <p className="text-slate-800">
                    <span className="font-medium">Voucher {i + 1}</span>{line.voucherType ? ` · ${line.voucherType}` : ''} · {money(line.subtotal)}
                    {!r && sent && <span className="text-slate-500"> — {line.vitamin?.chosen ? 'chosen' : 'AI'}: {money(sent.vitamin_exclude_amount)} MMK</span>}
                  </p>
                  {!r && sent?.vitamin_remark && <p className="mt-0.5 text-xs text-slate-500">{sent.vitamin_remark}</p>}
                  {r && !r.removed && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
                      <input
                        inputMode="numeric"
                        value={r.amount}
                        onChange={(e) => setRejection(i, { ...r, amount: e.target.value.replace(/[^0-9.]/g, '') })}
                        placeholder="Amount"
                        aria-label={`Voucher ${i + 1} rejected amount`}
                        className={selectClass}
                      />
                      <input
                        value={r.remark}
                        onChange={(e) => setRejection(i, { ...r, remark: e.target.value })}
                        placeholder="e.g. Vit C - 10,000 MMK is not covered due to supplement."
                        aria-label={`Voucher ${i + 1} remark`}
                        maxLength={500}
                        className={selectClass}
                      />
                    </div>
                  )}
                  {r?.removed && <p className="mt-0.5 text-xs text-slate-500">No rejection on this voucher.</p>}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    {(!r || r.removed) && (
                      <button
                        onClick={() => setRejection(i, { amount: sent?.vitamin_exclude_amount != null ? String(sent.vitamin_exclude_amount) : '', remark: sent?.vitamin_remark ?? '', removed: false })}
                        className="text-ulink-orange-dark hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    {/* Added on a voucher with no rejection: Remove takes the row away; otherwise No rejection is a decision. */}
                    {!r?.removed && (sent || flaggedRejections.includes(i)) && (
                      <button onClick={() => setRejection(i, { amount: '', remark: '', removed: true })} className="text-ulink-orange-dark hover:underline">No rejection</button>
                    )}
                    {r && !flaggedRejections.includes(i) && (
                      <button onClick={() => setRejection(i, null)} className="text-slate-500 hover:underline">{sent ? 'Keep as it was' : 'Remove'}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {addable.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setRejection(Number(e.target.value), { amount: '', remark: '', removed: false })}
              aria-label="Add a rejection to a voucher"
              className={`mt-2 sm:w-64 ${selectClass}`}
            >
              <option value="">+ Add rejection to a voucher</option>
              {addable.map((i) => <option key={i} value={i}>Voucher {i + 1}{lines[i].voucherType ? ` · ${lines[i].voucherType}` : ''} · {money(lines[i].subtotal)}</option>)}
            </select>
          )}
        </>
      )}

      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Comment — why these</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="e.g. The dental slip says chronic gingivitis; the pharmacy bill is outpatient medicine."
          className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        />
      </label>
      <p className="mt-2 text-xs text-slate-500">STP is worked out again with these choices: a benefit change can move the claim in or out of STP.</p>
      {missing.length > 0 && <p className="mt-1 text-xs text-amber-700">Still to choose: {missing.join(', ')}.</p>}
      {save.isError && <p className="mt-2 text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="mt-3">
        <Button disabled={missing.length > 0 || !changed || comment.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save and prepare the revision'}
        </Button>
      </div>
    </section>
  );
}
