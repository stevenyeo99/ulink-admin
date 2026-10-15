// The overdue badge (SYSTEM_4 E4-19 / E6 option B): working days a queued case has waited since its last change —
// Monday–Friday on Myanmar calendar days — and overdue past the STP-settings limit (default 2, ULINK to set — Q20).

jest.mock('../db/models', () => ({
  Case: { findAll: jest.fn() },
  CaseEvent: { findAll: jest.fn(async () => []) },
  ApiCaseStep: { findAll: jest.fn(async () => []) },
  CaseClaim: { findAll: jest.fn(async () => []) },
  Setting: { findAll: jest.fn(async () => []) },
  CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {},
}));

const { Case, CaseEvent, Setting } = require('../db/models');
const { workingDaysSince } = require('../modules/shared/workingDays');
const { settingError, DEFAULTS, getSettings } = require('../modules/settings/settings');
const { getReviewQueue } = require('../controllers/cases/casesController');

it('counts Monday–Friday on Myanmar days, after the day it started waiting', () => {
  const fri = new Date('2026-10-16T03:00:00Z'); // Friday 09:30 Yangon
  expect(workingDaysSince(fri, new Date('2026-10-16T10:00:00Z'))).toBe(0); // same day
  expect(workingDaysSince(fri, new Date('2026-10-18T10:00:00Z'))).toBe(0); // the weekend doesn't count
  expect(workingDaysSince(fri, new Date('2026-10-19T03:00:00Z'))).toBe(1); // Monday
  expect(workingDaysSince(fri, new Date('2026-10-21T03:00:00Z'))).toBe(3); // Wednesday
  // 23:00 UTC Thursday is already Friday 05:30 in Yangon.
  expect(workingDaysSince(new Date('2026-10-15T23:00:00Z'), new Date('2026-10-19T03:00:00Z'))).toBe(1);
  expect(workingDaysSince(undefined)).toBeNull(); // no date: nothing to count
  // Older than a year: counted exactly (52 weeks × 5 + the rest), no cap.
  expect(workingDaysSince(new Date('2025-10-16T03:00:00Z'), new Date('2026-10-16T03:00:00Z'))).toBe(261);
});

it('the limit: 2 working days by default, a whole number 1–30', () => {
  expect(DEFAULTS.overdueWorkingDays).toBe(2);
  expect(settingError('overdueWorkingDays', 3)).toBeNull();
  expect(settingError('overdueWorkingDays', 0)).toMatch('whole number from 1 to 30');
  expect(settingError('overdueWorkingDays', 2.5)).toMatch('whole number');
  expect(settingError('aiConfidenceThreshold', 0.6)).toBeNull(); // shares unchanged
});

it('queue items: waiting since they entered their status; overdue only when a person must act', async () => {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
  const held = (id, status, updatedAt) => ({
    id, source: 'EMAIL', currentStatus: status, updatedAt,
    documentCheckResult: { passed: false, issues: ['Missing voucher(s)'], details: [], checklist: [{ code: 'MISSING_VOUCHER', label: 'x', passed: false }] },
  });
  Case.findAll.mockResolvedValue([
    held('old', 'DOCUMENTS_REVIEW', new Date()), // touched today (a claim / correction) — but entered 10 days ago
    held('new', 'DOCUMENTS_REVIEW', new Date()),
    held('customer', 'INCOMPLETE', daysAgo(10)), // waiting for the customer: never overdue
  ]);
  CaseEvent.findAll.mockResolvedValue([
    { caseId: 'old', prevStatus: 'READY_FOR_DOCUMENT_CHECKING', newStatus: 'DOCUMENTS_REVIEW', createdAt: daysAgo(10) },
    { caseId: 'old', prevStatus: 'DOCUMENTS_REVIEW', newStatus: 'DOCUMENTS_REVIEW', reasonCode: 'CASE_CLAIMED', createdAt: new Date() },
  ]);
  Setting.findAll.mockResolvedValue([]);
  await getSettings();
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await getReviewQueue({ query: {} }, res);
  const items = Object.fromEntries(res.json.mock.calls[0][0].items.map((i) => [i.id, i]));
  expect(items.old).toMatchObject({ overdue: true });
  expect(items.old.waitingWorkingDays).toBeGreaterThanOrEqual(6);
  expect(items.new).toMatchObject({ overdue: false, waitingWorkingDays: 0 });
  if (items.customer) expect(items.customer.overdue).toBe(false);
});

it('approvals carry no overdue flag (JD3 approves in IAS, which the system cannot see)', async () => {
  const { getApprovals } = require('../controllers/cases/casesController');
  Case.findAll.mockResolvedValue([{ id: 'a', source: 'EMAIL', currentStatus: 'CLAIM_CREATED', updatedAt: new Date(Date.now() - 30 * 86400000) }]);
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await getApprovals({ query: {} }, res);
  expect(res.json.mock.calls[0][0].items[0].overdue).toBeUndefined();
});
