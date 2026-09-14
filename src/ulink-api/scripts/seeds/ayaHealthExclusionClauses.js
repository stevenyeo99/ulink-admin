// Hand-transcribed from docs/imp/demo/20260914/samples/
// "AYA SOMPO_AYA Health_Policy Wording_English.pdf" (12 pages, Section 6 "General
// Exclusions" + per-section "Specific Exclusions") — transcribed once carefully rather than
// auto-parsed from pdftotext layout output, since this is legal-adjacent text where a
// mis-parsed clause is worse than a slow one. route_key matches ulink_claim_routes'
// 'ayas_member_claim' (the only enabled route as of this writing — see
// db/migrations/20260822090000-add-claim-recognition.js).
//
// Clause text is condensed to the operative content, not the full legal boilerplate
// numbering/sub-lettering — the embedding only needs the substance for retrieval, and
// judge.js re-reads the full text of whichever candidates it's given, so nothing here is
// silently dropped from the actual judgment, only from what gets embedded/stored.

const ROUTE_KEY = 'ayas_member_claim';

const GENERAL_EXCLUSIONS = [
  ['6.1', 'Any expense, Treatment, medical or dental condition or procedure not specifically stated in this Policy as being insured.'],
  ['6.2', 'Any sum in excess of the Policy Limits.'],
  ['6.3', 'Any expense which the Company or its Medical Advisor consider to be unreasonable, unnecessary or excessive.'],
  ['6.4', 'Costs which would have been incurred if the Insured Event had not occurred.'],
  ['6.5', 'Costs relating to Palliative Treatment.'],
  ['6.6', 'Costs incurred at the International SOS Clinic, Yangon, Myanmar or Bumrungrad International Hospital, Bangkok, Thailand.'],
  ['6.7', 'Any Co-share and/or the Deductible specified in the Table of Benefits.'],
  ['6.8', 'Any Claim involving fraud, misrepresentation or concealment or their consequences.'],
  ['6.9.1', 'Any Claim arising from self-inflicted Injury, including suicide or attempted suicide.'],
  ['6.9.2', 'Any Claim arising from needless self-exposure to peril, except in an attempt to save human life.'],
  ['6.9.3', 'Any Claim arising from criminal acts committed by the Policy Holder or Participant.'],
  ['6.9.4', 'Any Claim arising from travel undertaken against medical advice.'],
  ['6.10', 'Treatment for drug and substance abuse (including alcohol) or dependency or other addictive condition, and any illness or injury arising directly or indirectly therefrom.'],
  ['6.11', 'Contraception, sterilization (or its reversal), fertilization, vasectomy, venereal disease, sexually transmitted infections, gender reassignment, or any other sexual-related condition.'],
  ['6.12', 'Investigations and/or Treatment for infertility and any related condition or form of assisted reproduction.'],
  ['6.13', 'Chronic or end-stage kidney failure which has or will require regular or long-term dialysis.'],
  ['6.14', 'Any Treatment to relieve symptoms caused by ageing or any physiological cause.'],
  ['6.15', 'Costs for Treatment incurred outside the Geographical Area (Myanmar) unless otherwise stated in this Policy Wording.'],
  ['6.16', 'Claims arising from birth injuries or defects, hereditary conditions, or congenital illness or anomalies.'],
  ['6.17', 'Artificial heart implantation.'],
  ['6.18', 'Any costs arising after the expiry of the current Period of Insurance, unless the Policy has been renewed.'],
  ['6.19', 'Care or medical Treatment arising directly or indirectly from HIV or HIV-related illness (including AIDS/ARC) is capped at 7,500,000 MMK for the lifetime of each Participant, not excluded outright.'],
  ['6.20', 'Experimental and unproven medical Treatment or drug therapy and the consequences thereof.'],
  ['6.21', 'Drugs and other medicines purchased without a Physician’s prescription, and routine/preventative medicines, vaccinations, check-ups, and vitamin/mineral/nutritional supplements, unless included in the Table of Benefits.'],
  ['6.22', 'Cosmetic surgery or remedial surgery, removal of fat or other surplus body tissue, weight loss or weight problems/eating disorders (whether or not for psychological purposes), unless required as a direct result of an Accident or surgery for cancer during the Period of Insurance.'],
  ['6.23', 'Surgery to correct short or long sight or any other eye defect, unless caused by an Accident or Illness during the Period of Insurance.'],
  ['6.24', 'Investigation into or Treatment of sleep apnea, snoring, or other sleep-related breathing problems.'],
  ['6.25', 'Medical Treatment performed by a Medical Practitioner, Physician, or consultant who is related to the Participant, unless previously approved by the Company.'],
  ['6.26', 'Medical Treatment associated with cryopreservation, implantation, or re-implantation of living cells or living tissue, autologous or donor.'],
  ['6.27', 'Claims arising from participation in professional sport, or any hazardous sport/activity, including racing/time trial, horse riding, rock climbing/mountaineering, hang-gliding/paragliding/parachuting/bungee jumping, off-piste snow skiing/snowboarding, unsupervised/uncertified sub-aqua diving, aviation other than as a fare-paying passenger, hunting, or activity involving weapons or physical impact.'],
  ['6.28', 'A hazardous sport or activity not specified in the policy list requires prior confirmation from the Company before cover applies.'],
  ['6.29', 'Any Claim arising while the Participant is under military authority, or engaged in activities involving firearms/weapons/physical combat, or in an area of military conflict (except tourist trips on private basis during leave).'],
  ['6.30', 'Expenses relating to search and rescue operations in mountains, at sea, in the desert, in the jungle, or similar remote locations, including air/sea rescue/evacuation charges.'],
  ['6.31', 'Any expense where the Company is not satisfied with the documents submitted and/or original documents are not received within 60 days of the Insured Event, unless otherwise agreed.'],
  ['6.32', 'Accommodation and Treatment costs in a nursing home, hydro, spa, nature clinic, health farm, or similar establishment that has effectively become the Participant’s home, or where admission is arranged wholly/partly for domestic reasons.'],
  ['6.33', 'Rehabilitation unless it forms an integral part of medical Treatment received as an Inpatient, under the control/supervision of a specialist, in a recognized Rehabilitation unit.'],
  ['6.34', 'Medical Treatment for learning difficulties, hyperactivity, attention deficit disorder, speech therapy, behavioral problems, or child development.'],
  ['6.35', 'Medical Treatment for mental or nervous disorders, psychiatric Treatment, and costs of a psychotherapist, psychologist, family therapist, or bereavement counsellor.'],
  ['6.36', 'Any Claim caused or contributed to by the use, release, or threat of any nuclear weapon/device or chemical/biological agent.'],
  ['6.37', 'Any Claim resulting from war, invasion, act of foreign enemy, hostilities (declared or not), act of terrorism, civil war, rebellion, revolution, insurrection, military or usurped power, civil commotion, or riot.'],
  ['6.38', 'Any expense which is, or but for this Policy would be, covered by any other existing insurance certificate, policy, or state scheme.'],
  ['6.39', 'Any losses not directly specified as covered by this Policy (e.g. loss of earnings due to inability to work as a result of Illness or Injury).'],
  ['6.40', 'A person insured under more than one health insurance policy issued by the Company will be treated as insured under whichever policy provides the greatest benefit; the Company pays only its proportion when another policy covers the same loss.'],
  ['6.41', 'Any cover, claim payment, or benefit that would expose the Company to sanction, prohibition, or restriction under UN, EU, UK, US, or other applicable trade/economic sanctions laws.'],
];

const SPECIFIC_EXCLUSIONS = [
  ['1.4.a', 'Maternity: Terminations of pregnancy, other than miscarriage, ectopic pregnancy, and stillbirth.'],
  ['1.4.b', 'Maternity: Antenatal classes, midwifery costs when not directly associated with the delivery.'],
  ['1.4.c', 'Maternity: Complications arising during or as a result of a planned home birth delivery.'],
  ['1.4.d', 'Maternity: Transfer of a pregnant woman to Hospital for routine childbirth, unless the Medical Advisor considers it medically necessary.'],
  ['1.4.e', 'Maternity: Amniocentesis for women aged 35 and under, unless agreed in advance.'],
  ['1.5.a', 'Thailand Zone: Any costs (other than specified transportation costs) incurred outside Myanmar which are not for Treatment of a listed Thailand Zone procedure.'],
  ['2.4.a', 'Optical Care: Contact lenses and Plano lenses.'],
  ['2.4.b', 'Optical Care: Sunglasses of any kind, including non-prescribed frames and/or prescription sunglasses.'],
  ['3.a', 'Dental: Any claim for Periodontics, Orthodontics, or Dental Prosthesis.'],
  ['3.b', 'Dental: Dental care if the Participant had not undergone all necessary Treatment recommended by a Dental Practitioner prior to their Date of Entry.'],
  ['3.c', 'Dental: Dental procedures other than those specified, cost of precious metals, dentures, and dental implants.'],
  ['4.1', 'Personal Accident: Sickness or disease, bacterial or viral infections, even if contracted by Accident.'],
  ['4.2', 'Personal Accident: Riding a motorcycle as driver or passenger when not wearing a helmet.'],
  ['4.3', 'Personal Accident: Any injury arising more than 12 months after the Accident giving rise to the Bodily Injury.'],
];

module.exports = {
  routeKey: ROUTE_KEY,
  clauses: [...GENERAL_EXCLUSIONS, ...SPECIFIC_EXCLUSIONS].map(([clauseRef, clauseText]) => ({
    routeKey: ROUTE_KEY,
    clauseRef,
    clauseText,
  })),
};
