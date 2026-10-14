# Release guide — API + console, UAT → prod

The one-page checklist for every release. Details, first-time setup and troubleshooting:
`DEPLOY_API.md`, `DEPLOY_CONSOLE.md`; server setup and history: `ULINK_AWS_User_and_Tailscale_Setup.md`.

| | UAT | Prod |
|---|---|---|
| Console URL | `http://47.131.150.18:5173` (Outline) / `http://100.65.116.86:5173` (Tailscale) | `http://<server ip>:5174` — not set up yet |
| API | container `ulink-api-uat`, port 3088 | container `ulink-api-prod`, port 3089 |
| Folder | `/home/ulinkai/uat/` | `/home/ulinkai/prod/` |
| Release log | `~/uat/releases/ulink-deploy.log` | `~/prod/releases/ulink-deploy.log` |
| Database / inbox / IAS | shared with local dev (staging) | prod's own — never UAT's |

Rule: **the same release files go to UAT first, then to prod** — never build separately for prod.

---

## 1. Prepare (your machine, WSL)

```bash
cd /mnt/c/git/ULINK/ULINK-STP-PROJECT/ulink-admin
git status -- src/                                   # must be clean — commit first
bash docs/deployment/pack-release.sh both            # or: ulink-api / ulink-console
```

Output (Windows: `C:\git\ULINK\ULINK-STP-PROJECT\ulink-admin\release\`):

- `release/api/ulink-api_<YYYYMMDD-HHMM>_<commit>.tar.gz`
- `release/console/ulink-console_<YYYYMMDD-HHMM>_<commit>.tar.gz`

Migrations — the deploy does **not** run them (only warns). If the release has new ones, decide and run them
yourself first:

```bash
cd src/ulink-api && npx sequelize-cli db:migrate:status | grep -c '^down'    # 0 = none pending
```

Before deploying UAT: **no pipeline running on your machine** (an API restart marks `RUNNING` runs as `FAILED`; UAT
shares your database).

## 2. Upload (WinSCP as `admin`)

Open `/home/ulinkai/upload/` directly (Ctrl+O). Copy both `.tar.gz` files there.

## 3. Deploy to UAT (server: `sudo su -` → `su - ulinkai`)

```bash
~/bin/ulink-deploy-api     uat ~/upload/ulink-api_<YYYYMMDD-HHMM>_<commit>.tar.gz
~/bin/ulink-deploy-console uat ~/upload/ulink-console_<YYYYMMDD-HHMM>_<commit>.tar.gz
tail -n 4 ~/uat/releases/ulink-deploy.log            # both lines end in OK
```

API first (the console may call new API endpoints). The API deploy: unpack → `npm ci` → pending-migration warning →
restart `ulink-api-uat` → health check. A `WARNING: N migration(s) pending` means step 1's migration check was
skipped — stop and decide.

## 4. Check UAT

```bash
docker ps --filter name=ulink-api-uat                                             # Up …
docker logs --tail 20 ulink-api-uat                                               # no errors
curl -s -o /dev/null -w "api %{http_code}\n" http://localhost:3088/api/docs/      # 200
curl -s -o /dev/null -w "via nginx %{http_code}\n" http://localhost:5173/api/docs/ # 200
```

Browser (Outline on): `http://47.131.150.18:5173` → Ctrl+F5 → log in → case list → open a case → whatever the
release changed.

**Not OK?** Roll back UAT to the previous release (names in `ls -t ~/uat/releases/<app>/`):

```bash
~/bin/ulink-deploy-api     uat ulink-api_<previous>.tar.gz
~/bin/ulink-deploy-console uat ulink-console_<previous>.tar.gz
```

## 5. Deploy to prod (only after UAT is signed off)

Upload the **same two files** again to `/home/ulinkai/upload/` (each environment keeps its own copy), then:

```bash
MIGRATE=1 ~/bin/ulink-deploy-api prod ~/upload/ulink-api_<same>.tar.gz   # type "prod" when asked; drop MIGRATE=1 if
                                                                           # prod migrations are run another way
~/bin/ulink-deploy-console prod ~/upload/ulink-console_<same>.tar.gz      # type "prod" when asked
tail -n 4 ~/prod/releases/ulink-deploy.log
```

## 6. Check prod

Same as step 4 with `ulink-api-prod`, port **3089**, nginx port **5174**, `~/prod/releases/`. Rollback: same
commands with `prod`.

## 7. Clean up

`ls -la ~/upload/` — should be empty (the scripts move the `.tar.gz` into `releases/`; each env keeps the last 5).

---

## Not every release needs everything

| Change | What to do |
|---|---|
| Console only | `pack-release.sh ulink-console`; deploy console only |
| API only | `pack-release.sh ulink-api`; deploy API only |
| A setting (`.env`) | no release — `DEPLOY_API.md` "Change a setting" |
| New npm package | normal API release (`npm ci` installs it) |
| New Linux package | new runtime image — `DEPLOY_API.md` "Adding a library" |
| Deploy script changed | upload + reinstall it — `DEPLOY_API.md` S3 / `DEPLOY_CONSOLE.md` one-time setup |

## First-time setup of an environment

- **UAT** — done 2026-10-14: `DEPLOY_API.md` S1–S8, `DEPLOY_CONSOLE.md` one-time setup, runbook 6.3 (nginx).
- **Prod** — runbook Part 7 (folders, prod `.env`, nginx 5174, container `ulink-api-prod`, cron), then this guide.
- **A new server** — runbook Parts 0–6 in order (user, Tailscale, Docker, folders, nginx), then the above.
