// Per-item correction (SYSTEM_4 E4-12): a reviewer fixes one value the AI read (NRC, a date, an amount, …) or one
// check's verdict, and the case is checked again with it. Pure — no I/O; the controller stores the correction
// (ulink_ai_feedback, the learning record) and writes the corrected fields.
//
// What the flow uses lives in the case's own fields, so every job reads it unchanged (member check, document check,
// claim preparation — email and API): a corrected value is written into extractedFields; every correction is listed in
// extractedFields.corrections, newest per item kept. Verdicts are applied by the document check (applyVerdicts).
// The AI's own value is kept in the correction (aiValue) — and, for API cases, in the earlier recognition step.

const { ISSUES, FIELD_LABELS, isRealDate, valueAt, issueForFlag } = require('../document-checking/checklist');
const { parseFollowUp } = require('../document-checking/labFollowUp');
const { ACCEPTABLE_MEMBER_ITEMS, MEMBER_ITEM_LABELS } = require('../member-verification/checks');

const WRONG_STEP_LABELS = {
  reading: 'the page was misread',
  mapping: 'read right but put in the wrong field',
  check: "the check's decision was wrong",
  // The AI was right; a person lets the check pass anyway (owner, 2026-10-20). Not AI mistakes: check verdicts only.
  ias_outdated: 'the IAS record is out of date',
  exception: 'the AI was right, accepted as an exception',
};
const EXCEPTION_STEPS = ['ias_outdated', 'exception'];

// Checklist lines a person may set pass / fail. Not: mandatory fields (correct the value instead), and the lines that
// only report on the values read (format, evidence) or vitamins (a person approves those claims anyway).
// PERSON_REQUEST: a reviewer's own lines (SYSTEM_4 E4-28) — closed by Confirm and continue, never by a correction.
// DOCUMENT_LIST / BENEFIT_TYPE / DOCUMENT_DATES: information only (documents found, the benefit type they show, whether
// the medical ones are dated), nothing to pass or fail.
const NOT_VERDICT_ITEMS = new Set(['MISSING_MANDATORY_FIELD', 'VALUE_FORMAT', 'FIELDS_READ', 'VITAMIN_OR_SUPPLEMENT', 'PERSON_REQUEST', 'DOCUMENT_LIST', 'BENEFIT_TYPE', 'DOCUMENT_DATES']);

const AMOUNT_FIELDS = new Set(['claim.total_claim_amount']);
// What the member check compares with IAS (member-verification), and the diagnosis and treatment its two exclusion
// checks judge (IAS events and the policy contract clauses): a correction of one of these is checked again from the
// member check; anything else from the document check, so a person's member override stays in force.
const MEMBER_CHECK_FIELDS = new Set([
  'claimant.claimant_name', 'claimant.claimant_nrc_passport', 'claimant.claimant_dob', 'policy.policy_no',
  'claim.appointment_date', 'claim.accident_date', 'bank.bank_name', 'bank.bank_account_name', 'bank.bank_account_number',
  'medical.detail_of_illness_injury', 'medical.full_description_of_treatment',
]);
// The voucher types the AI reads — keep in line with extract-fields.md (voucher_type) and its schema enum.
const VOUCHER_TYPES = ['consultation', 'pharmacy', 'lab', 'optical', 'other'];
const DATE_FIELDS = new Set(['claimant.claimant_dob', 'claim.appointment_date', 'claim.accident_date', 'medical_record.date']);
const VOUCHER_ITEM = /^invoices\.items\.(\d+)\.(subtotal|date)$/;
// Remove a voucher that is not part of the claim, and put it back (UAT 17/11, owner 2026-11-19). The voucher leaves
// invoices.items, so every check, the balance and the IAS revision see only the vouchers that remain; it is kept in
// invoices.removed with who, why and its own corrections. IAS gets nothing for it.
const VOUCHER_REMOVE = /^invoices\.items\.(\d+)\.remove$/;
const VOUCHER_RESTORE = /^invoices\.removed\.(\d+)\.restore$/;
const VOUCHER_PATH = /^invoices\.items\.(\d+)\.(.+)$/;
const isVoucherMove = (item) => VOUCHER_REMOVE.test(item) || VOUCHER_RESTORE.test(item);
// The corrections of vouchers from index `from` on, numbered by `by` (a voucher before them left or came back).
const shiftVouchers = (corrections, from, by) => corrections.map((c) => {
  const m = c.item?.match(VOUCHER_PATH);
  return m && Number(m[1]) >= from ? { ...c, item: `invoices.items.${Number(m[1]) + by}.${m[2]}` } : c;
});
const amountText = (n) => (typeof n === 'number' ? `${n.toLocaleString('en-US')} MMK` : 'no amount');
// A removed voucher in one line, for the page, the history and the assessment: "218,915 MMK, 2026-06-10".
const voucherText = (item) => `${amountText(item?.subtotal)}, ${item?.date ?? 'no date'}`;

// Sets a value in place (on a copy the caller made).
function setAt(fields, path, value) {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((o, key) => (o[key] ??= {}), fields);
  parent[keys.at(-1)] = value;
}

// A missing mandatory field's own verdict item: one line per field, all with the same code.
const mandatoryItem = (line) => `MISSING_MANDATORY_FIELD:${line.label}`;
// What a Mark OK on undated documents covers: the undated pages themselves, not the wording of the note.
const undatedKey = (line) => (line.undated || []).flatMap((g) => g.pages || [g.label]).sort().join(' | ');
// The verdict item of a checklist line.
const lineItem = (line) => (line.code === 'MISSING_MANDATORY_FIELD' ? mandatoryItem(line) : line.code);

const priorCorrection = (fields, item) => (fields.corrections || []).find((c) => c.item === item) || null;

/**
 * What a person can correct on this case: the key values (whether or not the AI read them), each voucher's amount
 * and date, the checklist lines with a verdict, and each open member finding (Mark OK only — "member:dob",
 * "member:bank", "member:policy"; never coverage). { kind, item, label, type: text|date|amount|verdict, current,
 * canFail?, note? }. current: the value / verdict in force now (corrected or the AI's).
 */
function correctionOptions(fields = {}, documentCheckResult = null, memberVerifyResult = null) {
  const values = Object.entries(FIELD_LABELS).map(([item, label]) => ({
    kind: 'value', item, label,
    type: AMOUNT_FIELDS.has(item) ? 'amount' : DATE_FIELDS.has(item) ? 'date' : 'text',
    current: valueAt(fields, item) ?? null,
  }));
  // Each voucher's type, which claim preparation reads, chosen from a fixed list (type: choice): a wrong type picks the
  // wrong IAS benefit (and its STP limit). Not the type of patient: it is free text on the claim form ("Outpatient",
  // "optical care"), and the member check compares it with the member's IAS benefit types as written.
  const choices = (fields.invoices?.items || []).map((voucher, i) => (
    { kind: 'value', item: `invoices.items.${i}.voucher_type`, label: `Voucher ${i + 1} type`, type: 'choice', choices: VOUCHER_TYPES, current: voucher.voucher_type ?? null }));
  const vouchers = (fields.invoices?.items || []).flatMap((voucher, i) => [
    // A voucher amount may be zero or negative: a refund / cash-return slip (claim-recognition keeps those).
    { kind: 'value', item: `invoices.items.${i}.subtotal`, label: `Voucher ${i + 1} amount`, type: 'amount', current: voucher.subtotal ?? null, signed: true },
    { kind: 'value', item: `invoices.items.${i}.date`, label: `Voucher ${i + 1} date`, type: 'date', current: voucher.date ?? null },
  ]);
  const lines = documentCheckResult?.checklist || [];
  const verdicts = lines
    .filter((line) => line.code && !NOT_VERDICT_ITEMS.has(line.code) && typeof line.passed === 'boolean')
    .map((line) => ({ kind: 'verdict', item: line.code, label: line.label, type: 'verdict', current: line.passed, canFail: Boolean(ISSUES[line.code]) }));
  // Mark OK where a finding had no action (UAT 17/11, owner 2026-11-19), so every document finding can be decided:
  // a medical document without a date (e.g. a medical book cover), covering the pages the person saw (covers: a new
  // undated page holds the case again); and a missing mandatory field with nothing to edit (e.g. no email on the form).
  // Only while it is open (confidence 0): once marked OK it is sure (confidence 1) and not offered again.
  const dates = lines.find((line) => line.code === 'DOCUMENT_DATES' && line.undated?.length && line.confidence === 0);
  const datesOk = dates ? [{ kind: 'verdict', item: 'DOCUMENT_DATES', label: dates.label, type: 'verdict', current: false, canFail: false, covers: undatedKey(dates) }] : [];
  const mandatoryOk = lines.filter((line) => line.code === 'MISSING_MANDATORY_FIELD' && line.passed === false && !line.editItems?.length)
    .map((line) => ({ kind: 'verdict', item: mandatoryItem(line), label: `Mandatory field ${line.label}`, type: 'verdict', current: false, canFail: false }));
  // A member finding marked OK is no longer an issue (checks.js sets it aside): only the open ones are offered.
  const member = (memberVerifyResult?.issues || [])
    .filter((issue) => ACCEPTABLE_MEMBER_ITEMS.has(issue.item))
    .map((issue) => ({ kind: 'verdict', item: issue.item, label: MEMBER_ITEM_LABELS[issue.item], type: 'verdict', current: false, canFail: false, note: issue.reason, ...(issue.coverKeys ? { coverKeys: issue.coverKeys } : {}) }));
  // Remove: only while another voucher stays (no voucher at all: the claim would go to IAS on the form's amount).
  const items = fields.invoices?.items || [];
  const remove = items.length > 1 ? items.map((voucher, i) => (
    { kind: 'value', item: `invoices.items.${i}.remove`, label: `Remove voucher ${i + 1}`, type: 'remove', current: false, voucher: i + 1, note: voucherText(voucher) })) : [];
  const restore = (fields.invoices?.removed || []).map((r, k) => (
    { kind: 'value', item: `invoices.removed.${k}.restore`, label: `Put back voucher ${r.voucher + 1}`, type: 'restore', current: false, voucher: r.voucher + 1,
      note: `${voucherText(r.item)}: removed by ${r.by} — ${r.reason}` }));
  return [...values, ...choices, ...vouchers, ...remove, ...restore, ...verdicts, ...datesOk, ...mandatoryOk, ...member];
}

/**
 * Checks a correction request against the options. Returns { error } or { option, corrected } (the value or verdict).
 * body: { kind, item, value?, passed?, reason, wrongStep }.
 */
function validateCorrection(body, options) {
  const option = options.find((o) => o.kind === body?.kind && o.item === body?.item);
  if (!option) return { error: 'Pick a value or check that can be corrected on this case.' };
  if (!WRONG_STEP_LABELS[body.wrongStep]) return { error: `Say what went wrong: ${Object.keys(WRONG_STEP_LABELS).join(', ')}.` };
  if (EXCEPTION_STEPS.includes(body.wrongStep) && option.kind !== 'verdict') return { error: 'A changed value is a misread or a wrong field, not an exception.' };
  // A short IAS balance or an exclusion in IAS is a business decision, not an AI mistake (SYSTEM_5).
  if (option.item === 'member:balance' && body.wrongStep !== 'exception') return { error: 'A short balance is bypassed as an exception.' };
  if (option.item === 'member:exclusion' && body.wrongStep !== 'exception') return { error: 'An exclusion in IAS is bypassed as an exception.' };
  if (option.item === 'member:same_date_claim' && body.wrongStep !== 'exception') return { error: 'A claim with the same incurred date is bypassed as an exception.' };
  // A policy contract exclusion (SYSTEM_5 contract exclusion): the AI was wrong (it does not apply, STP stays possible), or
  // it applies and the case goes on as an exception (never STP).
  if (option.item === 'member:contract_exclusion' && !['check', 'exception'].includes(body.wrongStep)) {
    return { error: "A policy contract exclusion either does not apply (the check's decision was wrong) or goes on as an exception." };
  }
  if (!reasonLongEnough(body.reason)) return { error: REASON_TOO_SHORT };

  if (option.kind === 'verdict') {
    if (typeof body.passed !== 'boolean') return { error: 'Say whether the check passes or fails.' };
    if (body.passed === option.current) return { error: `The check already ${option.current ? 'passes' : 'fails'}.` };
    if (!body.passed && !option.canFail) return { error: 'This check has no customer wording for a failure; it can only be marked passed.' };
    return { option, corrected: body.passed };
  }
  // Remove / put back: the action itself is the change.
  if (option.type === 'remove' || option.type === 'restore') return { option, corrected: true };
  let value = body.value;
  if (option.type === 'amount') {
    value = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${option.label}: enter an amount.` };
    if (!option.signed && value <= 0) return { error: `${option.label}: enter an amount above zero.` };
  } else if (option.type === 'date') {
    if (!isRealDate(value)) return { error: `${option.label}: enter a date as YYYY-MM-DD.` };
  } else if (option.type === 'choice') {
    if (!option.choices.includes(value)) return { error: `${option.label}: choose one of ${option.choices.join(', ')}.` };
  } else {
    value = typeof value === 'string' ? value.trim() : '';
    if (!value || value.length > 200) return { error: `${option.label}: enter the value (up to 200 characters).` };
    // The doctor's follow-up period is compared as dates (labFollowUp.js): only the fixed form, kept as "2 weeks".
    if (option.item === 'medical_record.follow_up') {
      value = parseFollowUp(value)?.text;
      if (!value) return { error: `${option.label}: enter a number and day, week or month, e.g. 2 weeks.` };
    }
  }
  if (value === option.current) return { error: `${option.label} is already "${value}".` };
  return { option, corrected: value };
}

/**
 * What the AI said about the item before any person touched it: { aiValue, aiConfidence, page } — from an earlier
 * correction of the same item when there is one (a second correction must not record the first person's value as the AI's).
 */
function aiOriginal(fields, option, documentCheckResult) {
  const prior = priorCorrection(fields, option.item);
  if (prior) return { aiValue: prior.aiValue, aiConfidence: prior.aiConfidence ?? null, page: prior.page ?? null };
  if (option.kind === 'verdict' && option.item.startsWith('member:')) return { aiValue: false, aiConfidence: null, page: null };
  // Remove / put back a voucher: the AI read it as a voucher of this claim (aiValue null: no value of its own).
  if (isVoucherMove(option.item)) return { aiValue: null, aiConfidence: null, page: fields.invoices?.items?.[Number(option.item.split('.')[2])]?.evidence?.page ?? null };
  if (option.kind === 'verdict') {
    const line = (documentCheckResult?.checklist || []).find((l) => lineItem(l) === option.item);
    // Undated documents: the AI's line "passes" but holds the case (confidence 0), so what the AI said is: not OK.
    return { aiValue: option.item === 'DOCUMENT_DATES' ? false : line?.passed ?? null, aiConfidence: line?.confidence ?? null, page: null };
  }
  const voucher = option.item.match(VOUCHER_ITEM);
  const evidence = voucher
    ? fields.invoices?.items?.[Number(voucher[1])]?.evidence
    : (fields.field_evidence || []).find((e) => e.field === option.item)
      // The follow-up period's AI evidence is on the medical record itself (labFollowUp.js).
      || (option.item === 'medical_record.follow_up' ? fields.medical_record?.follow_up_evidence : null);
  return { aiValue: option.current, aiConfidence: evidence?.confidence ?? null, page: evidence?.page ?? null };
}

/**
 * The case's fields with the correction in force. correction: { id, kind, item, label, aiValue, aiConfidence,
 * corrected, reason, wrongStep, page, by, at }. A value is written in, and its evidence says a person set it.
 */
function applyCorrection(fields, correction) {
  const next = structuredClone(fields);
  const removeAt = correction.item.match(VOUCHER_REMOVE);
  if (removeAt) {
    // The voucher leaves the list with its own corrections; the vouchers after it move up one number.
    const i = Number(removeAt[1]);
    const [item] = next.invoices.items.splice(i, 1);
    const all = next.corrections || [];
    const own = all.filter((c) => c.item?.match(VOUCHER_PATH)?.[1] === String(i));
    next.corrections = shiftVouchers(all.filter((c) => !own.includes(c)), i + 1, -1);
    next.invoices.removed = [...(next.invoices.removed || []),
      { voucher: i, item, corrections: own, id: correction.id, by: correction.by, reason: correction.reason, at: correction.at }];
    next.invoices.moves = [...(next.invoices.moves || []), { action: 'removed', voucher: i, text: voucherText(item), by: correction.by, reason: correction.reason, at: correction.at }];
    return next;
  }
  const restoreAt = correction.item.match(VOUCHER_RESTORE);
  if (restoreAt) {
    // Back in its old place (or last), with its corrections; the vouchers from there move down one number.
    const [entry] = next.invoices.removed.splice(Number(restoreAt[1]), 1);
    const at = Math.min(entry.voucher, next.invoices.items.length);
    next.invoices.items.splice(at, 0, entry.item);
    next.corrections = [...shiftVouchers(next.corrections || [], at, 1), ...shiftVouchers(entry.corrections || [], 0, at - entry.voucher)];
    if (!next.invoices.removed.length) delete next.invoices.removed;
    // ponytail: put back in its number at removal time; after other removals the order can differ (no value moves).
    next.invoices.moves = [...(next.invoices.moves || []), { action: 'put back', voucher: at, text: voucherText(entry.item), by: correction.by, reason: correction.reason, at: correction.at }];
    return next;
  }
  if (correction.kind === 'value') {
    setAt(next, correction.item, correction.corrected);
    const reason = `Corrected by ${correction.by}: ${correction.reason}`;
    const voucher = correction.item.match(VOUCHER_ITEM);
    if (voucher) {
      // One evidence covers a voucher's amount AND date: it is only sure once a person corrected both — correcting
      // one keeps the AI's doubt about the other (and its page).
      const item = next.invoices.items[Number(voucher[1])];
      const corrected = [...new Set([...(item.evidence?.corrected || []), voucher[2]])];
      const both = corrected.includes('subtotal') && corrected.includes('date');
      item.evidence = {
        confidence: both ? 1 : item.evidence?.confidence ?? null,
        reason: [item.evidence?.reason, `${voucher[2] === 'date' ? 'date' : 'amount'} ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`].filter(Boolean).join('; '),
        page: item.evidence?.page ?? correction.page ?? null,
        corrected,
      };
    } else if (FIELD_LABELS[correction.item]) {
      // Evidence for the key values only (the "Values read" list); a chosen voucher type / type of patient has none.
      next.field_evidence = [...(next.field_evidence || []).filter((e) => e.field !== correction.item),
        { field: correction.item, confidence: 1, reason, page: correction.page ?? null }];
    }
  }
  next.corrections = [...(next.corrections || []).filter((c) => c.item !== correction.item), correction];
  return next;
}

/**
 * The document check's result with the verdicts a person set (fields.corrections). A line set to pass drops its
 * issue (and its customer wording) from the result; a line set to fail adds its approved customer wording.
 */
function applyVerdicts(result, corrections = []) {
  const verdicts = corrections.filter((c) => c.kind === 'verdict');
  if (!verdicts.length) return result;
  let { issues, details, flags } = result;
  const checklist = result.checklist.map((line) => {
    const verdict = verdicts.find((v) => v.item === lineItem(line));
    // covers: the finding the person saw (the undated pages); a changed one is a new finding, held again.
    if (!verdict || (verdict.covers != null && verdict.covers !== undatedKey(line))) return line;
    if (verdict.corrected && line.code === 'MISSING_MANDATORY_FIELD') {
      // One field of many with the same code: only its own request goes.
      // section / field on the line (checklist.js); a line stored before them: from its label "section: field".
      const field = line.field ?? line.label.split(': ').slice(1).join(': ');
      const own = issueForFlag({ code: line.code, field });
      details = details.filter((d) => d.issue !== own);
      issues = issues.filter((i) => i !== own);
      flags = flags.filter((f) => !(f.code === line.code && f.field === field));
    } else if (verdict.corrected) {
      // Only this line's issue goes: customer wording another line still raises stays (e.g. the delegation letter).
      const own = new Set([ISSUES[line.code], ...details.filter((d) => d.code === line.code).map((d) => d.issue)].filter(Boolean));
      // Also the copy with no code (evaluateDocumentChecks lists a date flag's issue twice): else its text stays, and the
      // case is held again after a person marked the date check OK (UAT 17/11, case 2606100014).
      details = details.filter((d) => d.code !== line.code && !(d.code == null && own.has(d.issue)));
      issues = issues.filter((i) => !own.has(i) || details.some((d) => d.issue === i));
      flags = flags.filter((f) => f.code !== line.code);
    } else if (ISSUES[line.code] && !issues.includes(ISSUES[line.code])) {
      issues = [...issues, ISSUES[line.code]];
      details = [...details, { issue: ISSUES[line.code], code: line.code, reason: `Marked failed by ${verdict.by}: ${verdict.reason}` }];
    }
    const rest = { ...line };
    delete rest.usedFields; // the verdict is the person's now, not the values'
    return {
      ...rest,
      passed: verdict.corrected,
      confidence: 1,
      corrected: { by: verdict.by, at: verdict.at, reason: verdict.reason, aiPassed: verdict.aiValue },
      // The AI was right and a person let it pass anyway (ias_outdated / exception): say so, not "corrected".
      note: `${verdict.corrected ? 'Passed' : 'Failed'} — ${EXCEPTION_STEPS.includes(verdict.wrongStep) ? `accepted by ${verdict.by} (${WRONG_STEP_LABELS[verdict.wrongStep]})` : `corrected by ${verdict.by}`}: ${verdict.reason} (the AI said ${verdict.aiValue ? 'passed' : 'failed'}).`,
    };
  });
  return { ...result, issues, details, flags, checklist, passed: issues.length === 0 };
}

const shown = (value) => (value === true ? 'passed' : value === false ? 'failed' : value == null ? '—' : `"${value}"`);

// One line per correction for the case history, the summary and the IAS remark: AI value → corrected value, who, why.
function correctionText(c) {
  // Remove / put back a voucher: a person's decision, not an AI value.
  if (isVoucherMove(c.item || '')) return `${c.label}: by ${c.by} — ${c.reason}`;
  // A member Mark OK: the rules on IAS found it, not the AI — accepted, not "AI failed".
  if (c.item?.startsWith('member:')) return `${c.label}: marked OK by ${c.by} — ${c.reason}`;
  return `${c.label}: AI ${shown(c.aiValue)} → ${shown(c.corrected)} (corrected by ${c.by} — ${WRONG_STEP_LABELS[c.wrongStep]}: ${c.reason})`;
}

// Where the case is checked again: the member check when the corrected value is one it compares with IAS, or the case
// is still held there; the document check otherwise. { EMAIL, API } status pairs.
// A voucher's amount or type: the member balance check uses them (SYSTEM_5 member balance phase C), so from the member check.
const MEMBER_VOUCHER_ITEM = /^invoices\.(items\.\d+\.(subtotal|voucher_type|remove)|removed\.\d+\.restore)$/;

function recheckFrom(item, currentStatus) {
  // The balance dropped before the claim (BALANCE_REVIEW, SYSTEM_5 member balance phase D): its bypass goes back to claim
  // preparation — the documents are already in the IAS console, so nothing before it runs again.
  if (/BALANCE_REVIEW$/.test(currentStatus)) return { EMAIL: 'DOCUMENTS_UPLOADED', API: 'API_READY_FOR_CLAIM_PREPARATION', label: 'claim preparation' };
  const member = MEMBER_CHECK_FIELDS.has(item) || MEMBER_VOUCHER_ITEM.test(item) || item.startsWith('member:') || /(MEMBER_REVIEW_REQUIRED|BENEFIT_REVIEW)$/.test(currentStatus);
  return member
    ? { EMAIL: 'RECOGNIZED', API: 'API_RECOGNIZED', label: 'the member check' }
    : { EMAIL: 'READY_FOR_DOCUMENT_CHECKING', API: 'API_READY_FOR_DOCUMENT_CHECKING', label: 'the document check' };
}

// After a person corrected items on a case, missing documents wait for that person — they send the request themselves
// ("Send the request to the customer"); a correction never emails the customer on its own. [] when nothing to hold.
function correctionHold(result, fields) {
  return !result.passed && (fields?.corrections || []).length && !askCovers(result, fields) ? ['a person corrected items on this case and sends the request'] : [];
}

// "Ask the customer" (SYSTEM_5 review actions 4.9, owner 2026-10-27): failed document lines that a reviewer decided must
// come from the customer, stored on the fields as askCustomer { codes, by, at } with the save. A new reading of the
// documents (the customer's upload) replaces the fields, so the decision lasts until then.
const failedCodes = (result) => [...new Set((result?.checklist || []).filter((l) => l.passed === false && l.code && l.code !== 'PERSON_REQUEST').map((l) => l.code))];
// The decision covers every failed line of this check: the request goes out with no person (no hold, whatever the switch).
function askCovers(result, fields) {
  const asked = new Set(fields?.askCustomer?.codes || []);
  return asked.size > 0 && !result.passed && failedCodes(result).every((code) => asked.has(code));
}
// A save with Ask the customer or new reviewer lines: the open reviewer lines go to the customer with the request, they
// do not hold the case for a person again (4.10).
const requestsReleased = (fields) => Boolean(fields?.askCustomer);

// A reviewer's reason for a correction or an override (SYSTEM_5 review actions, owner 2026-10-27): at least 10
// characters, so "ok" is refused. The console checks the same number.
const MIN_REASON_LENGTH = 10;
const REASON_TOO_SHORT = `Write a reason of at least ${MIN_REASON_LENGTH} characters.`;
const reasonLongEnough = (reason) => typeof reason === 'string' && reason.trim().length >= MIN_REASON_LENGTH;

module.exports = { isVoucherMove, VOUCHER_REMOVE, voucherText, mandatoryItem, failedCodes, askCovers, requestsReleased, MIN_REASON_LENGTH, REASON_TOO_SHORT, reasonLongEnough, NOT_VERDICT_ITEMS, WRONG_STEP_LABELS, EXCEPTION_STEPS, recheckFrom, correctionHold, correctionOptions, validateCorrection, aiOriginal, applyCorrection, applyVerdicts, correctionText };
