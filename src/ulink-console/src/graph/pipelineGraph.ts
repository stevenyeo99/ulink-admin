import type { BlockName } from '../types/pipeline';
import type { Audience } from './audienceStyle';

export interface BlockMeta {
  id: BlockName;
  label: string;
  description: string;
  x: number;
  y: number;
}

// A small "mail sent" chip drawn directly under the one real producer it reports, instead of
// email-sender's own box (see EMAIL_BADGES below for why there's no separate email-sender
// BlockMeta/node anymore). `id` is intentionally NOT a BlockName — this isn't a second job,
// just 3 views of the one real email-sender job's status, attached at 3 points in the graph.
export interface EmailBadgeMeta {
  id: string;
  producer: BlockName;
  label: string;
  audience: Audience;
  x: number;
  y: number;
}

export interface StaticEdge {
  id: string;
  source: BlockName;
  target: BlockName;
  sourceHandle: 'source-right' | 'source-bottom';
  targetHandle: 'target-left' | 'target-top';
  /** 'main' = the Case.currentStatus chain each job filters on. */
  kind: 'main';
}

// Short vertical drop from a producer straight down to its own EMAIL_BADGES chip — see
// EmailBadgeMeta above. Separate type from StaticEdge because the target is a badge id, not
// a real BlockName.
export interface EmailBadgeEdge {
  id: string;
  source: BlockName;
  target: string;
  sourceHandle: 'source-bottom';
  targetHandle: 'target-top';
  kind: 'branch';
}

// Positions describe the real architecture (jobs-registry.md): email-sender is a shared
// consumer fed by three producers, not a 4th step in this chain — so it's not a BlockMeta at
// all anymore (see EMAIL_BADGES below). The 6 entries here are exactly the main
// Case.currentStatus chain.
export const BLOCKS: BlockMeta[] = [
  { id: 'email-intake', label: 'Email Intake', description: 'Reads unseen IMAP mail, stores attachments', x: 0, y: 160 },
  { id: 'claim-recognition', label: 'Claim Recognition', description: 'Vision + LLM extraction, route decision', x: 300, y: 160 },
  { id: 'member-verification', label: 'Member Verification', description: 'IAS member lookup + field checks', x: 600, y: 160 },
  { id: 'document-checking', label: 'Document Checking', description: 'Deterministic completeness checklist', x: 900, y: 160 },
  { id: 'ias-claim-preparation', label: 'Claim Preparation', description: 'ICD-10 pick, benefit pick, payload build', x: 1200, y: 160 },
  { id: 'ias-claim-creation', label: 'Claim Creation', description: 'Submits to IAS, assigns claim number', x: 1500, y: 160 },
];

export const EDGES: StaticEdge[] = [
  { id: 'e-intake-recognition', source: 'email-intake', target: 'claim-recognition', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-recognition-verification', source: 'claim-recognition', target: 'member-verification', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-verification-checking', source: 'member-verification', target: 'document-checking', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-checking-preparation', source: 'document-checking', target: 'ias-claim-preparation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
  { id: 'e-preparation-creation', source: 'ias-claim-preparation', target: 'ias-claim-creation', sourceHandle: 'source-right', targetHandle: 'target-left', kind: 'main' },
];

// One badge per producer, drawn directly under it (same x, a short y-offset — a plain
// vertical drop, never crossing the main chain above). Previously these were one shared
// "email-sender" box at a distant fixed position with 3 long edges converging into it
// (the ias-claim-creation edge in particular had to travel back left, under the whole main
// chain, to reach it) — confusing which producer a given email actually came from. Labels
// name the actual EmailTask.taskType(s) each producer queues (see
// modules/email-sender/templates.js's RENDERERS), and `audience` is who receives it
// (SOP §11/§13: several findings are held/escalated internally, never sent to the customer
// directly — see modules/email-sender/service.js's INTERNAL_ONLY_TASK_TYPES). Each producer
// here is uniformly one audience today, so one badge per producer is enough.
export const EMAIL_BADGES: EmailBadgeMeta[] = [
  {
    id: 'email-badge-member-verification',
    producer: 'member-verification',
    label: 'MEMBER_VERIFY_ISSUE',
    audience: 'internal',
    x: 600,
    y: 300,
  },
  {
    id: 'email-badge-document-checking',
    producer: 'document-checking',
    label: 'MISSING_DOCUMENTS · DOCUMENT_COMPLETE_ACK',
    audience: 'customer',
    x: 900,
    y: 300,
  },
  // ias-claim-creation's emails are internal-only, not the customer-facing
  // CLAIM_CREATED_NOTIFICATION this used to be — that taskType was removed (2026-09-14):
  // this system can't detect JD2's later approval, so the customer's claim-number notice
  // is now a manual step for ops, not automatic. CLAIM_APPROVAL_REVIEW is the SOP §13
  // "ready for JD2 handover" signal instead.
  {
    id: 'email-badge-ias-claim-creation',
    producer: 'ias-claim-creation',
    label: 'CLAIM_APPROVAL_REVIEW · CLAIM_SUBMIT_ISSUE',
    audience: 'internal',
    x: 1500,
    y: 300,
  },
];

export const EMAIL_BADGE_EDGES: EmailBadgeEdge[] = EMAIL_BADGES.map((badge) => ({
  id: `e-${badge.producer}-${badge.id}`,
  source: badge.producer,
  target: badge.id,
  sourceHandle: 'source-bottom',
  targetHandle: 'target-top',
  kind: 'branch',
}));
