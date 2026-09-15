import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import clsx from 'clsx';
import { Mail } from 'lucide-react';
import type { EmailBadgeNodeData } from '../../graph/mergeStatus';
import { AUDIENCE_STYLE } from '../../graph/audienceStyle';
import { StatusBadge } from './StatusBadge';

const AUDIENCE_TEXT: Record<'customer' | 'internal', string> = {
  customer: 'Customer',
  internal: 'Internal',
};

/**
 * The one real email-sender job, shown as a small chip directly beside whichever producer
 * queued the email — deliberately NOT styled like PipelineNode's full card, so it reads as
 * "a side-effect of the block beside it", not a step in the main top-to-bottom chain. See
 * EMAIL_BADGES' doc comment in pipelineGraph.ts for why there are 3 of these instead of one
 * shared box.
 */
export function EmailBadgeNode({ data }: NodeProps<Node<EmailBadgeNodeData>>) {
  return (
    <div className="w-[220px] rounded-full border border-slate-900/5 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-xl">
      <Handle type="target" id="target-left" position={Position.Left} className="!h-0 !w-0 !min-w-0 !border-0 !bg-transparent" />

      <div className="flex items-center gap-2">
        <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', AUDIENCE_STYLE[data.audience])}>
          <Mail size={11} />
        </span>
        <span className={clsx('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', AUDIENCE_STYLE[data.audience])}>
          {AUDIENCE_TEXT[data.audience]}
        </span>
        <StatusBadge status={data.status} className="ml-auto shrink-0" />
      </div>
      <p className="mt-1 truncate text-[10px] leading-tight text-slate-500" title={data.label}>
        {data.label}
      </p>
    </div>
  );
}
