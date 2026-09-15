const { findReadyReport, buildFromDatetime, csrDestination } = require('../modules/ias-claim-stp/service');

// Pure-logic regression for ias-claim-stp's report-matching and formatting — no DB/network,
// same spirit as tests/consoleUpload.test.js. The real IAS call (getClaimStatus/downloadFile)
// is exercised via the dev preview endpoint and a real job run instead.

describe('findReadyReport', () => {
  // Shape taken directly from the real sample
  // docs/imp/day1/IAS/ias_get_claim_status_response.json — three status-history rows for
  // one claim, only the middle one carries the settlement report.
  const results = [
    { SCMA_OID_CL_STATUS: 'CL_STATUS_PV', FILENAME: '', PATH: '' },
    { SCMA_OID_CL_STATUS: 'CL_STATUS_FC', FILENAME: 'CSR_CC_02_2511230003.pdf', PATH: '/AYAS/Claims/2026/01-16/000716-000/' },
    { SCMA_OID_CL_STATUS: 'CL_STATUS_FC', FILENAME: '', PATH: '' },
  ];

  it('finds the row with CL_STATUS_FC and a non-empty filename/path', () => {
    const report = findReadyReport(results);
    expect(report).toEqual({
      SCMA_OID_CL_STATUS: 'CL_STATUS_FC',
      FILENAME: 'CSR_CC_02_2511230003.pdf',
      PATH: '/AYAS/Claims/2026/01-16/000716-000/',
    });
  });

  it('returns null when no row has both CL_STATUS_FC and a filename', () => {
    const notReady = [{ SCMA_OID_CL_STATUS: 'CL_STATUS_PV', FILENAME: '', PATH: '' }];
    expect(findReadyReport(notReady)).toBeNull();
  });

  it('does not match a non-empty filename on a row that is not CL_STATUS_FC', () => {
    const wrongStatus = [{ SCMA_OID_CL_STATUS: 'CL_STATUS_PV', FILENAME: 'should-not-match.pdf', PATH: '/some/path/' }];
    expect(findReadyReport(wrongStatus)).toBeNull();
  });

  it('returns null for a non-array input', () => {
    expect(findReadyReport(undefined)).toBeNull();
  });
});

describe('buildFromDatetime', () => {
  it('formats as MMDDYYYY_00:00', () => {
    expect(buildFromDatetime(new Date('2026-09-15T03:00:00Z'))).toBe('09152026_00:00');
  });
});

describe('csrDestination', () => {
  it('builds yyyy/MM/dd/{claimNo}/CSR/{filename}', () => {
    const now = new Date('2026-01-16T00:00:00Z');
    const dest = csrDestination({ now, claimNo: '2511230003', filename: 'CSR_CC_02_2511230003.pdf' });
    expect(dest).toBe('2026/01/16/2511230003/CSR/CSR_CC_02_2511230003.pdf');
  });
});
