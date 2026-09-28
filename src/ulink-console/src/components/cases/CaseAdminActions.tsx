import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { overrideCase, resetCase } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { CaseDetail } from '../../types/case';

const REVIEWABLE_STATUSES = ['INCOMPLETE', 'MEMBER_REVIEW_REQUIRED'];



/**
 * Admin-only actions on a case: reset it to be reprocessed, or override a stuck check. Both are
 * logged permanently to the case's history. Shown inside the case page's technical details.
 */
export function CaseAdminActions({ caseRecord }: { caseRecord: CaseDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['cases'] });
    queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    navigate('/cases');
  };
  const overrideMutation = useMutation({ mutationFn: () => overrideCase(caseRecord.id, reason.trim()), onSuccess: done });
  const resetMutation = useMutation({ mutationFn: () => resetCase(caseRecord.id), onSuccess: done });
  const canSubmit = reason.trim() !== '' && !overrideMutation.isPending;

  return (
    <div className="space-y-4">
      {caseRecord.claimNo ? (
        <div>
          <h4 className="text-sm font-medium text-slate-800">Reset case</h4>
          <p className="mt-1 text-xs text-slate-500">
            This case already has a real IAS claim number (Claim {caseRecord.claimNo}), so reset is turned off to avoid losing
            the only local record of a claim that exists in IAS.
          </p>
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-slate-800">Reset case</h4>
          <p className="mb-3 mt-1 text-xs text-slate-500">
            Sends the case back to be read again and clears everything the pipeline worked out for it. The next pipeline run
            reprocesses it from the start. Logged permanently to the case history.
          </p>
          <AlertDialog.Root open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
            <AlertDialog.Trigger asChild>
              <Button variant="ghost">Reset case</Button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
                <AlertDialog.Title className="text-sm font-semibold text-slate-900">Reset this case?</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-slate-500">
                  This clears the recognised claim type, the extracted fields and every check result, and sends the case back
                  to be read again. It is logged permanently and can't be undone automatically.
                </AlertDialog.Description>
                <div className="mt-4 flex justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button variant="ghost">Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                      {resetMutation.isPending ? 'Resetting…' : 'Reset case'}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
          {resetMutation.isError && <p className="mt-3 text-xs text-red-600">{(resetMutation.error as Error).message}</p>}
        </div>
      )}

      {REVIEWABLE_STATUSES.includes(caseRecord.currentStatus) && (
        <div className="border-t border-slate-900/5 pt-4">
          <h4 className="text-sm font-medium text-ulink-orange-dark">Manual override</h4>
          <p className="mb-3 mt-1 text-xs text-slate-500">
            Moves the case past its current check. Needs a written reason; it and your name are logged permanently to the case history.
          </p>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Reason for override</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Voucher stamp confirmed with the provider by phone; the AI misread it."
              className="w-full rounded-lg border border-slate-900/10 px-3 py-2 text-sm outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20"
            />
          </label>
          <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialog.Trigger asChild>
              <Button disabled={!canSubmit}>Override and continue</Button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
                <AlertDialog.Title className="text-sm font-semibold text-slate-900">Override this check?</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-slate-500">
                  This skips the case's {caseRecord.currentStatus === 'INCOMPLETE' ? 'document check' : 'member check'} and moves it
                  on. It is logged permanently and can't be undone automatically.
                </AlertDialog.Description>
                <div className="mt-4 flex justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button variant="ghost">Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending}>
                      {overrideMutation.isPending ? 'Overriding…' : 'Override and continue'}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
          {overrideMutation.isError && <p className="mt-3 text-xs text-red-600">{(overrideMutation.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
