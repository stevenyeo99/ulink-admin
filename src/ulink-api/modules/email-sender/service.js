const { sequelize, Sequelize, Case, ClaimRoute, EmailThread, EmailMessage, EmailTask, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getChannelAdapter } = require('../../channels');
const { render } = require('./templates');

const BLOCK_NAME = 'email-sender';

const CASE_EVENT_STATUS = {
  MISSING_DOCUMENTS: 'MISSING_DOCUMENT_EMAIL_SENT',
  DOCUMENT_COMPLETE_ACK: 'COMPLETE_ACK_EMAIL_SENT',
  CLAIM_CREATED_NOTIFICATION: 'CLAIM_CREATED_NOTIFICATION_SENT',
  MEMBER_VERIFY_ISSUE: 'MEMBER_VERIFY_ISSUE_EMAIL_SENT',
};

async function logEvent(transaction, { caseId, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, newStatus, reasonCode, message }, { transaction });
}

/**
 * The most recent inbound message across all of a case's threads — gives us the
 * recipient (its `from`) and the threading headers (`messageId`/`references`) for the
 * reply. A case normally has exactly one thread; this doesn't assume that.
 */
async function findLastInboundMessage(caseId) {
  const threads = await EmailThread.findAll({ where: { caseId }, attributes: ['id'] });
  const threadIds = threads.map((t) => t.id);
  if (threadIds.length === 0) return null;

  return EmailMessage.findOne({
    where: { threadId: { [Sequelize.Op.in]: threadIds }, direction: 'inbound' },
    order: [['receivedAt', 'DESC']],
  });
}

/**
 * Per-route CC recipient (ulink_claim_routes.cc_email), joined via Case.recognizedType ->
 * ClaimRoute.routeKey (set by claim-recognition when the case was first classified). A case
 * with no recognizedType, or a route with no cc_email set, just means no CC — never an error
 * that should block the send.
 */
async function findCcEmail(caseId) {
  const caseRecord = await Case.findByPk(caseId, { attributes: ['recognizedType'] });
  if (!caseRecord?.recognizedType) return null;

  const route = await ClaimRoute.findOne({ where: { routeKey: caseRecord.recognizedType }, attributes: ['ccEmail'] });
  return route?.ccEmail || null;
}

async function sendTask(task) {
  const lastInbound = await findLastInboundMessage(task.caseId);
  if (!lastInbound) {
    throw new Error(`Case ${task.caseId} has no inbound EmailMessage to reply to`);
  }

  const submission = {
    from: lastInbound.fromAddr,
    subject: lastInbound.subject,
    messageId: lastInbound.messageId,
    references: lastInbound.referencesHeader,
  };

  const rendered = render(task.taskType, task.payload);
  const subject = rendered.subject || (lastInbound.subject ? `Re: ${lastInbound.subject}` : null);
  const cc = await findCcEmail(task.caseId);

  const { messageId } = await getChannelAdapter().sendReply(submission, { subject, bodyText: rendered.bodyText, cc });

  await sequelize.transaction(async (transaction) => {
    const referencesHeader = [lastInbound.referencesHeader, lastInbound.messageId].filter(Boolean).join(' ') || null;

    const outboundMessage = await EmailMessage.create(
      {
        threadId: lastInbound.threadId,
        source: lastInbound.source,
        direction: 'outbound',
        messageId,
        inReplyTo: lastInbound.messageId,
        referencesHeader,
        fromAddr: config.smtp.fromAddr,
        toAddr: lastInbound.fromAddr,
        ccAddr: cc,
        subject,
        bodyText: rendered.bodyText,
        status: 'sent',
        receivedAt: new Date(),
      },
      { transaction }
    );

    await EmailTask.update(
      { status: 'SENT', sentAt: new Date(), emailMessageId: outboundMessage.id, attempts: task.attempts + 1 },
      { where: { id: task.id }, transaction }
    );

    await logEvent(transaction, { caseId: task.caseId, newStatus: CASE_EVENT_STATUS[task.taskType] || 'EMAIL_SENT' });
  });
}

async function run() {
  const tasks = await EmailTask.findAll({
    where: { status: 'PENDING' },
    limit: config.emailSender.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const task of tasks) {
    try {
      await sendTask(task);
      results.push({ taskId: task.id, caseId: task.caseId, ok: true });
    } catch (error) {
      const attempts = task.attempts + 1;
      const status = attempts >= config.emailSender.maxAttempts ? 'FAILED' : 'PENDING';
      await EmailTask.update({ attempts, status, lastError: error.message }, { where: { id: task.id } });
      results.push({ taskId: task.id, caseId: task.caseId, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map(({ taskId, caseId, error }) => ({ taskId, caseId, error }));
  return { processed, errors };
}

module.exports = { run, sendTask };
