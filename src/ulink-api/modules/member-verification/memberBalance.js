const { getMemberLimitBalance } = require('./iasClient');
const { balanceRequest, memberPlanKey, checkBalance, balanceLineText } = require('./balance');
const { claimBenefitType } = require('./benefitEligibility');
const { pickBenefit } = require('../ias-claim-preparation/benefitPicker');
const { voucherKey, sameVoucher, benefitUnsure } = require('../ias-claim-preparation/preparationReview');
const { lastReadSettings } = require('../settings/settings');
const { toEnglishMedicalText } = require('../ias-claim-preparation/medicalTranslation');
const { uniqueBenefitCandidates } = require('../shared/iasBenefits');

// The member balance step of the member check (SYSTEM_5 member balance phase B, docs/imp/CR/SYSTEM_5/PRD/
// MEMBER_BALANCE_PRD.md 4.3–4.5): the AI picks each voucher's benefit head, then the IAS balance decides whether each
// voucher fits. Not pure: one AI call per voucher it has not picked before, and one IAS call.
//
// previousPicks: the picks of the last member check — reused while the voucher is unchanged (voucherKey), so a case
// that waits at member review (checked again every run) costs no new AI call. An unsure pick (no head) is kept too:
// phase C asks a person for it; until then that voucher is checked at benefit type level (4.4, rule 4).
// What a pick depends on beyond the voucher: the type of patient and the member's plan — a change picks again.
function pickBasis(extractedFields, iasMemberInfoResponse) {
  return { typeOfPatient: extractedFields.claim?.type_of_patient ?? null, plan: memberPlanKey(iasMemberInfoResponse) };
}

// A saved pick still fits this voucher: the AI's while the voucher is unchanged (amount, date, type); a person's
// (chosen, on the Choose the benefit screen) while its date is unchanged — a type or amount corrected with it keeps it.
function pickFits(pick, i, item, basis) {
  if (pick.voucher !== i || JSON.stringify(pick.basis ?? {}) !== JSON.stringify(basis)) return false;
  return pick.chosen ? pick.key?.date === voucherKey(item).date : sameVoucher(pick.key, voucherKey(item));
}

// The head claim preparation uses for voucher i (SYSTEM_5 member balance 4.8): the member check's sure or chosen pick,
// or null (preparation picks itself).
function savedHead(memberVerifyResult, i, item, iasMemberInfoResponse, extractedFields) {
  const basis = pickBasis(extractedFields, iasMemberInfoResponse);
  const pick = (memberVerifyResult?.balance?.picks || []).find((p) => pickFits(p, i, item, basis));
  return pick?.benefitHead || (pick?.chosen && pick?.benefitType) ? pick : null;
}

// voucher: the voucher's 0-based index, as preparation review keys its choices (balance lines number them from 1).
// basis: what the pick depends on beyond the voucher (type of patient, member plan) — a change picks again.
async function pickHeads(extractedFields, memberPlansRaw, previousPicks = [], basis = {}) {
  const items = extractedFields.invoices?.items || [];
  let context = null; // built on the first voucher that needs the AI: Burmese text is translated once, as claim preparation does
  const picks = [];
  // One at a time, like claim preparation: the local AI server takes one call at a time.
  for (const [i, item] of items.entries()) {
    const key = voucherKey(item);
    const saved = previousPicks.find((p) => pickFits(p, i, item, basis));
    if (saved) {
      picks.push(saved);
      continue;
    }
    if (!(Number(item.subtotal) > 0)) { // a refund slip, or no amount: no balance to check, no AI call
      picks.push({ voucher: i, key, basis, benefitType: null, benefitHead: null, confidence: null, reason: 'Not checked: no positive amount.' });
      continue;
    }
    if (!context) {
      const { diagnosis, treatment } = await toEnglishMedicalText({
        diagnosis: extractedFields.medical?.detail_of_illness_injury || null,
        treatment: extractedFields.medical?.full_description_of_treatment || null,
      });
      context = { typeOfPatient: extractedFields.claim?.type_of_patient, claimBenefitType: extractedFields.claim?.claim_benefit_type, illnessDescription: diagnosis, treatmentDescription: treatment };
    }
    const result = await pickBenefit({ ...context, voucherType: item.voucher_type }, memberPlansRaw);
    picks.push({
      voucher: i, key, basis,
      benefitType: result.pick?.benefitType ?? null, benefitHead: result.pick?.benefitHead ?? null,
      confidence: result.confidence ?? null, reason: result.reason ?? null,
    });
  }
  return picks;
}

/**
 * Returns { checked, note, picks, lines, issue }. checked false (with a note) when the balance could not be read: the
 * IAS record has no member ref / policy, IAS answered success: false, or it has no entry for the member's plan — the
 * case is not stopped for it. issue: the member:balance finding (reason code BALANCE_NOT_ENOUGH) when any voucher is
 * short, else null. An IAS network error or non-2xx answer throws: the member check fails and runs again next time.
 */
async function checkMemberBalance(extractedFields, iasMemberInfoResponse, previousPicks = []) {
  const memberPlans = iasMemberInfoResponse?.payload?.memberPlans;
  // The saved picks stay as they are when the balance cannot be read: no AI call is spent on it.
  const notChecked = (note) => ({ checked: false, note, picks: previousPicks, lines: [], issue: null });

  const request = balanceRequest(iasMemberInfoResponse);
  if (!request) return notChecked('The IAS member record has no member ref, policy number or policy start date.');
  const balanceResponse = await getMemberLimitBalance(request);
  if (balanceResponse?.success !== true) return notChecked(`IAS did not return the balance${balanceResponse?.error ? ` (${balanceResponse.error})` : ''}.`);

  const planKey = memberPlanKey(iasMemberInfoResponse);
  const items = extractedFields.invoices?.items || [];
  const picks = await pickHeads(extractedFields, memberPlans, previousPicks, pickBasis(extractedFields, iasMemberInfoResponse));
  // Vouchers the AI was not sure of (a positive amount, no person's choice): the Choose the benefit stop. The same rule
  // as claim preparation's (benefitUnsure: no type, no head where the plan has heads, or a confidence at or below the
  // threshold), so a head accepted here is never asked for again there.
  const candidates = uniqueBenefitCandidates(memberPlans);
  const threshold = lastReadSettings().aiConfidenceThreshold;
  // No benefit on the member's plan: nothing a person could choose, so no stop (the type limits are checked instead).
  const unsure = !candidates.length ? [] : picks.filter((p) => Number(items[p.voucher]?.subtotal) > 0 && benefitUnsure({
    pick: p.benefitType ? { benefitType: p.benefitType, benefitHead: p.benefitHead } : null, confidence: p.confidence, candidates, chosen: p.chosen,
  }, threshold)).map((p) => p.voucher);

  // A voucher with no head is checked against the type the claim form names (type of patient); a person's choice of a
  // type with no head counts as its type.
  const fallbackType = claimBenefitType(extractedFields, memberPlans);
  const vouchers = items.length
    ? items.map((item, i) => ({ voucher: i + 1, amount: item.subtotal, benefitType: picks[i].benefitType ?? fallbackType, benefitHead: picks[i].benefitHead }))
    // No voucher yet: the claim total against the type limits (the document check asks for the vouchers).
    : [{ voucher: null, amount: extractedFields.claim?.total_claim_amount ?? null, benefitType: fallbackType, benefitHead: null }];

  const result = checkBalance(balanceResponse, planKey, vouchers);
  if (!result.planFound) {
    return { ...notChecked(`IAS returned no balance for the member's plan${planKey ? ` (${planKey.planId}, revision ${planKey.revNo})` : ''}.`), picks, unsure, candidates };
  }
  const lines = result.lines.map((line) => ({ ...line, text: balanceLineText(line) }));
  return {
    checked: true, note: null, picks, lines, unsure, candidates,
    // coverKeys: what a bypass covers (owner, 2026-10-26, option A1) — the short vouchers (number, head, amount), not the
    // balance figure, so a balance that moves in IAS does not hold the case again; a new short voucher does.
    issue: balanceIssue(lines),
  };
}

// The member:balance finding from the balance lines, or null when none is short. coverKeys: what a bypass covers (owner,
// 2026-10-26, option A1) — the short vouchers (number, head, amount), not the balance figure, so a balance that moves in
// IAS does not hold the case again; a new short voucher does. skip: 0-based vouchers left out (unsure heads, judged after
// a person chooses them).
function balanceIssue(lines, skip = []) {
  const short = lines.filter((line) => line.enough === false && !skip.includes((line.voucher ?? 0) - 1));
  return short.length
    ? {
      item: 'member:balance', reasonCode: 'BALANCE_NOT_ENOUGH',
      reason: `Balance not enough: ${short.map((line) => line.text).join('; ')}.`,
      coverKeys: short.map((line) => `${line.voucher ?? 'claim'}|${line.benefitType ?? ''}|${line.benefitHead ?? ''}|${line.amount}`),
    }
    : null;
}

// The member check result with a person's head choices over its picks (same voucher index): what the next member check
// reuses. Chosen picks carry chosen: true, so they count as sure.
function withChosenPicks(memberVerifyResult, chosenPicks) {
  if (!chosenPicks?.length) return memberVerifyResult;
  const picks = memberVerifyResult?.balance?.picks || [];
  const merged = [...picks.filter((p) => !chosenPicks.some((c) => c.voucher === p.voucher)), ...chosenPicks];
  return { ...memberVerifyResult, balance: { ...memberVerifyResult?.balance, picks: merged } };
}

module.exports = { checkMemberBalance, pickHeads, pickBasis, savedHead, withChosenPicks, balanceIssue };
