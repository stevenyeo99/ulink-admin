// Case-history reason codes of claiming a case (SYSTEM_4 E4-22). No dependencies: claim.js writes them, and
// assessment-summary/nextAction.js skips them (a claim says who works on a case, not what happened to it).
const CLAIM_EVENTS = ['CASE_CLAIMED', 'CASE_RELEASED', 'CASE_TAKEN_OVER'];

module.exports = { CLAIM_EVENTS };
