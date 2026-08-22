/**
 * Freshdesk channel adapter — placeholder. No Freshdesk API access yet
 * (see docs/imp/day1/drt-claim-demo-implementation-plan.md, Block 20).
 * Implement fetchNewSubmissions/sendReply against the same Submission shape
 * as channels/imapSmtpChannel.js once access is available — set
 * CHANNEL_DRIVER=freshdesk and no other module needs to change.
 */
async function fetchNewSubmissions() {
  throw new Error('freshdeskChannel is not implemented yet (no Freshdesk API access)');
}

async function sendReply() {
  throw new Error('freshdeskChannel is not implemented yet (no Freshdesk API access)');
}

module.exports = { fetchNewSubmissions, sendReply };
