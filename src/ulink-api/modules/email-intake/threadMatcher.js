const { Op } = require('sequelize');
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
async function matchOrCreateThread(transaction, { inReplyTo, references, subjectHint, firstMessageId }) {
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

  const newCase = await Case.create({}, { transaction });
  const newThread = await EmailThread.create(
    { caseId: newCase.id, subjectHint: subjectHint || null, firstMessageId: firstMessageId || null },
    { transaction }
  );

  return { threadId: newThread.id, caseId: newCase.id, isNewCase: true };
}

module.exports = { matchOrCreateThread };
