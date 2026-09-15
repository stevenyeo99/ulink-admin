const { sequelize, Case, ClaimRoute, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { pickDiagnosis } = require('./diagnosisPicker');
const { pickBenefit } = require('./benefitPicker');
const { buildPayload } = require('./payloadBuilder');
const { isStp } = require('./stpEligibility');

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

  const medical = extractedFields.medical || {};
  const diagnosisText = [
    medical.detail_of_illness_injury && `Diagnosis/illness: ${medical.detail_of_illness_injury}`,
    medical.full_description_of_treatment && `Treatment: ${medical.full_description_of_treatment}`,
  ].filter(Boolean).join('\n');
  const diagnosis = await pickDiagnosis(diagnosisText);

  const memberPlansRaw = iasMemberInfoResponse?.payload?.memberPlans;
  const benefitContext = {
    typeOfPatient: extractedFields.claim?.type_of_patient,
    claimBenefitType: extractedFields.claim?.claim_benefit_type,
    illnessDescription: medical.detail_of_illness_injury,
    treatmentDescription: medical.full_description_of_treatment,
  };

  // One line per real voucher (extractedFields.invoices.items — each with its own subtotal
  // and its own benefit pick), not one collapsed line per case — verified against real
  // sample data that a claim can genuinely be multiple separate vouchers. Sequential, not
  // Promise.all: same one-call-at-a-time discipline claim-recognition's transcribePage
  // already uses for this local LLM server.
  const invoiceItems = extractedFields.invoices?.items || [];
  const lines = [];
  if (invoiceItems.length > 0) {
    for (const item of invoiceItems) {
      const benefit = await pickBenefit({ ...benefitContext, voucherType: item.voucher_type }, memberPlansRaw);
      lines.push({ subtotal: item.subtotal, benefit });
    }
  } else {
    // Shouldn't reach this job in practice (document-checking would have flagged a missing
    // voucher first) — defensive fallback so a case somehow lacking itemized invoices still
    // produces one usable line instead of an empty Items[] array.
    const benefit = await pickBenefit({ ...benefitContext, voucherType: null }, memberPlansRaw);
    lines.push({ subtotal: extractedFields.claim?.total_claim_amount, benefit });
  }

  // Same currency payloadBuilder.js hardcodes for every line (PresentedCurrency: 'MMK') —
  // no multi-currency support anywhere in this system yet, so this is the only currency an
  // STP limit could ever be checked against today.
  const presentedAmt = lines.reduce((sum, line) => sum + (line.subtotal ?? 0), 0);
  const stp = await isStp({ routeKey: caseRecord.recognizedType, currency: 'MMK', presentedAmt });

  const payload = buildPayload({
    extractedFields,
    iasMemberInfoResponse,
    route,
    diagnosis,
    lines,
    receivedAt: caseRecord.createdAt,
    barcode: caseRecord.consoleBarcode,
    isStp: stp,
    docCompleteDate: caseRecord.consoleUploadResult?.completedAt,
  });

  return { caseId: caseRecord.id, payload, diagnosis, lines, isStp: stp };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      { currentStatus: 'CLAIM_PAYLOAD_PREPARED', iasClaimPayload: outcome.payload, isStp: outcome.isStp },
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
