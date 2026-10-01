import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Clock } from 'lucide-react';
import clsx from 'clsx';
import { getCase } from '../api/casesApi';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { CaseDocumentsSection } from '../components/cases/CaseDocumentsSection';
import { JobStepsSection } from '../components/cases/JobStepsSection';
import { EmailThreadSection } from '../components/cases/EmailThreadSection';
import { CaseAdminActions } from '../components/cases/CaseAdminActions';
import { CaseOverridePanel } from '../components/cases/CaseOverridePanel';
import { isSuperAdmin } from '../lib/session';
import { JsonViewer } from '../components/panel/JsonViewer';
import { ChecklistTable } from '../components/panel/ChecklistTable';
import { AssessmentSummaryPanel, CaseJourneyPanel } from '../components/panel/AssessmentSummaryPanel';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import type { ChecklistItem } from '../types/case';

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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl', className)}>
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

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

  const { case: caseRecord, events, documents, apiSteps, assessmentSummary, override } = data;
  const isApi = caseRecord.source === 'API';
  const statusLabel = (code: string | null) => (code ? info(code).label : '—');

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
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {isApi ? 'API case' : `Email case${caseRecord.recognizedType ? `, ${caseRecord.recognizedType}` : ''}`}. Received{' '}
          {formatTimestamp(caseRecord.createdAt)}, last updated {formatTimestamp(caseRecord.updatedAt)}.
        </p>
        <p className="mt-1 text-sm text-slate-600">{info(caseRecord.currentStatus).description}</p>
      </header>

      <CaseJourneyPanel summary={assessmentSummary} />
      <AssessmentSummaryPanel summary={assessmentSummary} />

      {isSuperAdmin() && <CaseOverridePanel caseRecord={caseRecord} override={override} summary={assessmentSummary} />}

      {isApi && (
        <Section title="Documents">
          <CaseDocumentsSection caseId={caseRecord.id} documents={documents} />
        </Section>
      )}

      <Section title="Emails">
        <EmailThreadSection caseId={caseRecord.id} threads={caseRecord.EmailThreads} />
      </Section>

      <Section title="Case history">
        {events.length === 0 && <p className="text-sm text-slate-500">Nothing has happened to this case yet.</p>}
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <Clock size={14} className="mt-0.5 shrink-0 text-slate-300" />
              <div>
                <p className="text-slate-700">
                  {event.prevStatus ? `${statusLabel(event.prevStatus)} → ` : ''}
                  <span className="font-medium">{statusLabel(event.newStatus)}</span>
                </p>
                {event.message && <p className="mt-0.5 text-xs text-slate-500">{event.message}</p>}
                <p className="mt-0.5 text-xs text-slate-400">{formatTimestamp(event.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <button
        onClick={() => setShowTechnical((open) => !open)}
        aria-expanded={showTechnical}
        aria-controls="technical-details"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
      >
        <ChevronDown size={16} className={clsx('motion-safe:transition-transform', showTechnical && 'rotate-180')} />
        {showTechnical ? 'Hide technical details' : 'Show technical details'}
      </button>

      {showTechnical && (
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
