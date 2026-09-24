const { sequelize, Case, CaseEvent, ApiCaseStep, JobCheckpoint } = require('../../db/models');
const { listApiClaims } = require('./iasClient');
const { todayInIasTimezone } = require('../shared/iasDates');

// api-claim-intake: the entry point of the API case workflow (docs/imp/day1/api-case-workflow.md
// section 6.1). Lists claims created in IAS through its API and turns each new one into an
// API case at API_RECEIVED. Only this job ever creates source='API' cases. Each new case also
// gets this job's DONE step row (output = the IAS claim row), which is the input the next job
// (api-material-download) receives.

const BLOCK_NAME = 'api-claim-intake';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!ISO_DATE.test(value)) return false;
  // Round-trip catches impossible dates like 2026-02-30, which Date would silently roll over.
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/**
 * An explicit range (dev preview, manual catch-up). Either bound missing defaults to today
 * (Myanmar time). Returns { dateFrom, dateTo } or { error } — dates come straight from a query
 * string on the dev endpoint, so they're checked here, not trusted. The scheduled run uses
 * scheduledRange() instead.
 */
function resolveDateRange({ dateFrom, dateTo } = {}) {
  const today = todayInIasTimezone();
  const from = dateFrom || today;
  const to = dateTo || today;
  if (!isRealDate(from) || !isRealDate(to)) {
    return { error: 'dateFrom and dateTo must be real dates in YYYY-MM-DD format' };
  }
  if (from > to) {
    return { error: `dateFrom (${from}) must not be after dateTo (${to})` };
  }
  return { dateFrom: from, dateTo: to };
}

/**
 * Calls IAS for the range and returns its claims. `success: false` from IAS throws, same as a
 * technical failure: there is nothing to act on, and the next run retries the same range.
 */
async function fetchApiClaims({ dateFrom, dateTo }) {
  const body = await listApiClaims({ dateFrom, dateTo });
  if (!body || body.success !== true) {
    throw new Error(`IAS claim list returned an error: ${(body && body.error) || 'unknown error'}`);
  }
  const claims = Array.isArray(body.payload && body.payload.claims) ? body.payload.claims : [];
  return { dateFrom, dateTo, total: claims.length, claims };
}

function isValidClaim(claim) {
  return Boolean(claim)
    && typeof claim.clNo === 'string' && claim.clNo.trim() !== ''
    && typeof claim.tpaCaseNumber === 'string' && claim.tpaCaseNumber.trim() !== '';
}

/**
 * Creates the API case for one IAS claim unless one already exists for that clNo. An existing
 * case is left exactly as it is — its status belongs to whichever job moved it last. The
 * unique indexes on claim_no/tpa_case_number (source='API') are the real guard: a clash with a
 * different case (e.g. same tpaCaseNumber under a new clNo) throws and is reported, never merged.
 */
async function createCase(claim, range) {
  const claimNo = claim.clNo.trim();
  const tpaCaseNumber = claim.tpaCaseNumber.trim();
  return sequelize.transaction(async (transaction) => {
    const [caseRecord, created] = await Case.findOrCreate({
      where: { source: 'API', claimNo },
      defaults: { source: 'API', currentStatus: 'API_RECEIVED', claimNo, tpaCaseNumber },
      transaction,
    });
    if (created) {
      const now = new Date();
      await ApiCaseStep.create({
        caseId: caseRecord.id,
        job: BLOCK_NAME,
        status: 'DONE',
        input: range,
        output: { clNo: claimNo, tpaCaseNumber, crtDate: claim.crtDate ?? null },
        startedAt: now,
        finishedAt: now,
      }, { transaction });
      await CaseEvent.create({
        caseId: caseRecord.id,
        blockName: BLOCK_NAME,
        newStatus: 'API_RECEIVED',
        message: `IAS API claim ${claimNo} (${claim.tpaCaseNumber.trim()}) received`,
      }, { transaction });
    }
    return created;
  });
}

/**
 * The scheduled run's range: from the last date a run listed successfully up to today (Myanmar
 * time). Normally that's today → today; after an outage it reaches back over every missed day,
 * so no claim is lost (claims already turned into cases are skipped). The last day is listed
 * again on purpose: more claims may have been created on it after that run.
 */
async function scheduledRange() {
  const today = todayInIasTimezone();
  const checkpoint = await JobCheckpoint.findByPk(BLOCK_NAME);
  const last = checkpoint && checkpoint.value && checkpoint.value.lastListedDate;
  return { dateFrom: isRealDate(last) && last < today ? last : today, dateTo: today };
}

/**
 * Scheduled entry point (POST /api/jobs/api-claim-intake/run passes no range → scheduledRange).
 * An explicit range (a manual catch-up) is used as given and doesn't move the checkpoint.
 * An IAS failure throws before anything is written; the next run retries the same range.
 * One bad or clashing claim is reported and skipped, never blocking the rest of the list.
 */
async function run(range) {
  const scheduled = !range;
  const resolved = scheduled ? await scheduledRange() : resolveDateRange(range);
  if (resolved.error) throw new Error(resolved.error);

  const { claims } = await fetchApiClaims(resolved);
  const summary = { ...resolved, fetched: claims.length, inserted: 0, skippedExisting: 0, skippedInvalid: 0, errors: [] };

  for (const claim of claims) {
    if (!isValidClaim(claim)) {
      summary.skippedInvalid += 1;
      summary.errors.push({ claim, error: 'clNo and tpaCaseNumber are required' });
      continue;
    }
    try {
      if (await createCase(claim, resolved)) summary.inserted += 1;
      else summary.skippedExisting += 1;
    } catch (error) {
      summary.errors.push({ clNo: claim.clNo, tpaCaseNumber: claim.tpaCaseNumber, error: error.message });
    }
  }

  // IAS answered for the whole range, so every day up to today is covered — even if single rows
  // failed (those are reported; the day is listed again only while it is still today).
  if (scheduled) await JobCheckpoint.upsert({ job: BLOCK_NAME, value: { lastListedDate: resolved.dateTo } });
  return summary;
}

module.exports = { run, resolveDateRange, fetchApiClaims };
