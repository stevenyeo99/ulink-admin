import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { PipelineToolbar } from '../components/layout/PipelineToolbar';
import { WorkflowCanvas, type SelectedNode } from '../components/workflow/WorkflowCanvas';
import { NodeDetailPanel } from '../components/panel/NodeDetailPanel';
import { usePipelineRun } from '../hooks/usePipelineRun';

export function PipelinePage() {
  const { run, steps, isRunning, wasSkipped, isRateLimited, trigger } = usePipelineRun();
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <PipelineToolbar run={run} isRunning={isRunning} wasSkipped={wasSkipped} isRateLimited={isRateLimited} onRun={trigger} />
      <main className="relative flex-1">
        <ReactFlowProvider>
          <WorkflowCanvas steps={steps} onSelectNode={setSelectedNode} />
        </ReactFlowProvider>
      </main>
      <NodeDetailPanel selected={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
