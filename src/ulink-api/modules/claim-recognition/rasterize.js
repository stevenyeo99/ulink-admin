const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
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
    return { pageNumber: pageMatch ? Number(pageMatch[1]) : index + 1, filePath: path.join(tempDir, fileName) };
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

module.exports = { preparePageImages };
