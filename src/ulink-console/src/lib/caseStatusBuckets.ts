// Groups the real Case.currentStatus values (see ulink-api's jobs-registry.md) into a
// handful of buckets a person scanning the case list actually cares about. Lives here, not
// on the backend — this is purely a UI grouping, the API just returns the raw status.
export type StatusBucket = 'Needs Review' | 'In Progress' | 'Succeeded' | 'Failed';

const BUCKET_MAP: Record<string, StatusBucket> = {
  EMAIL_RECEIVED: 'In Progress',
  ATTACHMENTS_STORED: 'In Progress',
  READY_FOR_DOCUMENT_READING: 'In Progress',
  RECOGNIZED: 'In Progress',
  READY_FOR_DOCUMENT_CHECKING: 'In Progress',
  MEMBER_VERIFIED: 'In Progress',
  CLAIM_PAYLOAD_PREPARED: 'In Progress',
  INCOMPLETE: 'Needs Review',
  MEMBER_REVIEW_REQUIRED: 'Needs Review',
  CLAIM_CREATED: 'Succeeded',
  NOT_RECOGNIZED: 'Failed',
  MANUAL_REVIEW: 'Failed',
  CLAIM_SUBMIT_FAILED: 'Failed',
};

export function bucketOf(status: string): StatusBucket {
  return BUCKET_MAP[status] ?? 'In Progress';
}

export const STATUS_BUCKET_FILTERS: Array<'All' | StatusBucket> = ['All', 'Needs Review', 'In Progress', 'Succeeded', 'Failed'];

const LABELS: Record<string, string> = {
  EMAIL_RECEIVED: 'Email Received',
  ATTACHMENTS_STORED: 'Attachments Stored',
  READY_FOR_DOCUMENT_READING: 'Ready for Reading',
  RECOGNIZED: 'Recognized',
  READY_FOR_DOCUMENT_CHECKING: 'Ready for Document Checking',
  MEMBER_VERIFIED: 'Member Verified',
  CLAIM_PAYLOAD_PREPARED: 'Claim Prepared',
  INCOMPLETE: 'Incomplete',
  MEMBER_REVIEW_REQUIRED: 'Member Review',
  CLAIM_CREATED: 'Claim Created',
  NOT_RECOGNIZED: 'Not Recognized',
  MANUAL_REVIEW: 'Manual Review',
  CLAIM_SUBMIT_FAILED: 'Claim Submit Failed',
};

export function humanizeStatus(status: string): string {
  return LABELS[status] ?? status.replace(/_/g, ' ').replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
}
