// SYSTEM_4 E4-09: the document check passed, but the AI was unsure (at or below the threshold, default 70%) about an
// item. With the switch "documents the AI passed but wasn't sure about: a person confirms first" on, the case stops
// (DOCUMENTS_UNSURE / API_DOCUMENTS_UNSURE) until a person confirms; off, it continues exactly as before.

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { update: jest.fn().mockResolvedValue([1]) },
  CaseEvent: { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
  Setting: { findAll: jest.fn() },
}));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));
jest.mock('../modules/document-checking/service', () => ({
  ...jest.requireActual('../modules/document-checking/service'),
  checkCase: jest.fn(),
}));

const { Case, Setting } = require('../db/models');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const documentChecking = require('../modules/document-checking/service');
const { unsurePassedPoints } = require('../modules/document-checking/holdForReview');
const { job: apiDocumentJob } = require('../modules/api-document-checking/service');
const { OVERRIDE_TARGETS, OVERRIDE_AREAS, findingsFor, overrideCheck } = require('../modules/case-override/override');
const { CASE_STATUSES } = require('../modules/case-status/catalog');

const passed = (confidence) => ({
  passed: true,
  issues: [],
  details: [],
  checklist: [
    { code: 'PATIENT_NAME_INCONSISTENT', label: 'Patient name matches', passed: true, confidence },
    { code: 'MISSING_BANK_INFO', label: 'Bank information', passed: true }, // a rule: no score, never "unsure"
  ],
});
const switchOn = (on) => Setting.findAll.mockResolvedValue(on ? [{ key: 'holdUnsureDocumentPass', value: true }] : []);
beforeEach(() => jest.clearAllMocks());

it('counts a passed item at or below the threshold as unsure — not a rule without a score', () => {
  expect(unsurePassedPoints(passed(0.62))).toEqual(['Patient name matches (AI confidence 0.62)']);
  expect(unsurePassedPoints(passed(0.7))).toEqual(['Patient name matches (AI confidence 0.7)']);
  expect(unsurePassedPoints(passed(0.71))).toEqual([]);
  expect(unsurePassedPoints({ passed: false, checklist: [{ label: 'x', passed: false, confidence: 0.3 }] })).toEqual([]);
});

describe('email case', () => {
  const caseRecord = { id: 'case-1', currentStatus: 'READY_FOR_DOCUMENT_CHECKING', createdAt: '2026-10-14T01:00:00Z' };
  const persist = (confidence) => documentChecking.persistOutcome(caseRecord, { outcome: 'DOCUMENT_CHECKED', result: passed(confidence) });

  it('switch on + AI unsure: waits for a person, no email', async () => {
    switchOn(true);
    await persist(0.62);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'DOCUMENTS_UNSURE' });
    expect(queueDedupedTask).not.toHaveBeenCalled();
  });

  it('switch off, or the AI sure: checks passed as before', async () => {
    switchOn(false);
    await persist(0.62);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'MEMBER_VERIFIED' });
    jest.clearAllMocks();
    switchOn(true);
    await persist(0.95);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'MEMBER_VERIFIED' });
  });
});

describe('API case', () => {
  const caseRecord = { id: 'case-1', source: 'API', claimNo: '2610140001', createdAt: '2026-10-14T01:00:00Z' };
  const input = { 'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields: {} } };
  const process = async (confidence) => {
    documentChecking.checkCase.mockResolvedValue({ outcome: 'DOCUMENT_CHECKED', result: passed(confidence) });
    return apiDocumentJob.process({ caseRecord, input });
  };

  it('switch on + AI unsure: waits for a person before the IAS revision, no email', async () => {
    switchOn(true);
    const result = await process(0.62);
    expect(result.nextStatus).toBe('API_DOCUMENTS_UNSURE');
    expect(result.output).toMatchObject({ outcome: 'DOCUMENT_CHECKED', email: null });
    expect(result.message).toContain('Patient name matches (AI confidence 0.62)');
  });

  it('switch off, or the AI sure: documents complete as before', async () => {
    switchOn(false);
    expect((await process(0.62)).nextStatus).toBe('API_DOCUMENTS_VERIFIED');
    switchOn(true);
    expect((await process(0.95)).nextStatus).toBe('API_DOCUMENTS_VERIFIED');
  });
});

it('a person confirms it to where a pass would have gone, with "the AI read it right" offered only here', () => {
  expect(OVERRIDE_TARGETS).toMatchObject({ DOCUMENTS_UNSURE: 'MEMBER_VERIFIED', API_DOCUMENTS_UNSURE: 'API_DOCUMENTS_VERIFIED' });
  expect(OVERRIDE_AREAS).toMatchObject({ DOCUMENTS_UNSURE: 'documents', API_DOCUMENTS_UNSURE: 'documents' });
  expect(overrideCheck('API_DOCUMENTS_UNSURE')).toMatchObject({ allowed: true, target: 'API_DOCUMENTS_VERIFIED' });
  expect(Object.keys(findingsFor('API_DOCUMENTS_UNSURE'))[0]).toBe('AI_CORRECT');
  expect(findingsFor('INCOMPLETE').AI_CORRECT).toBeUndefined();
  expect(CASE_STATUSES.API_DOCUMENTS_UNSURE).toMatchObject({ group: 'needs_review', label: "Check the AI's documents finding" });
});
