You are given the page transcripts of one insurance claim (each page labeled "[filename - page N]"), the date of the claim's medical record, and one or more lab / imaging vouchers whose date is different from that date.

A doctor often orders tests at the visit and the patient has them done some days later. Your job is to report what the doctor wrote about that on the medical record, and to look at each listed voucher. You only report what is written. You never work out or compare dates: code does that.

Read the medical record of the visit on the given medical record date: the doctor's consultation note, prescription or recommendation for that visit. A medical book often has older pages from other visits, with other dates. Never take the note from another visit.

Return fields:
- `doctor_note`: the doctor's own words on that visit's record that order or recommend tests, a follow-up or a review, copied as written, in the language they are written in (keep Burmese as Burmese), at most about 200 characters. Examples: "Ix: CBC, CXR. Review after 1 week", "Plan: fasting lipid profile, HbA1c". Null when the record has no such note, or you cannot read it. Never copy it from the claim form, a voucher or a lab result.
- `follow_up_reason`: one short phrase: the exact words the period comes from and what they mean in English, or why there is none. Example: "'နောက်တစ်ပတ်' = next week".
- `follow_up`: the follow-up period the doctor states on that visit's record: when to come back, to be reviewed, or to do or repeat the tests. Write it only as a number and a unit: `3 days`, `1 week`, `2 months`. Null when the doctor states no period. A period only: never a date, never a range, never your own estimate, and never the number of days a medicine is taken for ("x 5 days" on a prescription line is a dosage, not a follow-up).
  - Burmese: ရက် = day, ပတ် (or အပတ်) = week, လ = month. Burmese digits ၀ ၁ ၂ ၃ ၄ ၅ ၆ ၇ ၈ ၉ = 0 to 9. "နောက်တစ်ပတ်" (next week) = `1 week`; "၂ ပတ်ကြာ" or "၂ ပတ်အကြာ" (after 2 weeks) = `2 weeks`; "နောက်နေ့" or "မနက်ဖြန်" (next day, tomorrow) = `1 day`; "နောက်လ" (next month) = `1 month`.
  - English shorthand: "1/52" = `1 week`, "2/52" = `2 weeks`, "1/12" = `1 month`, "3/7" = `3 days`; "f/u 1 wk", "R/V 2 weeks", "TCA 1 month" are follow-up periods.
- `follow_up_confidence`: 0.0-1.0, how sure you are that `follow_up` is what the doctor wrote for that visit. High only for clearly printed or typed text, or clear handwriting. Low for handwriting you had to guess at, a transcript that marks the words `unclear` or `[?]`, Burmese handwriting you are not sure of, or a period you are not sure belongs to that visit. Null when `follow_up` is null.
- `follow_up_page`: the transcript label of the page the period was read from, copied exactly (e.g. `claim.pdf - page 7`). Null when `follow_up` is null.
- `vouchers`: one entry for each voucher listed in the input, with the same `voucher` number.
  - `has_consultation_or_doctor_fee`: true if that voucher charges for seeing a doctor: a consultation fee, doctor fee, specialist fee, professional fee or medical service fee, as its own line or inside a total. false if the voucher lists only lab tests, imaging (X-ray, ultrasound, CT, MRI, ECG) and their own service charges. null if you cannot tell (for example, the voucher cannot be read).
  - `confidence`: 0.0-1.0, how sure you are of that answer.
