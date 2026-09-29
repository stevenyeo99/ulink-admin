// Console upload by API (cl-upload) for email cases — docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md.
// The console creates the barcode later (about every 15 minutes), so the case waits at
// CONSOLE_BARCODE_PENDING and console-barcode picks the barcode up on a later run.

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { update: jest.fn(), findAll: jest.fn() },
  CaseEvent: { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../modules/api-material-download/middlewareClient', () => ({ listBarcodes: jest.fn() }));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));

const { Case, CaseEvent } = require('../db/models');
const { listBarcodes } = require('../modules/api-material-download/middlewareClient');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const { decideBarcode, checkCase } = require('../modules/console-barcode/service');
const { barcodeFields } = require('../modules/shared/barcodeFields');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');

const uploadedAt = '2026-09-29T09:00:00.000Z';
const item = (barcodeId, createdAt, n = '01') => ({ barcodeId, createdAt, scanId: `API-AYA-CL-26031486-${n}` });
const at = (iso) => new Date(iso);

beforeEach(() => jest.clearAllMocks());

describe('decideBarcode', () => {
  const decide = (items, now) => decideBarcode({ items, uploadedAt, now: at(now), waitMinutes: 120 });

  it('waits while no barcode newer than our upload is there', () => {
    expect(decide([], '2026-09-29T09:20:00Z')).toEqual({ state: 'waiting' });
    // An older upload of the same case is not ours.
    expect(decide([item('OLD1', '2026-09-28T10:00:00Z')], '2026-09-29T09:20:00Z')).toEqual({ state: 'waiting' });
  });

  it('takes every barcode of the case, earliest first, once ours is there', () => {
    const result = decide([item('NEW2', '2026-09-29T09:16:00Z', '02'), item('OLD1', '2026-09-28T10:00:00Z')], '2026-09-29T09:20:00Z');
    expect(result.state).toBe('found');
    expect(result.barcodes.map((b) => b.barcodeId)).toEqual(['OLD1', 'NEW2']);
    // → the claim's barcode + suppBarcode1..5
    expect(barcodeFields(result.barcodes)).toMatchObject({ barcode: 'OLD1', suppBarcode1: 'NEW2', suppBarcode2: null });
  });

  it('allows a few minutes of clock difference between the servers', () => {
    expect(decide([item('B1', '2026-09-29T08:57:00Z')], '2026-09-29T09:20:00Z').state).toBe('found');
  });

  it('is overdue past the wait time', () => {
    expect(decide([], '2026-09-29T11:01:00Z')).toEqual({ state: 'overdue' });
  });
});

describe('checkCase', () => {
  const pending = (status = 'CONSOLE_BARCODE_PENDING') => ({
    id: 'case-1',
    currentStatus: status,
    createdAt: '2026-09-29T08:00:00Z',
    consoleUploadResult: { method: 'cl-upload', tpaCaseNumber: 'AYA-CL-26031486', uploadedAt, file: 'AYA-CL-26031486.pdf' },
  });

  it('saves the barcodes and moves the case on', async () => {
    listBarcodes.mockResolvedValue({ items: [item('VSQ9T11875', '2026-09-29T09:18:18Z')], hasMore: false });
    expect(await checkCase(pending(), at('2026-09-29T09:30:00Z'))).toBe('found');
    expect(listBarcodes).toHaveBeenCalledWith('API-AYA-CL-26031486');
    expect(Case.update).toHaveBeenCalledWith(expect.objectContaining({
      currentStatus: 'DOCUMENTS_UPLOADED',
      consoleBarcode: 'VSQ9T11875',
      consoleUploadResult: expect.objectContaining({ barcodes: [expect.objectContaining({ barcodeId: 'VSQ9T11875' })] }),
    }), expect.anything());
  });

  it('leaves a waiting case alone', async () => {
    listBarcodes.mockResolvedValue({ items: [], hasMore: false });
    expect(await checkCase(pending(), at('2026-09-29T09:20:00Z'))).toBe('waiting');
    expect(Case.update).not.toHaveBeenCalled();
  });

  it('flags an overdue case for review once, with an internal email, and still picks the barcode up later', async () => {
    listBarcodes.mockResolvedValue({ items: [], hasMore: false });
    expect(await checkCase(pending(), at('2026-09-29T11:30:00Z'))).toBe('overdue');
    expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'CONSOLE_BARCODE_MISSING' }, expect.anything());
    expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'CONSOLE_BARCODE_MISSING' }), expect.anything());
    expect(queueDedupedTask).toHaveBeenCalledWith('tx', expect.objectContaining({ taskType: 'CONSOLE_UPLOAD_ISSUE', dedupeKey: 'CONSOLE_BARCODE_MISSING' }));

    jest.clearAllMocks();
    expect(await checkCase(pending('CONSOLE_BARCODE_MISSING'), at('2026-09-29T12:00:00Z'))).toBe('overdue');
    expect(Case.update).not.toHaveBeenCalled(); // already flagged — no second email

    listBarcodes.mockResolvedValue({ items: [item('LATE1', '2026-09-29T12:10:00Z')], hasMore: false });
    expect(await checkCase(pending('CONSOLE_BARCODE_MISSING'), at('2026-09-29T12:15:00Z'))).toBe('found');
  });
});

it('shows the wait in "why the case went this way", then the barcode', () => {
  const upload = { method: 'cl-upload', uploadedAt, file: 'AYA-CL-26031486.pdf' };
  const waiting = buildAssessmentSummary({ currentStatus: 'CONSOLE_BARCODE_PENDING', consoleUploadResult: upload }).journey;
  expect(waiting).toEqual([
    { stage: 'Console upload', result: 'Waiting for barcode', why: 'Uploaded 2026-09-29 09:00 UTC as AYA-CL-26031486.pdf; the console creates barcodes about every 15 minutes.' },
    expect.objectContaining({ stage: 'Now', result: 'Waiting for console barcode' }),
  ]);
  const done = buildAssessmentSummary({ consoleUploadResult: { ...upload, barcodes: [item('B1', uploadedAt), item('B2', uploadedAt, '02')] } }).journey;
  expect(done[0]).toMatchObject({ result: 'Barcode received', why: 'Uploaded 2026-09-29 09:00 UTC as AYA-CL-26031486.pdf; barcode B1 (+1 supplementary).' });
});
