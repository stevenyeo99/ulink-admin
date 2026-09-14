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
  /** Who the email(s) this edge represents actually go to — customer-facing vs. internal
   * ops (SOP §11/§13: several findings are held/escalated internally, never sent to the
   * customer directly; see modules/email-sender/service.js's INTERNAL_ONLY_TASK_TYPES).
   * Only meaningful on 'branch' edges. */
  audience?: 'customer' | 'internal';
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
  { id: 'email-sender', label: 'Email Sender', description: 'Sends queued customer + internal emails', x: 750, y: 400 },
];

// Branch edge labels name the actual EmailTask.taskType(s) each producer queues (see
// modules/email-sender/templates.js's RENDERERS) — not a vague "on <status>" description —
// so it's visible at a glance which specific email fires and, via `audience`, who receives
// it. Each producer here is uniformly one audience today (no producer mixes customer and
// internal emails), so one edge per producer is enough — no need for parallel edges.
export const EDGES: StaticEdge[] = [
  { id: 'e-intake-recognition', source: 'email-intake', target: 'claim-recognition', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-recognition-verification', source: 'claim-recognition', target: 'member-verification', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-verification-checking', source: 'member-verification', target: 'document-checking', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-checking-preparation', source: 'document-checking', target: 'ias-claim-preparation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-preparation-creation', source: 'ias-claim-preparation', target: 'ias-claim-creation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  {
    id: 'e-verification-sender',
    source: 'member-verification',
    target: 'email-sender',
    sourceHandle: 'source-bottom',
    targetHandle: 'target-top',
    kind: 'branch',
    label: 'MEMBER_VERIFY_ISSUE',
    audience: 'internal',
  },
  {
    id: 'e-checking-sender',
    source: 'document-checking',
    target: 'email-sender',
    sourceHandle: 'source-bottom',
    targetHandle: 'target-top',
    kind: 'branch',
    label: 'MISSING_DOCUMENTS · DOCUMENT_COMPLETE_ACK',
    audience: 'customer',
  },
  // ias-claim-creation's emails are internal-only, not the customer-facing
  // CLAIM_CREATED_NOTIFICATION this used to be — that taskType was removed (2026-09-14):
  // this system can't detect JD2's later approval, so the customer's claim-number notice
  // is now a manual step for ops, not automatic. CLAIM_APPROVAL_REVIEW is the SOP §13
  // "ready for JD2 handover" signal instead.
  {
    id: 'e-creation-sender',
    source: 'ias-claim-creation',
    target: 'email-sender',
    sourceHandle: 'source-bottom',
    targetHandle: 'target-top',
    kind: 'branch',
    label: 'CLAIM_APPROVAL_REVIEW · CLAIM_SUBMIT_ISSUE',
    audience: 'internal',
  },
];
