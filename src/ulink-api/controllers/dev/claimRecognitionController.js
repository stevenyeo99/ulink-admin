const path = require('path');
const fs = require('fs');
const { Case } = require('../../db/models');
const { getEnabledRoutes } = require('../../modules/claim-recognition/routeCatalog');
const { recognizeCase, recognizeFromPdfPaths, decideRoute, extractFields, transcribePages } = require('../../modules/claim-recognition/service');
const logger = require('../../utils/logger');

function validatePdfPaths(pdfPaths) {
  return Array.isArray(pdfPaths) && pdfPaths.length > 0 && pdfPaths.every((p) => typeof p === 'string');
}

/** Same page-transcription loop as service.js's recognizeFromPdfPaths — duplicated here (not
 * exported as its own combinator) since decide-route/extract-fields need the raw
 * transcriptChunks on their own, not wrapped in the full recognize-and-decide flow. */
async function transcribePdfPaths(pdfPaths) {
  const transcriptChunks = [];
  for (const pdfPath of pdfPaths) {
    const buffer = await fs.promises.readFile(pdfPath);
    const filename = path.basename(pdfPath);
    const pages = await transcribePages(buffer, filename, path.basename(pdfPath, path.extname(pdfPath)));
    for (const page of pages) {
      transcriptChunks.push(`[${filename} - page ${page.pageNumber}]\n${page.text}`);
    }
  }
  return transcriptChunks;
}

/**
 * Developer-only preview: runs the same recognition logic (rasterize, transcribe,
 * synthesize, validate) as the real job for one case, but never calls persistOutcome —
 * nothing is written to Case or CaseEvent. For manually checking what the pipeline
 * would decide before trusting it against real data.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const routes = await getEnabledRoutes();
    if (routes.length === 0) {
      return res.status(500).json({ error: { message: 'No enabled claim routes configured (ulink_claim_routes)', status: 500 } });
    }

    const outcome = await recognizeCase(caseRecord, routes);
    res.json({
      caseId: outcome.caseId,
      dryRun: true,
      skipped: outcome.skipped || false,
      reason: outcome.reason || null,
      outcome: outcome.outcome || null,
      recognizedType: outcome.recognizedType || null,
      reasonCode: outcome.reasonCode || null,
      message: outcome.message || null,
      extractedFields: outcome.extractedFields || null,
    });
  } catch (error) {
    logger.error('claim-recognition preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

/**
 * Developer-only preview: same rasterize/transcribe/synthesize/validate pipeline, but the
 * input is a list of local PDF file paths instead of a Case's stored attachments — no Case
 * needed, nothing written anywhere (routes are the only DB read). For reviewing extraction
 * against a file that isn't attached to any Case yet (a new sample, a one-off test PDF).
 */
async function previewFiles(req, res) {
  const { pdfPaths } = req.body || {};

  if (!validatePdfPaths(pdfPaths)) {
    return res.status(400).json({ error: { message: 'pdfPaths must be a non-empty array of file path strings', status: 400 } });
  }

  try {
    const routes = await getEnabledRoutes();
    if (routes.length === 0) {
      return res.status(500).json({ error: { message: 'No enabled claim routes configured (ulink_claim_routes)', status: 500 } });
    }

    const outcome = await recognizeFromPdfPaths(pdfPaths, routes);
    res.json({
      pdfPaths,
      dryRun: true,
      outcome: outcome.outcome || null,
      recognizedType: outcome.recognizedType || null,
      reasonCode: outcome.reasonCode || null,
      message: outcome.message || null,
      extractedFields: outcome.extractedFields || null,
    });
  } catch (error) {
    logger.error('claim-recognition file preview failed', { pdfPaths, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

/**
 * Developer-only: Task 1 only (route decision), against local PDF files. Fast — no
 * extraction schema attached, so it doesn't wait on anything Task 2-sized. Nothing written
 * anywhere (routes are the only DB read).
 */
async function decideRouteFiles(req, res) {
  const { pdfPaths } = req.body || {};

  if (!validatePdfPaths(pdfPaths)) {
    return res.status(400).json({ error: { message: 'pdfPaths must be a non-empty array of file path strings', status: 400 } });
  }

  try {
    const routes = await getEnabledRoutes();
    if (routes.length === 0) {
      return res.status(500).json({ error: { message: 'No enabled claim routes configured (ulink_claim_routes)', status: 500 } });
    }

    const transcriptChunks = await transcribePdfPaths(pdfPaths);
    const result = await decideRoute(transcriptChunks, '', routes);
    if (result.schemaValidationError) {
      return res.status(500).json({ error: { message: result.schemaValidationError, status: 500 } });
    }
    res.json({ pdfPaths, dryRun: true, reason: result.reason, route: result.route, confidence: result.confidence });
  } catch (error) {
    logger.error('claim-recognition decide-route (files) failed', { pdfPaths, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

/**
 * Developer-only: Task 2 only (field extraction), against local PDF files and an explicit
 * routeKey — decoupled from route decision on purpose, so extraction can be reviewed in
 * isolation against a known route even before Task 1's own decision is trusted. Nothing
 * written anywhere.
 */
async function extractFieldsFiles(req, res) {
  const { pdfPaths, routeKey } = req.body || {};

  if (!validatePdfPaths(pdfPaths)) {
    return res.status(400).json({ error: { message: 'pdfPaths must be a non-empty array of file path strings', status: 400 } });
  }
  if (typeof routeKey !== 'string' || !routeKey) {
    return res.status(400).json({ error: { message: 'routeKey is required (a key from GET the enabled routes, e.g. ayas_member_claim)', status: 400 } });
  }

  try {
    const routes = await getEnabledRoutes();
    const matchedRoute = routes.find((r) => r.routeKey === routeKey);
    if (!matchedRoute) {
      return res.status(404).json({ error: { message: `No enabled route with routeKey "${routeKey}"`, status: 404 } });
    }

    const transcriptChunks = await transcribePdfPaths(pdfPaths);
    const result = await extractFields(transcriptChunks, matchedRoute);
    if (result.schemaValidationError) {
      return res.status(500).json({ error: { message: result.schemaValidationError, status: 500 } });
    }
    res.json({ pdfPaths, routeKey, dryRun: true, extractedFields: result.extractedFields });
  } catch (error) {
    logger.error('claim-recognition extract-fields (files) failed', { pdfPaths, routeKey, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase, previewFiles, decideRouteFiles, extractFieldsFiles };
