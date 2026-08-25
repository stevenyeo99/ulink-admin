import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import clsx from 'clsx';
import { Mail, ScanSearch, ClipboardCheck, UserCheck, SendHorizonal, FileText, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { BlockName } from '../../types/pipeline';
import type { PipelineNodeData } from '../../graph/mergeStatus';
import { StatusBadge } from './StatusBadge';

const ICONS: Record<BlockName, LucideIcon> = {
  'email-intake': Mail,
  'claim-recognition': ScanSearch,
  'document-checking': ClipboardCheck,
  'member-verification': UserCheck,
  'email-sender': SendHorizonal,
  'ias-claim-preparation': FileText,
  'ias-claim-creation': ShieldCheck,
};

const handleClass = '!h-0 !w-0 !min-w-0 !border-0 !bg-transparent';

export function PipelineNode({ id, data, selected }: NodeProps<Node<PipelineNodeData>>) {
  const Icon = ICONS[id as BlockName];
  const isRunning = data.status === 'RUNNING';
  const isFailed = data.status === 'FAILED';
  const isDone = data.status === 'DONE';

  return (
    <div
      className={clsx(
        'w-[220px] rounded-xl2 border bg-white/90 p-4 shadow-node backdrop-blur-xl transition-shadow duration-300',
        isRunning && 'border-ulink-orange/40 animate-pulse-glow',
        isFailed && 'border-red-300 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]',
        isDone && 'border-ulink-teal/30',
        !isRunning && !isFailed && !isDone && 'border-slate-900/5',
        selected && 'ring-2 ring-ulink-orange/50'
      )}
    >
      <Handle type="target" id="target-left" position={Position.Left} className={handleClass} />
      <Handle type="target" id="target-top" position={Position.Top} className={handleClass} />

      <div className="mb-2.5 flex items-center justify-between">
        <span
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-full',
            isRunning && 'bg-ulink-orange/15 text-ulink-orange-dark',
            isDone && 'bg-ulink-teal/15 text-ulink-teal-dark',
            isFailed && 'bg-red-100 text-red-600',
            !isRunning && !isDone && !isFailed && 'bg-slate-100 text-slate-500'
          )}
        >
          <Icon size={15} />
        </span>
        <StatusBadge status={data.status} />
      </div>

      <p className="text-[13px] font-semibold leading-tight text-slate-900">{data.label}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{data.description}</p>

      <Handle type="source" id="source-right" position={Position.Right} className={handleClass} />
      <Handle type="source" id="source-bottom" position={Position.Bottom} className={handleClass} />
    </div>
  );
}
