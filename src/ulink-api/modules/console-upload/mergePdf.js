const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

// cl-upload takes one file per case: every attachment merged into a single PDF, in attachment order.
// PDFs are copied page by page; JPEG/PNG are placed one per page at their own size; other images
// (WEBP, TIFF, …) are converted to PNG first. Anything else can't go into a PDF and is reported back.
async function mergeToPdf(files) {
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
      const page = merged.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    } else {
      skipped.push(filename || '(unnamed)');
    }
  }

  return { pdf: Buffer.from(await merged.save()), pageCount: merged.getPageCount(), skipped };
}

module.exports = { mergeToPdf };
