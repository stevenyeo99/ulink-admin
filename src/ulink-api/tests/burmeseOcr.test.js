// Typed Burmese on a claim form page (UAT AYA-CL-26041363): a page whose AI reading has Burmese also gets Tesseract's
// Burmese lines, kept apart from the page text (only the extraction gets them); an English page does not run
// Tesseract; Tesseract missing leaves the AI reading alone, with one warning.
jest.mock('child_process', () => ({ execFile: jest.fn() }));
// renderForOcr: the page as Tesseract reads it (a PDF page rendered again; an image as it is) — its own test is the real run.
jest.mock('../modules/claim-recognition/rasterize', () => ({ preparePageImages: jest.fn(), renderForOcr: jest.fn(async (page) => (page.pdfPath ? `/tmp/render-${page.pageNumber}.png` : page.filePath)) }));
jest.mock('../modules/claim-recognition/sidewaysPage', () => ({ turnedReading: jest.fn(async () => null) }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ transcribePage: jest.fn(), synthesizeJson: jest.fn(), DocumentsTooLongError: class extends Error {} }));

const { execFile } = require('child_process');
const { preparePageImages, renderForOcr } = require('../modules/claim-recognition/rasterize');
const { transcribePage } = require('../modules/claim-recognition/llmClient');
const { transcribePages, pushPage } = require('../modules/claim-recognition/service');
const { burmeseLines } = require('../modules/claim-recognition/burmeseOcr');

const OCR = 'Detail of illness injury\nနေမကောင်း\nDoctor Name\nDr.Khin Aye Gyi\nHospital or Clinic Name\nအောင်သစ္စာဆေးရုံ\n';
// execFile(cmd, args, options, callback): tesseract prints its reading.
const tools = (tesseract) => execFile.mockImplementation((cmd, args, options, callback) => tesseract(callback));
const pdfPages = () => preparePageImages.mockResolvedValue({
  pages: [{ pageNumber: 1, filePath: __filename, pdfPath: '/tmp/x.pdf' }, { pageNumber: 2, filePath: __filename, pdfPath: '/tmp/x.pdf' }],
  cleanup: async () => undefined,
});

beforeEach(() => {
  jest.clearAllMocks();
  transcribePage.mockResolvedValueOnce('Detail of illness injury: အနာရောဂါ\nAccount Number:').mockResolvedValueOnce('Bank Name: AYA');
});

it('keeps only the Burmese lines, each with the line before it (its label)', () => {
  expect(burmeseLines(OCR)).toBe('Detail of illness injury\nနေမကောင်း\nHospital or Clinic Name\nအောင်သစ္စာဆေးရုံ');
  expect(burmeseLines('Bank Name\nAYA')).toBeNull();
});

it("a Burmese page gets the OCR apart from its text; an English page does not run Tesseract; the chunk is unchanged", async () => {
  pdfPages();
  tools((callback) => callback(null, { stdout: OCR }));

  const pages = await transcribePages(Buffer.from('%PDF'), 'form.pdf', 'form');

  expect(pages[0]).toMatchObject({ text: 'Detail of illness injury: အနာရောဂါ\nAccount Number:', ocr: expect.stringContaining('နေမကောင်း') });
  expect(pages[1]).toMatchObject({ text: 'Bank Name: AYA', ocr: null });
  expect(execFile.mock.calls.filter(([cmd]) => cmd === 'tesseract')).toHaveLength(1);
  expect(execFile.mock.calls.find(([cmd]) => cmd === 'tesseract')[1]).toEqual(expect.arrayContaining(['-l', 'mya+eng', '--psm', '11']));
  expect(renderForOcr).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, pdfPath: '/tmp/x.pdf' }), expect.any(String), 60000);
  expect(execFile.mock.calls.find(([cmd]) => cmd === 'tesseract')[1][0]).toBe('/tmp/render-1.png');

  // The page chunk stays as the AI read it (the account number backstop still sees "Account Number:" at the end).
  const chunks = [];
  const extraReadings = [];
  pages.forEach((page) => pushPage(chunks, extraReadings, 'form.pdf', page));
  expect(chunks).toEqual(['[form.pdf - page 1]\nDetail of illness injury: အနာရောဂါ\nAccount Number:', '[form.pdf - page 2]\nBank Name: AYA']);
  expect(extraReadings).toEqual([expect.stringMatching(/^\[form\.pdf - page 1\] Burmese OCR text \(typed Burmese lines, each with the line before it\):\nDetail of illness injury\nနေမကောင်း/)]);
});

it('an image attachment: Tesseract reads the image itself', async () => {
  preparePageImages.mockResolvedValue({ pages: [{ pageNumber: 1, filePath: __filename }], cleanup: async () => undefined });
  tools((callback) => callback(null, { stdout: OCR }));

  await transcribePages(Buffer.from('jpg'), 'photo.jpg', 'photo');

  expect(execFile.mock.calls.map(([cmd]) => cmd)).toEqual(['tesseract']);
  expect(execFile.mock.calls[0][1][0]).toBe(__filename);
});

it('Tesseract missing: the pages keep the AI reading, and it is not tried again', async () => {
  pdfPages();
  tools((callback) => callback(Object.assign(new Error('spawn tesseract ENOENT'), { code: 'ENOENT' })));

  const pages = await transcribePages(Buffer.from('%PDF'), 'form.pdf', 'form');
  transcribePage.mockResolvedValueOnce('အနာရောဂါ');
  preparePageImages.mockResolvedValue({ pages: [{ pageNumber: 1, filePath: __filename, pdfPath: '/tmp/x.pdf' }], cleanup: async () => undefined });
  await transcribePages(Buffer.from('%PDF'), 'form.pdf', 'form');

  expect(pages.map((p) => p.ocr)).toEqual([null, null]);
  expect(execFile.mock.calls.filter(([cmd]) => cmd === 'tesseract')).toHaveLength(1);
});
