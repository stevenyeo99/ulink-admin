// The diagnosis code ULINK uses for some kinds of care, from the IAS benefit the claim goes in with (owner, 2026-10-29):
// dental, vision, vaccination, prenatal and delivery claims always get these codes, as the claims team codes them by
// hand. One code: set, the AI is not asked. Several (delivery: normal or caesarean): the AI picks only among them, with
// the rule's hint, and the case stops for a person when it is unsure. A person's own choice still wins (service.js).
// A new kind of care: one line here.

const { benefitUnsure } = require('./preparationReview');

const RULES = [
  { type: 'OP', head: 'VACC', codes: ['Z24'], label: 'Vaccination' },
  { type: 'IP', head: 'MAT', codes: ['Z34'], label: 'Maternity, prenatal' },
  {
    type: 'MAT', head: 'NDEL', codes: ['O80', 'O82'], label: 'Maternity, delivery',
    hint: 'O82 (caesarean) when the documents say caesarean, C-section, LSCS, operation or surgery, or the claim has an '
      + 'operation room (IP/OPR), surgeon (IP/SUR) or anesthetist (IP/ANES) voucher; O80 (normal) when they say normal, '
      + 'spontaneous, NVD or SVD delivery and show no operation. Neither clear: a low confidence, a person decides.',
  },
  { type: 'DT', codes: ['Z01.2'], label: 'Dental' },
  { type: 'VS', codes: ['Z46.0'], label: 'Vision' },
];

// The rule for one benefit: a rule with a head before a rule with the type alone (OP/VACC, not every OP).
const ruleFor = (benefit) => RULES.find((r) => r.type === benefit?.benefitType && (!r.head || r.head === benefit?.benefitHead)) || null;

// The claim's rule, from its voucher lines (claimPrepMeta.lines: { pick, confidence, candidates, chosen }). Only a decided
// benefit counts — the AI sure, a person's choice, or the member check's — so an unsure pick never sets a code. One
// matching voucher decides (a vaccine and a doctor's visit: Z24); vouchers matching different rules (dental and vision):
// none, the AI picks as for any claim.
function diagnosisRule(lines, threshold) {
  const rules = new Set(lines.filter((line) => line.pick && !benefitUnsure(line, threshold)).map((line) => ruleFor(line.pick)).filter(Boolean));
  return rules.size === 1 ? [...rules][0] : null;
}

module.exports = { RULES, ruleFor, diagnosisRule };
