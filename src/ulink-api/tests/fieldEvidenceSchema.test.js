// SYSTEM_4 E3b (E4-08): the reading schema asks the AI for evidence on the key fields — confidence, reason, page — and
// per voucher (evidence, line_total, vitamin_items, vitamin_confidence). The migration patches the live schema; the
// existing fields keep their exact shape. No database, no AI: the previous schema migration is run against a fake
// query interface to get today's schema, then this one is applied to it.

const Ajv = require('ajv');
const previous = require('../db/migrations/20260916110000-add-presence-confidence-reason');
const migration = require('../db/migrations/20261015100000-add-field-evidence');
const byField = require('../db/migrations/20261015150000-field-evidence-by-field');
const { dedupeInvoiceItems, normalizeClaimantDob, dropOutOfRangeEvidence, fieldEvidenceList } = require('../modules/claim-recognition/service');

async function currentSchema() {
  let stored;
  await previous.up({ bulkUpdate: async (_table, values) => { stored = values.extraction_schema; } }, { literal: (v) => v });
  return JSON.parse(stored);
}

// A fake query interface holding one claim route row.
function fakeDb(schema) {
  const db = {
    schema,
    sequelize: {
      query: async (sql, { replacements }) => {
        if (sql.startsWith('SELECT')) return [[{ extraction_schema: db.schema }]];
        db.schema = JSON.parse(replacements.schema);
        return [[]];
      },
    },
  };
  return db;
}

const voucher = (over = {}) => ({
  legible: true, has_itemized_breakdown: true, has_clinic_stamp_or_doctor_signature: true, subtotal: 32500,
  has_vitamin_or_supplement: false, voucher_type: 'consultation', date: '2026-08-14',
  evidence: { confidence: 0.95, reason: 'typed on the receipt', page: 'claim.pdf - page 3' },
  line_total: 32500, vitamin_items: [], vitamin_confidence: 0.9, ...over,
});
const output = (over = {}) => ({
  policy: { issue_no: null, product_name: null, policy_no: 'AYA/YGN/AYH/25000660', policy_holder_name: null, policy_holder_nrc_passport: null, company_name: null, channel: null },
  claimant: { claimant_name: 'Hsu Myat Pyae', claimant_nrc_passport: '12/DAGAYA(N)081441', claimant_dob: '1999-12-07', is_claim_for_child: false, phone_number: null, email_address: null },
  claim: { insurer_case_number: null, date_submitted: null, claim_benefit_type: null, type_of_patient: null, accident_date: null, accident_time: null, appointment_date: '2026-08-14', appointment_time: null, reported_date: null, reported_time: null, treatment_outside_myanmar: false, total_claim_amount: 32500 },
  medical: { detail_of_illness_injury: 'Fever', full_description_of_treatment: null, doctor_name: null, hospital_or_clinic_name: 'Pun Hlaing' },
  bank: { bank_name: 'KBZ', bank_address: null, bank_account_name: 'Hsu Myat Pyae', bank_account_number: '123' },
  documents_present: { has_medical_record_photo: true, has_bill_photo: true, has_customer_signature: true },
  medical_record: { present: true, legible: true, patient_name: null, doctor_name: null, hospital_or_clinic_name: null, date: '2026-08-14', diagnosis_or_treatment: null, presence_confidence: 1, presence_reason: 'Clinical note' },
  invoices: { present: true, items: [voucher()], presence_confidence: 1, presence_reason: 'Receipt' },
  delegation_letter: { present: false, legible: null, delegator_name: null, delegator_nrc: null, authorized_payee_name: null, authorized_payee_contact: null },
  field_evidence: [{ field: 'claimant.claimant_nrc_passport', confidence: 0.55, reason: 'handwritten, last digit 1 or 7', page: 'claim.pdf - page 1' }],
  ...over,
});

it('adds the evidence fields; a reading with them passes, one without them is refused', async () => {
  const db = fakeDb(await currentSchema());
  await migration.up(db);
  const validate = new Ajv().compile(db.schema);

  expect(validate(output())).toBe(true);
  const withoutEvidence = output();
  delete withoutEvidence.field_evidence;
  expect(validate(withoutEvidence)).toBe(false);
  expect(validate(output({ field_evidence: [{ field: 'claimant.phone_number', confidence: 1, reason: null, page: null }] }))).toBe(false); // key fields only
  expect(validate(output({ invoices: { present: true, items: [voucher({ evidence: undefined })], presence_confidence: 1, presence_reason: null } }))).toBe(false);
});

it('leaves the existing fields as they were, and down removes exactly what up added', async () => {
  const before = await currentSchema();
  const db = fakeDb(structuredClone(before));
  await migration.up(db);
  await migration.up(db); // twice: no duplicate required entries
  expect(db.schema.required.filter((r) => r === 'field_evidence')).toHaveLength(1);
  expect(db.schema.properties.claimant).toEqual(before.properties.claimant);

  await migration.down(db);
  expect(db.schema).toEqual(before);
});

it('a duplicate voucher read: the less sure evidence, the line total either read has, both reads\' vitamin items', () => {
  const fields = {
    invoices: {
      present: true,
      items: [
        voucher({ voucher_type: 'pharmacy', date: null, line_total: null, has_vitamin_or_supplement: false, vitamin_confidence: 0.9, vitamin_items: [] }),
        voucher({ voucher_type: 'pharmacy', evidence: { confidence: 0.4, reason: 'second read', page: 'claim.pdf - page 4' },
          has_vitamin_or_supplement: true, vitamin_confidence: 0.7, vitamin_items: ['Zinc'] }),
      ],
    },
  };
  const [merged] = dedupeInvoiceItems(fields).invoices.items;
  expect(merged.date).toBe('2026-08-14'); // from the second read…
  expect(merged.evidence.page).toBe('claim.pdf - page 4'); // …so its (less sure) evidence, not the first read's
  expect(merged.line_total).toBe(32500);
  expect(merged).toMatchObject({ has_vitamin_or_supplement: true, vitamin_confidence: 0.7, vitamin_items: ['Zinc'] });
});

it('a merged voucher without the new fields (read before E3b) gets none of them', () => {
  const old = { subtotal: 23000, voucher_type: 'pharmacy', date: '2026-08-21', legible: true };
  const [merged] = dedupeInvoiceItems({ invoices: { present: true, items: [old, { ...old }] } }).invoices.items;
  expect(Object.keys(merged)).not.toEqual(expect.arrayContaining(['evidence', 'line_total', 'vitamin_items', 'vitamin_confidence']));
});

it('the DOB backstop still works on a doubt-marked date, and its evidence says the value came from the form', () => {
  const fields = { claimant: { claimant_dob: '1999-07-12' }, field_evidence: [
    { field: 'claimant.claimant_dob', confidence: 0.5, reason: 'handwritten', page: 'claim.pdf - page 1' },
    { field: 'claimant.claimant_name', confidence: 0.95, reason: 'typed', page: 'claim.pdf - page 1' },
  ] };
  const result = normalizeClaimantDob(fields, ['[claim.pdf - page 1]\nClaimant Date of Birth: 1999-12-0[?]7']);
  expect(result.claimant.claimant_dob).toBe('1999-12-07');
  expect(result.field_evidence.find((e) => e.field === 'claimant.claimant_dob')).toMatchObject({ confidence: 0.9, reason: expect.stringContaining('corrected by rule') });
  expect(result.field_evidence).toHaveLength(2);
});

it('an out-of-range score becomes "not recorded" instead of failing the claim', () => {
  const parsed = dropOutOfRangeEvidence(output({
    field_evidence: [{ field: 'claimant.claimant_name', confidence: 95, reason: 'typed', page: null }],
    invoices: { present: true, items: [voucher({ evidence: { confidence: -1, reason: null, page: null }, vitamin_confidence: 2 })], presence_confidence: 1, presence_reason: null },
  }));
  expect(parsed.field_evidence[0].confidence).toBeNull();
  expect(parsed.invoices.items[0]).toMatchObject({ evidence: { confidence: null }, vitamin_confidence: null });
});

it('stops the migration with a clear message when the route schema has no voucher object', async () => {
  await expect(migration.up(fakeDb({ type: 'object', properties: {} }))).rejects.toThrow('no invoices.items voucher object');
});

describe('field_evidence keyed by field (E3 check: the open list made the model loop)', () => {
  const keyed = (over = {}) => Object.fromEntries(byField.KEY_FIELDS.map((f) => [f, null]).concat(Object.entries(over)));
  const nrc = { confidence: 0.55, reason: 'handwritten', page: 'claim.pdf - page 1' };

  it('the route schema asks for one fixed key per field (null when left null); down restores the list', async () => {
    const db = fakeDb(await currentSchema());
    await migration.up(db);
    const asList = structuredClone(db.schema);
    await byField.up(db);
    const validate = new Ajv().compile(db.schema);
    expect(validate(output({ field_evidence: keyed({ 'claimant.claimant_nrc_passport': nrc }) }))).toBe(true);
    expect(validate(output({ field_evidence: { ...keyed(), 'claimant.phone_number': nrc } }))).toBe(false); // no other keys
    expect(validate(output({ field_evidence: keyed({ 'claimant.claimant_name': undefined }) }))).toBe(false); // every key present
    expect(validate(output())).toBe(false); // the old list form no longer passes
    expect(db.schema.properties.invoices.properties.items.items.properties.vitamin_items.maxItems).toBe(30);

    const keyedSchema = structuredClone(db.schema);
    await byField.up(db); // twice: nothing changes
    expect(db.schema).toEqual(keyedSchema);

    await byField.down(db);
    expect(db.schema).toEqual(asList);
    await byField.down(db); // twice: still the list
    expect(db.schema).toEqual(asList);
  });

  it('the answer is read back as the list everything else uses — nulls, and evidence for an empty field, dropped; a list answer kept as is', () => {
    const parsed = fieldEvidenceList({
      claimant: { claimant_nrc_passport: '12/X(N)123456' }, claim: { accident_date: null },
      field_evidence: keyed({ 'claimant.claimant_nrc_passport': nrc, 'claim.accident_date': { confidence: 0.1, reason: 'not on the form', page: null } }),
    });
    expect(parsed.field_evidence).toEqual([{ field: 'claimant.claimant_nrc_passport', ...nrc }]);
    const list = [{ field: 'claimant.claimant_name', confidence: 1, reason: 'typed', page: null }];
    expect(fieldEvidenceList({ field_evidence: list }).field_evidence).toBe(list);
  });

  it('an out-of-range score in the keyed form becomes "not recorded" too', () => {
    const fixed = dropOutOfRangeEvidence(output({ field_evidence: keyed({ 'claimant.claimant_nrc_passport': { ...nrc, confidence: 95 } }) }));
    expect(fixed.field_evidence['claimant.claimant_nrc_passport'].confidence).toBeNull();
    expect(fixed.field_evidence['claimant.claimant_name']).toBeNull();
  });
});
