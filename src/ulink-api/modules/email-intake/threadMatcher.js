const { Op, fn, col, where } = require('sequelize');
const { Case, EmailThread, EmailMessage } = require('../../db/models');

/**
 * Thread/case matching, header-based only (Day 1 scope).
 *
 * Per the confirmed matching order: Message-ID / In-Reply-To / References
 * headers are checked first. The fallback (matching by already-extracted
 * claim identifiers — policy number, claimant name, etc.) is intentionally
 * NOT implemented here: those identifiers don't exist yet at intake time,
 * they only appear after Document Reader/Classifier run later in the
 * pipeline. Revisit once resubmission/correction handling needs it.
 */
// Our API emails carry "(Ref: <tpaCaseNumber>)" in the subject (api-email-sender's subjectFor).
const API_REF = /\(Ref:\s*([^)\s]+)\s*\)/i;

/**
 * S8: a customer who writes a new email instead of pressing Reply sends no reply headers.
 * If the subject carries an API case's ref and the sender is an address we already emailed on
 * that case, the email joins that case's thread instead of becoming a new email case (which could
 * create a second IAS claim). Anyone else falls through to today's behavior.
 */
async function matchApiCaseByRef(transaction, { subjectHint, from }) {
  const ref = API_REF.exec(subjectHint || '')?.[1];
  if (!ref || !from) return null;
  const apiCase = await Case.findOne({ where: { source: 'API', tpaCaseNumber: ref }, transaction });
  if (!apiCase) return null;
  const thread = await EmailThread.findOne({ where: { caseId: apiCase.id }, order: [['createdAt', 'ASC']], transaction });
  if (!thread) return null;
  const sentToSender = await EmailMessage.findOne({
    where: {
      threadId: thread.id,
      direction: 'outbound',
      [Op.and]: [where(fn('lower', col('to_addr')), from.trim().toLowerCase())],
    },
    transaction,
  });
  return sentToSender ? { threadId: thread.id, caseId: apiCase.id, isNewCase: false } : null;
}

async function matchOrCreateThread(transaction, { inReplyTo, references, subjectHint, firstMessageId, from }) {
  const candidates = []
    .concat(inReplyTo ? [inReplyTo] : [])
    .concat(references ? String(references).split(/\s+/).filter(Boolean) : []);

  if (candidates.length > 0) {
    const match = await EmailMessage.findOne({
      where: { messageId: { [Op.in]: candidates } },
      include: [{ model: EmailThread }],
      order: [['createdAt', 'DESC']],
      transaction,
    });
    if (match && match.EmailThread) {
      return { threadId: match.EmailThread.id, caseId: match.EmailThread.caseId, isNewCase: false };
    }
  }

  const byRef = await matchApiCaseByRef(transaction, { subjectHint, from });
  if (byRef) return byRef;

  const newCase = await Case.create({}, { transaction });
  const newThread = await EmailThread.create(
    { caseId: newCase.id, subjectHint: subjectHint || null, firstMessageId: firstMessageId || null },
    { transaction }
  );

  return { threadId: newThread.id, caseId: newCase.id, isNewCase: true };
}

module.exports = { matchOrCreateThread };
