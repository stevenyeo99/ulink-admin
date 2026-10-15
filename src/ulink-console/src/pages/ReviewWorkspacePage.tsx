import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { claimCase, confirmFinding, getCase, getNextCase, releaseCase } from '../api/casesApi';
import { getSession, isSuperAdmin } from '../lib/session';
import { Button } from '../components/common/Button';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { CaseClaimBar } from '../components/cases/CaseClaimBar';
import { CaseCorrectionPanel } from '../components/cases/CaseCorrectionPanel';
import { useConfidenceThreshold } from '../hooks/useConfidenceThreshold';
import { DocumentViewer } from '../components/review/DocumentViewer';
import { caseFiles, type PageRef } from '../lib/caseFiles';
import { FindingsPanel } from '../components/review/FindingsPanel';

/**
 * Review workspace (SYSTEM_4 E4-20, E5a): one screen per case — the document on the left, the AI's findings on the
 * right; a finding opens its page; Correct in place (E4a); the case is claimed on opening (E4b); Next case gives it
 * back and opens the oldest unclaimed case in the queue. The case page (/cases/:id) stays for everything else.
 */
export function ReviewWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threshold = useConfidenceThreshold();
  const [open, setOpen] = useState<PageRef | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [moving, setMoving] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [correctCount, setCorrectCount] = useState(0); // remounts the form even when the same item is chosen again
  const correctionRef = useRef<HTMLDivElement>(null);
  const claimTried = useRef<string | null>(null);

  const { data, isLoading, isError } = useQuery({ queryKey: ['case', id], queryFn: () => getCase(id as string), enabled: !!id });

  // Opening the workspace claims the case (nobody else holds it) — "Being reviewed by me". Leaving it (Next case, back,
  // another page) gives that claim back, so just looking at cases doesn't lock them for others.
  const claimedHere = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !id || data.claim || !isSuperAdmin() || claimTried.current === id) return;
    claimTried.current = id;
    claimCase(id)
      .then(() => {
        claimedHere.current = id;
        queryClient.invalidateQueries({ queryKey: ['case', id] });
      })
      .catch(() => {});
  }, [data, id, queryClient]);
  useEffect(() => () => {
    if (id && claimedHere.current === id) {
      claimedHere.current = null;
      releaseCase(id).then(() => queryClient.invalidateQueries({ queryKey: ['review-queue'] })).catch(() => {});
    }
  }, [id, queryClient]);

  useEffect(() => {
    setOpen(null);
    setCorrecting(null);
    setQueueEmpty(false);
    setNextError(null);
  }, [id]);

  const files = useMemo(() => (data ? caseFiles(data.case, data.documents, data.apiSteps) : []), [data]);

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (isError || !data || !id) return <div className="p-6 text-sm text-red-600">Couldn't load this case.</div>;

  const { case: caseRecord, assessmentSummary, corrections, claim } = data;
  const checklist = caseRecord.documentCheckResult?.checklist ?? [];
  const fields = (caseRecord.extractedFields ?? {}) as { claimant?: { claimant_name?: string | null }; claim?: { total_claim_amount?: number | null } };
  const unsureCount = assessmentSummary.reviewPoints.filter((p) => !p.overridden).length;

  // "✓ Right" (E5b): recorded as learning data; the list refreshes to show it.
  const me = getSession()?.user.username;
  const kindOf = (item: string) => corrections.options.find((o) => o.item === item)?.kind;
  const confirmed = new Map(corrections.list
    .filter((c) => c.kind === 'confirm' && c.createdBy === me && kindOf(c.item))
    .map((c) => [`${kindOf(c.item)}:${c.item}`, c.correctedValue]));
  const confirm = async (keys: string[]) => {
    setConfirming(true);
    setConfirmError(null);
    try {
      for (const key of keys) {
        const [kind, ...rest] = key.split(':');
        await confirmFinding(id, kind as 'value' | 'verdict', rest.join(':'));
      }
    } catch (error) {
      setConfirmError(`Couldn't record "Right": ${(error as Error).message}`);
    } finally {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ['case', id] });
    }
  };
  const correct = (item: string) => {
    setCorrecting(item);
    setCorrectCount((n) => n + 1);
    setTimeout(() => correctionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  // Find the next case first; only moving on gives this one back (leaving the page releases it). Nothing next: stay,
  // still holding this case. Both sources — the queue the reviewer sees.
  const nextCase = async () => {
    setMoving(true);
    setNextError(null);
    try {
      const { id: nextId } = await getNextCase(id);
      if (nextId) navigate(`/cases/${nextId}/review`);
      else setQueueEmpty(true);
    } catch (error) {
      setNextError(`Couldn't find the next case: ${(error as Error).message}`);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/cases/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft size={14} /> Case page
          </Link>
          <h2 className="text-base font-semibold text-slate-900">{caseRecord.tpaCaseNumber ?? caseRecord.claimNo ?? id.slice(0, 8)}</h2>
          <span className="text-sm text-slate-600">
            {[fields.claimant?.claimant_name, fields.claim?.total_claim_amount != null ? `${Number(fields.claim.total_claim_amount).toLocaleString('en-US')} MMK` : null].filter(Boolean).join(' · ')}
          </span>
          <CaseStatusPill status={caseRecord.currentStatus} />
          <span className={unsureCount ? 'text-sm font-medium text-amber-700' : 'text-sm text-slate-500'}>
            {unsureCount ? `${unsureCount} review point${unsureCount > 1 ? 's' : ''}` : 'No open review points'}
          </span>
          <Button className="ml-auto" disabled={moving} onClick={nextCase}>
            Next case <ChevronRight size={14} />
          </Button>
        </div>
        {queueEmpty && <p className="mt-2 text-sm text-slate-600">Nothing else is waiting in the review queue.</p>}
        {nextError && <p className="mt-2 text-sm text-red-600">{nextError}</p>}
        {isSuperAdmin() && <CaseClaimBar caseId={id} claim={claim ?? null} />}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Document" className="min-h-0 overflow-hidden rounded-xl2 border border-slate-900/10 bg-white/80 p-3">
          <DocumentViewer files={files} open={open} onOpen={setOpen} />
        </section>
        <section aria-label="AI findings" className="min-h-0 overflow-y-auto rounded-xl2 border border-slate-900/10 bg-white/80 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            AI findings <span className="font-normal text-slate-500">— unsure means at or below {Math.round(threshold * 100)}%</span>
          </h2>
          {confirmError && <p className="mb-2 text-sm text-red-600">{confirmError}</p>}
          <FindingsPanel
            checklist={checklist}
            lines={assessmentSummary.lines}
            options={corrections.options}
            files={files}
            onOpenPage={setOpen}
            onCorrect={corrections.allowed && isSuperAdmin() ? correct : null}
            onConfirm={isSuperAdmin() ? confirm : null}
            confirming={confirming}
            confirmed={confirmed}
            documentsOverridden={assessmentSummary.lines.some((l) => l.area === 'documents' && l.overridden)}
          />
          <div ref={correctionRef}>
            <CaseCorrectionPanel key={`${id}-${correcting ?? ''}-${correctCount}`} caseId={id} corrections={corrections} initialItem={correcting ?? ''} />
          </div>
        </section>
      </div>
    </div>
  );
}
