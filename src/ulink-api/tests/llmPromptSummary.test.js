// SYSTEM_4 D2: how each prompt version performs, from the AI call log — old and new versions side by side, the
// prompts on this server listed even with no calls yet. Read-only; the database is replaced here.

jest.mock('../db/models', () => ({ sequelize: { query: jest.fn(), QueryTypes: { SELECT: 'SELECT' } }, Setting: { findAll: jest.fn(async () => []) } }));

const { sequelize } = require('../db/models');
const { toSummary, promptSummary } = require('../modules/llm-calls/summary');
const { getPromptSummary } = require('../controllers/llm-calls/llmCallsController');

const row = (version, extra = {}) => ({
  prompt_name: 'diagnosis-pick', prompt_version: version, first_call: '2026-10-01T00:00:00Z', last_call: '2026-10-10T00:00:00Z',
  calls: 10, ok: 8, error: 1, timeout: 1, too_long: 0, avg_duration_ms: '4210.4', avg_prompt_tokens: '1900.2', avg_completion_tokens: '60',
  avg_confidence: '0.8123', with_confidence: 8, unsure: 2, ...extra,
});

it('one row per version: counts by status, averages, and the unsure share among calls with a confidence', () => {
  const { prompts, threshold } = toSummary([row('old0000000000')], [], 0.7);
  expect(threshold).toBe(0.7);
  expect(prompts).toEqual([{
    promptName: 'diagnosis-pick', promptVersion: 'old0000000000', current: false,
    firstCall: '2026-10-01T00:00:00Z', lastCall: '2026-10-10T00:00:00Z', calls: 10,
    byStatus: { ok: 8, error: 1, timeout: 1, too_long: 0 },
    avgDurationMs: 4210, avgPromptTokens: 1900, avgCompletionTokens: 60, avgConfidence: 0.812, unsureShare: 0.25,
  }]);
});

it('marks the version on this server current, lists prompts with no calls yet, current version first', () => {
  const current = [{ promptName: 'diagnosis-pick', promptVersion: 'new0000000000' }, { promptName: 'benefit-pick', promptVersion: 'ben0000000000' }];
  const { prompts } = toSummary([row('old0000000000'), row('new0000000000', { last_call: '2026-10-14T00:00:00Z' })], current, 0.7);
  expect(prompts.map((p) => [p.promptName, p.promptVersion, p.current, p.calls])).toEqual([
    ['benefit-pick', 'ben0000000000', true, 0],
    ['diagnosis-pick', 'new0000000000', true, 10],
    ['diagnosis-pick', 'old0000000000', false, 10],
  ]);
  expect(prompts[0].unsureShare).toBeNull();
});

it('asks the database for the chosen period with the threshold', async () => {
  sequelize.query.mockResolvedValue([]);
  await promptSummary({ days: 7 });
  const { replacements } = sequelize.query.mock.calls[0][1];
  expect(replacements.threshold).toBe(0.7);
  expect(Date.now() - Date.parse(replacements.since)).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 1000);
  await promptSummary();
  expect(sequelize.query.mock.calls[1][1].replacements.since).toBeNull();
});

it('refuses a bad period', async () => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await getPromptSummary({ query: { days: 'abc' } }, res);
  expect(res.statusCode).toBe(400);
});
