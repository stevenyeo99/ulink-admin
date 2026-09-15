const { buildFolder, generateBarcode, sanitize } = require('../modules/console-upload/service');

// Pure-logic regression for console-upload's two user-specified formats (folder naming,
// barcode shape) — no DB/disk, so this stays fast and doesn't need fixtures. The DB/disk
// side (planUpload/uploadCase) is exercised via the dev preview endpoint and a real job run
// against a real case instead, same as every other job in this codebase.

describe('buildFolder', () => {
  it('builds yyyy/MM/dd/{ddMMyyyy}{claimantName}-AYAS-{caseId}', () => {
    const now = new Date('2026-09-15T03:00:00Z');
    const folder = buildFolder({ now, claimantName: 'Zay Yar Tun', caseId: 'case-123' });
    expect(folder).toBe('2026/09/15/15092026Zay_Yar_Tun-AYAS-case-123');
  });

  it('falls back to "Unknown" for a missing claimant name', () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const folder = buildFolder({ now, claimantName: null, caseId: 'case-456' });
    expect(folder).toBe('2026/01/05/05012026Unknown-AYAS-case-456');
  });
});

describe('sanitize', () => {
  it('strips characters unsafe for a filesystem path', () => {
    expect(sanitize('Zay Yar Tun / Special?*Chars')).toBe('Zay_Yar_Tun_Special_Chars');
  });
});

describe('generateBarcode', () => {
  it('matches the drafted VS + yy + mm(base36) + dd(base36) + "1" + 4-digit format', () => {
    const barcode = generateBarcode(new Date('2026-09-15T00:00:00Z'));
    expect(barcode).toMatch(/^VS\d{2}[0-9A-Z][0-9A-Z]1\d{4}$/);
    expect(barcode.slice(0, 4)).toBe('VS26'); // "VS" + yy=26
  });
});
