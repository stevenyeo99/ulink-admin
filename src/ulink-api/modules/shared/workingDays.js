// Working days a case has waited (SYSTEM_4 E4-19 / E6: the overdue badge). Monday–Friday, counted on Myanmar calendar
// days (the day boundary IAS uses): each weekday after the day it started waiting, up to today.
// ponytail: no public holidays — add a holiday list (STP settings) if ULINK's ageing limit needs them (Q20).

const dayIn = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon' }).format(date); // YYYY-MM-DD
const DAY_MS = 24 * 60 * 60 * 1000;

// null when `since` is not a date (nothing to count — never overdue).
function workingDaysSince(since, now = new Date()) {
  if (since == null || Number.isNaN(new Date(since).getTime())) return null;
  const start = new Date(`${dayIn(new Date(since))}T12:00:00Z`);
  const days = Math.round((new Date(`${dayIn(now)}T12:00:00Z`) - start) / DAY_MS);
  if (days <= 0) return 0;
  // Whole weeks have 5 weekdays each; the remaining 0–6 days are counted one by one.
  let count = Math.floor(days / 7) * 5;
  for (let i = 1; i <= days % 7; i += 1) {
    const weekday = (start.getUTCDay() + i) % 7;
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

module.exports = { workingDaysSince };
