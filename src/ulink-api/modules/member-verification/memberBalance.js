const { getMemberLimitBalance } = require('./iasClient');
const { balanceRequest, memberPlanKey, checkBalance, balanceLineText } = require('./balance');
const { claimBenefitType } = require('./benefitEligibility');
const { pickBenefit } = require('../ias-claim-preparation/benefitPicker');
const { voucherKey, sameVoucher } = require('../ias-claim-preparation/preparationReview');

// The member balance step of the member check (SYSTEM_5 member balance phase B, docs/imp/CR/SYSTEM_5/PRD/
// MEMBER_BALANCE_PRD.md 4.3–4.5): the AI picks each voucher's benefit head, then the IAS balance decides whether each
// voucher fits. Not pure: one AI call per voucher it has not picked before, and one IAS call.
//
// previousPicks: the picks of the last member check — reused while the voucher is unchanged (voucherKey), so a case
// that waits at member review (checked again every run) costs no new AI call. An unsure pick (no head) is kept too:
// phase C asks a person for it; until then that voucher is checked at benefit type level (4.4, rule 4).
// voucher: the voucher's 0-based index, as preparation review keys its choices (balance lines number them from 1).
// basis: what the pick depends on beyond the voucher (type of patient, member plan) — a change picks again.
async function pickHeads(extractedFields, memberPlansRaw, previousPicks = [], basis = {}) {
  const items = extractedFields.invoices?.items || [];
  const context = {
    typeOfPatient: extractedFields.claim?.type_of_patient,
    claimBenefitType: extractedFields.claim?.claim_benefit_type,
    illnessDescription: extractedFields.medical?.detail_of_illness_injury,
    treatmentDescription: extractedFields.medical?.full_description_of_treatment,
  };
  const picks = [];
  // One at a time, like claim preparation: the local AI server takes one call at a time.
  for (const [i, item] of items.entries()) {
    const key = voucherKey(item);
    const saved = previousPicks.find((p) => p.voucher === i && sameVoucher(p.key, key) && JSON.stringify(p.basis ?? {}) === JSON.stringify(basis));
    if (saved) {
      picks.push(saved);
      continue;
    }
    if (!(Number(item.subtotal) > 0)) { // a refund slip, or no amount: no balance to check, no AI call
      picks.push({ voucher: i, key, basis, benefitType: null, benefitHead: null, confidence: null, reason: 'Not checked: no positive amount.' });
      continue;
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
  const picks = await pickHeads(extractedFields, memberPlans, previousPicks, { typeOfPatient: extractedFields.claim?.type_of_patient ?? null, plan: planKey });

  // A voucher with no head is checked against the type the claim form names (type of patient).
  const fallbackType = claimBenefitType(extractedFields, memberPlans);
  const items = extractedFields.invoices?.items || [];
  const vouchers = items.length
    ? items.map((item, i) => ({ voucher: i + 1, amount: item.subtotal, benefitType: picks[i].benefitType ?? fallbackType, benefitHead: picks[i].benefitHead }))
    // No voucher yet: the claim total against the type limits (the document check asks for the vouchers).
    : [{ voucher: null, amount: extractedFields.claim?.total_claim_amount ?? null, benefitType: fallbackType, benefitHead: null }];

  const result = checkBalance(balanceResponse, planKey, vouchers);
  if (!result.planFound) {
    return { ...notChecked(`IAS returned no balance for the member's plan${planKey ? ` (${planKey.planId}, revision ${planKey.revNo})` : ''}.`), picks };
  }
  const lines = result.lines.map((line) => ({ ...line, text: balanceLineText(line) }));
  const short = lines.filter((line) => line.enough === false);
  return {
    checked: true, note: null, picks, lines,
    issue: short.length
      ? { item: 'member:balance', reasonCode: 'BALANCE_NOT_ENOUGH', reason: `Balance not enough: ${short.map((line) => line.text).join('; ')}.` }
      : null,
  };
}

module.exports = { checkMemberBalance, pickHeads };
