// SYSTEM_4 E4-07: one AI confidence threshold (STP settings, default 70%) decides when the AI is unsure — a review
// point on the case, and an unsure missing-documents finding. At or below it is unsure.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings, lastReadSettings, DEFAULTS } = require('../modules/settings/settings');
const { buildAssessmentSummary, isLowConfidence } = require('../modules/assessment-summary/summary');
const { unsureDocumentPoints } = require('../modules/document-checking/holdForReview');

const withThreshold = async (value) => {
  Setting.findAll.mockResolvedValueOnce(value == null ? [] : [{ key: 'aiConfidenceThreshold', value }]);
  await getSettings();
};

it('defaults to 70%, and at or below it the AI is unsure', async () => {
  await withThreshold(null);
  expect(DEFAULTS.aiConfidenceThreshold).toBe(0.7);
  expect(lastReadSettings().aiConfidenceThreshold).toBe(0.7);
  expect([0.69, 0.7, 0.71].map(isLowConfidence)).toEqual([true, true, false]);
  expect(isLowConfidence(null)).toBe(false); // no score: not judged unsure by the threshold
});

it('follows the saved setting once read', async () => {
  await withThreshold(0.6);
  expect([0.6, 0.65].map(isLowConfidence)).toEqual([true, false]);
  await withThreshold(null);
});

it('makes a failed checklist item at the threshold an unsure point (the held-email check)', async () => {
  await withThreshold(null);
  const result = (confidence) => ({ checklist: [{ code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence }] });
  expect(unsureDocumentPoints(result(0.7))).toEqual(['Medical report present (AI confidence 0.7)']);
  expect(unsureDocumentPoints(result(0.71))).toEqual([]);
});

it('turns a passed AI result at the threshold into a review point', async () => {
  await withThreshold(null);
  const summary = (confidence) => buildAssessmentSummary({
    documentCheckResult: { passed: true, issues: [], details: [], checklist: [{ code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: true, confidence }] },
  });
  expect(summary(0.7).reviewPoints.length).toBeGreaterThan(0);
  expect(summary(0.95).reviewPoints).toEqual([]);
});
