import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps, type Edge } from '@xyflow/react';

export interface PipelineEdgeData extends Record<string, unknown> {
  kind: 'main' | 'branch';
  isActive: boolean;
  isComplete: boolean;
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
            className="pointer-events-none absolute rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
