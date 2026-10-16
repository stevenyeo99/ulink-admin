// SYSTEM_4 F2 (E4-14): the feedback report — one row per correction, "✓ Right" and override, with the case's numbers.
// Read-only; the database is replaced here.

jest.mock('../db/models', () => ({
  Case: { findAll: jest.fn() },
  CaseEvent: { findAll: jest.fn() },
  AiFeedback: { findAll: jest.fn() },
  Setting: { findAll: jest.fn(async () => []) },
}));

const { Case, CaseEvent, AiFeedback } = require('../db/models');
const { feedbackReport, overrideRow, ROW_LIMIT } = require('../modules/ai-feedback/report');
const { getFeedbackReport } = require('../controllers/llm-calls/llmCallsController');

const override = {
  caseId: 'c1', createdAt: '2026-10-15T09:00:00Z', prevStatus: 'API_DOCUMENTS_UNSURE',
  message: "Overridden by Ulink (ulink) — Checked: the AI's reading is right: voucher matches (waived: REVIEW: date unsure; REVIEW: amount unsure)",
};

it('an override: the finding is found even when it holds ": " itself; the waived points are what the AI found', () => {
  expect(overrideRow(override)).toMatchObject({
    type: 'Override', item: 'Document check', by: 'Ulink (ulink)',
    decision: "Checked: the AI's reading is right", comment: 'voucher matches',
    aiFinding: 'REVIEW: date unsure; REVIEW: amount unsure',
  });
});

it('corrections, confirmations and overrides together, newest first, with the case numbers', async () => {
  AiFeedback.findAll.mockResolvedValue([
    { kind: 'value', caseId: 'c1', createdAt: '2026-10-14T09:00:00Z', label: 'NRC', aiValue: '12/ABC', aiConfidence: 0.4, correctedValue: '12/ABD', wrongStep: 'reading', reason: 'page says D', createdBy: 'csr1', trusted: true },
    { kind: 'confirm', caseId: 'c2', createdAt: '2026-10-16T09:00:00Z', label: 'Diagnosis matches treatment', aiValue: true, aiConfidence: 0.9, reason: 'right', createdBy: 'csr2', trusted: false },
  ]);
  CaseEvent.findAll.mockResolvedValue([override]);
  Case.findAll.mockResolvedValue([{ id: 'c1', claimNo: 'CL1', tpaCaseNumber: 'T1', source: 'API' }]);

  const { rows, truncated } = await feedbackReport({ from: new Date('2026-10-01'), to: null });
  expect(truncated).toBe(false);

  expect(rows.map((r) => r.type)).toEqual(['Confirmed right', 'Override', 'Correction']);
  expect(rows[0]).toMatchObject({ aiFinding: 'passed', decision: 'AI was right', trusted: null, claimNo: null });
  expect(rows[2]).toMatchObject({ item: 'NRC', aiFinding: '12/ABC', aiConfidence: 0.4, decision: 'Changed to 12/ABD (the page was misread)', by: 'csr1', trusted: true, claimNo: 'CL1', tpaCaseNumber: 'T1' });
  expect(CaseEvent.findAll.mock.calls[0][0].where.reasonCode).toBe('MANUAL_OVERRIDE');
});

it('a reason holding " (waived: " keeps the real waived list', () => {
  const row = overrideRow({ ...override, message: 'Overridden by u — Other (see reason): see (waived: none) note (waived: REVIEW: x)' });
  expect(row).toMatchObject({ decision: 'Other (see reason)', comment: 'see (waived: none) note', aiFinding: 'REVIEW: x' });
});

it('a source at the row limit: older rows from the other source are dropped and the report says truncated', async () => {
  AiFeedback.findAll.mockResolvedValue(Array.from({ length: ROW_LIMIT }, () => (
    { kind: 'confirm', caseId: 'c1', createdAt: '2026-10-16T09:00:00Z', label: 'NRC', aiValue: 'x', reason: 'ok', createdBy: 'u' })));
  CaseEvent.findAll.mockResolvedValue([override]); // 2026-10-15, older than every feedback row
  Case.findAll.mockResolvedValue([]);
  const { rows, truncated } = await feedbackReport();
  expect(truncated).toBe(true);
  expect(rows.some((r) => r.type === 'Override')).toBe(false);
});

it('a bad date is refused', async () => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await getFeedbackReport({ query: { from: 'yesterday' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});
