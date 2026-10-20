import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { chooseDiagnosis, searchDiagnosis } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { CaseDetail, DiagnosisCandidate } from '../../types/case';

/**
 * The AI wasn't sure of the ICD-10 diagnosis code (API_DIAGNOSIS_REVIEW, ulink-api diagnosisController.js): a person
 * chooses it — one of the AI's candidates, a code from the search, or the AI's own code — with a comment. Claim
 * preparation then runs again with that code. Super admin (the page shows it to them only).
 */
export function DiagnosisReviewPanel({ caseRecord }: { caseRecord: CaseDetail }) {
  const queryClient = useQueryClient();
  const diagnosis = caseRecord.claimPrepMeta?.diagnosis;
  const aiPick = diagnosis?.pick as DiagnosisCandidate | null | undefined;
  const [code, setCode] = useState('');
  const [comment, setComment] = useState('');
  const [text, setText] = useState('');
  const search = useMutation({ mutationFn: () => searchDiagnosis(caseRecord.id, text.trim()) });
  const save = useMutation({
    mutationFn: () => chooseDiagnosis(caseRecord.id, code, comment.trim()),
    onSuccess: () => {
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  if (caseRecord.currentStatus !== 'API_DIAGNOSIS_REVIEW' || !diagnosis) return null;

  // The AI's own code first, then its candidates and the search results, each code once.
  const options = [aiPick, ...((diagnosis.candidates ?? []) as DiagnosisCandidate[]), ...(search.data?.candidates || [])]
    .filter((c): c is DiagnosisCandidate => Boolean(c?.diagCode))
    .filter((c, i, all) => all.findIndex((o) => o.diagCode === c.diagCode) === i);

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Stethoscope size={15} /> Choose the diagnosis code</h2>
      <p className="mt-1 text-sm text-slate-600">
        The AI read “{diagnosis.text || 'no diagnosis text'}” and {diagnosis.defaulted ? 'found no confident match, so it used' : 'was unsure of'}{' '}
        <span className="font-mono">{aiPick?.diagCode ?? 'none'}</span>
        {typeof diagnosis.confidence === 'number' ? ` (confidence ${Math.round(diagnosis.confidence * 100)}%)` : ''}.
        {diagnosis.reason ? ` AI: ${diagnosis.reason}` : ''}
      </p>

      <fieldset className="mt-3 space-y-1">
        {options.map((c) => (
          <label key={c.diagCode} className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="diagCode" value={c.diagCode} checked={code === c.diagCode} onChange={() => setCode(c.diagCode)} className="mt-1" />
            <span>
              <span className="font-mono">{c.diagCode}</span> {c.diagDesc}
              {c.diagCode === aiPick?.diagCode ? <span className="text-slate-500"> — the AI's code</span> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) search.mutate(); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search ICD-10, e.g. chronic gingivitis"
          className="flex-1 rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        />
        <Button type="submit" variant="ghost" disabled={text.trim().length < 3 || search.isPending}>{search.isPending ? 'Searching…' : 'Search'}</Button>
      </form>
      {search.isError && <p className="mt-2 text-sm text-red-600">{(search.error as Error).message}</p>}

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Comment — why this code</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="e.g. The dental slip says chronic gingivitis."
          className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        />
      </label>
      {save.isError && <p className="mt-2 text-sm text-red-600">{(save.error as Error).message}</p>}
      {save.isSuccess && <p className="mt-2 text-sm text-ulink-teal-dark">Saved — the next pipeline run prepares the revision with this code.</p>}
      <div className="mt-3">
        <Button disabled={!code || comment.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Use this code'}
        </Button>
      </div>
    </section>
  );
}
