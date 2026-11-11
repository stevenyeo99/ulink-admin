// A document photographed sideways (UAT AYA-CL-26034500): turned only when the AI says sideways AND Tesseract clearly
// reads one turn better; the upright reading is added under the page reading, never in place of it.
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ transcribePage: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { execFile } = require('child_process');
const { transcribePage } = require('../modules/claim-recognition/llmClient');
const { pickTurn, confidentWords, turnedReading } = require('../modules/claim-recognition/sidewaysPage');

const tsvRow = (conf, text) => ['5', '1', '1', '1', '1', '1', '0', '0', '10', '10', String(conf), text].join('\t');
const tsvWords = (n) => ['header', ...Array.from({ length: n }, () => tsvRow(95, 'Charges'))].join('\n');

describe('pickTurn', () => {
  it('turns the way that clearly reads better (page 7: left 22, right 0)', () => {
    expect(pickTurn({ left: 22, right: 0 })).toBe(270);
    expect(pickTurn({ left: 0, right: 15 })).toBe(90);
  });
  it('no clear winner: no turn (an upright page reads nothing either way; a near tie is doubt)', () => {
    expect(pickTurn({ left: 0, right: 0 })).toBeNull();
    expect(pickTurn({ left: 9, right: 0 })).toBeNull(); // too few words
    expect(pickTurn({ left: 20, right: 8 })).toBeNull(); // not 3 times the other side
  });
});

it('counts words read with confidence 80+ and 3+ letters', () => {
  const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext', tsvRow(95, 'Doctor'), tsvRow(91, 'Charges'), tsvRow(60, 'Receipt'), tsvRow(99, 'of'), tsvRow(-1, '')].join('\n');
  expect(confidentWords(tsv)).toBe(2);
});

describe('turnedReading', () => {
  let page;
  let image;
  beforeAll(async () => {
    image = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sideways-test-')), 'photo.jpg');
    fs.writeFileSync(file, image);
    page = { pageNumber: 1, filePath: file };
  });
  beforeEach(() => jest.clearAllMocks());
  // tesseract on the page turned left (turn-270) / right (turn-90): that many confident words.
  const tesseract = ({ left, right }) => execFile.mockImplementation((cmd, args, options, callback) => {
    callback(null, { stdout: tsvWords(args[0].includes('turn-270') ? left : right) });
  });

  it('the AI says upright: no Tesseract, no turn', async () => {
    transcribePage.mockResolvedValueOnce('upright');
    expect(await turnedReading(page, image, 'read')).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('the AI says sideways (any wording) and left clearly reads better: turned left and read again', async () => {
    transcribePage.mockResolvedValueOnce('The document is **sideways**.').mockResolvedValueOnce('AR YU International Hospital');
    tesseract({ left: 22, right: 0 });
    expect(await turnedReading(page, image, 'read')).toEqual({ direction: 'left', text: 'AR YU International Hospital' });
    expect(transcribePage).toHaveBeenLastCalledWith({ imageBuffer: expect.any(Buffer), instruction: 'read' });
  });

  it('sideways, but no clear winner: no turn', async () => {
    transcribePage.mockResolvedValueOnce('sideways');
    tesseract({ left: 0, right: 0 });
    expect(await turnedReading(page, image, 'read')).toBeNull();
    expect(transcribePage).toHaveBeenCalledTimes(1);
  });

  it('Tesseract missing: no turn, and no more checks (nor their AI question)', async () => {
    transcribePage.mockResolvedValueOnce('sideways');
    execFile.mockImplementation((cmd, args, options, callback) => callback(Object.assign(new Error('spawn tesseract ENOENT'), { code: 'ENOENT' })));
    expect(await turnedReading(page, image, 'read')).toBeNull();
    expect(await turnedReading(page, image, 'read')).toBeNull();
    expect(transcribePage).toHaveBeenCalledTimes(1);
  });
});
