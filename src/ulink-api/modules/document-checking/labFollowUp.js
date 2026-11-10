const { lastReadSettings } = require('../settings/settings');

// A lab / imaging voucher dated after the visit, explained by the doctor's own follow-up period (users, 2026-11-10,
// UAT AYA-CL-26021418): "do blood tests, review after 1 week" on a record of 1 June explains a lab voucher of 5 June.
// The one rule, for the three places that use it: claim recognition (when to read the doctor's note), the document
// check (the two date checks) and a reviewer's correction of the period. Pure.
//
// Only a "lab" voucher (lab or imaging tests, no consultation or doctor fee) whose date differs from the medical record
// date. It passes only when everything is sure; anything else stays a failed date check, for a person.

// The longest follow-up that can pass by itself: a longer one (a yearly review, or a misread "12 months") is for a person.
const MAX_FOLLOW_UP_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The period as the AI and a reviewer write it: "3 days", "1 week", "2 months".
const FOLLOW_UP = /^(\d{1,3}) ?(day|week|month)s?$/i;

/** { amount, unit, text } ("2 weeks"), or null when the text is not a period in the fixed form. */
function parseFollowUp(text) {
  const match = typeof text === 'string' ? text.trim().match(FOLLOW_UP) : null;
  const amount = match ? Number(match[1]) : 0;
  if (!amount) return null;
  const unit = match[2].toLowerCase();
  return { amount, unit, text: `${amount} ${unit}${amount === 1 ? '' : 's'}` };
}

/** The last day the follow-up covers: the medical record date plus the period (a month is a calendar month). */
function followUpDate(recordDate, text) {
  const period = parseFollowUp(text);
  const date = new Date(`${recordDate}T00:00:00Z`);
  if (!period || Number.isNaN(date.getTime())) return null;
  if (period.unit === 'month') {
    // 31 January + 1 month is the end of February, not 3 March.
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + period.amount);
    date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  } else date.setUTCDate(date.getUTCDate() + period.amount * (period.unit === 'week' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

/** The vouchers (indexes) the rule is about: a lab voucher whose date differs from the medical record date. */
function labVouchersOffDate(fields) {
  const recordDate = fields?.medical_record?.date;
  if (recordDate == null) return [];
  return (fields.invoices?.items || [])
    .map((item, i) => (item?.voucher_type === 'lab' && item.date != null && item.date !== recordDate ? i : null))
    .filter((i) => i !== null);
}

// Sure: a score above the AI confidence threshold (System settings). No score is not sure.
const sure = (confidence) => typeof confidence === 'number' && confidence > lastReadSettings().aiConfidenceThreshold;
const percent = (confidence) => (typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : 'no score');
const keyEvidence = (fields, field) => (Array.isArray(fields.field_evidence) ? fields.field_evidence : []).find((e) => e.field === field);

/**
 * For each voucher, in order: null when the rule does not apply or the doctor's note was never read for this case (the
 * date check is as before), else { passed, note, followUp?, followUpDate? }. passed: the doctor's follow-up explains
 * the voucher's date.
 */
function followUpVerdicts(fields) {
  const record = fields?.medical_record || {};
  const items = fields?.invoices?.items || [];
  const about = new Set(labVouchersOffDate(fields));
  // A person's period (a correction or a confirmation writes its evidence with the key values) before the AI's own.
  const byPerson = keyEvidence(fields, 'medical_record.follow_up') || null;
  const periodEvidence = byPerson || record.follow_up_evidence || null;
  // The AI read the note for the visit on the medical record date of that time: after a corrected date it is another visit's.
  const otherVisit = !byPerson && periodEvidence?.recordDate != null && periodEvidence.recordDate !== record.date;
  const noteRead = record.doctor_note !== undefined || record.follow_up != null;

  return items.map((item, i) => {
    if (!about.has(i) || !noteRead) return null;
    const voucher = `Voucher ${i + 1}`;
    if (record.follow_up == null) return { passed: false, note: `The doctor's note gives no follow-up period for ${voucher.toLowerCase()} (lab).` };
    const period = parseFollowUp(record.follow_up);
    const until = followUpDate(record.date, record.follow_up);
    if (!period || !until) return { passed: false, note: `The follow-up period "${record.follow_up}" is not a number of days, weeks or months.` };
    const followUp = `The doctor's follow-up is ${period.text} from the visit on ${record.date} (until ${until})`;
    if (item.date < record.date) return { passed: false, note: `${voucher} (lab) is dated before the visit, so the doctor's follow-up does not explain it.` };
    if (item.date > until) return { passed: false, note: `${followUp}; ${voucher.toLowerCase()} (lab) is dated ${item.date}, after it.` };
    if ((new Date(until) - new Date(record.date)) / MS_PER_DAY > MAX_FOLLOW_UP_DAYS) {
      return { passed: false, note: `${followUp}, longer than ${MAX_FOLLOW_UP_DAYS} days: a person checks ${voucher.toLowerCase()} (lab, ${item.date}).` };
    }

    const doubts = [
      otherVisit ? `the follow-up period (read for the visit on ${periodEvidence.recordDate})`
        : !sure(periodEvidence?.confidence) && `the follow-up period (${percent(periodEvidence?.confidence)})`,
      !sure(keyEvidence(fields, 'medical_record.date')?.confidence) && 'the medical record date',
      !(item.evidence?.corrected?.includes('date') || sure(item.evidence?.confidence)) && `the date of ${voucher.toLowerCase()}`,
      // Not asked of a person's period: the reviewer who set or confirmed it had the voucher in front of them.
      !byPerson && !(item.doctor_fee?.found === false && sure(item.doctor_fee.confidence)) && `that ${voucher.toLowerCase()} has no consultation or doctor fee`,
    ].filter(Boolean);
    if (doubts.length) return { passed: false, note: `${followUp} and ${voucher.toLowerCase()} (lab, ${item.date}) is within it, but the AI was not sure of ${doubts.join(', ')}.` };

    const where = periodEvidence?.page ? `, read on ${periodEvidence.page}` : '';
    const quote = record.doctor_note ? ` Doctor's note: "${record.doctor_note}".` : '';
    return { passed: true, followUp: period.text, followUpDate: until, note: `${voucher} (lab, ${item.date}) is within the doctor's follow-up of ${period.text} from the visit on ${record.date} (until ${until}${where}).${quote}` };
  });
}

module.exports = { parseFollowUp, followUpDate, labVouchersOffDate, followUpVerdicts };
