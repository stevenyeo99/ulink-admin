import { useEffect, useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, useReactFlow, type Node, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PipelineNode } from './PipelineNode';
import { PipelineEdge } from './PipelineEdge';
import { EmailBadgeNode } from './EmailBadgeNode';
import { mergeStatus, type PipelineNodeData, type EmailBadgeNodeData } from '../../graph/mergeStatus';
import type { BlockName, PipelineRunStep, Source } from '../../types/pipeline';

const nodeTypes = { pipelineNode: PipelineNode, emailBadgeNode: EmailBadgeNode };
const edgeTypes = { pipelineEdge: PipelineEdge };

function FocusRunningNode({ nodeId }: { nodeId?: string }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodeId) fitView({ nodes: [{ id: nodeId }], duration: 400, padding: 0.5 });
  }, [fitView, nodeId]);

  return null;
}

export interface SelectedNode {
  blockId: BlockName;
  label: string;
  description: string;
  steps: PipelineRunStep[];
}

interface WorkflowCanvasProps {
  steps: PipelineRunStep[];
  source?: Source;
  onSelectNode: (selected: SelectedNode) => void;
}

export function WorkflowCanvas({ steps, source = 'EMAIL', onSelectNode }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => mergeStatus(steps, source), [steps, source]);
  const runningNodeId = nodes.find((node) => (node.data as PipelineNodeData).status === 'RUNNING')?.id;

  // Email badges aren't real blocks (see EMAIL_BADGES in pipelineGraph.ts) — clicking one
  // opens the same detail as clicking the real email-sender job would, since it's the same
  // job's steps either way.
  const handleNodeClick: NodeMouseHandler<Node> = (_event, node) => {
    if (node.type === 'emailBadgeNode') {
      const data = node.data as EmailBadgeNodeData;
      onSelectNode({ blockId: 'email-sender', label: 'Email Sender', description: 'Sends queued customer + internal emails', steps: data.steps });
      return;
    }
    const data = node.data as PipelineNodeData;
    onSelectNode({ blockId: node.id as BlockName, label: data.label, description: data.description, steps: data.steps });
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.4}
      maxZoom={1.25}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
    >
      <FocusRunningNode nodeId={runningNodeId} />
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(15, 23, 42, 0.08)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
