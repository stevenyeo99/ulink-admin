import type { BlockName } from '../types/pipeline';

export interface BlockMeta {
  id: BlockName;
  label: string;
  description: string;
  x: number;
  y: number;
}

export interface StaticEdge {
  id: string;
  source: BlockName;
  target: BlockName;
  sourceHandle: 'source-right' | 'source-bottom';
  targetHandle: 'target-left' | 'target-top';
  /** 'main' = the Case.currentStatus chain each job filters on. 'branch' = email-sender's
   * shared-consumer relationship to its three producers (see jobs-registry.md) — it queues
   * from all three, doesn't gate any of them. */
  kind: 'main' | 'branch';
  label?: string;
}

// Positions describe the real architecture (jobs-registry.md), not just the linear STEPS
// array in modules/pipeline/service.js: email-sender is a shared consumer fed by two
// producers, drawn as a branch below the main Case.currentStatus chain rather than inline
// with it.
export const BLOCKS: BlockMeta[] = [
  { id: 'email-intake', label: 'Email Intake', description: 'Reads unseen IMAP mail, stores attachments', x: 0, y: 160 },
  { id: 'claim-recognition', label: 'Claim Recognition', description: 'Vision + LLM extraction, route decision', x: 300, y: 160 },
  { id: 'member-verification', label: 'Member Verification', description: 'IAS member lookup + field checks', x: 600, y: 160 },
  { id: 'document-checking', label: 'Document Checking', description: 'Deterministic completeness checklist', x: 900, y: 160 },
  { id: 'ias-claim-preparation', label: 'Claim Preparation', description: 'ICD-10 pick, benefit pick, payload build', x: 1200, y: 160 },
  { id: 'ias-claim-creation', label: 'Claim Creation', description: 'Submits to IAS, assigns claim number', x: 1500, y: 160 },
  { id: 'email-sender', label: 'Email Sender', description: 'Sends queued customer replies', x: 750, y: 400 },
];

export const EDGES: StaticEdge[] = [
  { id: 'e-intake-recognition', source: 'email-intake', target: 'claim-recognition', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-recognition-verification', source: 'claim-recognition', target: 'member-verification', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-verification-checking', source: 'member-verification', target: 'document-checking', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-checking-preparation', source: 'document-checking', target: 'ias-claim-preparation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-preparation-creation', source: 'ias-claim-preparation', target: 'ias-claim-creation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-verification-sender', source: 'member-verification', target: 'email-sender', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'branch', label: 'on REVIEW REQUIRED' },
  { id: 'e-checking-sender', source: 'document-checking', target: 'email-sender', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'branch', label: 'on VERIFIED / INCOMPLETE' },
  // email-sender runs a second time after ias-claim-creation (see modules/pipeline/service.js's
  // STEPS comment) specifically to send CLAIM_CREATED_NOTIFICATION the same run — a third
  // producer feeding the same shared consumer, same as the two branches above.
  { id: 'e-creation-sender', source: 'ias-claim-creation', target: 'email-sender', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'branch', label: 'on CLAIM_CREATED' },
];
