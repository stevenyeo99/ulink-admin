# Session handoff: 2026-10-26

What was built today, what is left, and what to do before a UAT release. All work is on branch `demo-4.steven.yeo`.

## 1. Built today

| Work | PRD | Phases | State |
|---|---|---|---|
| IAS revision `docCompleteDate`: the received date on a suspense revision, the claim preparation date for complete documents | n/a | n/a | Built, committed |
| Invoice name check (claim form claimant vs voucher patient name) | `SYSTEM_4_PRD.md` phase I | I1 + review fixes | Built |
| AI checklist page under Admin (every check in plain words, Step 1 member check, Step 2 document check) | `SYSTEM_5/PRD/SYSTEM_5_PRD.md` | A, B (switches) | Built. Phase C open |
| Member balance (IAS `get_member_limit_balance`) | `SYSTEM_5/PRD/MEMBER_BALANCE_PRD.md` | A, B, C, D | Built |
| Member and policy exclusions (IAS `get_member_policy_events`, judged by meaning) | `SYSTEM_5/PRD/MEMBER_EXCLUSION_PRD.md` | A, B, C | Built |

The last full test run passed: 655 tests in 93 suites, run from `src/ulink-api` on the final code.

To run the full suite, start Jest from the API folder. Two runs today started from the wrong folder and picked up other projects' tests:

```
cd src/ulink-api && npx jest --runInBand --rootDir "$PWD"
```

## 2. Commits

Commit only the files listed for each change. About 150 other files show as changed only because of line endings (see 6).

If a change below is not committed yet, these messages fit. Each change's file list is in that day's chat. The PRD and the change log (`docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md`) also name the files touched.

```
SYSTEM_5 member balance phase D: second balance check before the claim holds a new shortage at Balance changed before the claim (Bypass only, re-checked each run without starving new cases, back to claim preparation), every bypass counts, balance lines in the summary, Plan limits removed

SYSTEM_5 phase B: AI checklist switches (switch a check off or on with a reason; skipped and shown Turned off on cases; no STP when the case was checked with a stopping check off; five checks locked on)

SYSTEM_5 member exclusion phase A: IAS get_member_policy_events client, event rules (member/policy level, event date on or before treatment), AI judge by meaning only with the IAS samples

SYSTEM_5 member exclusion phases B and C: exclusion check in the member check (IAS events judged by meaning, member:exclusion with level, Bypass only as an exception, no STP after a bypass, an override or an unchecked exclusion) and docs
```

## 3. Before a UAT release

1. Run the migration `20261026120000-create-check-switches` on UAT.
2. Add these two lines to the UAT server's `.env` (`docs/deployment/DEPLOY_API.md`, "Change a setting"):

   ```
   GET_MEMBER_LIMIT_BALANCE_API=/api/get_member_limit_balance
   GET_MEMBER_POLICY_EVENTS_API=/api/get_member_policy_events
   ```

   Without them, the member check fails for every case whose member IAS finds, and those cases wait at the member check.
3. Test both new checks against one real member on UAT whose balance and exclusions ULINK knows. A wrong reading stops good claims. For example, "0" means used up. An old member exclusion such as "terminated, 18th NOV" stops every claim of that member until staff remove it in IAS.
4. Tell ULINK operations to keep member exclusions in IAS up to date, for the same reason.

## 4. Planned work still open

- AI checklist, phase C (docs): `OPERATIONS.md`, the flow document and the API flowchart for the AI checklist page and its switches, and a short user guide. Documents only. Recommended next.

## 5. Open decisions and follow-ups

Decisions for the owner:

1. Invoice name check: a name mismatch still emails the customer directly. The safer option is to let a person approve it first.
2. Child claims: the medical record name check (`PATIENT_NAME_INCONSISTENT`) still runs on a claim for a child, where the parent's name can be on the form.
3. Internal feedback items 3 to 5 (`SYSTEM_5/PRD/Internal_Note_Feedback.md`): skip the hospital name checks, run the AI batch jobs at the same time, and require a reason for Mark OK and override.

Small follow-ups from code reviews (optional):

- AI checklist: the date check labels and the information line labels are copied by hand. No test catches a removed check. The "Reviewer can" rule is copied from the correction panel.
- AI checklist switches: the switch state is read from the whole table, about three times per case. Two people switching the same check in the same second both get recorded. The AI comparisons are mapped to their checks by hand in the document check.
- Member balance: each case waiting at "Balance changed before the claim" costs one IAS call per run. If a held balance recovers, the API flow keeps one stale history step.
- Member exclusion: a Burmese claim can be translated twice in one member check. The "Bypass only" list (`member:balance`, `member:exclusion`) sits in four places.

## 6. Housekeeping

- About 150 tracked files differ only in line endings (CRLF/LF).
- `bash.exe.stackdump` is tracked and changed.
- `src/ulink-api/.env.uat` is tracked by git, although `DEPLOY_API.md` calls it git-ignored. Check that it holds no passwords or keys.
