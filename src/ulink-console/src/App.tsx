import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { BackgroundBlobs } from './components/layout/BackgroundBlobs';
import { TopBar } from './components/layout/TopBar';
import { WorkflowCanvas, type SelectedNode } from './components/workflow/WorkflowCanvas';
import { NodeDetailPanel } from './components/panel/NodeDetailPanel';
import { usePipelineRun } from './hooks/usePipelineRun';

export function App() {
  const { run, steps, isRunning, wasSkipped, isRateLimited, trigger } = usePipelineRun();
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <BackgroundBlobs />
      <TopBar run={run} isRunning={isRunning} wasSkipped={wasSkipped} isRateLimited={isRateLimited} onRun={trigger} />
      <main className="relative flex-1">
        <ReactFlowProvider>
          <WorkflowCanvas steps={steps} onSelectNode={setSelectedNode} />
        </ReactFlowProvider>
      </main>
      <NodeDetailPanel selected={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
