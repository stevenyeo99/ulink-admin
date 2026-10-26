import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { getCase } from '../api/casesApi';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { CaseDocumentsSection } from '../components/cases/CaseDocumentsSection';
import { JobStepsSection } from '../components/cases/JobStepsSection';
import { EmailThreadSection } from '../components/cases/EmailThreadSection';
import { CaseAdminActions } from '../components/cases/CaseAdminActions';
import { CaseOverridePanel } from '../components/cases/CaseOverridePanel';
import { CaseRetryPanel } from '../components/cases/CaseRetryPanel';
import { PreparationReviewPanel } from '../components/cases/PreparationReviewPanel';
import { BenefitReviewPanel } from '../components/cases/BenefitReviewPanel';
import { ReviewerChecklistPanel } from '../components/cases/ReviewerChecklistPanel';
import { LlmCallsSection } from '../components/cases/LlmCallsSection';
import { CaseUploadPanel } from '../components/cases/CaseUploadPanel';
import { CaseCorrectionPanel } from '../components/cases/CaseCorrectionPanel';
import { CaseClaimBar } from '../components/cases/CaseClaimBar';
import { CaseTimeline } from '../components/cases/CaseTimeline';
import { formatTimestamp } from '../lib/formatTimestamp';
import { isSuperAdmin } from '../lib/session';
import { JsonViewer } from '../components/panel/JsonViewer';
import { ChecklistTable } from '../components/panel/ChecklistTable';
import { FieldsReadTable } from '../components/panel/FieldsReadTable';
import { AssessmentSummaryPanel, CaseJourneyPanel } from '../components/panel/AssessmentSummaryPanel';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import type { CaseDetail, ChecklistItem } from '../types/case';
import { NextActionBox } from '../components/cases/NextActionBox';

// Labels for member-verification's checks.hard object (modules/member-verification/checks.js)
// — that module is deliberately pure/no-I/O, so display wording belongs here, not there.
const HARD_CHECK_LABELS: Record<string, string> = {
  coverageActive: 'Treatment date falls within the active coverage period',
  dobMatch: 'Claimant date of birth matches IAS record',
  bankNameMatch: 'Bank name matches IAS record',
  bankAccountNameMatch: 'Bank account holder name matches IAS record',
  bankAccountNumberMatch: 'Bank account number matches IAS record',
  policyNoMatch: 'Policy number matches IAS record',
};

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl', className)}>
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

// The case at a glance (SYSTEM_4 E4-21): who claims, which benefit(s), how much — each only once known.
function caseFacts(c: CaseDetail): string[] {
  const fields = (c.extractedFields ?? {}) as { claimant?: { claimant_name?: string | null }; claim?: { total_claim_amount?: number | null } };
  const name = fields.claimant?.claimant_name;
  const benefits = [...new Set((c.claimPrepMeta?.lines ?? []).map((l) => l.pick?.benefitType).filter((b): b is string => typeof b === 'string'))];
  const amount = fields.claim?.total_claim_amount;
  return [name, benefits.join(', '), amount != null ? `${Number(amount).toLocaleString('en-US')} MMK` : null].filter((f): f is string => Boolean(f));
}

// "Next": what has to happen to this case and who does it — amber when a person has to act, grey otherwise.
/**
 * One case (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, step 5). The reviewer view comes
 * first — what the AI decided and why (the assessment already covers every check), the documents, the
 * emails and the history in plain words. The raw checklists, data, job steps and admin actions sit
 * behind "Technical details".
 */
export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { info } = useCaseStatuses();
  const [showTechnical, setShowTechnical] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id as string),
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (isError || !data) return <div className="p-6 text-sm text-red-600">Couldn't load this case. It may have been removed.</div>;

  const { case: caseRecord, events, documents, apiSteps, assessmentSummary, override, nextAction, corrections, requests, claim, retry } = data;
  const fieldsRead = caseRecord.documentCheckResult?.checklist?.find((item) => item.code === 'FIELDS_READ')?.fields;
  const isApi = caseRecord.source === 'API';

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <CaseStatusPill status={caseRecord.currentStatus} />
          {caseRecord.claimNo && (
            <span className="rounded-full bg-ulink-teal/15 px-2.5 py-1 text-xs font-semibold text-ulink-teal-dark">Claim {caseRecord.claimNo}</span>
          )}
          {caseRecord.tpaCaseNumber && <span className="text-sm text-slate-700">{caseRecord.tpaCaseNumber}</span>}
          <Link
            to={`/cases/${caseRecord.id}/review`}
            className="ml-auto rounded-full bg-ulink-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-ulink-teal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
          >
            Review documents
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-700">{caseFacts(caseRecord).join(' · ')}</p>
        <p className="mt-1 text-sm text-slate-500">
          {isApi ? 'API case' : `Email case${caseRecord.recognizedType ? `, ${caseRecord.recognizedType}` : ''}`}. Received{' '}
          {formatTimestamp(caseRecord.createdAt)}, last updated {formatTimestamp(caseRecord.updatedAt)}.
        </p>
        {nextAction ? <NextActionBox next={nextAction} className="mt-3" /> : <p className="mt-1 text-sm text-slate-600">{info(caseRecord.currentStatus).description}</p>}
        {isSuperAdmin() && <CaseClaimBar caseId={caseRecord.id} claim={claim ?? null} />}
      </header>

      <CaseUploadPanel caseRecord={caseRecord} />
      <CaseJourneyPanel summary={assessmentSummary} />
      <AssessmentSummaryPanel summary={assessmentSummary} />

      {fieldsRead?.length ? (
        <Section title="What the AI read">
          <FieldsReadTable fields={fieldsRead} />
          <LearnedFrom fields={caseRecord.extractedFields} />
        </Section>
      ) : null}

      <CaseRetryPanel key={caseRecord.id} caseId={caseRecord.id} retry={retry} />
      {isSuperAdmin() && <BenefitReviewPanel key={`benefit-${caseRecord.id}`} caseRecord={caseRecord} />}
      {isSuperAdmin() && <PreparationReviewPanel key={`preparation-${caseRecord.id}`} caseRecord={caseRecord} />}
      {isSuperAdmin() && <CaseOverridePanel caseRecord={caseRecord} override={override} summary={assessmentSummary} />}
      <ReviewerChecklistPanel key={caseRecord.id} caseId={caseRecord.id} requests={requests} />
      {/* Corrections are made per finding on the review page; here the ones made so far and a link there. */}
      {corrections && <CaseCorrectionPanel caseId={caseRecord.id} corrections={corrections} linkToReview />}

      {isApi && (
        <Section title="Documents">
          <CaseDocumentsSection caseId={caseRecord.id} documents={documents} />
        </Section>
      )}

      <Section title="Emails">
        <EmailThreadSection caseId={caseRecord.id} threads={caseRecord.EmailThreads} />
      </Section>

      {/* The single timeline (SYSTEM_4 E4-24): case history, people, AI, emails, IAS — newest first. */}
      <Section title="Timeline">
        <CaseTimeline caseId={caseRecord.id} />
      </Section>

      {/* Technical details (raw JSON, job steps, IAS payloads): super admin only (SYSTEM_4 E4-20). */}
      {isSuperAdmin() && (
      <button
        onClick={() => setShowTechnical((open) => !open)}
        aria-expanded={showTechnical}
        aria-controls="technical-details"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
      >
        <ChevronDown size={16} className={clsx('motion-safe:transition-transform', showTechnical && 'rotate-180')} />
        {showTechnical ? 'Hide technical details' : 'Show technical details'}
      </button>
      )}

      {showTechnical && isSuperAdmin() && (
        <div id="technical-details">
          <Section title="Identifiers">
            <p className="font-mono text-xs text-slate-600">Case ID {caseRecord.id}</p>
            <p className="mt-1 font-mono text-xs text-slate-600">Status code {caseRecord.currentStatus}</p>
          </Section>
          <Section title="Member check (each IAS comparison)">
            {caseRecord.memberVerifyResult?.checks?.hard ? (
              <>
                <ChecklistTable
                  items={Object.entries(caseRecord.memberVerifyResult.checks.hard).map(
                    ([code, passed]): ChecklistItem => ({ code, label: HARD_CHECK_LABELS[code] ?? code, passed })
                  )}
                />
                {caseRecord.memberVerifyResult.reason && <p className="mt-3 text-xs text-slate-500">{caseRecord.memberVerifyResult.reason}</p>}
              </>
            ) : (
              <p className="text-sm text-slate-500">{caseRecord.memberVerifyResult?.reason ?? 'Not checked yet.'}</p>
            )}
          </Section>

          <Section title="Document checklist (as the checklist words it)">
            {caseRecord.documentCheckResult?.checklist ? (
              <ChecklistTable
                items={caseRecord.documentCheckResult.checklist}
                reasonByCode={Object.fromEntries(
                  (caseRecord.documentCheckResult.details ?? [])
                    .filter((detail) => detail.code && detail.reason)
                    .map((detail) => [detail.code as string, detail.reason as string])
                )}
              />
            ) : (
              <p className="text-sm text-slate-500">Not checked yet.</p>
            )}
          </Section>
          {isApi && (
            <Section title="Job steps">
              <JobStepsSection steps={apiSteps ?? []} />
            </Section>
          )}
          <Section title="AI calls">
            <LlmCallsSection caseId={caseRecord.id} />
          </Section>
          <Section title="Extracted fields">
            <JsonViewer value={caseRecord.extractedFields} />
          </Section>
          <Section title="Member check result (raw)">
            <JsonViewer value={caseRecord.memberVerifyResult} />
          </Section>
          <Section title="Document check result (raw)">
            <JsonViewer value={caseRecord.documentCheckResult} />
          </Section>
          <Section title="IAS member info">
            <JsonViewer value={caseRecord.iasMemberInfoResponse} />
          </Section>
          <Section title="IAS claim payload">
            <JsonViewer value={caseRecord.iasClaimPayload} />
          </Section>
          <Section title="Diagnosis and benefit pick reasoning">
            <p className="mb-3 text-xs text-slate-500">
              Confidence, reasons and the candidates considered for the diagnosis and benefit codes. Internal only, not sent to IAS.
            </p>
            <JsonViewer value={caseRecord.claimPrepMeta} />
          </Section>
          <Section title="IAS claim result">
            <JsonViewer value={caseRecord.iasClaimResult} />
          </Section>
          <Section title="Case history (codes)">
            <ol className="space-y-1 font-mono text-xs text-slate-600">
              {events.map((event) => (
                <li key={event.id}>
                  {formatTimestamp(event.createdAt)} {event.blockName}: {event.prevStatus ?? '—'} → {event.newStatus}
                  {event.reasonCode && ` (${event.reasonCode})`}
                </li>
              ))}
            </ol>
          </Section>
          {isSuperAdmin() && (
            <Section title="Admin actions" className="border-ulink-orange/20">
              <CaseAdminActions caseRecord={caseRecord} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// Which trusted reviewer notes from past claims the AI was given when it read this case (SYSTEM_4 F3).
function LearnedFrom({ fields }: { fields: unknown }) {
  const notes = (fields as { learnedFrom?: { id: string; label: string }[] } | null)?.learnedFrom;
  if (!notes?.length) return null;
  return (
    <p className="mt-2 text-xs text-slate-500">
      The AI used {notes.length} trusted reviewer note{notes.length > 1 ? 's' : ''} from past claims of this hospital: {[...new Set(notes.map((n) => n.label))].join(', ')}.
    </p>
  );
}
