import type { BlockName, EmailSenderBlockName } from '../types/pipeline';
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
  blockName: EmailSenderBlockName;
  label: string;
  audience: Audience;
  x: number;
  y: number;
}

export interface StaticEdge {
  id: string;
  source: BlockName;
  target: BlockName;
  sourceHandle: 'source-bottom';
  targetHandle: 'target-top';
  /** 'main' = the Case.currentStatus chain each job filters on. */
  kind: 'main';
}

// Short horizontal branch from a producer out to its own EMAIL_BADGES chip — see
// EmailBadgeMeta above. Separate type from StaticEdge because the target is a badge id, not
// a real BlockName.
export interface EmailBadgeEdge {
  id: string;
  source: BlockName;
  target: string;
  sourceHandle: 'source-right';
  targetHandle: 'target-left';
  kind: 'branch';
}

// Top-to-bottom main chain (2026-09-15: switched from left-to-right — a growing job count
// just makes the canvas taller, which scrolls naturally for a narrated demo, instead of
// forcing progressively more zoom-out the way a widening left-to-right chain did). email-
// sender is a shared consumer fed by three producers, not a 4th step in this chain — so it's
// not a BlockMeta at all (see EMAIL_BADGES below).
export const BLOCKS: BlockMeta[] = [
  { id: 'email-intake', label: 'Email Intake', description: 'Reads unseen IMAP mail, stores attachments', x: 0, y: 0 },
  { id: 'claim-recognition', label: 'Claim Recognition', description: 'Vision + LLM extraction, route decision', x: 0, y: 190 },
  { id: 'member-verification', label: 'Member Verification', description: 'IAS member lookup + field checks', x: 0, y: 380 },
  { id: 'document-checking', label: 'Document Checking', description: 'Deterministic completeness checklist', x: 0, y: 570 },
  // Added 2026-09-15 — AYAS reimbursement route only (Case.recognizedType==='ayas_member_claim'),
  // copies the case's documents to the shared console folder and generates its barcode
  // before ias-claim-preparation needs it. MEMBER_VERIFIED -> DOCUMENTS_UPLOADED.
  { id: 'console-upload', label: 'Console Upload', description: 'Copies docs to console folder, generates barcode', x: 0, y: 760 },
  { id: 'ias-claim-preparation', label: 'Claim Preparation', description: 'ICD-10 pick, benefit pick, payload build', x: 0, y: 950 },
  { id: 'ias-claim-creation', label: 'Claim Creation', description: 'Submits to IAS, assigns claim number', x: 0, y: 1140 },
  // Added 2026-09-15 — isStp claims only: polls IAS claim-status for the settlement report
  // (CSR), downloads it once ready, emails it to the customer. CLAIM_CREATED -> CSR_SENT.
  { id: 'ias-claim-stp', label: 'Claim STP', description: 'Downloads CSR, emails customer (STP claims only)', x: 0, y: 1330 },
];

export const EDGES: StaticEdge[] = [
  { id: 'e-intake-recognition', source: 'email-intake', target: 'claim-recognition', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-recognition-verification', source: 'claim-recognition', target: 'member-verification', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-verification-checking', source: 'member-verification', target: 'document-checking', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-checking-upload', source: 'document-checking', target: 'console-upload', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-upload-preparation', source: 'console-upload', target: 'ias-claim-preparation', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-preparation-creation', source: 'ias-claim-preparation', target: 'ias-claim-creation', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-creation-stp', source: 'ias-claim-creation', target: 'ias-claim-stp', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
];

// One badge per producer, drawn directly beside it (same y, an x-offset to the right — a
// plain horizontal branch, never crossing the main chain). Previously these were one shared
// "email-sender" box at a distant fixed position with 3 long edges converging into it
// (confusing which producer a given email actually came from) — see this file's git history
// for that version. Labels name the actual EmailTask.taskType(s) each producer queues (see
// modules/email-sender/templates.js's RENDERERS), and `audience` is who receives it
// (SOP §11/§13: several findings are held/escalated internally, never sent to the customer
// directly — see modules/email-sender/service.js's INTERNAL_ONLY_TASK_TYPES). Each producer
// here is uniformly one audience today, so one badge per producer is enough.
export const EMAIL_BADGES: EmailBadgeMeta[] = [
  {
    id: 'email-badge-member-verification',
    producer: 'member-verification',
    blockName: 'email-sender-member-verification',
    label: 'MEMBER_VERIFY_ISSUE',
    audience: 'internal',
    x: 300,
    y: 380,
  },
  {
    id: 'email-badge-document-checking',
    producer: 'document-checking',
    blockName: 'email-sender-document-checking',
    label: 'MISSING_DOCUMENTS · DOCUMENT_COMPLETE_ACK',
    audience: 'customer',
    x: 300,
    y: 570,
  },
  // ias-claim-creation's emails are internal-only, not the customer-facing
  // CLAIM_CREATED_NOTIFICATION this used to be — that taskType was removed (2026-09-14):
  // this system can't detect JD2's later approval, so the customer's claim-number notice
  // is now a manual step for ops, not automatic. CLAIM_APPROVAL_REVIEW is the SOP §13
  // "ready for JD2 handover" signal instead.
  {
    id: 'email-badge-ias-claim-creation',
    producer: 'ias-claim-creation',
    blockName: 'email-sender-claim-approval-review',
    label: 'CLAIM_APPROVAL_REVIEW · CLAIM_SUBMIT_ISSUE',
    audience: 'internal',
    x: 300,
    y: 1140,
  },
  // CSR_REPORT is customer-facing (the settlement report itself, with the PDF attached) —
  // unlike ias-claim-creation's internal-only emails above.
  {
    id: 'email-badge-ias-claim-stp',
    producer: 'ias-claim-stp',
    blockName: 'email-sender-csr-report',
    label: 'CSR_REPORT',
    audience: 'customer',
    x: 300,
    y: 1330,
  },
];

export const EMAIL_BADGE_EDGES: EmailBadgeEdge[] = EMAIL_BADGES.map((badge) => ({
  id: `e-${badge.producer}-${badge.id}`,
  source: badge.producer,
  target: badge.id,
  sourceHandle: 'source-right',
  targetHandle: 'target-left',
  kind: 'branch',
}));

// API case workflow (modules/pipeline/service.js API_STEPS, docs/imp/day1/api-case-workflow.md).
// Its own chain on the console's API tab — grows as each API job ships. No email badges yet:
// API emails arrive with document/member checking (Phase 6).
export const API_BLOCKS: BlockMeta[] = [
  { id: 'api-claim-intake', label: 'API Claim Intake', description: "Lists today's IAS API claims, one case per claim", x: 0, y: 0 },
  { id: 'api-material-download', label: 'Material Download', description: 'Downloads console images via the middleware zip', x: 0, y: 190 },
  { id: 'api-claim-recognition', label: 'Claim Recognition', description: 'Same OCR + extraction as email (AYAS member claim)', x: 0, y: 380 },
  { id: 'api-member-verification', label: 'Member Verification', description: 'Same IAS member lookup + checks as email', x: 0, y: 570 },
  { id: 'api-document-checking', label: 'Document Checking', description: 'Same completeness checklist as email', x: 0, y: 760 },
];

export const API_EDGES: StaticEdge[] = [
  { id: 'e-api-intake-download', source: 'api-claim-intake', target: 'api-material-download', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-api-download-recognition', source: 'api-material-download', target: 'api-claim-recognition', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-api-recognition-member', source: 'api-claim-recognition', target: 'api-member-verification', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
  { id: 'e-api-member-documents', source: 'api-member-verification', target: 'api-document-checking', sourceHandle: 'source-bottom', targetHandle: 'target-top', kind: 'main' },
];

// Same presentation as the email tab: a badge beside each job that asks for an email, showing the
// one api-email-sender step that sends them all (the email pipeline splits its sender per
// category; the API pipeline runs it once, so every API badge shows that same step).
export const API_EMAIL_BADGES: EmailBadgeMeta[] = [
  { id: 'api-email-badge-material-download', producer: 'api-material-download', blockName: 'api-email-sender', label: 'MISSING_DOCUMENTS (no images)', audience: 'customer', x: 300, y: 190 },
  { id: 'api-email-badge-member-verification', producer: 'api-member-verification', blockName: 'api-email-sender', label: 'MEMBER_VERIFY_ISSUE', audience: 'internal', x: 300, y: 570 },
  { id: 'api-email-badge-document-checking', producer: 'api-document-checking', blockName: 'api-email-sender', label: 'MISSING_DOCUMENTS · DOCUMENT_COMPLETE_ACK', audience: 'customer', x: 300, y: 760 },
];

export const API_EMAIL_BADGE_EDGES: EmailBadgeEdge[] = API_EMAIL_BADGES.map((badge) => ({
  id: `e-${badge.producer}-${badge.id}`,
  source: badge.producer,
  target: badge.id,
  sourceHandle: 'source-right',
  targetHandle: 'target-left',
  kind: 'branch',
}));
