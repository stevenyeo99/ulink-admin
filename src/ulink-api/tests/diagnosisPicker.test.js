const { pickDiagnosis, DEFAULT_DIAGNOSIS } = require('../modules/ias-claim-preparation/diagnosisPicker');

// Regression test for the 2026-09-16 fix (at user's request): DiagnosisCode is a mandatory
// CL_CLAIM_API field for an STP submission — pickDiagnosis previously returned pick: null
// whenever it wasn't confident, which left that mandatory field blank and only surfaced as
// an IAS rejection at actual submission time. It now falls back to DEFAULT_DIAGNOSIS (a
// real ICD-10 "unspecified" code, R69) and marks the result `defaulted: true` so callers
// (claimPrepMeta, the console's ConfidenceSummary) can still show it wasn't a confident pick.
//
// Only the fully pure, no-I/O branch (no free text at all) is exercised here — the
// candidates-lookup and LLM-pick branches make real embedding/LLM calls, same as every other
// picker in this codebase (untested at the unit level, verified against real cases instead).
describe('pickDiagnosis', () => {
  it('falls back to DEFAULT_DIAGNOSIS, marked defaulted, when there is no free text at all', async () => {
    const result = await pickDiagnosis('');
    expect(result).toEqual({ pick: DEFAULT_DIAGNOSIS, defaulted: true, confidence: null, candidates: [] });
  });

  it('DEFAULT_DIAGNOSIS is a real ICD-10 code, not a placeholder string', () => {
    expect(DEFAULT_DIAGNOSIS).toEqual({ diagCode: 'R69', diagDesc: 'Unknown and unspecified causes of morbidity' });
  });
});
