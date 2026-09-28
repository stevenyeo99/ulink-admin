import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { resetCase } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { CaseDetail } from '../../types/case';

/**
 * Admin-only action on a case: reset it to be reprocessed from the start, logged permanently to the
 * case's history. Shown inside the case page's technical details. (Overriding a wrongly flagged check
 * is a reviewer action in the reviewer view — CaseOverridePanel.)
 */
export function CaseAdminActions({ caseRecord }: { caseRecord: CaseDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const resetMutation = useMutation({
    mutationFn: () => resetCase(caseRecord.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      navigate('/cases');
    },
  });

  if (caseRecord.claimNo) {
    return (
      <div>
        <h4 className="text-sm font-medium text-slate-800">Reset case</h4>
        <p className="mt-1 text-xs text-slate-500">
          This case already has a real IAS claim number (Claim {caseRecord.claimNo}), so reset is turned off to avoid losing the
          only local record of a claim that exists in IAS.
        </p>
      </div>
    );
  }

  return (
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
              This clears the recognised claim type, the extracted fields and every check result, and sends the case back to be
              read again. It is logged permanently and can't be undone automatically.
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
  );
}
