// Claiming a case (SYSTEM_4 E4-22, E4b): "Being reviewed by …" — while one person holds a case, others can view it but
// not act on it (override, reset, release the missing-documents email, upload, correct). Pipeline jobs are not
// affected. A claim lasts CLAIM_MINUTES from the holder's last successful action; the holder's override (their
// decision) or Release ends it; another person can take it over with a comment (e.g. the holder has gone home).
// Q21 default (owner, until ULINK answers): reviewers claim cases themselves; 30-minute time-out.
//
// ponytail: the action guard checks then acts without a lock — a take-over landing between a holder's check and their
// action lets that one action through (the holder was entitled to it a moment before). Claiming itself is atomic.

const { sequelize, CaseClaim, CaseEvent } = require('../../db/models');
const { CASE_STATUSES } = require('../case-status/catalog');
const { CLAIM_EVENTS } = require('./events');

// ponytail: fixed until ULINK answers Q21 (time-out); move to the System settings page if they want to change it.
const CLAIM_MINUTES = 30;
// "Done" for the pipeline, but waiting for JD3's approval in IAS (the Approvals page) — still claimable.
const APPROVAL_STATUSES = ['CLAIM_CREATED', 'API_CLAIM_REVISED'];

const expiry = (now) => new Date(now.getTime() + CLAIM_MINUTES * 60 * 1000);
const isActive = (claim, now = new Date()) => Boolean(claim && new Date(claim.expiresAt) > now);
const holderName = (claim) => claim.name || claim.username;

// For the case page / queues: { username, name, claimedAt, expiresAt } or null when nobody holds it.
function claimView(claim, now = new Date()) {
  return isActive(claim, now) ? { username: claim.username, name: holderName(claim), claimedAt: claim.claimedAt, expiresAt: claim.expiresAt } : null;
}

async function activeClaims(caseIds, now = new Date()) {
  if (!caseIds.length) return new Map();
  const rows = await CaseClaim.findAll({ where: { caseId: caseIds } });
  return new Map(rows.filter((r) => isActive(r, now)).map((r) => [r.caseId, claimView(r, now)]));
}

const logClaimEvent = (caseRecord, reasonCode, message) => CaseEvent.create({
  caseId: caseRecord.id, blockName: 'case-review', prevStatus: caseRecord.currentStatus, newStatus: caseRecord.currentStatus, reasonCode, message,
});

// One statement, so two people can't both win: the row is written only when nobody holds the case, it is already the
// user's, the claim expired, or (take-over) it is still held by the person being taken over from. Returns the row
// written, or null when someone else got there first.
async function writeClaim(row, now, takeOverFrom = null) {
  const [rows] = await sequelize.query(
    `INSERT INTO ulink_case_claims (case_id, username, name, claimed_at, expires_at)
     VALUES (:caseId, :username, :name, :claimedAt, :expiresAt)
     ON CONFLICT (case_id) DO UPDATE SET
       username = EXCLUDED.username, name = EXCLUDED.name, expires_at = EXCLUDED.expires_at,
       claimed_at = CASE WHEN ulink_case_claims.username = EXCLUDED.username AND ulink_case_claims.expires_at > :now
                         THEN ulink_case_claims.claimed_at ELSE EXCLUDED.claimed_at END
     WHERE ulink_case_claims.username = EXCLUDED.username OR ulink_case_claims.expires_at <= :now
        OR ulink_case_claims.username = :takeOverFrom
     RETURNING case_id AS "caseId", username, name, claimed_at AS "claimedAt", expires_at AS "expiresAt"`,
    { replacements: { ...row, now, takeOverFrom } }
  );
  return rows[0] || null;
}

/**
 * Claim (or keep) a case for user. caseRecord: { id, currentStatus }. Held by someone else: refused, unless takeOver
 * comes with a comment. A finished case can't be claimed. Returns { claim } or { error, status }.
 */
async function claimCase(caseRecord, user, { takeOver = false, comment = '' } = {}, now = new Date()) {
  if (CASE_STATUSES[caseRecord.currentStatus]?.group === 'done' && !APPROVAL_STATUSES.includes(caseRecord.currentStatus)) {
    return { status: 400, error: 'This case is finished — nothing to review.' };
  }
  const current = await CaseClaim.findByPk(caseRecord.id);
  const heldByOther = isActive(current, now) && current.username !== user.username;
  if (heldByOther && !takeOver) {
    return { status: 409, error: `Being reviewed by ${holderName(current)} since ${new Date(current.claimedAt).toISOString()}. Take it over with a comment if they can't finish it.` };
  }
  if (heldByOther && comment.trim().length < 3) return { status: 400, error: 'Add a comment: why you take this case over.' };

  const mine = isActive(current, now) && current.username === user.username;
  const written = await writeClaim(
    { caseId: caseRecord.id, username: user.username, name: user.name || null, claimedAt: now, expiresAt: expiry(now) },
    now,
    heldByOther ? current.username : null
  );
  if (!written) return { status: 409, error: 'Someone else started reviewing this case just now. Reload the page.' };
  if (heldByOther) {
    await logClaimEvent(caseRecord, 'CASE_TAKEN_OVER', `Taken over by ${holderName(written)} from ${holderName(current)}: ${comment.trim()}`);
  } else if (!mine) {
    await logClaimEvent(caseRecord, 'CASE_CLAIMED', `Being reviewed by ${holderName(written)}`);
  }
  return { claim: claimView(written, now) };
}

// Ends the user's own claim (Release). Someone else's active claim: refused — they take it over instead.
async function releaseCase(caseRecord, user, now = new Date()) {
  const current = await CaseClaim.findByPk(caseRecord.id);
  if (!current) return { released: false };
  if (isActive(current, now) && current.username !== user.username) {
    return { status: 409, error: `Being reviewed by ${holderName(current)} — only they release it.` };
  }
  await CaseClaim.destroy({ where: { caseId: caseRecord.id, username: current.username } });
  if (isActive(current, now)) await logClaimEvent(caseRecord, 'CASE_RELEASED', `Released by ${holderName(current)}`);
  return { released: true };
}

// The user decided the case (override): their own claim ends with it — never someone else's. No event: the override is
// the history entry.
async function endClaim(caseId, username) {
  await CaseClaim.destroy({ where: { caseId, username } });
}

/**
 * Express middleware for the case actions: refuses (409) when someone else holds the case. When the acting user holds
 * it, their claim is renewed once the action succeeded (the time-out counts from their last successful action).
 * Nobody holds it: the action goes ahead. ("Mark trusted" is deliberately not guarded: a second person gives it,
 * usually while the corrector still holds the case.)
 */
async function requireNotHeldByOther(req, res, next) {
  const now = new Date();
  const current = await CaseClaim.findByPk(req.params.id);
  if (isActive(current, now) && current.username !== req.user.username) {
    return res.status(409).json({ error: { message: `Being reviewed by ${holderName(current)}. Ask them, or take the case over with a comment.`, status: 409 } });
  }
  if (isActive(current, now)) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        CaseClaim.update({ expiresAt: expiry(new Date()) }, { where: { caseId: req.params.id, username: req.user.username } }).catch(() => {});
      }
    });
  }
  return next();
}

module.exports = { CLAIM_MINUTES, CLAIM_EVENTS, isActive, claimView, activeClaims, claimCase, releaseCase, endClaim, requireNotHeldByOther, writeClaim };
