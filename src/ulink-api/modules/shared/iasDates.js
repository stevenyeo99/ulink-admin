/**
 * One place for every ISO-date <-> IAS-date conversion, precisely because IAS itself is
 * inconsistent about which format it wants where — verified directly against real
 * request/response samples, not assumed from any doc (one earlier doc note got this wrong):
 *
 * - GET_MEMBER_INFO_API's `meplEffDate` request param, and this app's own ISO dates
 *   (`YYYY-MM-DD` / `YYYYMMDD`) — see modules/member-verification/checks.js.
 * - GET_MEMBER_INFO_API's *response* dates (DOB, EFF_DATE, EXP_DATE, TERM_DATE,
 *   REINST_DATE) are MMDDYYYY (verified: member.DOB "03281984" against claimant_dob
 *   "1984-03-28" — March 28 1984, not a plausible day-13th month).
 * - CL_CLAIM_API's *request* dates (ReceivedDate, IncurDateFrom/To, SymptomDate) are ALSO
 *   MMDDYYYY (verified against docs/imp/day1/IAS/ias_claim_submission_api.json's real
 *   sample, e.g. "08202026" = Aug 20 2026).
 *
 * Keeping all of these in one module means a future third endpoint with yet another format
 * gets caught here, not by silently reusing the wrong helper.
 */

function toYYYYMMDD(isoDate) {
  return isoDate ? isoDate.replaceAll('-', '') : null;
}

function iasDateToYYYYMMDD(mmddyyyy) {
  if (!mmddyyyy || mmddyyyy.length !== 8) return null;
  const mm = mmddyyyy.slice(0, 2);
  const dd = mmddyyyy.slice(2, 4);
  const yyyy = mmddyyyy.slice(4, 8);
  return `${yyyy}${mm}${dd}`;
}

function isoToMMDDYYYY(isoDate) {
  if (!isoDate) return null;
  const [yyyy, mm, dd] = isoDate.split('-');
  if (!yyyy || !mm || !dd) return null;
  return `${mm}${dd}${yyyy}`;
}

// For a JS Date/timestamp (e.g. Case.createdAt) rather than an ISO date string — same
// MMDDYYYY, date-only, no time component.
function dateToMMDDYYYY(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${mm}${dd}${yyyy}`;
}

module.exports = { toYYYYMMDD, iasDateToYYYYMMDD, isoToMMDDYYYY, dateToMMDDYYYY };
