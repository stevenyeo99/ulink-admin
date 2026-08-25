import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, type Node, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PipelineNode } from './PipelineNode';
import { PipelineEdge } from './PipelineEdge';
import { mergeStatus, type PipelineNodeData } from '../../graph/mergeStatus';
import type { BlockName, PipelineRunStep } from '../../types/pipeline';

const nodeTypes = { pipelineNode: PipelineNode };
const edgeTypes = { pipelineEdge: PipelineEdge };

export interface SelectedNode {
  blockId: BlockName;
  label: string;
  description: string;
  steps: PipelineRunStep[];
}

interface WorkflowCanvasProps {
  steps: PipelineRunStep[];
  onSelectNode: (selected: SelectedNode) => void;
}

export function WorkflowCanvas({ steps, onSelectNode }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => mergeStatus(steps), [steps]);

  const handleNodeClick: NodeMouseHandler<Node<PipelineNodeData>> = (_event, node) => {
    onSelectNode({ blockId: node.id as BlockName, label: node.data.label, description: node.data.description, steps: node.data.steps });
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
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(15, 23, 42, 0.08)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
