const { entityMatch, meaningMatch } = require('../modules/document-checking/identityJudgment');

// Unlike documentChecking.test.js (fixture-based, instant, no network), this makes real
// LLM calls — entityMatch can't be fixture-tested the way evaluateJudgmentDependentChecks
// can, since the thing under test IS the judgment call itself. Slower and network-
// dependent; kept in its own file so it's easy to skip/exclude separately if the fast
// suite ever needs to stay green independent of the LLM endpoint being reachable.
//
// The abbreviation case below is a real regression, not a hypothetical: verified
// 2026-09-14 against a real case (caseId f6f3514e-44c6-4096-a63b-bcee41627640) —
// "Ar Yu" (claim form) vs "Ar Yu International Hospital" (medical record) was judged
// `consistent: false` at 0.92 confidence, reasoning that a short name must be a person's
// name rather than an abbreviated institution name. Fixed in prompts/entity-match.md;
// this test is what stops it from silently coming back.
jest.setTimeout(120000);

describe('entityMatch (real LLM calls)', () => {
  it('judges an institution short name and its full name as consistent', async () => {
    const result = await entityMatch('Ar Yu', 'Ar Yu International Hospital');
    expect(result).not.toBeNull();
    expect(result.consistent).toBe(true);
  });

  it('judges two genuinely different names as inconsistent (control — confirms the fix did not overcorrect)', async () => {
    const result = await entityMatch('Khin Maung', 'Kyaw Than Aung');
    expect(result).not.toBeNull();
    expect(result.consistent).toBe(false);
  });

  it('returns null when either value is missing — nothing to compare', async () => {
    expect(await entityMatch(null, 'Ar Yu International Hospital')).toBeNull();
    expect(await entityMatch('Ar Yu', null)).toBeNull();
  });
});

// Item 18 (SOP §8, "Medical Record must support claim") — a support/relevance judgment,
// not an entity match, so it gets its own describe block even though it shares
// identityJudgment.js's schema/confidence-gating with entityMatch above.
describe('meaningMatch (real LLM calls)', () => {
  it('judges a differently-worded but medically-related record as supporting the claim', async () => {
    const result = await meaningMatch(
      'BMI 30.2, Fatty Liver, Hypercholesterolemia, Hyperuricemia',
      'Weight-management consultation, Tirzepatide 2.5mg prescribed for metabolic syndrome'
    );
    expect(result).not.toBeNull();
    expect(result.consistent).toBe(true);
  });

  it('judges an unrelated record as not supporting the claim (control)', async () => {
    const result = await meaningMatch(
      'Fractured left arm from a fall, cast application',
      'Routine annual dental cleaning, no abnormal findings'
    );
    expect(result).not.toBeNull();
    expect(result.consistent).toBe(false);
  });

  it('returns null when either value is missing — nothing to compare', async () => {
    expect(await meaningMatch(null, 'Routine annual dental cleaning')).toBeNull();
    expect(await meaningMatch('Fractured left arm', null)).toBeNull();
  });
});
