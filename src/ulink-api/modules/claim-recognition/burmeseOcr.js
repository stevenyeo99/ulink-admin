const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const logger = require('../../utils/logger');
const { hasBurmese } = require('../ias-claim-preparation/medicalTranslation');

const execFileAsync = promisify(execFile);

// Typed Burmese on a claim form page, read by Tesseract OCR (UAT AYA-CL-26041363): the AI page reader misread the typed
// "နေမကောင်း" as "အနာရောဂါ" and "အဖျားကြီး" (high fever) as "အယားကြီး" (big itch); Tesseract with the Burmese data
// (tesseract-ocr-mya) reads them. Only for a page whose AI reading has Burmese. A PDF page is rendered again at about
// 300 DPI (at 100 DPI the letters are too small), its longest side capped (a huge page would render to hundreds of MB);
// an image attachment is read as it is. Page mode 11 (sparse text): on the claim form's label/value layout it kept a
// wrapped Burmese line whole, where the default modes broke it into junk. Only the Burmese lines are kept, each with the
// line before it (usually its field label): the English is already in the AI's reading.
// Tesseract or its Burmese data missing: one "Burmese OCR skipped" warning, then no more tries until a restart; any
// other failure: a warning for that page. Either way null — the page goes on with the AI reading alone, as before.
// Setup: docs/deployment/DEPLOY_API.md "Burmese OCR (Tesseract)".
const MAX_SIDE_PX = 3508; // A4 at 300 DPI
const TIMEOUT_MS = 60000;
let unavailable = false;

function burmeseLines(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const keep = new Set();
  lines.forEach((line, i) => {
    if (!hasBurmese(line)) return;
    if (i > 0) keep.add(i - 1);
    keep.add(i);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n') || null;
}

async function burmeseOcrText(page) {
  if (unavailable) return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'burmese-ocr-'));
  try {
    let imagePath = page.filePath;
    if (page.pdfPath) {
      const prefix = path.join(tempDir, 'page');
      const n = String(page.pageNumber);
      await execFileAsync('pdftoppm', ['-scale-to', String(MAX_SIDE_PX), '-f', n, '-l', n, '-png', '-singlefile', page.pdfPath, prefix], { timeout: TIMEOUT_MS });
      imagePath = `${prefix}.png`;
    }
    const { stdout } = await execFileAsync('tesseract', [imagePath, '-', '-l', 'mya+eng', '--psm', '11'], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return burmeseLines(stdout);
  } catch (error) {
    const detail = (error.stderr || '').toString().trim() || error.message;
    // Not installed (spawn ENOENT) or no Burmese data: the same on every page, so stop trying.
    if (error.code === 'ENOENT' || /Failed loading language|mya\.traineddata/i.test(detail)) unavailable = true;
    logger.warn(`Burmese OCR skipped: ${detail}`);
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = { burmeseOcrText, burmeseLines };
