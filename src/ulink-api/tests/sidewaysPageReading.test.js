// A sideways page's upright reading goes to the extraction, under the page's label; the page text stays as read (UAT AYA-CL-26034500).
jest.mock('../modules/claim-recognition/rasterize', () => ({
  preparePageImages: jest.fn(async () => ({ pages: [{ pageNumber: 1, filePath: __filename }, { pageNumber: 2, filePath: __filename }], cleanup: async () => undefined })),
}));
jest.mock('../modules/claim-recognition/llmClient', () => ({ transcribePage: jest.fn(), synthesizeJson: jest.fn(), DocumentsTooLongError: class extends Error {} }));
jest.mock('../modules/claim-recognition/sidewaysPage', () => ({ turnedReading: jest.fn() }));

const { transcribePage } = require('../modules/claim-recognition/llmClient');
const { turnedReading } = require('../modules/claim-recognition/sidewaysPage');
const { transcribePages } = require('../modules/claim-recognition/service');

it('adds the upright reading under a sideways page; leaves an upright page as it is', async () => {
  transcribePage.mockResolvedValueOnce('A+ MEDICAL CLINIC (SINGAPORE)\nCustomer Signature').mockResolvedValueOnce('Bank Name: AYA');
  turnedReading.mockResolvedValueOnce({ direction: 'left', text: 'AR YU International Hospital\nTotal: 102,950' }).mockResolvedValueOnce(null);

  const pages = await transcribePages(Buffer.from('jpg'), 'scan.jpg', 'scan');

  // The page text stays as read; the upright reading goes only to the extraction, under the page's label.
  expect(pages[0]).toMatchObject({ text: 'A+ MEDICAL CLINIC (SINGAPORE)\nCustomer Signature', turned: { direction: 'left' } });
  expect(pages[1]).toMatchObject({ text: 'Bank Name: AYA', turned: null });
  const { pushPage } = require('../modules/claim-recognition/service');
  const chunks = [];
  const extraReadings = [];
  pages.forEach((page) => pushPage(chunks, extraReadings, 'scan.jpg', page));
  expect(chunks).toEqual(['[scan.jpg - page 1]\nA+ MEDICAL CLINIC (SINGAPORE)\nCustomer Signature', '[scan.jpg - page 2]\nBank Name: AYA']);
  expect(extraReadings).toEqual(['[scan.jpg - page 1] The photo on this page, turned left so it reads normally:\nAR YU International Hospital\nTotal: 102,950']);
});
