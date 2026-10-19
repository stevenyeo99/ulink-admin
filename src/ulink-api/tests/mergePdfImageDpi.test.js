// mergeToPdf's imageDpi (api-material-download, 2026-10-19): a console photo's page is sized so that the AI's rendering
// at CLAIM_RECOGNITION_RASTER_DPI gives back the photo's own pixels — no bigger image, no more AI tokens.
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { mergeToPdf } = require('../modules/console-upload/mergePdf');

it('sizes an image page for the given resolution; without one, one point per pixel as before', async () => {
  const jpg = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const pageSize = async (options) => (await PDFDocument.load((await mergeToPdf([{ bytes: jpg, filename: 'p.jpg', contentType: 'image/jpeg' }], options)).pdf)).getPage(0).getSize();
  expect(await pageSize({ imageDpi: 100 })).toEqual({ width: 1080, height: 1440 }); // 1500 px at 100 dpi = 15 in = 1080 pt
  expect(await pageSize()).toEqual({ width: 1500, height: 2000 });
});

it('refuses a resolution that is not a positive number (a bad CLAIM_RECOGNITION_RASTER_DPI)', async () => {
  await expect(mergeToPdf([], { imageDpi: -100 })).rejects.toThrow('imageDpi must be a positive number');
});
