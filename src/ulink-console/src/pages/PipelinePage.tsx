import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { PipelineToolbar } from '../components/layout/PipelineToolbar';
import { WorkflowCanvas, type SelectedNode } from '../components/workflow/WorkflowCanvas';
import { NodeDetailPanel } from '../components/panel/NodeDetailPanel';
import { PipelineCompletionAlert } from '../components/workflow/PipelineCompletionAlert';
import { SourceTabs } from '../components/common/SourceTabs';
import { useSource } from '../hooks/useSource';
import { usePipelineRun } from '../hooks/usePipelineRun';
import type { Source } from '../types/pipeline';

// Email and API are separate orchestrators; each tab mounts its own view (key={source}), so
// runs, polling and the selected node never carry over between them.
export function PipelinePage() {
  const [source, setSource] = useSource();
  return <PipelineView key={source} source={source} onSourceChange={setSource} />;
}

function PipelineView({ source, onSourceChange }: { source: Source; onSourceChange: (source: Source) => void }) {
  const { run, steps, isRunning, wasSkipped, isRateLimited, trigger } = usePipelineRun(source);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <PipelineCompletionAlert run={run} />
      <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
        <SourceTabs source={source} onChange={onSourceChange} />
        <PipelineToolbar run={run} isRunning={isRunning} wasSkipped={wasSkipped} isRateLimited={isRateLimited} onRun={trigger} />
      </div>
      <main className="relative flex-1">
        <ReactFlowProvider>
          <WorkflowCanvas steps={steps} source={source} onSelectNode={setSelectedNode} />
        </ReactFlowProvider>
      </main>
      <NodeDetailPanel selected={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
