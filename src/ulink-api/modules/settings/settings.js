const { Setting } = require('../../db/models');

// Switches changed on the console's STP settings and System settings pages (super admin). Each default keeps the behaviour the system had
// before the switch existed, unless the owner decided otherwise (noted per setting).
const DEFAULTS = {
  // The human-in-the-loop switches (2026-09-29). Both off until Ulink decides.
  // A claim with an open review point (the AI unsure, a possible exclusion, …) never goes STP — a
  // person checks it first (the JD3 path).
  stpBlockOnReviewPoints: false,
  // When the AI is unsure a document is missing (low confidence / unreadable), the customer's
  // missing-documents email waits for a person: send it, or override the check.
  holdUnsureMissingDocsEmail: false,
  // The document check passed, but the AI was unsure (at or below the threshold) about an item: the case stops for a
  // person to confirm before claim preparation / the IAS revision (SYSTEM_4 E4-09). Off until turned on.
  holdUnsureDocumentPass: false,
  // API cases: the AI was unsure of the ICD-10 diagnosis code (it fell back to the default, or at or below the
  // threshold): the case stops for a person to choose the code before the IAS revision. On (owner, 2026-10-20).
  holdUnsureDiagnosis: true,
  // The AI had no benefit, no head, or was unsure of a voucher's benefit: the case stops for a person to choose it — at the
  // member check, before the documents (BENEFIT_REVIEW / API_BENEFIT_REVIEW, both flows, SYSTEM_5 member balance phase C),
  // and at claim preparation for a voucher that changed since (API_PREPARATION_REVIEW). On (owner, 2026-10-20).
  holdUnsureBenefit: true,
  // API cases: the AI couldn't tell, or was unsure of, a voucher's vitamins / supplements (no amount, an amount above the
  // voucher, or at or below the threshold): the case stops for a person to set the manual rejection (amount and remark)
  // on each voucher (same stop). On (owner, 2026-10-20).
  holdUnsureVitamin: true,
  // A voucher with vitamins / supplements: the claim is approved by a person (JD3), never STP (SYSTEM_4 E4-10).
  // On from the start — ULINK asked for it at the 02-Oct demo.
  vitaminsBlockStp: true,
  // Which cases the system works on (SYSTEM_4 E4-01, 2026-10-14 — API cases go live first). A source switched off:
  // its pipeline doesn't run and its tab is hidden on the work pages. Its cases are kept, untouched.
  emailCasesEnabled: true,
  apiCasesEnabled: true,
  // Read the mailbox (IMAP) — off: the inbox step (email-intake) is skipped in both pipelines, and the API pipeline's
  // reply step (api-reply-intake) too, without editing .env or a restart (SYSTEM_4 E4-02). Sending email is not affected.
  mailboxEnabled: true,
  // API cases: the customer's missing-documents email (SYSTEM_4 E4-03). Off: ULINK staff contact the customer
  // themselves; the team is still emailed.
  apiSendMissingDocumentsEmail: true,
  // At or below this confidence (0–1) the AI counts as unsure: a review point on the case, and a held
  // missing-documents email (SYSTEM_4 E4-07). 0.7 decided by ULINK (14-Oct feedback); was a fixed 0.5 before.
  aiConfidenceThreshold: 0.7,
  // A case waiting for a person longer than this many working days is flagged overdue in the review queue and approvals
  // (SYSTEM_4 E4-19 / E6). 2 is a placeholder until ULINK sets its ageing limit (Q20).
  overdueWorkingDays: 2,
  // The Overview turns red when a pipeline has had no run for this many minutes (SYSTEM_4 E6) — 3× the UAT cron interval
  // (docs/deployment/CRONTAB_SETUP.md: email every 10 min, API every 30). Raise them for a business-hours schedule.
  pipelineStaleMinutesEmail: 30,
  pipelineStaleMinutesApi: 90,
  // A voucher dated more than this many days before or after the visit is most likely misread (E3 check 2026-10-15:
  // a July visit with a voucher read as January) — "Values read look valid" marks it unsure (SYSTEM_4 E4-08).
  voucherDaysBeforeVisit: 30,
  // Before the AI maps a claim's pages, it gets trusted reviewer notes from past claims of the same hospital — lessons
  // only, never past values (SYSTEM_4 F3, E4-15 step 4). Off: the AI reads every claim without them. On from the start —
  // the owner approved it so (2026-10-16); it does nothing until a correction is marked trusted.
  usePastCorrections: true,
};

// Settings that are whole numbers in a range (the rest of the numbers are shares 0–1). Sent to the console with the
// settings, so its form checks the same ranges.
const WHOLE_NUMBERS = { overdueWorkingDays: [1, 30], pipelineStaleMinutesEmail: [5, 4320], pipelineStaleMinutesApi: [5, 4320], voucherDaysBeforeVisit: [1, 365] };

// The source switch for a pipeline / case source ('EMAIL' / 'API').
const SOURCE_SETTING = { EMAIL: 'emailCasesEnabled', API: 'apiCasesEnabled' };

// The settings as last read, for code that can't wait on the database — the assessment summary is built in plain
// functions all over the API. Refreshed by every getSettings(): at startup (bin/www), at each pipeline run (the source
// check), on every console page (the source tabs) and after a save.
// ponytail: in-process copy, right for the one API process we run; with several processes, read per request instead.
let lastRead = { ...DEFAULTS };

async function getSettings() {
  const rows = await Setting.findAll({ where: { key: Object.keys(DEFAULTS) } });
  lastRead = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return lastRead;
}

const lastReadSettings = () => lastRead;

// Why a value can't be saved, or null. Each setting takes the type of its default; the threshold is a share 0–1,
// the working-day limit a whole number in its range.
function settingError(key, value) {
  if (!(key in DEFAULTS)) return `Unknown switch ${key}.`;
  if (typeof DEFAULTS[key] === 'boolean') return typeof value === 'boolean' ? null : `${key} must be on or off.`;
  if (WHOLE_NUMBERS[key]) {
    const [min, max] = WHOLE_NUMBERS[key];
    return Number.isInteger(value) && value >= min && value <= max ? null : `${key} must be a whole number from ${min} to ${max}.`;
  }
  return typeof value === 'number' && value >= 0 && value <= 1 ? null : `${key} must be a percentage from 0 to 100.`;
}

// Only known keys, each of its own type. transaction: to save with other changes (the STP / System settings form).
async function setSettings(changes, updatedBy, { transaction } = {}) {
  for (const [key, value] of Object.entries(changes)) {
    const error = settingError(key, value);
    if (error) throw new Error(error);
    await Setting.upsert({ key, value, updatedBy }, { transaction });
  }
}

module.exports = { getSettings, lastReadSettings, setSettings, settingError, DEFAULTS, SOURCE_SETTING, WHOLE_NUMBERS };
