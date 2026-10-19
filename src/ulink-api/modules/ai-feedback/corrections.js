// Per-item correction (SYSTEM_4 E4-12): a reviewer fixes one value the AI read (NRC, a date, an amount, …) or one
// check's verdict, and the case is checked again with it. Pure — no I/O; the controller stores the correction
// (ulink_ai_feedback, the learning record) and writes the corrected fields.
//
// What the flow uses lives in the case's own fields, so every job reads it unchanged (member check, document check,
// claim preparation — email and API): a corrected value is written into extractedFields; every correction is listed in
// extractedFields.corrections, newest per item kept. Verdicts are applied by the document check (applyVerdicts).
// The AI's own value is kept in the correction (aiValue) — and, for API cases, in the earlier recognition step.

const { ISSUES, FIELD_LABELS, isRealDate, valueAt } = require('../document-checking/checklist');

const WRONG_STEP_LABELS = {
  reading: 'the page was misread',
  mapping: 'read right but put in the wrong field',
  check: "the check's decision was wrong",
};

// Checklist lines a person may set pass / fail. Not: mandatory fields (correct the value instead), and the lines that
// only report on the values read (format, evidence) or vitamins (a person approves those claims anyway).
// PERSON_REQUEST: a reviewer's own lines (SYSTEM_4 E4-28) — closed by Confirm and continue, never by a correction.
// DOCUMENT_LIST / BENEFIT_TYPE / DOCUMENT_DATES: information only (documents found, the benefit type they show, whether
// the medical ones are dated), nothing to pass or fail.
const NOT_VERDICT_ITEMS = new Set(['MISSING_MANDATORY_FIELD', 'VALUE_FORMAT', 'FIELDS_READ', 'VITAMIN_OR_SUPPLEMENT', 'PERSON_REQUEST', 'DOCUMENT_LIST', 'BENEFIT_TYPE', 'DOCUMENT_DATES']);

const AMOUNT_FIELDS = new Set(['claim.total_claim_amount']);
// What the member check compares with IAS (member-verification): a correction of one of these is checked again from
// the member check; anything else from the document check, so a person's member override stays in force.
const MEMBER_CHECK_FIELDS = new Set([
  'claimant.claimant_name', 'claimant.claimant_nrc_passport', 'claimant.claimant_dob', 'policy.policy_no',
  'claim.appointment_date', 'claim.accident_date', 'bank.bank_name', 'bank.bank_account_name', 'bank.bank_account_number',
]);
const DATE_FIELDS = new Set(['claimant.claimant_dob', 'claim.appointment_date', 'claim.accident_date', 'medical_record.date']);
const VOUCHER_ITEM = /^invoices\.items\.(\d+)\.(subtotal|date)$/;

// Sets a value in place (on a copy the caller made).
function setAt(fields, path, value) {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((o, key) => (o[key] ??= {}), fields);
  parent[keys.at(-1)] = value;
}

const priorCorrection = (fields, item) => (fields.corrections || []).find((c) => c.item === item) || null;

/**
 * What a person can correct on this case: the key values (whether or not the AI read them), each voucher's amount
 * and date, and the checklist lines with a verdict. { kind, item, label, type: text|date|amount|verdict, current,
 * canFail? }. current: the value / verdict in force now (corrected or the AI's).
 */
function correctionOptions(fields = {}, documentCheckResult = null) {
  const values = Object.entries(FIELD_LABELS).map(([item, label]) => ({
    kind: 'value', item, label,
    type: AMOUNT_FIELDS.has(item) ? 'amount' : DATE_FIELDS.has(item) ? 'date' : 'text',
    current: valueAt(fields, item) ?? null,
  }));
  const vouchers = (fields.invoices?.items || []).flatMap((voucher, i) => [
    // A voucher amount may be zero or negative: a refund / cash-return slip (claim-recognition keeps those).
    { kind: 'value', item: `invoices.items.${i}.subtotal`, label: `Voucher ${i + 1} amount`, type: 'amount', current: voucher.subtotal ?? null, signed: true },
    { kind: 'value', item: `invoices.items.${i}.date`, label: `Voucher ${i + 1} date`, type: 'date', current: voucher.date ?? null },
  ]);
  const verdicts = (documentCheckResult?.checklist || [])
    .filter((line) => line.code && !NOT_VERDICT_ITEMS.has(line.code) && typeof line.passed === 'boolean')
    .map((line) => ({ kind: 'verdict', item: line.code, label: line.label, type: 'verdict', current: line.passed, canFail: Boolean(ISSUES[line.code]) }));
  return [...values, ...vouchers, ...verdicts];
}

/**
 * Checks a correction request against the options. Returns { error } or { option, corrected } (the value or verdict).
 * body: { kind, item, value?, passed?, reason, wrongStep }.
 */
function validateCorrection(body, options) {
  const option = options.find((o) => o.kind === body?.kind && o.item === body?.item);
  if (!option) return { error: 'Pick a value or check that can be corrected on this case.' };
  if (!WRONG_STEP_LABELS[body.wrongStep]) return { error: `Say what went wrong: ${Object.keys(WRONG_STEP_LABELS).join(', ')}.` };
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3) return { error: 'Add a comment: why the AI was wrong.' };

  if (option.kind === 'verdict') {
    if (typeof body.passed !== 'boolean') return { error: 'Say whether the check passes or fails.' };
    if (body.passed === option.current) return { error: `The check already ${option.current ? 'passes' : 'fails'}.` };
    if (!body.passed && !option.canFail) return { error: 'This check has no customer wording for a failure; it can only be marked passed.' };
    return { option, corrected: body.passed };
  }
  let value = body.value;
  if (option.type === 'amount') {
    value = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${option.label}: enter an amount.` };
    if (!option.signed && value <= 0) return { error: `${option.label}: enter an amount above zero.` };
  } else if (option.type === 'date') {
    if (!isRealDate(value)) return { error: `${option.label}: enter a date as YYYY-MM-DD.` };
  } else {
    value = typeof value === 'string' ? value.trim() : '';
    if (!value || value.length > 200) return { error: `${option.label}: enter the value (up to 200 characters).` };
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
  if (option.kind === 'verdict') {
    const line = (documentCheckResult?.checklist || []).find((l) => l.code === option.item);
    return { aiValue: line?.passed ?? null, aiConfidence: line?.confidence ?? null, page: null };
  }
  const voucher = option.item.match(VOUCHER_ITEM);
  const evidence = voucher
    ? fields.invoices?.items?.[Number(voucher[1])]?.evidence
    : (fields.field_evidence || []).find((e) => e.field === option.item);
  return { aiValue: option.current, aiConfidence: evidence?.confidence ?? null, page: evidence?.page ?? null };
}

/**
 * The case's fields with the correction in force. correction: { id, kind, item, label, aiValue, aiConfidence,
 * corrected, reason, wrongStep, page, by, at }. A value is written in, and its evidence says a person set it.
 */
function applyCorrection(fields, correction) {
  const next = structuredClone(fields);
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
    } else {
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
    const verdict = verdicts.find((v) => v.item === line.code);
    if (!verdict) return line;
    if (verdict.corrected) {
      // Only this line's issue goes: customer wording another line still raises stays (e.g. the delegation letter).
      const own = new Set([ISSUES[line.code], ...details.filter((d) => d.code === line.code).map((d) => d.issue)].filter(Boolean));
      details = details.filter((d) => d.code !== line.code && !(d.code == null && d.issue === ISSUES[line.code]));
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
      note: `${verdict.corrected ? 'Passed' : 'Failed'} — corrected by ${verdict.by}: ${verdict.reason} (the AI said ${verdict.aiValue ? 'passed' : 'failed'}).`,
    };
  });
  return { ...result, issues, details, flags, checklist, passed: issues.length === 0 };
}

const shown = (value) => (value === true ? 'passed' : value === false ? 'failed' : value == null ? '—' : `"${value}"`);

// One line per correction for the case history, the summary and the IAS remark: AI value → corrected value, who, why.
function correctionText(c) {
  return `${c.label}: AI ${shown(c.aiValue)} → ${shown(c.corrected)} (corrected by ${c.by} — ${WRONG_STEP_LABELS[c.wrongStep]}: ${c.reason})`;
}

// Where the case is checked again: the member check when the corrected value is one it compares with IAS, or the case
// is still held there; the document check otherwise. { EMAIL, API } status pairs.
function recheckFrom(item, currentStatus) {
  const member = MEMBER_CHECK_FIELDS.has(item) || /MEMBER_REVIEW_REQUIRED$/.test(currentStatus);
  return member
    ? { EMAIL: 'RECOGNIZED', API: 'API_RECOGNIZED', label: 'the member check' }
    : { EMAIL: 'READY_FOR_DOCUMENT_CHECKING', API: 'API_READY_FOR_DOCUMENT_CHECKING', label: 'the document check' };
}

// After a person corrected items on a case, missing documents wait for that person — they send the request themselves
// ("Send the request to the customer"); a correction never emails the customer on its own. [] when nothing to hold.
function correctionHold(result, fields) {
  return !result.passed && (fields?.corrections || []).length ? ['a person corrected items on this case and sends the request'] : [];
}

module.exports = { WRONG_STEP_LABELS, recheckFrom, correctionHold, correctionOptions, validateCorrection, aiOriginal, applyCorrection, applyVerdicts, correctionText };
