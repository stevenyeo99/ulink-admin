const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

// cl-upload takes one file per case: every attachment merged into a single PDF, in attachment order.
// PDFs are copied page by page; JPEG/PNG are placed one per page at their own size; other images
// (WEBP, TIFF, …) are converted to PNG first. Anything else can't go into a PDF and is reported back.
// imageDpi: size each image page so that rendering the page at this resolution gives back the image's own pixels
// (api-material-download: the AI reads the page rendered at CLAIM_RECOGNITION_RASTER_DPI, so the console photo reaches
// it at its own size). Without it, one PDF point per pixel, as before.
async function mergeToPdf(files, { imageDpi = 72 } = {}) {
  if (!(imageDpi > 0)) throw new Error(`imageDpi must be a positive number, got ${imageDpi}`);
  const merged = await PDFDocument.create();
  const skipped = [];

  for (const { bytes, contentType, filename } of files) {
    const type = (contentType || '').toLowerCase();
    const name = (filename || '').toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    } else if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|tiff?|bmp|heic)$/.test(name)) {
      const image = type === 'image/jpeg' || /\.jpe?g$/.test(name)
        ? await merged.embedJpg(bytes)
        : await merged.embedPng(type === 'image/png' || name.endsWith('.png') ? bytes : await sharp(bytes).png().toBuffer());
      const scale = 72 / imageDpi;
      const page = merged.addPage([image.width * scale, image.height * scale]);
      page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
    } else {
      skipped.push(filename || '(unnamed)');
    }
  }

  return { pdf: Buffer.from(await merged.save()), pageCount: merged.getPageCount(), skipped };
}

module.exports = { mergeToPdf };
