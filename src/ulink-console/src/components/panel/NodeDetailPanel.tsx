import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { StatusBadge } from '../workflow/StatusBadge';
import { JsonViewer } from './JsonViewer';
import type { PipelineRunStep } from '../../types/pipeline';
import type { SelectedNode } from '../workflow/WorkflowCanvas';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function duration(step: PipelineRunStep): string | null {
  if (!step.startedAt || !step.finishedAt) return null;
  const ms = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepCard({ step, heading }: { step: PipelineRunStep; heading: string | null }) {
  return (
    <div className="mb-4 rounded-xl border border-slate-900/5 bg-white/60 p-4">
      {heading && <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{heading}</p>}

      <div className="mb-4 flex items-center gap-3">
        <StatusBadge status={step.status} />
        {duration(step) && <span className="text-xs text-slate-500">took {duration(step)}</span>}
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-slate-400">Started</dt>
          <dd className="mt-0.5 font-medium text-slate-700">{formatTimestamp(step.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Finished</dt>
          <dd className="mt-0.5 font-medium text-slate-700">{formatTimestamp(step.finishedAt)}</dd>
        </div>
      </dl>

      {step.skipReason && (
        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Skipped: {step.skipReason}</div>
      )}

      {step.errorMessage && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{step.errorMessage}</div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Result</p>
      <JsonViewer value={step.resultSummary} />
    </div>
  );
}

interface NodeDetailPanelProps {
  selected: SelectedNode | null;
  onClose: () => void;
}

export function NodeDetailPanel({ selected, onClose }: NodeDetailPanelProps) {
  return (
    <Dialog.Root open={selected !== null} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {selected && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-900/5 bg-white/95 p-6 shadow-glass backdrop-blur-xl"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-slate-900">{selected.label}</Dialog.Title>
                    <p className="mt-0.5 text-xs text-slate-500">{selected.description}</p>
                  </div>
                  <Dialog.Close asChild>
                    <button className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </Dialog.Close>
                </div>

                {selected.steps.length === 0 && <p className="text-sm italic text-slate-400">Hasn't run in this pipeline execution yet.</p>}

                {/* A block can run more than once in the same pipeline execution — email-sender
                    does, deliberately (modules/pipeline/service.js's STEPS comment) — so every
                    instance gets its own card, oldest first, rather than only showing one. */}
                {selected.steps.map((step, index) => (
                  <StepCard key={step.id} step={step} heading={selected.steps.length > 1 ? `Pass ${index + 1} of ${selected.steps.length}` : null} />
                ))}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
