// SYSTEM_4 E4-04: upload missing documents from the case page — any logged-in user, a comment required, PDF / JPG /
// PNG only, sent to the IAS console as one PDF; the case then waits for the console. cl-upload and the PDF merge are
// replaced here — nothing real is uploaded.

jest.mock('../db/models', () => {
  const rows = { cases: [], steps: [], events: [] };
  return {
    rows,
    sequelize: { transaction: (fn) => fn('tx') },
    Case: { findByPk: jest.fn(), update: jest.fn(async (fields, opts) => rows.cases.push({ fields, where: opts.where })) },
    ApiCaseStep: { create: jest.fn(async (row) => rows.steps.push(row)) },
    CaseEvent: { create: jest.fn(async (row) => rows.events.push(row)) },
  };
});
jest.mock('../modules/console-upload/mergePdf', () => ({ mergeToPdf: jest.fn(async (files) => ({ pdf: Buffer.from('%PDF'), pageCount: files.length, skipped: [] })) }));
jest.mock('../modules/console-upload/clUploadClient', () => {
  const actual = jest.requireActual('../modules/console-upload/clUploadClient');
  return { ...actual, uploadToConsole: jest.fn(async () => ({ path: '/outbox/API-AYA-CL-26100012-01/UPLOAD.pdf' })) };
});

const config = require('../config');
const { rows, Case } = require('../db/models');
const { uploadToConsole, UploadRejected } = require('../modules/console-upload/clUploadClient');
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

it('uploads to the console with the TPA case number, and the case waits for the console', async () => {
  const res = await call({ comment: 'Customer sent the medical report by Viber', files: [file('report.pdf'), file('voucher.jpg')] });
  expect(res.body).toEqual({ caseId: 'case-1', currentStatus: 'API_DOCUMENTS_UPLOADED', files: ['report.pdf', 'voucher.jpg'] });
  expect(uploadToConsole).toHaveBeenCalledWith(expect.objectContaining({ tpaCaseNumber: 'AYA-CL-26100012' }));
  expect(rows.cases[0]).toMatchObject({ fields: { currentStatus: 'API_DOCUMENTS_UPLOADED' } });
  expect(rows.steps[0]).toMatchObject({ job: 'case-upload', status: 'DONE', input: { username: 'csr1', comment: 'Customer sent the medical report by Viber' }, output: { path: '/outbox/API-AYA-CL-26100012-01/UPLOAD.pdf', pageCount: 2 } });
  expect(rows.events[0].message).toBe('Documents uploaded to the console by CSR (csr1) — comment: Customer sent the medical report by Viber (report.pdf, voucher.jpg, 2 pages)');
});

it('needs a comment, the right files, and a case waiting on documents', async () => {
  expect((await call({ files: [file('a.pdf')] })).statusCode).toBe(400);
  expect((await call({ comment: 'resent', files: [] })).body.error.message).toBe('Choose 1 to 10 files.');
  expect((await call({ comment: 'resent', files: [file('a.docx')] })).body.error.message).toBe('Only PDF, JPG or PNG files: a.docx.');
  expect((await call({ comment: 'resent', files: [file('a.pdf')] }, { ...waiting, currentStatus: 'API_CSR_SENT' })).statusCode).toBe(400);
  expect((await call({ comment: 'resent', files: [file('a.pdf')] }, { ...waiting, source: 'EMAIL', currentStatus: 'INCOMPLETE' })).statusCode).toBe(400);
  expect(uploadToConsole).not.toHaveBeenCalled();
});

it('the console said no → the reason, the case unchanged; a network failure → try again, unchanged', async () => {
  uploadToConsole.mockRejectedValueOnce(new UploadRejected('cl-upload refused the upload (status 400): bad case'));
  const refused = await call({ comment: 'resent', files: [file('a.pdf')] });
  expect(refused).toMatchObject({ statusCode: 422, body: { error: { message: expect.stringContaining('The console refused the upload') } } });
  uploadToConsole.mockRejectedValueOnce(new Error('cl-upload timed out after 60000ms'));
  const failed = await call({ comment: 'resent', files: [file('a.pdf')] });
  expect(failed).toMatchObject({ statusCode: 502, body: { error: { message: expect.stringContaining('Nothing changed — try again') } } });
  expect(rows.cases).toHaveLength(0);
});

it('says so when console upload is not set up on the server', async () => {
  config.clUpload.url = '';
  const res = await call({ comment: 'resent', files: [file('a.pdf')] });
  expect(res).toMatchObject({ statusCode: 503 });
  config.clUpload.url = 'http://cl-upload.test';
});
