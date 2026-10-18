import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { getStpSettings, saveStpSettings, type NumberKey, type StpSettings, type SwitchKey, type Switches } from '../api/stpSettingsApi';
import { SourceTabs } from '../components/common/SourceTabs';
import { Button } from '../components/common/Button';
import { isSuperAdmin } from '../lib/session';
import type { Source } from '../types/pipeline';

// IAS benefit type codes (benefit_type_code on the member's plan) — the type each claim line is submitted with.
const BENEFIT_LABELS: Record<string, string> = { IP: 'Inpatient', OP: 'Outpatient', DT: 'Dental', VS: 'Vision' };
const SOURCE_LABEL: Record<Source, string> = { EMAIL: 'Email', API: 'API' };

type View = 'stp' | 'system';

// STP settings page: what stops a claim from being paid straight through.
const STP_SWITCHES: { key: SwitchKey; title: string; text: string }[] = [
  {
    key: 'stpBlockOnReviewPoints',
    title: "Don't pay automatically when the AI was unsure",
    text: 'A claim with an open review point (the AI unsure — at or below the threshold on System settings — a possible policy exclusion, …) never goes STP — it goes to JD3 for approval, and the STP reason says why.',
  },
  {
    key: 'vitaminsBlockStp',
    title: 'Vitamins / supplements: a person approves (no STP)',
    text: 'When the AI reads a vitamin or supplement on a voucher, the claim goes to JD3 for approval instead of STP, and the case shows which voucher.',
  },
];

// System settings page: when the AI itself says it is unsure, a person decides before the customer is asked for
// documents or anything goes to IAS. Off until Ulink decides; off, the system works as before.
const AI_SWITCHES: { key: SwitchKey; title: string; text: string }[] = [
  {
    key: 'holdUnsureDocumentPass',
    title: "Documents the AI passed but wasn't sure about: a person confirms first",
    text: 'When every document check passed but the AI was unsure about one (at or below the threshold above), the case waits for a person to confirm before anything goes to IAS.',
  },
  {
    key: 'usePastCorrections',
    title: 'The AI learns from trusted corrections',
    text: "Before the AI reads a claim, it gets up to 5 trusted reviewer notes from past claims of the same hospital or clinic (what was misread, and why). It never gets a past amount, date or name — every value comes from this claim's own pages. The case page shows which notes it used.",
  },
  {
    key: 'holdUnsureMissingDocsEmail',
    title: "Don't email the customer when the AI is unsure a document is missing",
    text: "When the AI couldn't read a document, or wasn't sure it is missing, the customer's missing-documents email waits. The team checks, then sends the request or overrides the check.",
  },
];

// Which cases the system works on, and the customer email ULINK may send by hand (SYSTEM_4, API go-live first).
const CASE_SWITCHES: { key: SwitchKey; title: string; text: string }[] = [
  {
    key: 'emailCasesEnabled',
    title: 'Work on email cases',
    text: "Off: the email pipeline doesn't run (scheduled or Run) and the Email tab is hidden on the work pages. Email cases already in the system are kept, untouched.",
  },
  {
    key: 'apiCasesEnabled',
    title: 'Work on API cases',
    text: "Off: the API pipeline doesn't run (scheduled or Run) and the API tab is hidden on the work pages. API cases already in the system are kept, untouched.",
  },
  {
    key: 'mailboxEnabled',
    title: 'Read the mailbox (IMAP)',
    text: "Off: incoming email is not read — Email Intake and Email Reply Intake are skipped in the pipelines; new email claims and customer replies stay in the mailbox. Sending email is not affected. (With no mailbox set up on the server, it isn't read either way.)",
  },
  {
    key: 'apiSendMissingDocumentsEmail',
    title: 'API cases: email the customer about missing documents',
    text: 'Off: the customer is not emailed — the team gets the list and contacts the customer. The claim is still suspended in IAS as usual.',
  },
];

const card = 'mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl';
const input =
  'rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20 disabled:bg-slate-50';
const changedMark = 'bg-ulink-orange/5 shadow-[inset_3px_0_0_0] shadow-ulink-orange';

const money = (n: number | null) => (n == null ? 'none' : n.toLocaleString('en-US'));
const onOff = (b: boolean) => (b ? 'On' : 'Off');

// The form as the user edits it: amounts as typed (text), so an empty box and a half-typed number are allowed.
interface Draft {
  rules: Record<string, { stpAllowed: boolean; amount: string }>;
  diagnoses: { codePrefix: string; note: string | null }[];
  switches: Switches;
  threshold: string; // aiConfidenceThreshold as a percentage, as typed
  numbers: Record<NumberKey, string>; // the whole-number settings, as typed
}

// The whole-number settings (all on System settings): label before the box, unit after, what it does.
type NumberSetting = { key: NumberKey; label: string; unit: string; help: string };
const AI_NUMBERS: NumberSetting[] = [
  { key: 'voucherDaysBeforeVisit', label: 'A voucher dated before or after the visit by more than', unit: 'days', help: 'Such a date is most likely misread (for example, July read as January). The AI is marked unsure, and a person checks the date. Raise it for claims that cover a long course of treatment.' },
];
const ALERT_NUMBERS: NumberSetting[] = [
  { key: 'overdueWorkingDays', label: 'A case waiting for a person is overdue after', unit: 'working days', help: "Monday–Friday, since the case entered its current status. Marked red in the review queue. 2 until ULINK sets its limit." },
  { key: 'pipelineStaleMinutesEmail', label: 'The Overview turns red when the email pipeline has not run for', unit: 'minutes', help: 'About 3× the schedule (cron every 10 min → 30). Raise it if the schedule pauses outside working hours.' },
  { key: 'pipelineStaleMinutesApi', label: 'The Overview turns red when the API pipeline has not run for', unit: 'minutes', help: 'About 3× the schedule (cron every 30 min → 90).' },
];
const NUMBER_SETTINGS = [...AI_NUMBERS, ...ALERT_NUMBERS];

// What each page shows, checks and saves. The STP page alone has the rules and the never-STP list; the
// System page alone has the threshold and the whole numbers.
const PAGE: Record<View, { switches: { key: SwitchKey; title: string; text: string }[]; numbers: NumberSetting[] }> = {
  stp: { switches: STP_SWITCHES, numbers: [] },
  system: { switches: [...CASE_SWITCHES, ...AI_SWITCHES], numbers: NUMBER_SETTINGS },
};

function draftFrom(data: StpSettings): Draft {
  return {
    rules: Object.fromEntries(data.rules.map((r) => [r.id, { stpAllowed: r.stpAllowed, amount: r.amountLimit == null ? '' : String(r.amountLimit) }])),
    diagnoses: data.blockedDiagnoses.map((d) => ({ codePrefix: d.codePrefix, note: d.note })),
    switches: { ...data.switches },
    threshold: String(Math.round(data.switches.aiConfidenceThreshold * 100)),
    numbers: Object.fromEntries(NUMBER_SETTINGS.map((n) => [n.key, String(data.switches[n.key])])) as Record<NumberKey, string>,
  };
}

// The threshold box: a whole or decimal percentage 0–100, or null when it isn't one.
const parsePercent = (text: string): number | null => {
  const n = text.trim() === '' ? NaN : Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

const parseAmount = (text: string): number | null => (text.trim() === '' ? null : Number(text));

// A whole-number box: the number when it is whole and in [min, max] (the API's range), else null.
const parseWhole = (text: string, [min, max]: [number, number]): number | null => {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * Two pages on one form (2026-10-18). STP settings (enhancement status point 7): which claims may go straight
 * through without a person — per case type (email / API) and IAS benefit type, diagnoses that never go STP, and the
 * STP switches. System settings: which cases the system works on, the AI checks, overdue and pipeline alerts.
 * Both read and save /api/stp-settings; each page shows, lists and saves only its own part.
 * One Save per page: nothing takes effect until "Review & save", which lists every change first and saves
 * all of it or nothing.
 */
export function StpSettingsPage({ view = 'stp' }: { view?: View }) {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings });

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-4 pb-28 pt-6 sm:px-6">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        {view === 'stp'
          ? 'A claim goes straight through (STP) only when every benefit type on it is allowed and within its limit, and its diagnosis is not on the never-STP list. Nothing changes until you save; changes apply to claims prepared after that.'
          : 'Which cases the system works on, when the AI counts as unsure and a person checks, and when cases and pipelines are flagged. Nothing changes until you save.'}
        {!isSuperAdmin() && ' Only a super admin can change these.'}
      </p>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the settings.</p>}
      {/* Keyed on the loaded version: after a save (or a reload) the form starts again from what is stored. */}
      {data && <StpForm key={`${view}-${dataUpdatedAt}`} view={view} data={data} canEdit={isSuperAdmin()} />}
    </div>
  );
}

function StpForm({ view, data, canEdit }: { view: View; data: StpSettings; canEdit: boolean }) {
  const isStp = view === 'stp';
  const page = PAGE[view];
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>('EMAIL');
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Every difference from what is stored, in words — the Review & save list, and the change count.
  const changes = useMemo(() => {
    const list: { key: string; text: string; source?: Source }[] = [];
    for (const rule of isStp ? data.rules : []) {
      const d = draft.rules[rule.id];
      const name = `${SOURCE_LABEL[rule.caseSource]} · ${rule.benefitType}`;
      if (d.stpAllowed !== rule.stpAllowed) list.push({ key: `${rule.id}-a`, source: rule.caseSource, text: `${name}: STP allowed ${rule.stpAllowed ? 'Yes' : 'No'} → ${d.stpAllowed ? 'Yes' : 'No'}` });
      if (parseAmount(d.amount) !== rule.amountLimit) list.push({ key: `${rule.id}-m`, source: rule.caseSource, text: `${name}: max amount ${money(rule.amountLimit)} → ${money(parseAmount(d.amount))} ${rule.currency}` });
    }
    if (isStp) {
      const stored = data.blockedDiagnoses.map((d) => d.codePrefix);
      const drafted = draft.diagnoses.map((d) => d.codePrefix);
      for (const d of draft.diagnoses) if (!stored.includes(d.codePrefix)) list.push({ key: `+${d.codePrefix}`, text: `Never-STP diagnoses: add ${d.codePrefix}${d.note ? ` (${d.note})` : ''}` });
      for (const code of stored) if (!drafted.includes(code)) list.push({ key: `-${code}`, text: `Never-STP diagnoses: remove ${code}` });
    }
    for (const s of page.switches) {
      if (draft.switches[s.key] !== data.switches[s.key]) list.push({ key: s.key, text: `"${s.title}": ${onOff(data.switches[s.key])} → ${onOff(draft.switches[s.key])}` });
    }
    const percent = parsePercent(draft.threshold);
    if (!isStp && percent !== null && percent / 100 !== data.switches.aiConfidenceThreshold) {
      list.push({ key: 'aiConfidenceThreshold', text: `AI unsure at or below: ${Math.round(data.switches.aiConfidenceThreshold * 100)}% → ${percent}%` });
    }
    for (const n of page.numbers) {
      const value = parseWhole(draft.numbers[n.key], data.numberRanges[n.key]);
      if (value !== null && value !== data.switches[n.key]) list.push({ key: n.key, text: `${n.label}: ${data.switches[n.key]} → ${value} ${n.unit}` });
    }
    return list;
  }, [data, draft, isStp, page]);

  // Problems the save would be refused for — shown on the row, and they block the save.
  const ruleErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const rule of isStp ? data.rules : []) {
      const d = draft.rules[rule.id];
      const amount = parseAmount(d.amount);
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) errors[rule.id] = 'Enter a number of 0 or more.';
      else if (d.stpAllowed && amount == null) errors[rule.id] = 'Set a max amount to allow STP.';
    }
    return errors;
  }, [data, draft, isStp]);
  const thresholdError = !isStp && parsePercent(draft.threshold) === null ? 'Enter a percentage from 0 to 100.' : null;
  const numberErrors = Object.fromEntries(page.numbers
    .filter((n) => parseWhole(draft.numbers[n.key], data.numberRanges[n.key]) === null)
    .map((n) => [n.key, `Enter a whole number from ${data.numberRanges[n.key][0]} to ${data.numberRanges[n.key][1]}.`]));
  const errorCount = Object.keys(ruleErrors).length + (thresholdError ? 1 : 0) + Object.keys(numberErrors).length;
  const dirty = changes.length > 0;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    // Only what changed (the Review & save list): a setting this page didn't change — on either page — is never
    // sent, so an old tab can't undo a newer save. No blockedDiagnoses unless the list changed — the API then leaves
    // the never-STP list as it is. Save is blocked while a box has an error, so each changed box parses here.
    mutationFn: () => {
      const changed = new Set(changes.map((c) => c.key));
      return saveStpSettings({
        rules: data.rules
          .filter((r) => changed.has(`${r.id}-a`) || changed.has(`${r.id}-m`))
          .map((r) => ({ id: r.id, stpAllowed: draft.rules[r.id].stpAllowed, amountLimit: parseAmount(draft.rules[r.id].amount) })),
        ...(changes.some((c) => /^[+-]/.test(c.key)) && { blockedDiagnoses: draft.diagnoses }),
        switches: {
          ...Object.fromEntries(page.switches.filter((s) => changed.has(s.key)).map((s) => [s.key, draft.switches[s.key]])),
          ...(changed.has('aiConfidenceThreshold') && { aiConfidenceThreshold: (parsePercent(draft.threshold) ?? 0) / 100 }),
          ...Object.fromEntries(page.numbers.filter((n) => changed.has(n.key)).map((n) => [n.key, parseWhole(draft.numbers[n.key], data.numberRanges[n.key])])),
        },
      });
    },
    onSuccess: (saved) => {
      setConfirmOpen(false);
      queryClient.setQueryData(['stp-settings'], saved);
    },
  });

  const setSwitch = (key: SwitchKey, on: boolean) => setDraft((d) => ({ ...d, switches: { ...d.switches, [key]: on } }));

  const setRule = (id: string, patch: Partial<Draft['rules'][string]>) =>
    setDraft((d) => ({ ...d, rules: { ...d.rules, [id]: { ...d.rules[id], ...patch } } }));
  const countFor = (s: Source) => changes.filter((c) => c.source === s).length;

  // One whole-number box: label, box with its unit, what it does, and its error.
  const numberRow = (n: NumberSetting) => (
    <div key={n.key} className={clsx('mt-3 rounded-lg p-2', changes.some((c) => c.key === n.key) && changedMark)}>
      <label className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-800">{n.label}</span>
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            min={data.numberRanges[n.key][0]}
            max={data.numberRanges[n.key][1]}
            step={1}
            value={draft.numbers[n.key]}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, numbers: { ...d.numbers, [n.key]: e.target.value } }))}
            aria-label={`${n.label}, ${n.unit}`}
            className={`${input} w-24`}
          />
          <span className="text-sm text-slate-600">{n.unit}</span>
        </span>
      </label>
      <p className="mt-1 text-sm text-slate-600">{n.help}</p>
      {numberErrors[n.key] && <p className="mt-1 text-xs text-red-600">{numberErrors[n.key]}</p>}
    </div>
  );

  return (
    <>
      {isStp ? (
        <>
          <section className={card}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">Rules by benefit type</h2>
              <div className="flex items-center gap-3">
                {(['EMAIL', 'API'] as Source[]).filter((s) => s !== source && countFor(s) > 0).map((s) => (
                  <span key={s} className="text-xs text-ulink-orange-dark">
                    {SOURCE_LABEL[s]}: {countFor(s)} unsaved
                  </span>
                ))}
                <SourceTabs source={source} onChange={setSource} showAll />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pl-3 pr-4 font-medium">Benefit type</th>
                  <th className="pb-2 pr-4 font-medium">STP allowed</th>
                  <th className="pb-2 pr-3 font-medium">Max amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.filter((r) => r.caseSource === source).map((rule) => {
                  const d = draft.rules[rule.id];
                  const changed = d.stpAllowed !== rule.stpAllowed || parseAmount(d.amount) !== rule.amountLimit;
                  return (
                    <tr key={rule.id} className={clsx('border-t border-slate-900/5 align-top', changed && changedMark)}>
                      <td className="py-3 pl-3 pr-4">
                        <span className="font-medium text-slate-800">{rule.benefitType}</span>
                        <span className="ml-2 text-slate-500">{BENEFIT_LABELS[rule.benefitType] ?? ''}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={d.stpAllowed}
                            disabled={!canEdit}
                            onChange={(e) => setRule(rule.id, { stpAllowed: e.target.checked })}
                            className="h-4 w-4 accent-ulink-orange"
                          />
                          <span className="text-slate-700">{d.stpAllowed ? 'Yes' : 'No'}</span>
                        </label>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={d.amount}
                            disabled={!canEdit}
                            onChange={(e) => setRule(rule.id, { amount: e.target.value })}
                            aria-label={`Max amount for ${rule.benefitType}`}
                            aria-invalid={Boolean(ruleErrors[rule.id])}
                            className={clsx(input, 'w-36', ruleErrors[rule.id] && 'border-red-400')}
                          />
                          <span className="text-slate-500">{rule.currency}</span>
                        </div>
                        {ruleErrors[rule.id] && <p className="mt-1 text-xs text-red-600">{ruleErrors[rule.id]}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">A benefit type not listed here (e.g. PA) never goes STP.</p>
          </section>

          <NeverStpDiagnoses
            diagnoses={draft.diagnoses}
            stored={data.blockedDiagnoses.map((d) => ({ codePrefix: d.codePrefix, note: d.note }))}
            canEdit={canEdit}
            onChange={(diagnoses) => setDraft((d) => ({ ...d, diagnoses }))}
          />

          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-800">When a claim never goes STP</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">Applies to email and API cases.</p>
            <SwitchList switches={STP_SWITCHES} draft={draft} stored={data.switches} canEdit={canEdit} onToggle={setSwitch} />
          </section>
        </>
      ) : (
        <>
          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-800">Which cases the system works on</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">For going live with one kind of case first. The STP rules (STP settings page) can be set for both either way.</p>
            <SwitchList switches={CASE_SWITCHES} draft={draft} stored={data.switches} canEdit={canEdit} onToggle={setSwitch} />
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-800">AI checks — when the AI is unsure, a person checks</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">Applies to email and API cases.</p>
            <div className={clsx('mb-3 rounded-lg p-2', changes.some((c) => c.key === 'aiConfidenceThreshold') && changedMark)}>
              <label className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-slate-800">The AI is unsure at or below</span>
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    inputMode="decimal"
                    value={draft.threshold}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, threshold: e.target.value }))}
                    aria-label="AI confidence threshold, percent"
                    className={`${input} w-20`}
                  />
                  <span className="text-sm text-slate-600">% confidence</span>
                </span>
              </label>
              <p className="mt-1 text-sm text-slate-600">An AI answer at or below this becomes a review point on the case; with the switches below on, a person decides.</p>
              {thresholdError && <p className="mt-1 text-xs text-red-600">{thresholdError}</p>}
            </div>
            <SwitchList switches={AI_SWITCHES} draft={draft} stored={data.switches} canEdit={canEdit} onToggle={setSwitch} />
            {AI_NUMBERS.map(numberRow)}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-800">Overdue cases and pipeline alerts</h2>
            {ALERT_NUMBERS.map(numberRow)}
          </section>
        </>
      )}

      {canEdit && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-900/10 bg-white/95 px-4 py-3 shadow-glass backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{changes.length} unsaved change{changes.length > 1 ? 's' : ''}</span>
              {errorCount > 0 && <span className="ml-2 text-red-600">· fix {errorCount} problem{errorCount > 1 ? 's' : ''} first</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(draftFrom(data))}>
                Discard
              </Button>
              <Button disabled={errorCount > 0} onClick={() => setConfirmOpen(true)}>
                Review & save
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
            <AlertDialog.Title className="text-sm font-semibold text-slate-900">{isStp ? 'Save these STP changes?' : 'Save these system changes?'}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-3 text-sm text-slate-700">
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {changes.map((c) => (
                    <li key={c.key}>• {c.text}</li>
                  ))}
                </ul>
                <p className="mt-3 text-slate-500">{isStp ? 'They apply to claims prepared after saving. Claims already prepared keep their decision.' : 'They apply from the next pipeline run. Cases already checked keep their results.'}</p>
              </div>
            </AlertDialog.Description>
            {save.isError && <p className="mt-3 text-sm text-red-600">{save.error.message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Back</Button>
              </AlertDialog.Cancel>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : `Save ${changes.length} change${changes.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function SwitchList({
  switches,
  draft,
  stored,
  canEdit,
  onToggle,
}: {
  switches: { key: SwitchKey; title: string; text: string }[];
  draft: Draft;
  stored: Switches;
  canEdit: boolean;
  onToggle: (key: SwitchKey, on: boolean) => void;
}) {
  return (
    <ul className="space-y-2">
      {switches.map((s) => (
        <li key={s.key} className={clsx('rounded-lg p-2', draft.switches[s.key] !== stored[s.key] && changedMark)}>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={draft.switches[s.key]}
              disabled={!canEdit}
              onChange={(e) => onToggle(s.key, e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-ulink-orange"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">{s.title}</span>
              <span className="block text-sm text-slate-600">{s.text}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function NeverStpDiagnoses({
  diagnoses,
  stored,
  canEdit,
  onChange,
}: {
  diagnoses: { codePrefix: string; note: string | null }[];
  stored: { codePrefix: string; note: string | null }[];
  canEdit: boolean;
  onChange: (diagnoses: { codePrefix: string; note: string | null }[]) => void;
}) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const normalized = code.trim().toUpperCase();
  const problem =
    normalized === '' ? null
      : !/^[A-Z][0-9A-Z.]{0,6}$/.test(normalized) ? 'Enter an ICD-10 code or the start of one, e.g. C or C50.'
        : diagnoses.some((d) => d.codePrefix === normalized) ? `${normalized} is already on the list.`
          : null;
  const removed = stored.filter((s) => !diagnoses.some((d) => d.codePrefix === s.codePrefix));
  const isStored = (codePrefix: string) => stored.some((s) => s.codePrefix === codePrefix);

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-slate-800">Diagnoses that never go STP</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        ICD-10 codes, or the start of one: <b>C</b> blocks every cancer code, <b>C50</b> only breast cancer. Applies to email and API
        cases. <b>R69</b> is the code used when the AI could not find the diagnosis.
      </p>
      <ul className="mb-4 flex flex-wrap gap-2">
        {diagnoses.map((d) => {
          const added = !isStored(d.codePrefix);
          return (
            <li key={d.codePrefix} className={clsx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm', added ? 'bg-ulink-orange/10 ring-1 ring-ulink-orange/40' : 'bg-slate-100')}>
              <span className="font-medium text-slate-800">{d.codePrefix}</span>
              {d.note && <span className="text-slate-500">{d.note}</span>}
              {added && <span className="text-xs text-ulink-orange-dark">new</span>}
              {canEdit && (
                <button
                  onClick={() => onChange(diagnoses.filter((x) => x.codePrefix !== d.codePrefix))}
                  aria-label={`Remove ${d.codePrefix}`}
                  className="text-slate-400 hover:text-red-600"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          );
        })}
        {removed.map((s) => (
          <li key={s.codePrefix} className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">
            <span className="line-through">{s.codePrefix}</span>
            <span className="text-xs">removed</span>
            {canEdit && (
              <button onClick={() => onChange([...diagnoses, s])} className="text-xs underline">
                undo
              </button>
            )}
          </li>
        ))}
        {diagnoses.length === 0 && removed.length === 0 && <li className="text-sm text-slate-500">None.</li>}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem || normalized === '') return;
            onChange([...diagnoses, { codePrefix: normalized, note: note.trim() || null }]);
            setCode('');
            setNote('');
          }}
        >
          <div>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. C50" aria-label="ICD-10 code" className={`${input} w-36`} />
            {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" className={`${input} min-w-0 flex-1`} />
          <Button type="submit" variant="ghost" disabled={normalized === '' || Boolean(problem)}>
            Add to list
          </Button>
        </form>
      )}
    </section>
  );
}
