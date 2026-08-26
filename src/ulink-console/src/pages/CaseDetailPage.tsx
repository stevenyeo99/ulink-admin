import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ArrowLeft, Clock } from 'lucide-react';
import { getCase, overrideCase, resetCase } from '../api/casesApi';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { EmailThreadSection } from '../components/cases/EmailThreadSection';
import { JsonViewer } from '../components/panel/JsonViewer';
import { Button } from '../components/common/Button';

const REVIEWABLE_STATUSES = ['INCOMPLETE', 'MEMBER_REVIEW_REQUIRED'];

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [operatorName, setOperatorName] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id as string),
    enabled: !!id,
  });

  const overrideMutation = useMutation({
    mutationFn: () => overrideCase(id as string, reason.trim(), operatorName.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate('/cases');
    },
  });

  const canSubmit = operatorName.trim() !== '' && reason.trim() !== '' && !overrideMutation.isPending;

  const resetMutation = useMutation({
    mutationFn: () => resetCase(id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate('/cases');
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (isError || !data) return <div className="p-6 text-sm text-red-500">Couldn't load this case.</div>;

  const { case: caseRecord, events } = data;

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 py-6">
      <button
        onClick={() => navigate('/cases')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to Cases
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-slate-400">{caseRecord.id}</p>
          <div className="mt-1 flex items-center gap-2">
            <CaseStatusPill status={caseRecord.currentStatus} />
            <span className="text-sm text-slate-600">{caseRecord.recognizedType ?? 'Unrecognized route'}</span>
            {caseRecord.claimNo && (
              <span className="rounded-full bg-ulink-teal/15 px-2.5 py-1 text-xs font-semibold text-ulink-teal-dark">
                Claim {caseRecord.claimNo}
              </span>
            )}
          </div>
        </div>
      </div>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Email Thread</h2>
        <EmailThreadSection caseId={caseRecord.id} threads={caseRecord.EmailThreads} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Extracted Fields</h2>
        <JsonViewer value={caseRecord.extractedFields} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Document Check Result</h2>
        <JsonViewer value={caseRecord.documentCheckResult} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Member Verify Result</h2>
        <JsonViewer value={caseRecord.memberVerifyResult} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">IAS Member Info</h2>
        <JsonViewer value={caseRecord.iasMemberInfoResponse} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">IAS Claim Payload</h2>
        <JsonViewer value={caseRecord.iasClaimPayload} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">IAS Claim Result</h2>
        <JsonViewer value={caseRecord.iasClaimResult} />
      </section>

      <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Case Timeline</h2>
        {events.length === 0 && <p className="text-sm italic text-slate-400">No events yet</p>}
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 text-xs">
              <Clock size={13} className="mt-0.5 shrink-0 text-slate-300" />
              <div>
                <p className="text-slate-700">
                  <span className="font-medium">{event.blockName}</span>: {event.prevStatus ?? '—'} → {event.newStatus}
                  {event.reasonCode && <span className="text-slate-400"> ({event.reasonCode})</span>}
                </p>
                {event.message && <p className="mt-0.5 text-slate-500">{event.message}</p>}
                <p className="mt-0.5 text-slate-300">{formatTimestamp(event.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {caseRecord.claimNo ? (
        <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Reset Case</h2>
          <p className="text-xs text-slate-500">
            This case already has a real IAS claim number (Claim {caseRecord.claimNo}) — resetting is disabled to
            avoid losing the only local record of an already-created claim.
          </p>
        </section>
      ) : (
        <section className="mb-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Reset Case</h2>
          <p className="mb-4 text-xs text-slate-500">
            Rewinds this case back to READY_FOR_DOCUMENT_READING and clears everything the pipeline computed for
            it, so the next pipeline run reprocesses it from scratch. Logged permanently to this case's audit
            trail.
          </p>

          <AlertDialog.Root open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
            <AlertDialog.Trigger asChild>
              <Button variant="ghost">Reset Case</Button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
                <AlertDialog.Title className="text-sm font-semibold text-slate-900">Confirm reset</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-slate-500">
                  This clears the recognized route, extracted fields, and every check result this case has, and
                  sends it back to READY_FOR_DOCUMENT_READING. The next pipeline run will reprocess it as if it
                  were freshly submitted. This is logged permanently and cannot be automatically undone.
                </AlertDialog.Description>
                <div className="mt-4 flex justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button variant="ghost">Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                      {resetMutation.isPending ? 'Resetting…' : 'Confirm Reset'}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>

          {resetMutation.isError && <p className="mt-3 text-xs text-red-500">{(resetMutation.error as Error).message}</p>}
        </section>
      )}

      {REVIEWABLE_STATUSES.includes(caseRecord.currentStatus) && (
      <section className="rounded-xl2 border border-ulink-orange/20 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ulink-orange-dark">Manual Override</h2>
        <p className="mb-4 text-xs text-slate-500">
          Advances this case past its current check. Requires a written reason — logged permanently to this case's audit trail.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Your name</span>
          <input
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="e.g. Steven"
            className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Reason for override</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Verified voucher stamp is legitimate via phone call with the provider — extraction misread it."
            className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange"
          />
        </label>

        <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialog.Trigger asChild>
            <Button disabled={!canSubmit}>Override & Proceed</Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
              <AlertDialog.Title className="text-sm font-semibold text-slate-900">Confirm override</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-slate-500">
                This bypasses this case's {caseRecord.currentStatus === 'INCOMPLETE' ? 'document check' : 'member verification'}{' '}
                and advances it for further processing. This is logged permanently and cannot be automatically undone.
              </AlertDialog.Description>
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button variant="ghost">Cancel</Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending}>
                    {overrideMutation.isPending ? 'Overriding…' : 'Confirm Override'}
                  </Button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>

        {overrideMutation.isError && (
          <p className="mt-3 text-xs text-red-500">{(overrideMutation.error as Error).message}</p>
        )}
      </section>
      )}
    </div>
  );
}
