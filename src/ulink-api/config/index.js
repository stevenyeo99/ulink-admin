require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

module.exports = {
  env,
  isProduction: env === 'production',
  port: parseInt(process.env.PORT, 10) || 3000,
  logLevel: process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  db: {
    enabled: parseBool(process.env.SUPABASE_DB_ENABLED, false),
    connectionString: process.env.SUPABASE_DB_CONN_STR,
    ssl: parseBool(process.env.SUPABASE_DB_SSL, true),
    pool: {
      max: parseInt(process.env.SUPABASE_DB_POOL_MAX, 10) || 10,
      min: parseInt(process.env.SUPABASE_DB_POOL_MIN, 10) || 0,
      idleTimeoutMillis: parseInt(process.env.SUPABASE_DB_POOL_IDLE_MS, 10) || 30000,
      connectionTimeoutMillis: parseInt(process.env.SUPABASE_DB_POOL_ACQUIRE_MS, 10) || 30000,
    },
  },

  llm: {
    baseUrl: process.env.LLM_URL || process.env.LM_URL,
    visionModel: process.env.MODEL,
    assistantModel: process.env.MODEL_ASSISTANT || process.env.MODEL,
    // Pass through the value supported by the selected model/server, e.g. low or off.
    reasoningEffort: process.env.LLM_REASONING_EFFORT || 'low',
    documentCheckingReasoningEffort: process.env.DOCUMENT_CHECKING_REASONING_EFFORT || 'medium',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS, 10) || 120000,
    maxImages: parseInt(process.env.LLM_MAX_IMAGES, 10) || 6,
    maxRequestBytes: parseInt(process.env.LLM_MAX_REQUEST_BYTES, 10) || 25 * 1000 * 1000,
  },

  embedding: {
    // Same LM Studio server as llm.baseUrl by default (EMBEDDING_URL overrides
    // independently, in case the embedding model ever moves to its own host).
    baseUrl: process.env.EMBEDDING_URL || process.env.LLM_URL || process.env.LM_URL,
    model: process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
    timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS, 10) || 30000,
    // Nomic Embed Text v1.5's actual output size at this model's default setting — verified
    // directly against the real LM Studio endpoint, not assumed from the model card. The
    // ulink_icd10_diagnoses.embedding column is a fixed vector(768); if this ever changes,
    // that column needs a matching migration, not just this config value.
    dimensions: 768,
  },

  claimRecognition: {
    // Cases processed per job run — bounds one run's total latency/LLM load.
    batchLimit: parseInt(process.env.CLAIM_RECOGNITION_BATCH_LIMIT, 10) || 5,
    // Below this, a route match still gets flagged MANUAL_REVIEW instead of RECOGNIZED.
    confidenceThreshold: parseFloat(process.env.CLAIM_RECOGNITION_CONFIDENCE_THRESHOLD) || 0.6,
    // 100 DPI verified reliable + fast in Day-1 testing; 200 DPI caused multi-minute hangs.
    rasterDpi: parseInt(process.env.CLAIM_RECOGNITION_RASTER_DPI, 10) || 100,
    // Per-page vision call budget. Typed pages converge well under this; this is a safety
    // cap, not a target — the claim-recognition calls use the supported low setting.
    maxTokensPerPage: parseInt(process.env.CLAIM_RECOGNITION_MAX_TOKENS_PER_PAGE, 10) || 800,
  },

  documentChecking: {
    // Pure code, no LLM/external call — safe to process a much larger batch per run
    // than claim-recognition.
    batchLimit: parseInt(process.env.DOCUMENT_CHECKING_BATCH_LIMIT, 10) || 50,
  },

  consoleUpload: {
    // Separate from storage.root (STORAGE_ROOT) on purpose — that's this app's own private
    // attachment store; this is a dedicated shared folder the console/ops side browses
    // directly.
    root: process.env.CONSOLE_UPLOAD_ROOT || './data/console-upload',
    // Real disk I/O (reads every attachment, writes a copy) per case — keep modest, same
    // reasoning as memberVerification's batch size.
    batchLimit: parseInt(process.env.CONSOLE_UPLOAD_BATCH_LIMIT, 10) || 20,
  },

  emailSender: {
    // Pure DB + one SMTP call per task — no LLM involved.
    batchLimit: parseInt(process.env.EMAIL_SENDER_BATCH_LIMIT, 10) || 20,
    // After this many failed attempts, a task is marked FAILED instead of retried
    // on the next run.
    maxAttempts: parseInt(process.env.EMAIL_SENDER_MAX_ATTEMPTS, 10) || 5,
    // SOP §11: member-verification findings ("Member/policy mismatch", "Bank detail
    // issue") are "hold and verify/escalate" internally, never a direct customer email —
    // MEMBER_VERIFY_ISSUE goes here instead of the case's own sender. No default: an
    // unset value fails loudly (see email-sender/service.js) rather than silently
    // emailing nobody.
    internalReviewEmail: process.env.INTERNAL_REVIEW_EMAIL || null,
  },

  memberVerification: {
    // One IAS call per case — keep the batch modest, unlike documentChecking's pure-code run.
    batchLimit: parseInt(process.env.MEMBER_VERIFICATION_BATCH_LIMIT, 10) || 20,
  },

  iasClaimPreparation: {
    // Two LLM calls per case (diagnosis pick, benefit pick) — keep modest, same reasoning
    // as memberVerification's batch size.
    batchLimit: parseInt(process.env.IAS_CLAIM_PREPARATION_BATCH_LIMIT, 10) || 20,
  },

  iasClaimCreation: {
    // One real, non-idempotent IAS API call per case — keep modest, same reasoning as
    // memberVerification's batch size.
    batchLimit: parseInt(process.env.IAS_CLAIM_CREATION_BATCH_LIMIT, 10) || 20,
  },

  csrUpload: {
    // Separate from storage.root/consoleUpload.root on purpose — its own dedicated shared
    // folder for downloaded CSR (Claim Settlement Report) PDFs.
    root: process.env.CSR_UPLOAD_ROOT || './data/csr-upload',
    // One IAS claim-status call (+ a download call, only once the report is ready) per
    // case — keep modest, same reasoning as memberVerification's batch size.
    batchLimit: parseInt(process.env.CSR_UPLOAD_BATCH_LIMIT, 10) || 20,
  },

  ias: {
    baseUrl: process.env.IAS_URL,
    getMemberInfoApi: process.env.GET_MEMBER_INFO_API,
    claimApi: process.env.CL_CLAIM_API,
    claimStatusApi: process.env.CL_CLAIM_STATUS_API,
    downloadFileApi: process.env.CL_DOWNLOAD_FILE_API,
    // Explicit and short, same reasoning as imap/linkedDocuments' own timeouts: an external
    // call must not be able to hang the job (see modules/member-verification/iasClient.js).
    timeoutMs: parseInt(process.env.IAS_TIMEOUT_MS, 10) || 30000,
  },

  linkedDocuments: {
    // Some generated claim PDFs reference a supporting photo by URL instead of embedding
    // it (verified against real sample data — a human reviewer clicked through and found
    // the linked document fine; the pipeline must not treat it as absent). Only hosts
    // listed here are ever fetched — this content is attacker-influenceable (anything in
    // an inbound email), so fetching is never opened up to arbitrary URLs found in it.
    // ayasompostorage01.blob.core.windows.net added 2026-09-14 — confirmed real host behind
    // AYA/ATOM's actual claim-notification emails' "File Attachments Link:" section (seen
    // only after unwrapping Microsoft Defender's Safe Links redirect — see
    // linkedDocuments.js's unwrapSafeLink).
    allowedHosts: (process.env.LINKED_DOCUMENTS_ALLOWED_HOSTS || 'as.expa.ai,ayasompostorage01.blob.core.windows.net')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    timeoutMs: parseInt(process.env.LINKED_DOCUMENTS_TIMEOUT_MS, 10) || 30000,
    maxBytes: parseInt(process.env.LINKED_DOCUMENTS_MAX_BYTES, 10) || 15 * 1000 * 1000,
  },

  imap: {
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT, 10) || 993,
    secure: parseBool(process.env.IMAP_TLS, true),
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    folder: process.env.IMAP_FOLDER || 'INBOX',
    fetchLimit: parseInt(process.env.IMAP_FETCH_LIMIT, 10) || 20,
    socketTimeoutMs: parseInt(process.env.IMAP_SOCKET_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMs: parseInt(process.env.IMAP_CONNECTION_TIMEOUT_MS, 10) || 30000,
    greetingTimeoutMs: parseInt(process.env.IMAP_GREETING_TIMEOUT_MS, 10) || 15000,
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    root: process.env.STORAGE_ROOT || './data/attachments',
  },

  channel: {
    driver: process.env.CHANNEL_DRIVER || 'imap_smtp',
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: parseBool(process.env.SMTP_TLS, false),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromAddr: process.env.SMTP_FROM || process.env.SMTP_USER,
    connectionTimeoutMs: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10) || 30000,
    // connectionTimeout alone only guards the initial connect — without these, a stall
    // after connecting (waiting on the server's greeting, or mid-send) falls back to
    // nodemailer's own defaults (30s / 10min), same gap imap's own block above already
    // closed with explicit values.
    greetingTimeoutMs: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS, 10) || 10000,
    socketTimeoutMs: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 10) || 30000,
  },

  pipeline: {
    // Backstop only, not the primary defense — every external call each block makes
    // already has its own timeout (ias.timeoutMs, imap.*TimeoutMs, smtp.*TimeoutMs,
    // linkedDocuments.timeoutMs). This exists because sequential orchestration means a
    // hang anywhere would otherwise stall every step behind it, unlike today where each
    // block only stalls its own independent cron line.
    stepTimeoutMs: parseInt(process.env.PIPELINE_STEP_TIMEOUT_MS, 10) || 300000,
  },
};
