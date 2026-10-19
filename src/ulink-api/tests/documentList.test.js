// System checklist step 1 (owner, 2026-10-19): the AI gives the kind and the date of each page, each with its own
// confidence and reason (document_list). The document check shows it as one "Documents found" line — information only:
// never an issue, never a review point, never a hold, whatever the AI's confidence.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const Ajv = require('ajv');
const { getSettings } = require('../modules/settings/settings');
const migration = require('../db/migrations/20261019120000-document-list');
const { documentListCheck } = require('../modules/document-checking/checklist');
const { dropOutOfRangeEvidence, withoutBadDocumentList } = require('../modules/claim-recognition/service');
const { correctionOptions } = require('../modules/ai-feedback/corrections');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { unsurePassedPoints, unsureDocumentPoints } = require('../modules/document-checking/holdForReview');

const list = [
  { page: 'claim.pdf - page 1', kind: 'claim_form', date: '2026-10-12', confidence: 0.95, reason: 'printed AYA claim form, date in section A' },
  { page: 'B1/page-002.jpg - page 1', kind: 'eye_test_slip', date: null, confidence: 0.4, reason: 'SPH/CYL table, no date on the slip' },
];

beforeEach(() => getSettings());

it('adds document_list to the reading schema as a required field; down removes it', async () => {
  const db = { schema: { type: 'object', required: ['claim'], properties: { claim: { type: 'object' } } } };
  const queryInterface = { sequelize: { query: async (sql, { replacements }) => {
    if (sql.startsWith('SELECT')) return [[{ extraction_schema: db.schema }]];
    db.schema = JSON.parse(replacements.schema);
    return [[]];
  } } };
  await migration.up(queryInterface);
  expect(db.schema.required).toEqual(['claim', 'document_list']);
  const validate = new Ajv().compile(db.schema);
  expect(validate({ claim: {}, document_list: list })).toBe(true);
  expect(validate({ claim: {}, document_list: [{ ...list[0], kind: 'selfie' }] })).toBe(false);
  expect(validate({ claim: {}, document_list: [{ ...list[0], reason: undefined }] })).toBe(false);
  await migration.down(queryInterface);
  expect(db.schema.required).toEqual(['claim']);
  expect(db.schema.properties.document_list).toBeUndefined();
});

it('a confidence outside 0–1 becomes null, so it never fails the whole reading', () => {
  expect(dropOutOfRangeEvidence({ document_list: [{ ...list[0], confidence: 95 }] }).document_list[0].confidence).toBeNull();
});

it('a missing or malformed list is dropped — it never fails the whole reading', async () => {
  const schema = { type: 'object', required: ['claim'], properties: { claim: { type: 'object' } } };
  await migration.up({ sequelize: { query: async (sql, { replacements }) => {
    if (sql.startsWith('SELECT')) return [[{ extraction_schema: schema }]];
    Object.assign(schema, JSON.parse(replacements.schema));
    return [[]];
  } } });
  const validate = (r) => new Ajv().compile(r.schema)(r.fields);
  const bad = withoutBadDocumentList({ claim: {}, document_list: [{ page: 'p1', kind: 'selfie' }] }, schema);
  expect(bad.fields).toEqual({ claim: {} });
  expect(validate(bad)).toBe(true);
  expect(validate(withoutBadDocumentList({ claim: {} }, schema))).toBe(true);
  expect(withoutBadDocumentList({ claim: {}, document_list: list }, schema).fields.document_list).toEqual(list);
});

it('one short line (kind and date per page); each page keeps its page, confidence and reason', () => {
  const item = documentListCheck({ document_list: [...list, { ...list[0], kind: 'voucher', date: '12/10/2026' }] });
  expect(item).toMatchObject({ code: 'DOCUMENT_LIST', label: 'Documents found', passed: true, documents: [
    { label: 'claim form', page: 'claim.pdf - page 1', confidence: 0.95, reason: 'printed AYA claim form, date in section A' },
    { label: 'eye test slip', date: null },
    { label: 'voucher', date: null, dateRead: '12/10/2026' },
  ] });
  expect(item.note).toBe('3 pages: claim form, 2026-10-12; eye test slip, no date; voucher, date unclear ("12/10/2026").');
  expect(item.confidence).toBeUndefined();
  expect(documentListCheck({})).toBeNull(); // an old case, read before the list existed
});

it('is information only: no review point and no hold, even when the AI was unsure of a page', () => {
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [documentListCheck({ document_list: list })] };
  const summary = buildAssessmentSummary({ documentCheckResult });
  expect(summary.lines.find((l) => l.decision === 'Documents found')).toMatchObject({ result: 'Info', status: 'ok', review: null });
  expect(summary.reviewPoints).toEqual([]);
  expect(unsurePassedPoints(documentCheckResult)).toEqual([]);
  expect(unsureDocumentPoints(documentCheckResult)).toEqual([]);
  expect(correctionOptions({}, documentCheckResult).some((o) => o.item === 'DOCUMENT_LIST')).toBe(false);
});
