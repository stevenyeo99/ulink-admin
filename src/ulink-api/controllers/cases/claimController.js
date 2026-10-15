const { Case } = require('../../db/models');
const { claimCase, releaseCase } = require('../../modules/case-claim/claim');

// POST /api/cases/:id/claim — { takeOver?, comment? }. "Being reviewed by me" (SYSTEM_4 E4-22).
const findCase = (id) => Case.findByPk(id, { attributes: ['id', 'currentStatus'] });
const notFound = (res, id) => res.status(404).json({ error: { message: `Case ${id} not found`, status: 404 } });

async function claim(req, res) {
  const caseRecord = await findCase(req.params.id);
  if (!caseRecord) return notFound(res, req.params.id);
  const result = await claimCase(caseRecord, req.user, { takeOver: req.body?.takeOver === true, comment: String(req.body?.comment ?? '') });
  if (result.error) return res.status(result.status).json({ error: { message: result.error, status: result.status } });
  res.json({ claim: result.claim });
}

// POST /api/cases/:id/release — give the case back.
async function release(req, res) {
  const caseRecord = await findCase(req.params.id);
  if (!caseRecord) return notFound(res, req.params.id);
  const result = await releaseCase(caseRecord, req.user);
  if (result.error) return res.status(result.status).json({ error: { message: result.error, status: result.status } });
  res.json({ released: result.released });
}

module.exports = { claim, release };
