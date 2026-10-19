// SYSTEM_4 E4-04: upload missing documents from the case page — any logged-in user, a comment required, PDF / JPG /
// PNG only, merged into one PDF and stored on the case; the case is read and checked again at once, and goes to the
// IAS console later (api-console-upload). The PDF merge and storage are replaced here.

jest.mock('../db/models', () => {
  const rows = { cases: [], steps: [], events: [], documents: [] };
  return {
    rows,
    sequelize: { transaction: (fn) => fn('tx') },
    Case: { findByPk: jest.fn(), update: jest.fn(async (fields, opts) => { rows.cases.push({ fields, where: opts.where }); return [1]; }) },
    CaseDocument: { create: jest.fn(async (row) => { rows.documents.push(row); return { id: `doc-${rows.documents.length}`, ...row }; }) },
    ApiCaseStep: { create: jest.fn(async (row) => rows.steps.push(row)) },
    CaseEvent: { create: jest.fn(async (row) => rows.events.push(row)) },
  };
});
jest.mock('../modules/console-upload/mergePdf', () => ({ mergeToPdf: jest.fn(async (files) => ({ pdf: Buffer.from('%PDF'), pageCount: files.length, skipped: [] })) }));
jest.mock('../storage', () => {
  const put = jest.fn(async (key) => ({ storageRef: `ref:${key}` }));
  return { put, getStorageAdapter: () => ({ put }) };
});

const config = require('../config');
const { rows, Case } = require('../db/models');
const { mergeToPdf } = require('../modules/console-upload/mergePdf');
const { put } = require('../storage');
const { uploadCaseDocuments } = require('../controllers/cases/casesController');

const waiting = { id: 'case-1', source: 'API', currentStatus: 'API_CLAIM_SUSPENDED', tpaCaseNumber: 'AYA-CL-26100012' };
const file = (filename) => ({ filename, contentType: 'application/pdf', data: Buffer.from('bytes').toString('base64') });
const call = async (body, caseRecord = waiting) => {
  Case.findByPk.mockResolvedValue(caseRecord);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await uploadCaseDocuments({ params: { id: 'case-1' }, body, user: { username: 'csr1', name: 'CSR' } }, res);
  return res;
};

beforeAll(() => { config.clUpload.url = 'http://cl-upload.test'; config.clUpload.apiKey = 'k'; });
beforeEach(() => { jest.clearAllMocks(); Object.values(rows).forEach((r) => { r.length = 0; }); });

it('merges the files into one PDF stored on the case, and the case is read again', async () => {
  const res = await call({ comment: 'Customer sent the medical report by Viber', files: [file('report.pdf'), file('voucher.jpg')] });
  expect(res.body).toEqual({ caseId: 'case-1', currentStatus: 'API_UPLOAD_RECEIVED', files: ['report.pdf', 'voucher.jpg'] });
  expect(mergeToPdf).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(expect.stringMatching(/^api\/AYA-CL-26100012\/upload\/[0-9a-f-]{36}\.pdf$/), Buffer.from('%PDF'));
  expect(rows.documents).toEqual([expect.objectContaining({
    caseId: 'case-1', origin: 'UPLOAD', barcodeId: null, contentType: 'application/pdf',
    originalFilename: expect.stringMatching(/^UPLOAD-AYA-CL-26100012-\d{4}-\d\d-\d\dT\d{6}\.pdf$/),
  })]);
  expect(rows.cases[0]).toMatchObject({ fields: { currentStatus: 'API_UPLOAD_RECEIVED' } });
  expect(rows.steps[0]).toMatchObject({ job: 'case-upload', status: 'DONE', input: { username: 'csr1', comment: 'Customer sent the medical report by Viber' }, output: { documentId: 'doc-1', pageCount: 2 } });
  expect(rows.events[0].message).toBe('Documents uploaded by CSR (csr1) — comment: Customer sent the medical report by Viber (report.pdf, voucher.jpg, 2 pages); read and checked next, then sent to the IAS console');
});

it('says so when console upload is not set up on the server (the case would be stuck after the check)', async () => {
  config.clUpload.url = '';
  expect(await call({ comment: 'resent', files: [file('a.pdf')] })).toMatchObject({ statusCode: 503 });
  config.clUpload.url = 'http://cl-upload.test';
  expect(put).not.toHaveBeenCalled();
});

it('needs a comment, the right files, and a case waiting on documents', async () => {
  expect((await call({ files: [file('a.pdf')] })).statusCode).toBe(400);
  expect((await call({ comment: 'resent', files: [] })).body.error.message).toBe('Choose 1 to 10 files.');
  expect((await call({ comment: 'resent', files: [file('a.docx')] })).body.error.message).toBe('Only PDF, JPG or PNG files: a.docx.');
  expect((await call({ comment: 'resent', files: [file('a.pdf')] }, { ...waiting, currentStatus: 'API_CSR_SENT' })).statusCode).toBe(400);
  expect((await call({ comment: 'resent', files: [file('a.pdf')] }, { ...waiting, currentStatus: 'API_UPLOAD_RECEIVED' })).statusCode).toBe(400);
  expect((await call({ comment: 'resent', files: [file('a.pdf')] }, { ...waiting, source: 'EMAIL', currentStatus: 'INCOMPLETE' })).statusCode).toBe(400);
  expect(put).not.toHaveBeenCalled();
});

it('the case moved on during the upload → refused, nothing recorded; storage down → try again', async () => {
  Case.update.mockResolvedValueOnce([0]);
  expect(await call({ comment: 'resent', files: [file('a.pdf')] })).toMatchObject({ statusCode: 409 });
  expect(rows.steps).toHaveLength(0);
  put.mockRejectedValueOnce(new Error('disk full'));
  expect(await call({ comment: 'resent', files: [file('a.pdf')] })).toMatchObject({ statusCode: 502, body: { error: { message: expect.stringContaining('Nothing changed — try again') } } });
});
