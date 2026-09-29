import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { overrideCase, releaseMissingDocuments } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { AssessmentSummary, CaseDetail, CaseOverrideInfo } from '../../types/case';

/**
 * "Override and continue" — for when the AI flagged the document or member check wrongly. The reviewer
 * says why the check was wrong and writes a reason; the case then carries on exactly as if the check
 * had passed. Which cases qualify is decided by the API (modules/case-override/override.js).
 */
export function CaseOverridePanel({
  caseRecord,
  override,
  summary,
}: {
  caseRecord: CaseDetail;
  override: CaseOverrideInfo;
  summary: AssessmentSummary;
}) {
  const queryClient = useQueryClient();
  const [finding, setFinding] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => overrideCase(caseRecord.id, reason.trim(), finding),
    onSuccess: () => {
      setConfirmOpen(false);
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (!override.allowed) {
    // An overridable status that is blocked for a reason (e.g. member not in IAS) — say why.
    return override.reason ? (
      <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Override not available</h2>
        <p className="text-sm text-slate-600">{override.reason}</p>
      </section>
    ) : null;
  }

  const isMemberCheck = caseRecord.currentStatus.endsWith('MEMBER_REVIEW_REQUIRED');
  // Held by the switch "hold the missing-documents email when the AI is unsure": the customer hasn't been emailed.
  const isHeld = caseRecord.currentStatus.endsWith('DOCUMENTS_REVIEW');
  const checkName = isMemberCheck ? 'member check' : 'document check';
  // A bank mismatch is a payment risk even when another problem was found first.
  const memberResult = caseRecord.memberVerifyResult;
  const paymentRisk = [memberResult?.reasonCode, ...(memberResult?.issues ?? []).map((i) => i.reasonCode)].includes('BANK_DETAILS_MISMATCH');
  const canSubmit = finding !== '' && reason.trim() !== '' && !mutation.isPending;

  return (
    <section className="mb-6 rounded-xl2 border border-ulink-orange/25 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      {isHeld && <HeldEmailActions caseId={caseRecord.id} />}
      <h2 className="text-sm font-semibold text-slate-800">Override and continue</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        If the AI flagged the {checkName} wrongly, you can let the case continue as if it had passed. Your name, your choice below
        and your reason are kept in the case history.
      </p>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Why was the check wrong?</span>
        <select
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
          className="w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        >
          <option value="">Choose one</option>
          {Object.entries(override.findings).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Reason</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. The medical record on page 3 is readable; the AI misread it."
          className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
        />
      </label>

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Trigger asChild>
          <Button disabled={!canSubmit}>Override and continue</Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
            <AlertDialog.Title className="text-sm font-semibold text-slate-900">Skip the {checkName}?</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-2 space-y-3 text-sm text-slate-600">
                {summary.reviewPoints.length > 0 && (
                  <div>
                    <p className="mb-1">These points will be skipped:</p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {summary.reviewPoints.map((p) => (
                        <li key={`${p.decision}-${p.reason}`}>
                          {p.decision}: {p.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {paymentRisk && (
                  <p className="flex gap-2 rounded-lg bg-red-50 p-2 text-red-700">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    The bank details don't match IAS. Make sure the payment will go to the right account before continuing.
                  </p>
                )}
                <p>The case continues on the next pipeline run. This is logged permanently and can't be undone automatically.</p>
              </div>
            </AlertDialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialog.Cancel>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? 'Overriding…' : 'Override and continue'}
              </Button>
            </div>
            {mutation.isError && <p className="mt-3 text-sm text-red-600">{(mutation.error as Error).message}</p>}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}

/**
 * The customer has NOT been emailed yet: the AI was unsure a document is missing. If a person checks and
 * the documents really are missing, this sends the customer the request the check prepared. If the
 * documents are fine, the override below is the other choice.
 */
function HeldEmailActions({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const release = useMutation({
    mutationFn: () => releaseMissingDocuments(caseId),
    onSuccess: () => {
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <div className="mb-5 rounded-lg border border-ulink-orange/30 bg-ulink-orange/5 p-4">
      <h2 className="text-sm font-semibold text-slate-800">Check before emailing the customer</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">
        The AI wasn't sure some documents are missing, so the customer has not been emailed. Look at the documents: if they really are
        missing, send the request; if they are fine, override the check below.
      </p>
      <Button onClick={() => release.mutate()} disabled={release.isPending}>
        {release.isPending ? 'Sending…' : 'Documents are missing — send the request to the customer'}
      </Button>
      {release.isError && <p className="mt-2 text-sm text-red-600">{(release.error as Error).message}</p>}
    </div>
  );
}
