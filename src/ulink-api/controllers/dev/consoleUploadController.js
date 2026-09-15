const { Case } = require('../../db/models');
const { planUpload } = require('../../modules/console-upload/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: computes the same destination folder, barcode, and gathered-
 * attachments list the real job would, but never persists and never touches disk — unlike
 * ias-claim-creation's preview (not a dry run, since IAS has no validate-only mode), this
 * job's side effects are entirely local, so a genuine dry run is possible here.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const plan = await planUpload(caseRecord);
    res.json({
      caseId: plan.caseId,
      dryRun: true,
      folder: plan.folder,
      barcode: plan.barcode,
      files: plan.files.map(({ attachment, destFilename }) => ({ originalFilename: attachment.originalFilename, destFilename })),
    });
  } catch (error) {
    logger.error('console-upload preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
