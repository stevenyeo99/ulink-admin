const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');
const config = require('../../config');

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

async function rasterizePdf(pdfBuffer, label) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claim-recognition-'));
  const inputPath = path.join(tempDir, `${label}.pdf`);
  await fs.promises.writeFile(inputPath, pdfBuffer);

  const outputPrefix = path.join(tempDir, label);
  try {
    await execFileAsync('pdftoppm', [
      '-r',
      String(config.claimRecognition.rasterDpi),
      '-jpeg',
      '-jpegopt',
      'quality=80',
      inputPath,
      outputPrefix,
    ]);
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    const stderr = (error.stderr || '').toString().trim();
    throw new Error(`pdftoppm failed: ${stderr || error.message}`);
  }

  const files = await fs.promises.readdir(tempDir);
  const prefixBase = path.basename(outputPrefix);
  const pageFiles = files
    .filter((file) => file.startsWith(prefixBase) && file.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (pageFiles.length === 0) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('pdftoppm produced no pages (check poppler-utils is installed)');
  }

  const pages = pageFiles.map((fileName, index) => {
    const pageMatch = fileName.match(/-(\d+)\.jpg$/);
    // pdfPath: the source PDF, for a sharper render of one page (burmeseOcr.js).
    return { pageNumber: pageMatch ? Number(pageMatch[1]) : index + 1, filePath: path.join(tempDir, fileName), pdfPath: inputPath };
  });

  return { pages, cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined) };
}

async function rasterizeImage(imageBuffer, label, ext) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claim-recognition-'));
  const filePath = path.join(tempDir, `${label}${ext}`);
  await fs.promises.writeFile(filePath, imageBuffer);
  return {
    pages: [{ pageNumber: 1, filePath }],
    cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined),
  };
}

/**
 * Turns one attachment (PDF or already-an-image) into per-page JPEG/PNG files ready for
 * a vision call. Caller MUST call the returned cleanup() once done with the images — this
 * job runs on a recurring cron and would otherwise leak temp files forever.
 */
async function preparePageImages(buffer, filename, label) {
  const ext = path.extname(filename || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return rasterizeImage(buffer, label, ext);
  }
  return rasterizePdf(buffer, label);
}

// One page as a PNG for Tesseract (burmeseOcr.js, sidewaysPage.js): a PDF page rendered again with its longest side
// OCR_MAX_SIDE_PX — A4 at 300 DPI; at the 100 DPI page image the letters are too small — and an image attachment with
// its EXIF orientation applied (so it matches what the AI was shown) and its longest side capped the same (a phone
// photo is far bigger). → the PNG's path, inside tempDir (the caller removes it).
const OCR_MAX_SIDE_PX = 3508;
async function renderForOcr(page, tempDir, timeoutMs = 60000) {
  const outPath = path.join(tempDir, `ocr-page-${page.pageNumber}.png`);
  if (page.pdfPath) {
    const n = String(page.pageNumber);
    await execFileAsync('pdftoppm', ['-scale-to', String(OCR_MAX_SIDE_PX), '-f', n, '-l', n, '-png', '-singlefile', page.pdfPath, outPath.replace(/\.png$/, '')], { timeout: timeoutMs });
  } else {
    await sharp(page.filePath).rotate().resize({ width: OCR_MAX_SIDE_PX, height: OCR_MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true }).png().toFile(outPath);
  }
  return outPath;
}

module.exports = { preparePageImages, renderForOcr };
