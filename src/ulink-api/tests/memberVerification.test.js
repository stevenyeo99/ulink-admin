const fs = require('fs');
const path = require('path');
const { checkBenefitEligibility } = require('../modules/member-verification/benefitEligibility');
const { summarizeBenefitLimits } = require('../modules/member-verification/benefitLimits');

// Fixture-based regression harness for member-verification's SOP §6.4/§6.5 checks — same
// pattern as tests/documentChecking.test.js: pure/deterministic functions, no IAS/LLM calls,
// fixtures built from real IAS response shapes (docs/imp/day1/IAS/*.json), not guessed.
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'memberVerification');
const loadFixture = (filename) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8'));
const allFixtureFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));

describe('checkBenefitEligibility (SOP §6.4)', () => {
  const eligibilityFixtures = allFixtureFiles.filter((f) => f.startsWith('eligibility-'));
  it.each(eligibilityFixtures)('%s', (filename) => {
    const fixture = loadFixture(filename);
    const flag = checkBenefitEligibility(fixture.extractedFields, fixture.memberPlansRaw);

    if (fixture.expected.eligibilityFlag === null) {
      expect(flag).toBeNull();
    } else {
      expect(flag).not.toBeNull();
      expect(flag.code).toBe(fixture.expected.eligibilityFlag.code);
    }
  });
});

describe('summarizeBenefitLimits (SOP §6.5)', () => {
  const limitsFixtures = allFixtureFiles.filter((f) => f.startsWith('limits-'));
  it.each(limitsFixtures)('%s', (filename) => {
    const fixture = loadFixture(filename);
    const limits = summarizeBenefitLimits(fixture.memberPlansRaw);
    expect(limits).toEqual(fixture.expected.limits);
  });
});
