require('dotenv').config({ quiet: true });
const { sequelize, Case } = require('../db/models');

// Real-DB check of the API/email case separation (migration 20260924100000-add-api-case-source,
// docs/imp/day1/api-case-workflow.md section 3). Every attempt runs in its own transaction that
// is always rolled back, so nothing is left in the database. Skipped when no DB is configured.

const describeDb = process.env.SUPABASE_DB_CONN_STR ? describe : describe.skip;

// Runs fn inside a transaction and rolls it back whatever happens.
async function attempt(fn) {
  const transaction = await sequelize.transaction();
  try {
    return await fn(transaction);
  } finally {
    await transaction.rollback();
  }
}

const apiCase = (overrides = {}) => ({
  source: 'API',
  currentStatus: 'API_RECEIVED',
  claimNo: 'TEST-CL-0001',
  tpaCaseNumber: 'TEST-TPA-0001',
  ...overrides,
});

describeDb('ulink_cases source/status separation', () => {
  afterAll(() => sequelize.close());

  it('accepts an API case with an API_ status, and a default case as EMAIL', async () => {
    await attempt(async (transaction) => {
      const api = await Case.create(apiCase(), { transaction });
      const email = await Case.create({}, { transaction });
      expect(api.source).toBe('API');
      expect(email.source).toBe('EMAIL');
      expect(email.currentStatus).toBe('EMAIL_RECEIVED');
    });
  });

  it('rejects an API case with an email status', async () => {
    await expect(attempt((transaction) => Case.create(apiCase({ currentStatus: 'INCOMPLETE' }), { transaction })))
      .rejects.toThrow(/ulink_cases_source_status_match/);
  });

  it('rejects an email case with an API_ status', async () => {
    await expect(attempt((transaction) => Case.create({ currentStatus: 'API_RECEIVED' }, { transaction })))
      .rejects.toThrow(/ulink_cases_source_status_match/);
  });

  it('rejects moving an existing API case into an email status', async () => {
    await expect(attempt(async (transaction) => {
      const api = await Case.create(apiCase(), { transaction });
      await Case.update({ currentStatus: 'READY_FOR_DOCUMENT_READING' }, { where: { id: api.id }, transaction });
    })).rejects.toThrow(/ulink_cases_source_status_match/);
  });

  it('rejects an unknown source', async () => {
    await expect(attempt((transaction) => Case.create({ source: 'FAX' }, { transaction })))
      .rejects.toThrow(/ulink_cases_source_check/);
  });

  it('rejects a second API case with the same claimNo or tpaCaseNumber', async () => {
    await expect(attempt(async (transaction) => {
      await Case.create(apiCase(), { transaction });
      await Case.create(apiCase({ tpaCaseNumber: 'TEST-TPA-0002' }), { transaction });
    })).rejects.toThrow();
    await expect(attempt(async (transaction) => {
      await Case.create(apiCase(), { transaction });
      await Case.create(apiCase({ claimNo: 'TEST-CL-0002' }), { transaction });
    })).rejects.toThrow();
  });
});
