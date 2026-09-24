const { sequelize, Sequelize, Case, CaseEvent, ClaimRoute, EmailThread, EmailMessage, ApiCaseStep } = require('../../db/models');
const config = require('../../config');
const { getChannelAdapter } = require('../../channels');
const { render } = require('../email-sender/templates');

// api-email-sender: sends the emails API case jobs ask for (docs/imp/day1/api-case-workflow.md 7.1).
//
//   input:  a DONE step whose output.email is { taskType, audience, payload, dedupeKey }
//           (api-material-download, api-member-verification, api-document-checking, api-reply-intake,
//           api-claim-revision)
//   output: { to, cc, subject, messageId, threadId }  or  { skipped: 'same as the last one sent' }
//
// Separate from the email pipeline's email-sender on purpose: that one sends every PENDING
// ulink_email_tasks row by replying in the case's inbound thread, which API cases don't have.
// This job never touches ulink_email_tasks, so neither sender can see the other's emails. It
// reuses what is safe to share: the same templates (same wording), the same channel adapter, and
// the same thread/message tables — so a customer's reply is matched to the API case by the
// existing header matching (reply routing: Phase 4).
//
// Every subject carries the tpaCaseNumber, so a reply can also be matched by subject when a mail
// client drops the reply headers.

const JOB = 'api-email-sender';
const SOURCE_JOBS = ['api-material-download', 'api-member-verification', 'api-document-checking', 'api-reply-intake', 'api-claim-revision'];
const API_ROUTE_KEY = 'ayas_member_claim';

// Customer templates have no subject of their own (email cases reply under the customer's
// subject); API emails start their own thread, so they need one.
const CUSTOMER_SUBJECTS = {
  MISSING_DOCUMENTS: 'Additional documents required',
  DOCUMENT_COMPLETE_ACK: 'Claim documents received',
};

function subjectFor(email, rendered, caseRecord) {
  const ref = `(Ref: ${caseRecord.tpaCaseNumber})`;
  if (rendered.subject) return `${rendered.subject} ${ref}`;
  return `AYA Sompo claim ${caseRecord.claimNo} — ${CUSTOMER_SUBJECTS[email.taskType] || 'Your claim'} ${ref}`;
}

function recipientFor(email) {
  const to = email.audience === 'internal' ? config.emailSender.internalReviewEmail : config.apiEmail.customerEmail;
  if (!to) {
    throw new Error(`${email.audience === 'internal' ? 'INTERNAL_REVIEW_EMAIL' : 'API_CASE_CUSTOMER_EMAIL'} is not configured`);
  }
  return to;
}

// DONE steps asking for an email that api-email-sender hasn't handled yet, oldest first.
async function pendingRequests() {
  return ApiCaseStep.findAll({
    where: {
      status: 'DONE',
      job: SOURCE_JOBS,
      [Sequelize.Op.and]: [
        Sequelize.literal(`jsonb_typeof("ApiCaseStep"."output"->'email') = 'object'`),
        Sequelize.literal(`NOT EXISTS (SELECT 1 FROM ulink_api_case_steps sent
          WHERE sent.job = '${JOB}' AND sent.status = 'DONE'
          AND sent.input->>'sourceStepId' = "ApiCaseStep"."id"::text)`),
      ],
    },
    order: [['createdAt', 'ASC']],
    limit: config.apiEmail.batchLimit,
  });
}

// Same rule as the email flow (shared/emailTaskQueue.js): if the last email of this type for the
// case had the same dedupe key, it would say the same thing again — don't send it.
async function isRepeat(caseId, email) {
  const sent = await ApiCaseStep.findAll({ where: { caseId, job: JOB, status: 'DONE' }, order: [['createdAt', 'DESC']] });
  const last = sent.find((step) => step.input?.email?.taskType === email.taskType && !step.output?.skipped);
  return Boolean(last) && (last.input.email.dedupeKey ?? null) === (email.dedupeKey ?? null);
}

async function recordFailure(request, input, error) {
  const failed = await ApiCaseStep.findOne({
    where: { caseId: request.caseId, job: JOB, status: 'FAILED', [Sequelize.Op.and]: [Sequelize.literal(`input->>'sourceStepId' = '${request.id}'`)] },
  });
  const fields = { input, error: error.message, startedAt: new Date(), finishedAt: new Date() };
  return failed ? failed.update(fields) : ApiCaseStep.create({ caseId: request.caseId, job: JOB, status: 'FAILED', ...fields });
}

async function send(request) {
  const { email } = request.output;
  const input = { sourceStepId: request.id, sourceJob: request.job, email };
  const startedAt = new Date();

  if (await isRepeat(request.caseId, email)) {
    await ApiCaseStep.create({ caseId: request.caseId, job: JOB, status: 'DONE', input, output: { skipped: 'same as the last one sent' }, startedAt, finishedAt: new Date() });
    return 'skipped';
  }

  const caseRecord = await Case.findByPk(request.caseId, { attributes: ['id', 'claimNo', 'tpaCaseNumber'] });
  const rendered = render(email.taskType, email.payload);
  const to = recipientFor(email);
  const route = await ClaimRoute.findOne({ where: { routeKey: API_ROUTE_KEY }, attributes: ['ccEmail'] });
  const cc = route?.ccEmail || null;
  const subject = subjectFor(email, rendered, caseRecord);

  // First API email for the case starts its thread; later ones reply to the latest message of the
  // same conversation — customer emails to the customer's side (their replies and our emails to
  // them), internal emails to the internal side. Never mixed, so a customer's mail app never gets
  // a reply to an internal email it never received (S19). Long threads work: each reply extends
  // the References chain.
  const thread = await EmailThread.findOne({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const conversation = email.audience === 'internal'
    ? { direction: 'outbound', toAddr: to }
    : { [Sequelize.Op.or]: [{ direction: 'inbound' }, { direction: 'outbound', toAddr: to }] };
  const last = thread && await EmailMessage.findOne({ where: { threadId: thread.id, ...conversation }, order: [['createdAt', 'DESC']] });

  const { messageId } = await getChannelAdapter().sendReply(
    { messageId: last?.messageId || null, references: last?.referencesHeader || null },
    { to, cc, subject, bodyText: rendered.bodyText, attachments: rendered.attachments }
  );

  await sequelize.transaction(async (transaction) => {
    const threadId = thread
      ? thread.id
      : (await EmailThread.create({ caseId: caseRecord.id, subjectHint: subject, firstMessageId: messageId }, { transaction })).id;
    await EmailMessage.create({
      threadId,
      direction: 'outbound',
      messageId,
      inReplyTo: last?.messageId || null,
      referencesHeader: [last?.referencesHeader, last?.messageId].filter(Boolean).join(' ') || null,
      fromAddr: config.smtp.fromAddr,
      toAddr: to,
      ccAddr: cc,
      subject,
      bodyText: rendered.bodyText,
      status: 'sent',
      receivedAt: new Date(),
    }, { transaction });
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: JOB, status: 'DONE', input, output: { to, cc, subject, messageId, threadId }, startedAt, finishedAt: new Date(),
    }, { transaction });
    await CaseEvent.create({ caseId: caseRecord.id, blockName: JOB, newStatus: 'API_EMAIL_SENT', message: `${email.taskType} sent to ${to}` }, { transaction });
  });
  return 'sent';
}

async function run() {
  const summary = { sent: 0, skipped: 0, errors: [] };
  for (const request of await pendingRequests()) {
    try {
      summary[await send(request)] += 1;
    } catch (error) {
      // Not sent (SMTP, missing config, ...): recorded, and the request is retried next run.
      await recordFailure(request, { sourceStepId: request.id, sourceJob: request.job, email: request.output.email }, error).catch(() => {});
      summary.errors.push({ caseId: request.caseId, sourceStepId: request.id, error: error.message });
    }
  }
  return summary;
}

module.exports = { run, subjectFor };
