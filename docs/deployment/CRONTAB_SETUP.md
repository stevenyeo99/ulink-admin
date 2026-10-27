# Crontab setup — scheduled pipelines (UAT / prod)

Cron runs the two ulink-api pipelines and their two review lanes on a schedule. Without it, pipelines run only when someone clicks
**Pipeline → Run** in the console. Related: `DEPLOY_API.md`, `RELEASE_GUIDE.md`, `OPERATIONS.md` §2.

| Pipeline | Endpoint (called on the server itself) | UAT schedule |
|---|---|---|
| **Email cases** | `POST http://127.0.0.1:<port>/api/jobs/pipeline/run` | every 10 min (`*/10`) |
| **API cases** | `POST http://127.0.0.1:<port>/api/jobs/api-pipeline/run` | at :07 and :37 (every 30 min, offset from email) |
| Email review lane (retry) | `POST http://127.0.0.1:<port>/api/jobs/review-pipeline/run` | every 3 min (`*/3`) |
| API review lane (retry) | `POST http://127.0.0.1:<port>/api/jobs/api-review-pipeline/run` | every 3 min (`1-59/3`, offset from email) |

The review lanes (SYSTEM_5, `docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md`) process the cases a person decided. A
person's save already starts its lane. The cron is the retry: it picks up a case whose run failed or was skipped. A
round with no decided case writes nothing, so the cron is cheap.

| | UAT | Prod |
|---|---|---|
| Port | 3088 (`ulink-api-uat`) | 3089 (`ulink-api-prod`) |
| Schedule file | `~/uat/crontab.txt` | lines added to the same crontab |
| Trigger errors | `~/uat/cron-errors.log` | `~/prod/cron-errors.log` |

How it behaves:

- **Separate:** email and API pipelines have their own lock and schedule — one running does not block the other.
- **No pile-up:** a trigger that fires while that pipeline is still running is **skipped**, not queued. A review lane is
  different: a trigger while it is busy makes the busy run do one more round, so nothing is lost.
- **Same as the console button:** runs appear in the console's pipeline history either way.
- **Direct to the API:** cron calls `127.0.0.1:<port>`, not nginx or the public ports.
- **Fire-and-forget:** the call returns at once; the run continues inside the API. Run results are in the console and
  the API logs (`DEPLOY_API.md` "Logs"); `cron-errors.log` only records a trigger that failed (API down, timeout).

## Before switching it on

- **UAT shares the local database, IMAP inbox and IAS staging** — stop running pipelines on your machine first, or
  both pick up the same emails / cases.
- Prod: only with prod's own `.env` (DB / inbox / IAS) and BACKLOG B9 done.
- ulinkai may use cron: `crontab -l` says "no crontab for ulinkai" (allowed, empty) — checked 2026-10-14. A
  "not allowed" message means `/etc/cron.allow` / `cron.deny` need ulinkai (runbook Part 1.4).

## Install (as ulinkai — `sudo su -` → `su - ulinkai`)

**1. Write the schedule file** (changes nothing yet):

```bash
cat > ~/uat/crontab.txt <<'EOF'
# ULINK UAT — ulink-api-uat on 127.0.0.1:3088 (cron calls it directly, not through nginx)
# Email pipeline every 10 min; API pipeline at :07 and :37. Trigger failures only → ~/uat/cron-errors.log
*/10 * * * *  curl -fsS -m 30 -X POST http://127.0.0.1:3088/api/jobs/pipeline/run     >/dev/null 2>>/home/ulinkai/uat/cron-errors.log
7,37 * * * *  curl -fsS -m 30 -X POST http://127.0.0.1:3088/api/jobs/api-pipeline/run >/dev/null 2>>/home/ulinkai/uat/cron-errors.log
# Review lanes (SYSTEM_5): retry decided cases every 3 min, email and API one minute apart.
*/3 * * * *    curl -fsS -m 30 -X POST http://127.0.0.1:3088/api/jobs/review-pipeline/run     >/dev/null 2>>/home/ulinkai/uat/cron-errors.log
1-59/3 * * * * curl -fsS -m 30 -X POST http://127.0.0.1:3088/api/jobs/api-review-pipeline/run >/dev/null 2>>/home/ulinkai/uat/cron-errors.log
EOF
cat ~/uat/crontab.txt
```

**2. Install it** (`crontab <file>` replaces ulinkai's whole crontab with the file):

```bash
crontab ~/uat/crontab.txt
crontab -l                       # prints the same lines
```

**3. Check after the first trigger time** (email: next multiple of 10 min; API: :07 / :37):

```bash
cat ~/uat/cron-errors.log 2>/dev/null || echo "no trigger errors"
curl -s "http://127.0.0.1:3088/api/jobs/pipeline/runs?limit=1" | head -c 300; echo
curl -s "http://127.0.0.1:3088/api/jobs/api-pipeline/runs?limit=1" | head -c 300; echo
# The review lanes answer at once; with no decided case they write no run, so an empty list is normal.
curl -s -X POST http://127.0.0.1:3088/api/jobs/api-review-pipeline/run; echo
curl -s -X POST http://127.0.0.1:3088/api/jobs/review-pipeline/run; echo
```

A review lane answers `{"started":true}`, `{"started":false,"queued":true}` (a round was busy and runs once more) or
`{"skipped":"source_disabled"}` (that source is switched off in System settings).

The latest run's start time matches the cron time; the console's pipeline history shows it too.

## What each part means

| Part | Meaning |
|---|---|
| `*/10 * * * *` | every 10 minutes (fields: minute, hour, day of month, month, weekday) |
| `7,37 * * * *` | at minute 7 and 37 of every hour |
| `*/3 * * * *` / `1-59/3 * * * *` | every 3 minutes from minute 0 / from minute 1 |
| `curl -fsS -m 30 -X POST …/run` | start the pipeline; `-f` treats HTTP errors as failures, `-sS` quiet but shows errors, `-m 30` gives up after 30 s |
| `>/dev/null` | discard the normal reply (`{ started: true, runId: … }`) |
| `2>>…/cron-errors.log` | append only failures to the error log |

Other schedules, if needed: `*/30 * * * *` (every 30 min) · `*/10 8-18 * * 1-5` (every 10 min, 08:00–18:59,
Mon–Fri). Cron uses the server's time zone — check with `date`.

## Change, pause, resume

```bash
nano ~/uat/crontab.txt && crontab ~/uat/crontab.txt     # change intervals
crontab -r                                              # pause everything (removes ulinkai's crontab; the file stays)
crontab ~/uat/crontab.txt                               # resume
```

A stuck run (process died mid-run) keeps its lock and later triggers are skipped — release it:
`curl -X POST http://127.0.0.1:3088/api/jobs/pipeline/release` (or `api-pipeline/release`). A review lane takes over its
own lock after 15 minutes. To release it at once: `review-pipeline/release` or `api-review-pipeline/release`.

## Prod (later)

Add prod's four lines to the same file and reinstall — port **3089**, its own error log:

```cron
*/10 * * * *  curl -fsS -m 30 -X POST http://127.0.0.1:3089/api/jobs/pipeline/run     >/dev/null 2>>/home/ulinkai/prod/cron-errors.log
7,37 * * * *  curl -fsS -m 30 -X POST http://127.0.0.1:3089/api/jobs/api-pipeline/run >/dev/null 2>>/home/ulinkai/prod/cron-errors.log
*/3 * * * *    curl -fsS -m 30 -X POST http://127.0.0.1:3089/api/jobs/review-pipeline/run     >/dev/null 2>>/home/ulinkai/prod/cron-errors.log
1-59/3 * * * * curl -fsS -m 30 -X POST http://127.0.0.1:3089/api/jobs/api-review-pipeline/run >/dev/null 2>>/home/ulinkai/prod/cron-errors.log
```

Keep both environments' lines in one file (`~/uat/crontab.txt`, or rename it `~/crontab.txt`) — `crontab <file>`
always replaces the whole crontab.

## Status

- [ ] UAT installed — waiting for the decision to stop local pipelines (2026-10-14).
- [ ] UAT review lane retry lines (SYSTEM_5, 2026-10-27): add them with the release that runs migrations
  `20261027110000-review-lane` and `20261027120000-email-review-lane`.
- [ ] Prod — after runbook Part 7.
