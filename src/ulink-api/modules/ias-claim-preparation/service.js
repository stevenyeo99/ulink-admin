const { sequelize, Case, ClaimRoute, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { pickDiagnosis } = require('./diagnosisPicker');
const { pickBenefit } = require('./benefitPicker');
const { voucherKey, sameVoucher, diagnosisSource, sameDiagnosis } = require('./preparationReview');
const { savedHead, recheckBalance, heldBalanceEnough } = require('../member-verification/memberBalance');
const logger = require('../../utils/logger');
const { uniqueBenefitCandidates } = require('../shared/iasBenefits');
const { buildPayload } = require('./payloadBuilder');
const { vitaminRejection } = require('../document-checking/checklist');
const { stpDecision } = require('./stpEligibility');
const { toEnglishMedicalText } = require('./medicalTranslation');
const { aiSummaryRemark } = require('./aiSummaryRemark');
const { overridesFromEvents } = require('../case-override/override');
const { barcodeFields } = require('../shared/barcodeFields');
const { buildAssessmentSummary } = require('../assessment-summary/summary');
const { forCase } = require('../llm-calls/log');

const BLOCK_NAME = 'ias-claim-preparation';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
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
  // What a person chose (API: the case stopped at API_PREPARATION_REVIEW): it wins, the AI is not asked again; the AI's
  // own pick, reason and candidates stay alongside, for the assessment. The diagnosis only for the text it was chosen
  // for, a voucher's benefit only while that voucher is the same: new documents or a correction get a new AI pick (and
  // a new stop when unsure).
  const choice = caseRecord.preparationChoice || null;
  const chosen = choice && { by: choice.by, comment: choice.comment };
  const source = diagnosisSource(medical);
  const chosenDiagnosis = choice?.diagnosis && sameDiagnosis(choice.diagnosis, { source, text: diagnosisText || null }) ? choice.diagnosis : null;
  const diagnosisPick = chosenDiagnosis
    ? { ...chosenDiagnosis.aiPick, pick: { diagCode: chosenDiagnosis.diagCode, diagDesc: chosenDiagnosis.diagDesc }, defaulted: false, chosen }
    : await pickDiagnosis(diagnosisText, { searchText: illnessText });
  const chosenBenefit = (i, item) => (choice?.benefits || []).find((b) => b.voucher === i && sameVoucher(b.key, voucherKey(item)));
  // A person's manual rejection (vitamins / supplements) on a voucher: theirs, on any voucher, while it is the same.
  const chosenRejection = (i, item) => (choice?.rejections || []).find((r) => r.voucher === i && sameVoucher(r.key, voucherKey(item)));

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
    for (const [i, item] of invoiceItems.entries()) {
      const mine = chosenBenefit(i, item);
      // The member check's head for this voucher (SYSTEM_5 member balance 4.8): the one its balance was checked with —
      // the AI's sure pick or a person's choice — so the balance and the IAS claim use one head, and nobody is asked twice.
      const member = mine ? null : savedHead(caseRecord.memberVerifyResult, i, item, iasMemberInfoResponse, extractedFields);
      const benefitPick = mine
        ? { ...mine.aiPick, pick: { benefitType: mine.benefitType, benefitHead: mine.benefitHead }, chosen }
        : member
          ? {
            pick: { benefitType: member.benefitType, benefitHead: member.benefitHead },
            confidence: member.chosen ? null : member.confidence, reason: member.chosen ? member.comment : member.reason,
            candidates: uniqueBenefitCandidates(memberPlansRaw), fromMemberCheck: true,
            ...(member.chosen ? { chosen: { by: member.by, comment: member.comment } } : {}),
          }
          : await pickBenefit({ ...benefitContext, voucherType: item.voucher_type }, memberPlansRaw);
      // Vitamins / supplements on this voucher → man_rej set 1 on its IAS item (SYSTEM_4 E4-10, owner 2026-10-16) — the
      // AI's, or a person's (amount null: no rejection on this voucher).
      const ai = vitaminRejection(item);
      const rejection = chosenRejection(i, item);
      const vitamin = rejection
        ? (rejection.amount == null ? null : { vitamin_exclude_amount: rejection.amount, vitamin_remark: rejection.remark })
        : ai;
      lines.push({ subtotal: item.subtotal, benefit: benefitPick.pick, vitamin });
      lineMeta.push({
        voucherType: item.voucher_type ?? null, subtotal: item.subtotal ?? null, ...benefitPick,
        // found / confidence: the AI's reading (has_vitamin_or_supplement); ai: its rejection; rejection: the one sent.
        vitamin: { found: item.has_vitamin_or_supplement ?? null, confidence: item.vitamin_confidence ?? null, ai, rejection: vitamin, ...(rejection ? { chosen } : {}) },
      });
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
    diagnosis: { text: diagnosisText || null, source, translation, ...diagnosisPick },
    lines: lineMeta,
  };

  // The second balance check (SYSTEM_5 member balance phase D): with the final heads, just before the claim is built. A
  // new shortage holds the case at BALANCE_REVIEW for a person's bypass (hold: the caller moves the case); any shortage
  // at all keeps the claim from STP.
  const balanceCheck = await recheckBalance(extractedFields, iasMemberInfoResponse, caseRecord.memberVerifyResult, lines.map((line) => line.benefit));
  claimPrepMeta.balance = { checked: balanceCheck.checked, note: balanceCheck.note, lines: balanceCheck.lines, uncovered: balanceCheck.uncovered, issue: balanceCheck.issue };
  if (balanceCheck.hold) {
    return { caseId: caseRecord.id, hold: true, claimPrepMeta, reason: balanceCheck.issue.reason };
  }

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
    // Vouchers the AI read vitamins / supplements on, or a person rejected them on (SYSTEM_4 E4-10) — numbered like the
    // document check's line.
    vitaminVouchers: invoiceItems.map((item, i) => (item.has_vitamin_or_supplement === true || lines[i]?.vitamin ? i + 1 : null)).filter(Boolean),
    // Bypassed (accepted) or let through by a whole-check override (still in issues): never STP either way.
    balanceBypassed: Boolean(balanceCheck.issue) || !balanceCheck.checked
      || [...(caseFields.memberVerifyResult?.accepted || []), ...(caseFields.memberVerifyResult?.issues || [])].some((finding) => finding.item === 'member:balance'),
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
    // The second balance check found a new shortage (SYSTEM_5 member balance phase D): the case waits here for a
    // person's bypass, then comes back to claim preparation.
    if (outcome.hold) {
      await Case.update({ currentStatus: 'BALANCE_REVIEW', claimPrepMeta: outcome.claimPrepMeta }, { where: { id: caseRecord.id }, transaction });
      await logEvent(transaction, { caseId: caseRecord.id, prevStatus, newStatus: 'BALANCE_REVIEW', reasonCode: 'BALANCE_RECHECK', message: `Member balance changed before the claim: ${outcome.reason}` });
      return;
    }
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

/**
 * Cases waiting at BALANCE_REVIEW (SYSTEM_5 member balance phase D): the balance is asked again (one IAS call, no AI)
 * with the heads claim preparation chose; if no shortage is left uncovered — another claim was reversed — the case goes
 * back to claim preparation by itself.
 */
async function recheckHeldBalances() {
  const held = await Case.findAll({ where: { currentStatus: 'BALANCE_REVIEW' }, limit: config.iasClaimPreparation.batchLimit, order: [['updatedAt', 'ASC']] });
  for (const caseRecord of held) {
    try {
      if (!(await heldBalanceEnough(caseRecord.extractedFields, caseRecord.iasMemberInfoResponse, caseRecord.memberVerifyResult, caseRecord.claimPrepMeta))) {
        // Still waiting: to the back of the queue (updatedAt), so every held case gets its turn.
        await Case.update({ currentStatus: 'BALANCE_REVIEW' }, { where: { id: caseRecord.id, currentStatus: 'BALANCE_REVIEW' } });
        continue;
      }
      await sequelize.transaction(async (transaction) => {
        const [count] = await Case.update({ currentStatus: 'DOCUMENTS_UPLOADED' }, { where: { id: caseRecord.id, currentStatus: 'BALANCE_REVIEW' }, transaction });
        if (count === 1) await logEvent(transaction, { caseId: caseRecord.id, prevStatus: 'BALANCE_REVIEW', newStatus: 'DOCUMENTS_UPLOADED', reasonCode: 'BALANCE_RECHECK', message: 'The member balance is enough again: claim preparation runs again.' });
      });
    } catch (error) {
      // The case keeps waiting and is asked again next run.
      logger.warn('Balance re-check of a held case failed', { caseId: caseRecord.id, error: error.message });
    }
  }
}

async function run() {
  await recheckHeldBalances();
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
      const outcome = await forCase(caseRecord.id, 'ias-claim-preparation', () => checkCase(caseRecord)); // AI call log: this case
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
