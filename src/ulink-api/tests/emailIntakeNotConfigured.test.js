// SYSTEM_4 E4-02: no mailbox to read — the IMAP driver with no IMAP_HOST, or *Read the mailbox* switched off on the
// STP settings page. The pipelines skip email-intake on notConfiguredReason(), and a direct run says why instead of a
// connection error.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));
jest.mock('../channels', () => ({ getChannelAdapter: jest.fn(() => ({ fetchNewSubmissions: jest.fn(async () => []) })) }));

const config = require('../config');
const { Setting } = require('../db/models');
const emailIntake = require('../modules/email-intake/service');

const saved = { driver: config.channel.driver, host: config.imap.host };
afterEach(() => { config.channel.driver = saved.driver; config.imap.host = saved.host; });

it('is not configured with the IMAP driver and no IMAP_HOST, and a run says so', async () => {
  config.channel.driver = 'imap_smtp';
  config.imap.host = '';
  expect(await emailIntake.notConfiguredReason()).toBe('inbox not configured (IMAP_HOST is empty)');
  await expect(emailIntake.run()).rejects.toThrow('inbox not configured');
});

it('is configured once IMAP_HOST is set', async () => {
  config.channel.driver = 'imap_smtp';
  config.imap.host = 'imap.example.com';
  expect(await emailIntake.notConfiguredReason()).toBeNull();
  await expect(emailIntake.run()).resolves.toEqual({ processed: 0, errors: [] });
});

it('reads nothing when the mailbox is switched off on the STP settings page', async () => {
  config.channel.driver = 'imap_smtp';
  config.imap.host = 'imap.example.com';
  Setting.findAll.mockResolvedValue([{ key: 'mailboxEnabled', value: false }]);
  expect(await emailIntake.notConfiguredReason()).toBe('mailbox switched off (STP settings)');
  await expect(emailIntake.run()).rejects.toThrow('mailbox switched off');
  Setting.findAll.mockResolvedValue([]);
});

it('does not depend on IMAP for another channel driver', async () => {
  config.channel.driver = 'freshdesk';
  config.imap.host = '';
  expect(await emailIntake.notConfiguredReason()).toBeNull();
});
