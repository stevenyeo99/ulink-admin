// SYSTEM_5 member exclusion, phase A: the request, the events that count, the claim facts, and the AI judge (faked) on
// the three IAS sample events (docs/imp/CR/SYSTEM_5/PRD/MEMBER_EXCLUSION_PRD.md 4.8).
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { eventsRequest, readEvents, claimFacts, isoDate } = require('../modules/member-verification/exclusions');
const { judgeExclusionEvents } = require('../modules/member-verification/exclusionJudge');

const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/imp/day1/IAS/ias_get_member_information_response_v2.json'), 'utf8'));
// The three IAS samples, all member events (owner, 2026-10-26).
const SAMPLES = {
  conditions: '"1. ASTHMA for 1st yr\n2. Any symptom related to GERD\n3. DRT testing"',
  terminated: 'Policy Terminated or expired in the system. No further claims to be accepted , 18th NOV',
  territory: '1. The diagnosis and claim can only be accepted from India, Malaysia, and Thailand.,2. The policy will be canceled once the insured decides to leave Myanmar permanently or if their visa is no longer valid.,3. If the life assured remains outside of Myanmar for a period of more than one hundred eighty-five (185) consecutive days, then the policy will be terminated.',
};
const response = { success: true, payload: {
  memberEvents: [
    { eventId: '1', eventDate: '2025-08-01', eventDescription: SAMPLES.conditions },
    { eventId: '2', eventDate: '2025-11-18', eventDescription: SAMPLES.terminated },
    { eventId: '3', eventDate: null, eventDescription: SAMPLES.territory },
    { eventId: '4', eventDate: '2026-12-01', eventDescription: 'Added after the treatment' },
  ],
  policyEvents: [{ eventId: '1', eventDate: '2025-01-01', eventDescription: null }],
} };

beforeEach(() => jest.clearAllMocks());

it('builds the request from the member answer: numbers first, reference numbers as the fallback, date YYYY-MM-DD', () => {
  expect(isoDate('08012025')).toBe('2025-08-01');
  expect(eventsRequest(info)).toEqual({ policyNo: '00071600000001', memberNo: '098562100', policyEffDate: '2025-08-01' });
  const refsOnly = { payload: { member: { MBR_REF_NO: 'M1' }, policies: [{ POCY_REF_NO: 'P1', EFF_DATE: '09012025' }] } };
  expect(eventsRequest(refsOnly)).toEqual({ policyRefNo: 'P1', memberRefNo: 'M1', policyEffDate: '2025-09-01' });
  expect(eventsRequest({ payload: { member: {}, policies: [] } })).toBeNull();
});

it('reads both lists with their level; counts events on or before the treatment date, or with no date', () => {
  const events = readEvents(response, '2026-10-01');
  expect(events.map((e) => [e.level, e.eventId, e.counted, e.judgeable])).toEqual([
    ['Member', '1', true, true],
    ['Member', '2', true, true],
    ['Member', '3', true, true], // no date: counts
    ['Member', '4', false, false], // added after the treatment
    ['Policy', '1', true, false], // no description: listed, not judged
  ]);
});

it('gives the AI what the claim is for — the fields read — and no dates (no date reasoning on the free text)', () => {
  const fields = { claim: { appointment_date: '2026-10-01', treatment_outside_myanmar: false }, medical: { detail_of_illness_injury: 'acid reflux' }, invoices: { items: [{ subtotal: 30000, voucher_type: 'pharmacy' }] } };
  expect(claimFacts(fields, null)).toEqual({
    diagnosis: 'acid reflux', treatment: null, vouchers: [{ voucher: 1, type: 'pharmacy', amount: 30000 }], treatmentOutsideMyanmar: false,
  });
});

it('judges the counted events in one AI call and marks a likely match or an unsure answer as a match', async () => {
  synthesizeJson.mockResolvedValue({ results: [
    { eventId: 'Member:1', applies: true, confidence: 0.92, reason: 'Rule 2 excludes GERD symptoms; the claim is for acid reflux.' },
    { eventId: 'Member:2', applies: false, confidence: 0.6, reason: 'Not sure.' },
    { eventId: 'Member:3', applies: false, confidence: 0.9, reason: 'Treatment inside Myanmar.' },
  ] });
  const events = readEvents(response, '2026-10-01');
  const judged = await judgeExclusionEvents({ diagnosis: 'acid reflux' }, events, 0.7);
  expect(synthesizeJson).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(synthesizeJson.mock.calls[0][0].userText);
  expect(sent.events.map((e) => [e.id, e.level])).toEqual([['Member:1', 'Member'], ['Member:2', 'Member'], ['Member:3', 'Member']]);
  expect(sent.events[0]).not.toHaveProperty('date'); // meaning only
  expect(judged.filter((e) => e.judgeable).map((e) => [e.eventId, e.match, e.unsure])).toEqual([['1', true, false], ['2', true, true], ['3', false, false]]);
  expect(judged.find((e) => e.eventId === '4')).not.toHaveProperty('match'); // not counted, not judged
});

it('an event the AI did not answer is unsure; no event to judge: no AI call', async () => {
  synthesizeJson.mockResolvedValue({ results: [] });
  const judged = await judgeExclusionEvents({}, readEvents(response, '2026-10-01'), 0.7);
  expect(judged.find((e) => e.eventId === '1')).toMatchObject({ unsure: true, match: true });
  synthesizeJson.mockClear();
  await judgeExclusionEvents({}, readEvents({ success: true, payload: { memberEvents: [], policyEvents: [] } }, '2026-10-01'), 0.7);
  expect(synthesizeJson).not.toHaveBeenCalled();
});

it('the prompt carries the three kinds of rule from the IAS samples', () => {
  const { PROMPT } = require('../modules/member-verification/exclusionJudge');
  expect(PROMPT).toContain('ASTHMA for 1st yr');
  expect(PROMPT).toContain('No further claims to be accepted, 18th NOV');
  expect(PROMPT).toContain('India, Malaysia, and Thailand');
  expect(PROMPT).toContain('Do not work out dates');
});

it('a member event and a policy event with the same id keep their own answers', async () => {
  const both = { success: true, payload: {
    memberEvents: [{ eventId: '1', eventDate: null, eventDescription: 'Any symptom related to GERD' }],
    policyEvents: [{ eventId: '1', eventDate: null, eventDescription: 'Treatment abroad excluded' }],
  } };
  synthesizeJson.mockResolvedValue({ results: [
    { eventId: 'Member:1', applies: true, confidence: 0.9, reason: 'GERD' },
    { eventId: 'Policy:1', applies: false, confidence: 0.9, reason: 'Inside Myanmar' },
  ] });
  const judged = await judgeExclusionEvents({}, readEvents(both, '2026-10-01'), 0.7);
  expect(judged.map((e) => [e.key, e.match])).toEqual([['Member:1', true], ['Policy:1', false]]);
});

it('a counted event with no description is unsure (a person reads it); an unclear date counts', async () => {
  const judged = await judgeExclusionEvents({}, readEvents(response, '2026-10-01'), 0.7);
  expect(judged.find((e) => e.key === 'Policy:1')).toMatchObject({ unsure: true, match: true });
  expect(readEvents({ success: true, payload: { memberEvents: [{ eventId: '9', eventDate: '2027-1-5', eventDescription: 'x' }], policyEvents: [] } }, '2026-10-01')[0].counted).toBe(true);
});

it('asks for the policy period that covers the treatment date', () => {
  const two = { payload: { member: { MBR_NO: 'M1' }, policies: [
    { POCY_NO: 'NEW', EFF_DATE: '08012026', EXP_DATE: '07312027' },
    { POCY_NO: 'OLD', EFF_DATE: '08012025', EXP_DATE: '07312026' },
  ] } };
  expect(eventsRequest(two, '2026-03-01')).toMatchObject({ policyNo: 'OLD', policyEffDate: '2025-08-01' });
  expect(eventsRequest(two, null)).toMatchObject({ policyNo: 'NEW' });
});
