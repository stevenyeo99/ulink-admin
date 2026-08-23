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
    // 'none' is a hard-won default, not a style choice: this model runs an unbounded
    // "thinking" pass on hard vision content (e.g. handwriting) that never converges
    // even with a large max_tokens budget (verified against the real sample docs).
    // 'none' eliminates that hang entirely with no accuracy cost on the typed content
    // this pipeline actually relies on. See modules/claim-recognition.
    reasoningEffort: process.env.LLM_REASONING_EFFORT || 'none',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS, 10) || 120000,
    maxImages: parseInt(process.env.LLM_MAX_IMAGES, 10) || 6,
    maxRequestBytes: parseInt(process.env.LLM_MAX_REQUEST_BYTES, 10) || 25 * 1000 * 1000,
  },

  claimRecognition: {
    // Cases processed per job run — bounds one run's total latency/LLM load.
    batchLimit: parseInt(process.env.CLAIM_RECOGNITION_BATCH_LIMIT, 10) || 5,
    // Below this, a route match still gets flagged MANUAL_REVIEW instead of RECOGNIZED.
    confidenceThreshold: parseFloat(process.env.CLAIM_RECOGNITION_CONFIDENCE_THRESHOLD) || 0.6,
    // 100 DPI verified reliable + fast in Day-1 testing; 200 DPI caused multi-minute hangs.
    rasterDpi: parseInt(process.env.CLAIM_RECOGNITION_RASTER_DPI, 10) || 100,
    // Per-page vision call budget. Typed pages converge well under this; this is a safety
    // cap, not a target — reasoningEffort:'none' is what actually prevents runaway usage.
    maxTokensPerPage: parseInt(process.env.CLAIM_RECOGNITION_MAX_TOKENS_PER_PAGE, 10) || 800,
  },

  documentChecking: {
    // Pure code, no LLM/external call — safe to process a much larger batch per run
    // than claim-recognition.
    batchLimit: parseInt(process.env.DOCUMENT_CHECKING_BATCH_LIMIT, 10) || 50,
  },

  emailSender: {
    // Pure DB + one SMTP call per task — no LLM involved.
    batchLimit: parseInt(process.env.EMAIL_SENDER_BATCH_LIMIT, 10) || 20,
    // After this many failed attempts, a task is marked FAILED instead of retried
    // on the next run.
    maxAttempts: parseInt(process.env.EMAIL_SENDER_MAX_ATTEMPTS, 10) || 5,
  },

  memberVerification: {
    // One IAS call per case — keep the batch modest, unlike documentChecking's pure-code run.
    batchLimit: parseInt(process.env.MEMBER_VERIFICATION_BATCH_LIMIT, 10) || 20,
  },

  ias: {
    baseUrl: process.env.IAS_URL,
    getMemberInfoApi: process.env.GET_MEMBER_INFO_API,
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
    allowedHosts: (process.env.LINKED_DOCUMENTS_ALLOWED_HOSTS || 'as.expa.ai')
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
  },
};
