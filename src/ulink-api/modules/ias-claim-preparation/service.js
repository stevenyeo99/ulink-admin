const { sequelize, Case, ClaimRoute, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { pickDiagnosis } = require('./diagnosisPicker');
const { pickBenefit } = require('./benefitPicker');
const { buildPayload } = require('./payloadBuilder');
const { stpDecision } = require('./stpEligibility');
const { toEnglishMedicalText } = require('./medicalTranslation');
const { aiSummaryRemark } = require('./aiSummaryRemark');
const { overridesFromEvents } = require('../case-override/override');
const { barcodeFields } = require('../shared/barcodeFields');
const { buildAssessmentSummary } = require('../assessment-summary/summary');

const BLOCK_NAME = 'ias-claim-preparation';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, message }, { transaction });
}

/**
 * Not pure — makes real LLM calls (diagnosis/benefit picks). The dev preview endpoint calls
 * this same function directly and just skips persistOutcome, same spirit as
 * member-verification's preview.
 */
async function checkCase(caseRecord) {
  const extractedFields = caseRecord.extractedFields;
  const iasMemberInfoResponse = caseRecord.iasMemberInfoResponse;
  if (!extractedFields || !iasMemberInfoResponse) {
    throw new Error(`Case ${caseRecord.id} is missing extractedFields or iasMemberInfoResponse`);
  }

  const route = caseRecord.recognizedType
    ? await ClaimRoute.findOne({ where: { routeKey: caseRecord.recognizedType } })
    : null;

  // The ICD-10 search and the picks work in English: Burmese diagnosis / treatment text is translated
  // first (medicalTranslation.js). Only these picks use the translation — the IAS payload keeps the
  // original text (payloadBuilder reads extractedFields directly).
  const medical = extractedFields.medical || {};
  const { diagnosis: illnessText, treatment: treatmentText, translation } = await toEnglishMedicalText({
    diagnosis: medical.detail_of_illness_injury || null,
    treatment: medical.full_description_of_treatment || null,
  });
  const diagnosisText = [
    illnessText && `Diagnosis/illness: ${illnessText}`,
    treatmentText && `Treatment: ${treatmentText}`,
  ].filter(Boolean).join('\n');
  const diagnosisPick = await pickDiagnosis(diagnosisText);

  const memberPlansRaw = iasMemberInfoResponse?.payload?.memberPlans;
  const benefitContext = {
    typeOfPatient: extractedFields.claim?.type_of_patient,
    claimBenefitType: extractedFields.claim?.claim_benefit_type,
    illnessDescription: illnessText,
    treatmentDescription: treatmentText,
  };

  // One line per real voucher (extractedFields.invoices.items — each with its own subtotal
  // and its own benefit pick), not one collapsed line per case — verified against real
  // sample data that a claim can genuinely be multiple separate vouchers. Sequential, not
  // Promise.all: same one-call-at-a-time discipline claim-recognition's transcribePage
  // already uses for this local LLM server.
  const invoiceItems = extractedFields.invoices?.items || [];
  const lines = [];
  const lineMeta = [];
  if (invoiceItems.length > 0) {
    for (const item of invoiceItems) {
      const benefitPick = await pickBenefit({ ...benefitContext, voucherType: item.voucher_type }, memberPlansRaw);
      lines.push({ subtotal: item.subtotal, benefit: benefitPick.pick });
      lineMeta.push({ voucherType: item.voucher_type ?? null, subtotal: item.subtotal ?? null, ...benefitPick });
    }
  } else {
    // Shouldn't reach this job in practice (document-checking would have flagged a missing
    // voucher first) — defensive fallback so a case somehow lacking itemized invoices still
    // produces one usable line instead of an empty Items[] array.
    const benefitPick = await pickBenefit({ ...benefitContext, voucherType: null }, memberPlansRaw);
    lines.push({ subtotal: extractedFields.claim?.total_claim_amount, benefit: benefitPick.pick });
    lineMeta.push({ voucherType: null, subtotal: extractedFields.claim?.total_claim_amount ?? null, ...benefitPick });
  }

  // Internal-only diagnostic record of *why* each pick landed where it did — confidence
  // score plus the candidate list the LLM was actually shown — never merged into `payload`,
  // which is the literal IAS-bound submission (see payloadBuilder.js's header comment).
  const claimPrepMeta = {
    // text: what the pick actually searched with (English); translation: the Burmese original, when translated.
    diagnosis: { text: diagnosisText || null, translation, ...diagnosisPick },
    lines: lineMeta,
  };

  // Open review points so far — member, documents and the picks just made — for the STP switch "open
  // review point blocks STP". A check a person overrode no longer counts.
  const overrides = overridesFromEvents(await CaseEvent.findAll({ where: { caseId: caseRecord.id, reasonCode: 'MANUAL_OVERRIDE' } }));
  const caseFields = caseRecord.toJSON ? caseRecord.toJSON() : caseRecord;
  const openReviewPoints = buildAssessmentSummary({ ...caseFields, claimPrepMeta }, { overrides }).reviewPoints
    .filter((p) => !p.overridden)
    .map(({ decision, reason }) => ({ decision, reason }));

  // STP rules (console Settings) apply per case type + the IAS benefit type each line is submitted
  // with. Currency: the same MMK payloadBuilder.js hardcodes — no multi-currency support yet.
  const stpResult = await stpDecision({
    openReviewPoints,
    source: caseRecord.source,
    currency: 'MMK',
    lines: lines.map((line) => ({ benefitType: line.benefit?.benefitType ?? null, subtotal: line.subtotal })),
    diagCode: diagnosisPick.pick?.diagCode ?? null,
  });
  const stp = stpResult.isStp;
  claimPrepMeta.stp = stpResult;

  const iasPayload = buildPayload({
    extractedFields,
    iasMemberInfoResponse,
    route,
    diagnosis: diagnosisPick.pick,
    lines,
    receivedAt: caseRecord.createdAt,
    barcode: caseRecord.consoleBarcode,
    isStp: stp,
    docCompleteDate: caseRecord.consoleUploadResult?.completedAt,
  });

  // The AI assessment goes to IAS with the claim (AiSummaryRemark, 17/09 meeting #9): the case as it
  // stands when sent — member and document results, overrides, and the picks and STP decision just made.
  // An email case uploaded by cl-upload can have several console barcodes (one per upload): all of them,
  // barcode + suppBarcode1..5, same rule as API cases. The folder method has one barcode, sent as before.
  const consoleBarcodes = caseRecord.consoleUploadResult?.barcodes;
  const payload = {
    ...iasPayload,
    ...(consoleBarcodes?.length ? barcodeFields(consoleBarcodes) : {}),
    AiSummaryRemark: aiSummaryRemark({
      ...caseFields,
      currentStatus: caseRecord.source === 'API' ? 'API_CLAIM_PAYLOAD_PREPARED' : 'CLAIM_PAYLOAD_PREPARED',
      claimPrepMeta,
      isStp: stp,
    }, overrides),
  };

  return { caseId: caseRecord.id, payload, diagnosis: diagnosisPick.pick, lines, isStp: stp, claimPrepMeta };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      {
        currentStatus: 'CLAIM_PAYLOAD_PREPARED',
        iasClaimPayload: outcome.payload,
        claimPrepMeta: outcome.claimPrepMeta,
        isStp: outcome.isStp,
      },
      { where: { id: caseRecord.id }, transaction }
    );
    const benefitSummary = outcome.lines
      .map((line) => `${line.benefit?.benefitType ?? 'null'}/${line.benefit?.benefitHead ?? 'null'}`)
      .join(', ');
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: 'CLAIM_PAYLOAD_PREPARED',
      message: `Claim payload prepared (${outcome.lines.length} line(s); diagnosis=${outcome.diagnosis?.diagCode ?? 'null'}; benefits=[${benefitSummary}]; isStp=${outcome.isStp})`,
    });
  });
}

async function run() {
  // Reads DOCUMENTS_UPLOADED, not MEMBER_VERIFIED, as of 2026-09-15 — console-upload
  // (modules/console-upload/service.js) now sits between document-checking and this job, so
  // the barcode it generates (Case.consoleBarcode) is guaranteed to exist before
  // payloadBuilder.js needs it. See modules/pipeline/service.js's STEPS order.
  const cases = await Case.findAll({
    where: { currentStatus: 'DOCUMENTS_UPLOADED' },
    limit: config.iasClaimPreparation.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await checkCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true });
    } catch (error) {
      // Technical failure (LLM/lookup error, missing prerequisite data) — case is left at
      // DOCUMENTS_UPLOADED for retry, same per-case try/catch pattern as every other job. A
      // diagnosis/benefit pick that legitimately comes back null is NOT a failure — that
      // path already succeeds via persistOutcome with those fields left null in the payload.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase };
