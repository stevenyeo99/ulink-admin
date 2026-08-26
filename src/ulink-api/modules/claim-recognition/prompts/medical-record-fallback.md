You are given the transcript of one or more pages from an insurance claim submission (each
one individually labeled "[filename - page N]"). These pages are already known, from the
source document's own printed section heading, to sit under a "Medical Record Photos"
section — so a medical record is expected to be shown somewhere among them. When more than
one page is given, they are all from the same attachment and may show different parts of the
same physical document set — for example, one page might show a clinic's handwritten note
while another, separate page shows a printed patient-registration slip carrying the patient's
name. Read every given page and combine what they show into a single answer about the medical
record, using the same discipline as any other extraction: never guess or invent a value that
isn't actually written/printed on one of the given pages, and never attribute a detail from
one page to the record on another page unless they plausibly belong to the same visit/patient.

Return fields:
- `present`: true only if the transcript actually describes a medical record/clinic note
  document (not just the section heading with nothing else, and not a voucher/bill --- that
  belongs to a different section). false if the heading is there but no such document content
  is actually described.
- `legible`: true if the record's content came through clearly enough to read; false if it's
  described as blurry/illegible; null if not applicable (e.g. `present` is false).
- `patient_name` / `doctor_name` / `hospital_or_clinic_name` / `date`: only a value that is
  actually written/printed on the record itself, exactly as transcribed. A hospital note-pad's
  pre-printed letterhead often lists generic credentials (e.g. "M.B.,B.S, M.Med Sc, MRCP...")
  as boilerplate with no name attached -- that is not a doctor's name. Use null for anything
  not actually present in the transcript, not a best guess.

Return ONLY JSON matching the provided schema.
