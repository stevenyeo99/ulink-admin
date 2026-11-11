const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');
const logger = require('../../utils/logger');
const { transcribePage } = require('./llmClient');
const { renderForOcr } = require('./rasterize');

const execFileAsync = promisify(execFile);

// A document photographed sideways on a page (UAT AYA-CL-26034500: the Ar Yu receipt on page 7 lay on its side; the page
// reader misread "AR YU+" as "A+ MEDICAL CLINIC (SINGAPORE)" and invented its lines and total). Read upright, it reads
// exactly. Two signals, because neither alone is safe (tested 2026-11-11):
// 1. The AI says whether the main document is sideways — reliable — but not which way to turn it (it said "right" for a
//    page that needed a left turn).
// 2. Tesseract counts confident English words with the page turned left and turned right: the upright side wins clearly
//    (page 7: left 22, right 0); an upright page gives nothing either way (0 / 0), so it is never turned.
// Turned only when the AI says sideways AND one side clearly wins. A photo's EXIF orientation is applied first, so the AI,
// Tesseract and the turn all see the same picture. Any doubt or failure: no turn, as before. Tesseract or pdftoppm
// missing: one warning, then no more checks (nor their AI question) until a restart.
const ORIENTATION_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'page-orientation.md'), 'utf8');
const TIMEOUT_MS = 60000;
const MIN_WORDS = 10;
const MIN_RATIO = 3;
let unavailable = false;

// Tesseract TSV → words read with confidence ≥ 80 and at least 3 letters.
function confidentWords(tsv) {
  return tsv.split('\n').slice(1).map((line) => line.split('\t'))
    .filter((cols) => Number(cols[10]) >= 80 && (cols[11] || '').trim().length >= 3).length;
}

// { left, right } word counts → the turn in degrees clockwise (left = 270, right = 90), or null when neither clearly wins.
function pickTurn({ left, right }) {
  const [winner, loser, degrees] = left >= right ? [left, right, 270] : [right, left, 90];
  return winner >= MIN_WORDS && winner >= MIN_RATIO * Math.max(loser, 1) ? degrees : null;
}

async function wordsTurned(imagePath, degrees, tempDir) {
  const turnedPath = path.join(tempDir, `turn-${degrees}.png`);
  await sharp(imagePath).rotate(degrees).toFile(turnedPath);
  const { stdout } = await execFileAsync('tesseract', [turnedPath, '-', '-l', 'eng', '--psm', '11', 'tsv'], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  return confidentWords(stdout);
}

// The image as shown: a photo's EXIF orientation applied (sharp's rotate() with no angle); otherwise the bytes as they are.
async function asShown(imageBuffer) {
  const { orientation } = await sharp(imageBuffer).metadata();
  return orientation > 1 ? sharp(imageBuffer).rotate().jpeg({ quality: 80 }).toBuffer() : imageBuffer;
}

/**
 * page: { pageNumber, filePath, pdfPath? }; imageBuffer: the page image the reader saw; instruction: the page reader's.
 * → { direction: 'left' | 'right', text } — the page reader's reading of the page turned upright — or null.
 */
async function turnedReading(page, imageBuffer, instruction) {
  if (unavailable) return null;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sideways-'));
  try {
    const shown = await asShown(imageBuffer);
    const answer = await transcribePage({ imageBuffer: shown, instruction: ORIENTATION_PROMPT });
    if (!/\bsideways\b/i.test(answer)) return null;

    const ocrPath = await renderForOcr(page, tempDir, TIMEOUT_MS);
    const [left, right] = await Promise.all([wordsTurned(ocrPath, 270, tempDir), wordsTurned(ocrPath, 90, tempDir)]);
    const degrees = pickTurn({ left, right });
    if (degrees == null) {
      logger.info(`Page ${page.pageNumber} looks sideways, but no turn reads clearly better (left ${left}, right ${right}): left as it is.`);
      return null;
    }
    const turned = await sharp(shown).rotate(degrees).jpeg({ quality: 80 }).toBuffer();
    return { direction: degrees === 270 ? 'left' : 'right', text: await transcribePage({ imageBuffer: turned, instruction }) };
  } catch (error) {
    if (error.code === 'ENOENT') unavailable = true; // tesseract or pdftoppm not installed: the same on every page
    logger.warn(`Sideways page check skipped: ${(error.stderr || '').toString().trim() || error.message}`);
    return null;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = { turnedReading, pickTurn, confidentWords };
