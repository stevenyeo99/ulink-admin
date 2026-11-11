// Typed Burmese on a claim form page (UAT AYA-CL-26041363): a page whose AI reading has Burmese also gets Tesseract's
// reading under it; an English page does not run Tesseract; Tesseract missing or failing leaves the AI reading alone.
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../modules/claim-recognition/rasterize', () => ({
  preparePageImages: jest.fn(async () => ({
    pages: [{ pageNumber: 1, filePath: __filename, pdfPath: '/tmp/x.pdf' }, { pageNumber: 2, filePath: __filename, pdfPath: '/tmp/x.pdf' }],
    cleanup: async () => undefined,
  })),
}));
jest.mock('../modules/claim-recognition/llmClient', () => ({ transcribePage: jest.fn(), synthesizeJson: jest.fn(), DocumentsTooLongError: class extends Error {} }));

const { execFile } = require('child_process');
const { transcribePage } = require('../modules/claim-recognition/llmClient');
const { transcribePages } = require('../modules/claim-recognition/service');

// execFile(cmd, args, options, callback): pdftoppm renders, tesseract prints its reading.
const tools = (tesseract) => execFile.mockImplementation((cmd, args, options, callback) => {
  if (cmd === 'pdftoppm') return callback(null, { stdout: '', stderr: '' });
  return tesseract(callback);
});

beforeEach(() => {
  jest.clearAllMocks();
  transcribePage.mockResolvedValueOnce('Detail of illness injury: အနာရောဂါ').mockResolvedValueOnce('Bank Name: AYA');
});

it("a Burmese page gets Tesseract's reading under the AI's; an English page does not run Tesseract", async () => {
  tools((callback) => callback(null, { stdout: 'Detail of illness injury\n\nနေမကောင်း\n', stderr: '' }));

  const pages = await transcribePages(Buffer.from('%PDF'), 'form.pdf', 'form');

  expect(pages[0].text).toBe('Detail of illness injury: အနာရောဂါ\n\nBurmese OCR text (page 1):\nDetail of illness injury\nနေမကောင်း');
  expect(pages[1].text).toBe('Bank Name: AYA');
  const tesseractCalls = execFile.mock.calls.filter(([cmd]) => cmd === 'tesseract');
  expect(tesseractCalls).toHaveLength(1);
  expect(tesseractCalls[0][1]).toEqual(expect.arrayContaining(['-l', 'mya+eng', '--psm', '11']));
  expect(execFile.mock.calls.find(([cmd]) => cmd === 'pdftoppm')[1]).toEqual(expect.arrayContaining(['-r', '300', '-f', '1', '-l', '1']));
});

it('Tesseract missing: the page keeps the AI reading, the case goes on', async () => {
  tools((callback) => callback(Object.assign(new Error('spawn tesseract ENOENT'), { stderr: '' })));

  const pages = await transcribePages(Buffer.from('%PDF'), 'form.pdf', 'form');

  expect(pages.map((p) => p.text)).toEqual(['Detail of illness injury: အနာရောဂါ', 'Bank Name: AYA']);
});
