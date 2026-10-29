import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { chooseBenefit, createCorrections } from '../../api/casesApi';
import type { PendingCorrections } from '../../lib/correctionDraft';
import { Button } from '../common/Button';
import { ReasonText } from '../common/ReasonText';
import { QuickReasons } from '../review/QuickReasons';
import { reasonProblem } from '../../lib/correctionDraft';
import type { BenefitCandidate, CaseDetail } from '../../types/case';

const selectClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';
const money = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
const percent = (c: number | null | undefined) => (typeof c === 'number' ? ` (${Math.round(c * 100)}%)` : '');
type Choice = { type: string; head: string };

/**
 * "Choose the benefit" (SYSTEM_5 member balance phase C, ulink-api benefitController.js): the member check stopped
 * because the AI wasn't sure of a voucher's benefit head (BENEFIT_REVIEW / API_BENEFIT_REVIEW). A person chooses it from
 * the member's own plan; the member check then runs again and checks the balance with it, before the documents. A
 * misread voucher amount is corrected with the review page's ✎ Edit and saved with this, in one save. Super admin.
 */
export function BenefitReviewPanel({ caseRecord, corrections, onSaved }: { caseRecord: CaseDetail; corrections?: PendingCorrections; onSaved?: (message: string) => void }) {
  const queryClient = useQueryClient();
  const balance = caseRecord.memberVerifyResult?.balance;
  const items = ((caseRecord.extractedFields as { invoices?: { items?: { subtotal?: number; voucher_type?: string }[] } } | null)?.invoices?.items) ?? [];
  const plan = (balance?.candidates ?? []) as BenefitCandidate[];
  const types = plan.filter((c, i) => plan.findIndex((o) => o.type === c.type) === i);
  const headsOf = (type: string) => plan.filter((c) => c.type === type && c.head);
  const unsure = balance?.unsure ?? [];
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [comment, setComment] = useState('');
  const fixes = corrections?.items ?? [];

  const save = useMutation({
    mutationFn: async () => {
      const choice = {
        benefits: Object.entries(choices).map(([i, c]) => ({ voucher: Number(i), benefitType: c.type, benefitHead: c.head || null })),
        comment: comment.trim(),
      };
      if (!fixes.length) return chooseBenefit(caseRecord.id, choice);
      await chooseBenefit(caseRecord.id, { ...choice, recheck: true });
      return createCorrections(caseRecord.id, fixes);
    },
    onSuccess: () => {
      onSaved?.('Saved. The member check runs again on the next pipeline run and checks the balance with your choice.');
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (!['BENEFIT_REVIEW', 'API_BENEFIT_REVIEW'].includes(caseRecord.currentStatus) || !balance) return null;

  // A choice is complete with a type, and a head where the plan has heads for that type.
  const complete = (c?: Choice) => Boolean(c?.type) && (!headsOf(c!.type).length || Boolean(c!.head));
  const missing = unsure.filter((i) => !complete(choices[i])).map((i) => `voucher ${i + 1}`);
  const setChoice = (i: number, c: Choice) => setChoices((d) => ({ ...d, [i]: c }));
  const vouchersTotal = items.reduce((sum, item) => sum + (typeof item.subtotal === 'number' ? item.subtotal : 0), 0);
  const claimed = (caseRecord.extractedFields as { claim?: { total_claim_amount?: number } } | null)?.claim?.total_claim_amount;

  return (
    <section className="mb-6 rounded-xl2 border border-ulink-orange/25 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-800"><Wallet size={16} /> Choose the benefit</h2>
      <p className="mb-4 text-sm text-slate-600">
        The AI wasn't sure of the benefit head of {unsure.map((i) => `voucher ${i + 1}`).join(', ')}. Choose it from the member's plan.
        The member check then runs again and checks the member balance with it, before the documents are checked.
      </p>
      <ul className="mb-4 space-y-3">
        {unsure.map((i) => {
          const pick = balance.picks.find((p) => p.voucher === i);
          const c = choices[i] ?? { type: '', head: '' };
          return (
            <li key={i} className="rounded-lg border border-slate-900/10 p-3 text-sm">
              <div className="mb-2 font-medium text-slate-800">
                Voucher {i + 1} · {items[i]?.voucher_type ?? 'type not read'} · {money(items[i]?.subtotal)} MMK
              </div>
              <p className="mb-2 text-xs text-slate-500">
                AI: {pick?.benefitHead ? `${pick.benefitType} / ${pick.benefitHead}${percent(pick.confidence)}` : `not sure${percent(pick?.confidence)}`}
              </p>
              <ReasonText text={pick?.reason} label="AI reasoning" className="mb-2" />
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label={`Voucher ${i + 1} benefit type`} className={selectClass} value={c.type} onChange={(e) => setChoice(i, { type: e.target.value, head: '' })}>
                  <option value="">Benefit type…</option>
                  {types.map((t) => <option key={t.type} value={t.type}>{t.type}{t.typeDesc ? ` ${t.typeDesc}` : ''}</option>)}
                </select>
                <select aria-label={`Voucher ${i + 1} benefit head`} className={selectClass} value={c.head} disabled={!c.type || !headsOf(c.type).length} onChange={(e) => setChoice(i, { ...c, head: e.target.value })}>
                  <option value="">{c.type && !headsOf(c.type).length ? 'No head for this type' : 'Benefit head…'}</option>
                  {headsOf(c.type).map((h) => <option key={h.head!} value={h.head!}>{h.head}{h.headDesc ? ` ${h.headDesc}` : ''}</option>)}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mb-3 text-xs text-slate-600">
        Vouchers total {money(vouchersTotal)} MMK · claimed {money(claimed)} MMK.
        {typeof claimed === 'number' && claimed !== vouchersTotal ? ' They do not match: the document check will ask about it unless a misread amount is corrected.' : ''}
        {' '}A misread voucher amount: correct it with ✎ Edit on the review page, and it is saved with this.
      </p>
      <p className="mb-1 text-xs font-medium text-slate-600">Why these? Pick a reason, or write your own</p>
      <QuickReasons reasons={['The voucher shows this benefit head.', 'The same benefit as the other voucher.']} value={comment} onPick={setComment} />
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-slate-600">Reason (required)</span>
        <textarea className={selectClass} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why these heads" />
      </label>
      {fixes.length > 0 && (
        <p className="mb-2 text-xs text-slate-600">One save: these choices and the correction{fixes.length === 1 ? '' : 's'}. The case is checked again from the member check.</p>
      )}
      {missing.length > 0 && <p className="mb-2 text-xs text-amber-700">Choose the head of {missing.join(', ')}.</p>}
      {save.isError && <p className="mb-2 text-xs text-red-600">{(save.error as Error).message}</p>}
      <Button disabled={missing.length > 0 || !!reasonProblem(comment) || (corrections?.notReady ?? 0) > 0 || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : fixes.length ? 'Save all and check again' : 'Save and check the balance'}
      </Button>
    </section>
  );
}
