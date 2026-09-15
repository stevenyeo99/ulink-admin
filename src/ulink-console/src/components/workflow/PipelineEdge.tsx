import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps, type Edge } from '@xyflow/react';
import clsx from 'clsx';
import { AUDIENCE_STYLE, type Audience } from '../../graph/audienceStyle';

export interface PipelineEdgeData extends Record<string, unknown> {
  kind: 'main' | 'branch';
  isActive: boolean;
  isComplete: boolean;
  /** Who the email(s) on this edge go to. Only set on an edge that still carries its own
   * label (today: none — the 3 producer→email-badge edges show this on the badge node
   * instead, see EmailBadgeNode.tsx). Kept here so a future labeled edge has somewhere to
   * put it without reinventing this pill. */
  audience?: Audience;
}

export function PipelineEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
}: EdgeProps<Edge<PipelineEdgeData>>) {
  const isBranch = data?.kind === 'branch';
  const [path, labelX, labelY] = isBranch
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  const color = data?.isActive ? 'var(--ulink-orange)' : data?.isComplete ? 'var(--ulink-teal)' : '#cbd5e1';

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: color,
          strokeWidth: data?.isActive ? 2.5 : 1.75,
          strokeDasharray: isBranch ? '5 4' : undefined,
        }}
        className={data?.isActive ? 'edge-flowing' : undefined}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={clsx(
              'pointer-events-none absolute rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm',
              data?.audience ? AUDIENCE_STYLE[data.audience] : 'bg-white/90 text-slate-500'
            )}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
