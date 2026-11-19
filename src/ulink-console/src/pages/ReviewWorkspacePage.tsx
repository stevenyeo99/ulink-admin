import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, PanelLeftOpen } from 'lucide-react';
import { claimCase, confirmFinding, getCase, getNextCase, releaseCase } from '../api/casesApi';
import { getSession, isSuperAdmin } from '../lib/session';
import { Button } from '../components/common/Button';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import { CaseClaimBar } from '../components/cases/CaseClaimBar';
import { ReviewerChecklistPanel } from '../components/cases/ReviewerChecklistPanel';
import { CaseCorrectionPanel } from '../components/cases/CaseCorrectionPanel';
import { CaseOverridePanel } from '../components/cases/CaseOverridePanel';
import { CaseRetryPanel } from '../components/cases/CaseRetryPanel';
import { PreparationReviewPanel } from '../components/cases/PreparationReviewPanel';
import { BenefitReviewPanel } from '../components/cases/BenefitReviewPanel';
import { useConfidenceThreshold } from '../hooks/useConfidenceThreshold';
import { DocumentViewer } from '../components/review/DocumentViewer';
import { caseFiles, type PageRef } from '../lib/caseFiles';
import { FindingsPanel } from '../components/review/FindingsPanel';
import { NextActionBox } from '../components/cases/NextActionBox';
import { CaseUploadPanel } from '../components/cases/CaseUploadPanel';
import type { PendingCorrections } from '../lib/correctionDraft';

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
  // UAT 17/11 item 3: the reviewer can hide the document, and the findings take the center.
  const [docHidden, setDocHidden] = useState(false);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [moving, setMoving] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const claimTried = useRef<string | null>(null);
  // Corrections not saved yet: at the claim preparation stop they are saved with its choices, in one save.
  const [pendingCorrections, setPendingCorrections] = useState<PendingCorrections>({ items: [], notReady: 0, lines: [], asks: [], allDecided: true, openLabels: [], firstOpenKey: null });
  // New request lines typed in the findings, not saved yet: the email draft shows them at once.
  const [newRequestLines, setNewRequestLines] = useState<string[]>([]);
  // What the last save did, so the reviewer sees it after its panel goes away (the case moved on).
  const [saved, setSaved] = useState<string | null>(null);
  // A new findings panel after the one save at the document stop: its decisions were saved by the claim panel.
  const [findingsRound, setFindingsRound] = useState(0);
  // A new claim panel after each of its saves: the form starts again from what is now saved.
  const [claimRound, setClaimRound] = useState(0);

  // Polls every 5 seconds while the review lane checks the case again after a decision (SYSTEM_5), so the banner below
  // shows where it is and the buttons come back when it stops again.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['case', id], queryFn: () => getCase(id as string), enabled: !!id,
    refetchInterval: (query) => (query.state.data?.case.reviewPendingAt ? 5_000 : false),
  });
  // The round that checked the case again ended (SYSTEM_5 review lane 4.8.3): say how, and refresh the lists.
  const { info: statusInfo } = useCaseStatuses();
  const wasPending = useRef(false);
  const pendingNow = Boolean(data?.case.reviewPendingAt);
  useEffect(() => {
    if (wasPending.current && !pendingNow && data) {
      const status = statusInfo(data.case.currentStatus);
      const points = data.assessmentSummary.reviewPoints.filter((p) => !p.overridden).length;
      setSaved(status.group === 'needs_review' || status.group === 'failed'
        ? `Checked again: it needs review again${points ? ` (${points} point${points === 1 ? '' : 's'})` : ''}. ${status.label}.`
        : `Checked again: ${status.label}.`);
      for (const key of ['review-queue', 'reviewed', 'cases', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    }
    wasPending.current = pendingNow;
  }, [pendingNow, data, statusInfo, queryClient]);

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
    setQueueEmpty(false);
    setNextError(null);
    setSaved(null);
  }, [id]);

  const files = useMemo(() => (data ? caseFiles(data.case, data.documents, data.apiSteps) : []), [data]);

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (isError || !data || !id) return <div className="p-6 text-sm text-red-600">Couldn't load this case.</div>;

  const { case: caseRecord, assessmentSummary, nextAction, corrections, requests, claim, override, retry } = data;
  const checklist = caseRecord.documentCheckResult?.checklist ?? [];
  const fields = (caseRecord.extractedFields ?? {}) as { claimant?: { claimant_name?: string | null }; claim?: { total_claim_amount?: number | null } };
  const unsureCount = assessmentSummary.reviewPoints.filter((p) => !p.overridden).length;
  // The benefit choice saves the review page's corrections with it too (SYSTEM_5 member balance phase C).
  const atPreparationStop = ['API_PREPARATION_REVIEW', 'BENEFIT_REVIEW', 'API_BENEFIT_REVIEW'].includes(caseRecord.currentStatus) && isSuperAdmin();
  // One review at the document stop (UAT 17/11): the claim preparation findings are under the document findings, and the
  // claim panel's save sends both. Without a ready preview, the findings save alone, as before.
  const claimAtDocumentStop = ['API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE'].includes(caseRecord.currentStatus) && isSuperAdmin()
    && Boolean(caseRecord.preparationPreview?.claimPrepMeta) && !caseRecord.preparationPreview?.error;
  // New request lines are added in the findings ("Your own request lines") and saved with the decisions: the same
  // condition as FindingsPanel's section. Then "Ask for more information" keeps only the lines already asked.
  const linesInFindings = corrections.allowed && isSuperAdmin() && requests.allowed && !requests.stays && !atPreparationStop;

  // "✓ Right" (E5b): recorded as learning data; the list refreshes to show it.
  const me = getSession()?.user.username;
  const kindOf = (item: string) => corrections.options.find((o) => o.item === item)?.kind;
  const confirmed = new Map(corrections.list
    .filter((c) => c.kind === 'confirm' && c.createdBy === me && kindOf(c.item))
    .map((c) => [`${kindOf(c.item)}:${c.item}`, c.correctedValue]));
  // true when every item was saved: the panel keeps the reviewer's reason otherwise.
  const confirm = async (keys: string[], reason?: string) => {
    setConfirming(true);
    setConfirmError(null);
    try {
      for (const key of keys) {
        const [kind, ...rest] = key.split(':');
        await confirmFinding(id, kind as 'value' | 'verdict', rest.join(':'), reason);
      }
      return true;
    } catch (error) {
      setConfirmError(`Couldn't record "Mark OK": ${(error as Error).message}`);
      return false;
    } finally {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ['case', id] });
    }
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

  // One element, placed by the stop (the one review puts it under the findings; elsewhere it keeps its place).
  const preparation = (
    <PreparationReviewPanel
      key={`preparation-${id}-${claimRound}`}
      caseRecord={caseRecord}
      corrections={pendingCorrections}
      oneReview={claimAtDocumentStop}
      requestLines={newRequestLines}
      onSaved={(message, decisions) => {
        setSaved(message);
        setClaimRound((r) => r + 1);
        if (decisions) setFindingsRound((r) => r + 1); // the decisions are saved: none open, no second save
      }}
    />
  );

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

      <div className={docHidden ? 'flex min-h-0 flex-1 gap-4' : 'grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'}>
        {docHidden ? (
          // The hidden document leaves a narrow strip where it was: the way back is where the reviewer hid it.
          <button
            onClick={() => setDocHidden(false)}
            title="Show document"
            className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl2 border border-slate-900/10 bg-white/80 py-3 text-xs font-medium text-slate-600 hover:bg-slate-900/5"
          >
            <PanelLeftOpen size={15} />
            <span className="[writing-mode:vertical-rl]">Show document</span>
          </button>
        ) : (
          <section aria-label="Document" className="min-h-0 overflow-hidden rounded-xl2 border border-slate-900/10 bg-white/80 p-3">
            <DocumentViewer files={files} open={open} onOpen={setOpen} onHide={() => setDocHidden(true)} />
          </section>
        )}
        {/* Hidden document: the findings take the full width (owner, 2026-11-19: a capped width left an empty gap on a wide screen and still wrapped the button rows). */}
        <section aria-label="AI findings" className={clsx('min-h-0 overflow-y-auto rounded-xl2 border border-slate-900/10 bg-white/80 p-4', docHidden && 'flex-1')}>
          {/* What to do with this case now, before the findings (the same "Next" as the case page). */}
          {saved && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ulink-teal/30 bg-ulink-teal/5 px-4 py-3 text-sm text-slate-800">
              <span>{saved}</span>
              <div className="flex gap-2">
                <Button disabled={moving} onClick={nextCase}>Next case</Button>
                <Button variant="ghost" onClick={() => setSaved(null)}>Stay on this case</Button>
              </div>
            </div>
          )}
          {caseRecord.reviewPendingAt && (
            <div role="status" className="mb-4 rounded-lg border border-ulink-teal/30 bg-ulink-teal/5 px-4 py-3 text-sm text-slate-800">
              <span className="font-semibold">Being checked again after a decision</span>
              {caseRecord.reviewPendingBy ? ` by ${caseRecord.reviewPendingBy}` : ''}:{' '}
              <CaseStatusPill status={caseRecord.currentStatus} />, {Math.max(0, Math.floor((Date.now() - new Date(caseRecord.reviewPendingAt).getTime()) / 60000))} min.
              <span className="block text-xs text-slate-600">Nothing can be changed until it stops again. This page updates by itself.</span>
            </div>
          )}
          {nextAction && <NextActionBox next={nextAction} className="mb-4" />}
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            {claimAtDocumentStop ? '1. Documents: ' : ''}AI findings <span className="font-normal text-slate-500">— unsure means at or below {Math.round(threshold * 100)}%</span>
          </h2>
          {confirmError && <p className="mb-2 text-sm text-red-600">{confirmError}</p>}
          <FindingsPanel
            key={`findings-${id}-${findingsRound}`} // a new case starts with no open changes (they belong to the case they were made on)
            checklist={checklist}
            lines={assessmentSummary.lines}
            options={corrections.options}
            files={files}
            onOpenPage={(ref) => {
              setOpen(ref);
              setDocHidden(false); // a page link shows the document again at that page
            }}
            caseId={id}
            canCorrect={corrections.allowed && isSuperAdmin()}
            onConfirm={isSuperAdmin() ? confirm : null}
            confirming={confirming}
            confirmed={confirmed}
            documentsOverridden={assessmentSummary.lines.some((l) => l.area === 'documents' && l.overridden)}
            onPendingChange={setPendingCorrections}
            onRequestLinesChange={setNewRequestLines}
            onSaved={setSaved}
            saveBelow={atPreparationStop || claimAtDocumentStop}
            claimBelow={claimAtDocumentStop}
            status={caseRecord.currentStatus}
            // The review page's save moves the case back to the document check; where it stays, lines are added on the case page.
            requestsAllowed={requests.allowed && !requests.stays}
            openRequestLines={requests.open.map((r) => r.text)}
          />
          {/* Right under the findings at the one-review document stop: part 2 of the review, with the one save. */}
          {claimAtDocumentStop && preparation}
          {/* Missing documents: upload them here too (shows only while the case waits on documents) — below the findings
              and closed (owner, 2026-11-16): the page opens on the decisions. */}
          <CaseUploadPanel caseRecord={caseRecord} closed />
          <CaseRetryPanel key={`retry-${id}`} caseId={id} retry={retry} />
          {isSuperAdmin() && <BenefitReviewPanel key={`benefit-${id}`} caseRecord={caseRecord} corrections={pendingCorrections} onSaved={setSaved} />}
          {!claimAtDocumentStop && isSuperAdmin() && preparation}
          {/* Override and continue (same rules as the case page): a reviewer who checked the member or documents by hand,
              or fixed it in IAS, lets the case go on to the next job without leaving the review page. */}
          {isSuperAdmin() && <CaseOverridePanel key={`override-${id}`} caseRecord={caseRecord} override={override} summary={assessmentSummary} onSaved={setSaved} heldActions={false} closed />}
          {/* Each finding is corrected in place (Edit / Mark OK / Mark wrong); here only the corrections made so far. */}
          <CaseCorrectionPanel key={`corrections-${id}`} caseId={id} corrections={corrections} />
          <ReviewerChecklistPanel key={`requests-${id}`} caseId={id} requests={requests} addLines={!linesInFindings} pendingLines={newRequestLines} draftClosed />
        </section>
      </div>
    </div>
  );
}
