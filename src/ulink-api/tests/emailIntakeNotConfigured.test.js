// SYSTEM_4 E4-02: with the IMAP driver and no IMAP_HOST there is no inbox to read — the pipelines skip
// email-intake on notConfiguredReason(), and a direct run says why instead of a connection error.

jest.mock('../db/models', () => ({}));
jest.mock('../channels', () => ({ getChannelAdapter: jest.fn(() => ({ fetchNewSubmissions: jest.fn(async () => []) })) }));

const config = require('../config');
const emailIntake = require('../modules/email-intake/service');

const saved = { driver: config.channel.driver, host: config.imap.host };
afterEach(() => { config.channel.driver = saved.driver; config.imap.host = saved.host; });

it('is not configured with the IMAP driver and no IMAP_HOST, and a run says so', async () => {
  config.channel.driver = 'imap_smtp';
  config.imap.host = '';
  expect(emailIntake.notConfiguredReason()).toBe('inbox not configured');
  await expect(emailIntake.run()).rejects.toThrow('inbox not configured');
});

it('is configured once IMAP_HOST is set', async () => {
  config.channel.driver = 'imap_smtp';
  config.imap.host = 'imap.example.com';
  expect(emailIntake.notConfiguredReason()).toBeNull();
  await expect(emailIntake.run()).resolves.toEqual({ processed: 0, errors: [] });
});

it('does not depend on IMAP for another channel driver', () => {
  config.channel.driver = 'freshdesk';
  config.imap.host = '';
  expect(emailIntake.notConfiguredReason()).toBeNull();
});
