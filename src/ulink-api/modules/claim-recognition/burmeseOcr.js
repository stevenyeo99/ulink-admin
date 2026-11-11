const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const logger = require('../../utils/logger');

const execFileAsync = promisify(execFile);

// Typed Burmese on a claim form page, read by Tesseract OCR (UAT AYA-CL-26041363): the AI page reader misread the typed
// "နေမကောင်း" as "အနာရောဂါ" and "အဖျားကြီး" (high fever) as "အယားကြီး" (big itch); Tesseract with the Burmese data
// (tesseract-ocr-mya) reads them. Only for a page whose AI reading has Burmese. A PDF page is rendered again at 300 DPI
// (at 100 DPI the letters are too small); an image attachment is read as it is. Page mode 11 (sparse text): on the
// claim form's label/value layout it kept a wrapped Burmese line whole, where the default modes broke it into junk. Tesseract or its Burmese data missing,
// or any failure: null, with a "Burmese OCR skipped" warning — the page goes on with the AI reading alone, as before.
// Setup: docs/deployment/DEPLOY_API.md "Burmese OCR (Tesseract)".
const OCR_DPI = 300;
const TIMEOUT_MS = 60000;

async function burmeseOcrText(page) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'burmese-ocr-'));
  try {
    let imagePath = page.filePath;
    if (page.pdfPath) {
      const prefix = path.join(tempDir, 'page');
      const n = String(page.pageNumber);
      await execFileAsync('pdftoppm', ['-r', String(OCR_DPI), '-f', n, '-l', n, '-png', '-singlefile', page.pdfPath, prefix], { timeout: TIMEOUT_MS });
      imagePath = `${prefix}.png`;
    }
    const { stdout } = await execFileAsync('tesseract', [imagePath, '-', '-l', 'mya+eng', '--psm', '11'], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    const text = stdout.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
    return text || null;
  } catch (error) {
    logger.warn(`Burmese OCR skipped: ${(error.stderr || '').toString().trim() || error.message}`);
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = { burmeseOcrText };
