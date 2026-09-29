const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');

// AiSummaryRemark on the IAS claim submission / revision (17/09 meeting #9 — the AI assessment kept in
// iAS, 2026-09-29): the same text as the internal emails — why the case went this way, review points,
// decisions. Confirmed by the IAS team: top-level field, optional, up to 10,000 characters, line breaks
// and Burmese allowed. A longer text is cut at the limit with a note; the full one stays in the console.
const MAX_LENGTH = 10000;
const CUT_NOTE = '\n… (cut to fit; full assessment in the ULINK console)';

function aiSummaryRemark(fields, overrides = []) {
  const text = assessmentSummaryText(buildAssessmentSummary(fields, { overrides }));
  return text.length <= MAX_LENGTH ? text : text.slice(0, MAX_LENGTH - CUT_NOTE.length) + CUT_NOTE;
}

module.exports = { aiSummaryRemark, MAX_LENGTH };
