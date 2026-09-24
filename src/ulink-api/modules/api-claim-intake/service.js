const { sequelize, Case, CaseEvent } = require('../../db/models');
const { listApiClaims } = require('./iasClient');
const { todayInIasTimezone } = require('../shared/iasDates');

// api-claim-intake: the entry point of the API case workflow (docs/imp/day1/api-case-workflow.md
// section 6.1). Lists claims created in IAS through its API and turns each new one into an
// API case at API_RECEIVED. Only this job ever creates source='API' cases.

const BLOCK_NAME = 'api-claim-intake';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!ISO_DATE.test(value)) return false;
  // Round-trip catches impossible dates like 2026-02-30, which Date would silently roll over.
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/**
 * Either bound missing defaults to today (Myanmar time), so the workflow's scheduled run
 * with no input asks for today only. Returns { dateFrom, dateTo } or { error } — dates come
 * straight from a query string on the dev endpoint, so they're checked here, not trusted.
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
async function createCase(claim) {
  const claimNo = claim.clNo.trim();
  return sequelize.transaction(async (transaction) => {
    const [caseRecord, created] = await Case.findOrCreate({
      where: { source: 'API', claimNo },
      defaults: {
        source: 'API',
        currentStatus: 'API_RECEIVED',
        claimNo,
        tpaCaseNumber: claim.tpaCaseNumber.trim(),
        iasApiClaim: claim,
      },
      transaction,
    });
    if (created) {
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
 * Scheduled entry point (POST /api/jobs/api-claim-intake/run passes no range, so today).
 * An IAS failure throws before anything is written; the next run retries the same range.
 * One bad or clashing claim is reported and skipped, never blocking the rest of the list.
 */
async function run(range = {}) {
  const resolved = resolveDateRange(range);
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
      if (await createCase(claim)) summary.inserted += 1;
      else summary.skippedExisting += 1;
    } catch (error) {
      summary.errors.push({ clNo: claim.clNo, tpaCaseNumber: claim.tpaCaseNumber, error: error.message });
    }
  }
  return summary;
}

module.exports = { run, resolveDateRange, fetchApiClaims };
