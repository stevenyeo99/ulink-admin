import type { Edge, Node } from '@xyflow/react';
import { BLOCKS, EDGES } from './pipelineGraph';
import type { PipelineRunStep, StepStatus } from '../types/pipeline';

export type NodeStatus = 'IDLE' | StepStatus;

export interface PipelineNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  status: NodeStatus;
  /** Usually one entry. email-sender runs twice per pipeline execution (see
   * modules/pipeline/service.js's STEPS comment) — a block can legitimately have more than
   * one PipelineRunStep row in the same run, so this is always an array, oldest first. */
  steps: PipelineRunStep[];
}

const DONE_LIKE: NodeStatus[] = ['DONE', 'SKIPPED'];

// Precedence for collapsing multiple same-block step rows into one node badge. RUNNING
// first so a live call is never hidden behind an already-finished earlier pass; FAILED
// next so a real failure in an earlier pass is never masked by a later pass's success
// (e.g. email-sender's first call failing to send a missing-doc email shouldn't be hidden
// just because its second call — usually a no-op — came back DONE). PENDING is a brief
// transitional state (the row exists before its lock is acquired). Between DONE and
// SKIPPED, DONE wins — it represents a pass that actually did something.
const STATUS_PRECEDENCE: NodeStatus[] = ['RUNNING', 'FAILED', 'PENDING', 'DONE', 'SKIPPED'];

function representativeStatus(steps: PipelineRunStep[]): NodeStatus {
  if (steps.length === 0) return 'IDLE';
  const present = new Set(steps.map((step) => step.status));
  return STATUS_PRECEDENCE.find((status) => present.has(status as StepStatus)) ?? steps[steps.length - 1].status;
}

/**
 * Pure merge of the static graph layout (pipelineGraph.ts) with a run's live
 * PipelineRunStep[] (grouped by blockName) into React Flow's node/edge shape. Kept separate
 * from the graph layout itself and from WorkflowCanvas's rendering so the "what does the
 * data mean" logic has exactly one place to live.
 */
export function mergeStatus(steps: PipelineRunStep[]): { nodes: Node<PipelineNodeData>[]; edges: Edge[] } {
  const stepsByBlock = new Map<string, PipelineRunStep[]>();
  for (const step of steps) {
    const existing = stepsByBlock.get(step.blockName);
    if (existing) existing.push(step);
    else stepsByBlock.set(step.blockName, [step]);
  }

  const nodes: Node<PipelineNodeData>[] = BLOCKS.map((block) => {
    const blockSteps = stepsByBlock.get(block.id) ?? [];
    return {
      id: block.id,
      type: 'pipelineNode',
      position: { x: block.x, y: block.y },
      // Explicit dimensions (matching PipelineNode.tsx's own w-[220px] card, height padded
      // generously for its 2-line description) so React Flow can lay out nodes/edges
      // immediately instead of waiting on a ResizeObserver measurement pass — confirmed
      // that measurement can silently never complete in some environments (headless
      // Chromium here), leaving every node stuck at visibility:hidden indefinitely.
      width: 220,
      height: 108,
      data: {
        label: block.label,
        description: block.description,
        status: representativeStatus(blockSteps),
        steps: blockSteps,
      },
    };
  });

  const statusOf = (id: string): NodeStatus => nodes.find((n) => n.id === id)?.data.status ?? 'IDLE';

  const edges: Edge[] = EDGES.map((edge) => {
    const sourceStatus = statusOf(edge.source);
    const targetStatus = statusOf(edge.target);
    const isActive = targetStatus === 'RUNNING';
    const isComplete = DONE_LIKE.includes(sourceStatus) && DONE_LIKE.includes(targetStatus);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'pipelineEdge',
      label: edge.label,
      data: { kind: edge.kind, isActive, isComplete },
      animated: isActive,
    };
  });

  return { nodes, edges };
}
