// Mirrors ulink-api/src/db/models/pipelineRun.js and pipelineRunStep.js exactly —
// keep these in sync if those models change.

export type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

export type RunStatus = 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

// Matches modules/pipeline/service.js's STEPS order — the block names PipelineRunStep rows
// are keyed by (blockName).
export type BlockName =
  | 'email-intake'
  | 'claim-recognition'
  | 'document-checking'
  | 'member-verification'
  | 'email-sender'
  | 'ias-claim-preparation'
  | 'ias-claim-creation';

export interface PipelineRunStep {
  id: string;
  pipelineRunId: string;
  blockName: BlockName;
  sequence: number;
  status: StepStatus;
  skipReason: string | null;
  resultSummary: unknown | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PipelineRun {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  PipelineRunSteps?: PipelineRunStep[];
}

export interface RunPipelineResponse {
  block: 'pipeline';
  started?: boolean;
  runId?: string;
  skipped?: boolean;
  reason?: string;
}

export interface ListRunsResponse {
  runs: PipelineRun[];
}

export interface GetRunResponse {
  run: PipelineRun;
}
