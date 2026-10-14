# Deploy ulink-api to AWS

How to release a new ulink-api build to the AWS server. ulink-api runs in a Docker container per environment; the
browser reaches it through nginx (`/api` on the console port). UAT's port 3088 is also open to Outline for direct calls.
Server setup history and reasons: `ULINK_AWS_User_and_Tailscale_Setup.md`.

| Env | Folder | Container | Port (`PORT` in `.env`) | Reached via |
|---|---|---|---|---|
| **uat** | `/home/ulinkai/uat/ulink-api` | `ulink-api-uat` | 3088 | `http://<server ip>:5173/api/...`; also directly `http://47.131.150.18:3088` on Outline (owner's choice 2026-10-14 — bypasses nginx, so `/api/jobs` is open to Outline users) |
| **prod** | `/home/ulinkai/prod/ulink-api` | `ulink-api-prod` (not yet) | 3089 | `http://<server ip>:5174/api/...` |

| Where | Who | What |
|---|---|---|
| Your machine (WSL) | you | pack the release `.tar.gz` |
| WinSCP | `admin` | upload to `/home/ulinkai/upload/` |
| Server shell | `ulinkai` | install it with `~/bin/ulink-deploy-api <env>` |

Always deploy to **uat** first; prod asks you to type `prod` to confirm.

## Every release

**1. Pack (WSL, from `ulink-admin`)** — there is no build step: the release is the committed `src/ulink-api` code;
`npm ci` and migrations run on the server.

```bash
cd /mnt/c/git/ULINK/ULINK-STP-PROJECT/ulink-admin
git status -- src/                                  # must be clean — the script refuses uncommitted src/ changes
bash docs/deployment/pack-release.sh ulink-api      # or: both (api + console)
```

Output: `release/api/ulink-api_<YYYYMMDD-HHMM>_<commit>.tar.gz` — in Windows
`C:\git\ULINK\ULINK-STP-PROJECT\ulink-admin\release\api\`. Made with `git archive`, so it never contains `.env`,
`.env.uat`, `node_modules`, `data/` or logs. `ALLOW_DIRTY=1` builds anyway — the content is still the last commit,
the name shows that commit.

**2. Migrations (WSL)** — the deploy does **not** migrate or seed (owner's choice 2026-10-14: uat shares the dev
database, migrated by hand). It only warns if migrations are pending. Check / run them yourself before deploying:

```bash
cd src/ulink-api && npx sequelize-cli db:migrate:status | grep -c '^down'   # pending migrations (0 = none)
npx sequelize-cli db:migrate                                                 # only if you decide to
```

**3. Upload (WinSCP, logged in as `admin`)** — open `/home/ulinkai/upload/` directly (Ctrl+O); copy the `.tar.gz`.

**4. Deploy (server: `sudo su -` → `su - ulinkai`)**

```bash
~/bin/ulink-deploy-api uat ~/upload/ulink-api_<YYYYMMDD-HHMM>_<commit>.tar.gz    # or: prod
tail -n 3 ~/uat/releases/ulink-deploy.log                                         # last line ends in OK
```

The script: copies the file into `~/uat/releases/ulink-api/` → extracts over `~/uat/ulink-api/` (keeps `.env`) →
`npm ci` → count pending migrations, warn if any (both in a throwaway `ulink-api-runtime:22` container) → `docker restart ulink-api-uat`
→ waits for `http://localhost:3088/api/docs` → keeps the last 5 releases → logs one line.

**Shared database note (uat today):** every start/restart of the container marks pipeline runs still `RUNNING` in
the database as `FAILED` ("interrupted by server restart", `modules/pipeline/reconcile.js`). UAT shares the local
Supabase DB, so make sure no pipeline is running on your machine when you deploy or restart UAT. The API has no
built-in scheduler — jobs run only when called (cron or the console).

## Check it is running

```bash
docker ps --filter name=ulink-api-uat              # STATUS "Up …"
docker logs --tail 50 ulink-api-uat                # startup errors show here
curl -s -o /dev/null -w "api %{http_code}\n" http://localhost:3088/api/docs        # 200
curl -s -o /dev/null -w "via nginx %{http_code}\n" http://localhost:5173/api/docs  # 200
```

Browser: `http://<server ip>:5173` → log in.

## Logs

ulink-api writes every log line to two places (`utils/logger.js`; JSON lines in production, HTTP requests included):

| Where | What | Read it (as ulinkai) |
|---|---|---|
| Container output | everything, incl. startup crashes before the logger loads | `docker logs --tail 100 ulink-api-uat` · live: `docker logs -f --since 10m ulink-api-uat` (Ctrl+C stops watching, not the API) |
| `~/uat/ulink-api/logs/combined.log` | everything | `tail -n 100 ~/uat/ulink-api/logs/combined.log` · live: `tail -f …` |
| `~/uat/ulink-api/logs/error.log` | errors only — look here first | `tail -n 50 ~/uat/ulink-api/logs/error.log` |

The files are on the server's disk (the code folder is mounted into the container), so they survive container
restarts and recreation, and WinSCP can download them (admin with group read access). Search:
`grep -i "error\|fail" ~/uat/ulink-api/logs/combined.log | tail -n 50`, or by case: `grep '<case id>' …`.

**Deploys never delete logs:** the release only adds/overwrites code files; `logs/*.log` stay. Docker's own log
(`docker logs`) survives restarts but is lost when the container is removed (`docker rm -f`, e.g. a new runtime
image) — the files above keep everything anyway.

**Daily rotation** (`docs/deployment/ulinkai-logrotate.conf` → `/etc/logrotate.d/ulinkai`): each day's log becomes
`combined.log-YYYYMMDD`, older days are gzipped (`.gz`), 30 days kept, uat and prod. Install as root:

```bash
sed -i 's/\r$//' /home/ulinkai/upload/ulinkai-logrotate.conf
install -o root -g root -m 644 /home/ulinkai/upload/ulinkai-logrotate.conf /etc/logrotate.d/ulinkai && rm /home/ulinkai/upload/ulinkai-logrotate.conf
logrotate -d /etc/logrotate.d/ulinkai          # dry run: prints what it would do, changes nothing
```

Expected dry run: `switching euid to <ulinkai uid>`, both uat logs considered, "log does not need rotating" on the
first day (logrotate only records new files then; rotation starts the next night). Installed on UAT 2026-10-14.

Read an old day: `zcat ~/uat/ulink-api/logs/combined.log-20261014.gz | grep …`. Docker's own log: capped by the
`--log-opt` options in `docker run` (S7) — `ulink-api-uat` gets them the next time it is recreated.

## Rollback

```bash
ls -t ~/uat/releases/ulink-api/                                    # newest first; last 5 kept
~/bin/ulink-deploy-api uat ulink-api_<older>.tar.gz                # name only — it is already in releases/
```

Migrations are not undone. Only if the older code cannot work with the newer schema:
`docker run --rm --user $(id -u):$(id -g) --network host -v ~/uat/ulink-api:/app -w /app ulink-api-runtime:22 npm run db:migrate:undo`
(one migration per run).

## Release log

`tail -n 30 ~/uat/releases/ulink-deploy.log` — one log per environment, shared with the console:

```
2026-10-14 15:42:10 | uat/ulink-api      | ulink-api_20261014-1027_7a479f0.tar.gz | sha256 3f9a1c0b7e21 | by admin | OK
```

To also run `db:migrate` on the server for that environment's database (e.g. prod with its own DB):
`MIGRATE=1 ~/bin/ulink-deploy-api prod ~/upload/<file>`.

A failure reads `FAILED at <step>`: `no-env`, `no-port`, `copy`, `extract`, `npm-ci`, `migrate-status` (or `migrate` with `MIGRATE=1`), `restart`, `health`, `prune`.

## Change a setting (`.env`)

Edit on your machine (`src/ulink-api/.env.uat`, git-ignored), upload to `/home/ulinkai/upload/`, then as ulinkai:

```bash
sed -i 's/\r$//' ~/upload/.env.uat
install -m 600 ~/upload/.env.uat ~/uat/ulink-api/.env && rm ~/upload/.env.uat
docker restart ulink-api-uat
```

`.env.uat` = the local `.env` with only the server-specific values changed: `NODE_ENV=production`, `LOG_LEVEL=info`,
`STORAGE_ROOT` / `CONSOLE_UPLOAD_ROOT` / `CSR_UPLOAD_ROOT` under `/home/ulinkai/uat/ulink-attachments/`,
`CONSOLE_URL=http://47.131.150.18:5173`, `CONSOLE_MIDDLEWARE_URL=https://tpa.api.ias.staging.ins-link.com/admin/_`.
UAT shares the local Supabase DB, IMAP inbox and IAS staging — **do not run the pipelines on your machine once UAT's
cron is on**. Prod's `.env` must use the prod DB / inbox / IAS (runbook Part 7).

## One-time setup (per server / per environment)

Done for **uat** on 2026-10-14 in this order. For **prod** repeat with `prod` / `/home/ulinkai/prod` /
`ulink-api-prod` and the prod `.env` (runbook Part 7). Run as **ulinkai** (`sudo su -` → `su - ulinkai`) unless
marked root.

**S1. Upload folder private (root, once per server)** — the `.env` passes through it:

```bash
chmod 2770 /home/ulinkai/upload && ls -ld /home/ulinkai/upload      # drwxrws--- ulinkai ulinkai
```

**S2. Upload (WinSCP as admin → `/home/ulinkai/upload/`):** the release `.tar.gz`, `ulink-deploy-api.sh`,
`ulink-api-runtime.Dockerfile`, `src/ulink-api/.env.uat` (hidden file: Ctrl+Alt+H in WinSCP).

**S3. Install the deploy script**

```bash
sed -i 's/\r$//' ~/upload/ulink-deploy-api.sh
install -D -m 755 ~/upload/ulink-deploy-api.sh ~/bin/ulink-deploy-api && rm ~/upload/ulink-deploy-api.sh
~/bin/ulink-deploy-api                      # usage: … uat|prod …
```

**S4. Build the runtime image** (once per server; 1–2 min; downloads Debian packages)

```bash
sed -i 's/\r$//' ~/upload/ulink-api-runtime.Dockerfile
cd ~/upload && docker build -t ulink-api-runtime:22 -f ulink-api-runtime.Dockerfile . && rm ulink-api-runtime.Dockerfile && cd
docker run --rm ulink-api-runtime:22 sh -c 'node -v && pdftoppm -v 2>&1 | head -1'
```

Expect `Successfully tagged ulink-api-runtime:22`, then `v22.23.2` and `pdftoppm version 20.09.0`.

**S5. Install the `.env`**

```bash
sed -i 's/\r$//' ~/upload/.env.uat
install -m 600 ~/upload/.env.uat ~/uat/ulink-api/.env && rm ~/upload/.env.uat
ls -l ~/uat/ulink-api/.env                                      # -rw------- ulinkai ulinkai
grep -E '^(PORT|NODE_ENV|STORAGE_ROOT|CONSOLE_URL|CONSOLE_MIDDLEWARE_URL)=' ~/uat/ulink-api/.env   # non-secret values only
```

**S6. First deploy** — unpacks the code and runs `npm ci`; ends in `FAILED at restart` because the container does
not exist yet (**expected**). A failure before `restart` is a real problem.

```bash
~/bin/ulink-deploy-api uat ~/upload/ulink-api_<...>.tar.gz
```

Result on 2026-10-14: `added 762 packages`, database reachable ("already up to date"), then
`No such container: ulink-api-uat` → `FAILED at restart`.

**S7. Create the container** (once; later deploys only restart it). Check no pipeline is running on your machine
first — the API marks `RUNNING` pipeline runs as `FAILED` when it starts (shared database).

```bash
D=/home/ulinkai/uat                         # prod: /home/ulinkai/prod
echo $D                                     # must print the folder — if empty, the mounts point at wrong paths
docker run -d --name ulink-api-uat --restart unless-stopped --log-opt max-size=20m --log-opt max-file=3 --network host --user $(id -u):$(id -g) \
  -v $D/ulink-api:/app -v $D/ulink-attachments:$D/ulink-attachments \
  -w /app -e NODE_ENV=production ulink-api-runtime:22 node bin/www
```

| Part | Meaning |
|---|---|
| `docker run -d` | create and start a container, in the background |
| `--name ulink-api-uat` | its name — the deploy script restarts it by this name; prod is `ulink-api-prod` |
| `--restart unless-stopped` | back automatically after a crash or server reboot, unless stopped with `docker stop` |
| `--log-opt max-size=20m --log-opt max-file=3` | caps Docker's own log at 3 × 20 MB (the `logs/*.log` files are rotated separately). `ulink-api-uat` was created 2026-10-14 without it — it gets it when next recreated |
| `--network host` | uses the server's network: listens on 127.0.0.1:3088 for nginx, reaches LM Studio over Tailscale |
| `--user $(id -u):$(id -g)` | runs as ulinkai, not root — files it writes belong to ulinkai |
| `-v $D/ulink-api:/app` | the env's code folder (with `.env`) appears inside as `/app` |
| `-v $D/ulink-attachments:$D/ulink-attachments` | attachments at the **same path** inside, so the absolute `.env` paths work and files stay on the server's disk when the container is recreated |
| `-w /app` | starts in the code folder |
| `-e NODE_ENV=production` | production mode (log format, no error details to users) |
| `ulink-api-runtime:22` | the image from S4 (Node 22 + PDF tools) |
| `node bin/www` | starts ulink-api (same as `npm start`); the port comes from `PORT` in `.env` |

**S8. Check**

```bash
sleep 5
docker ps --filter name=ulink-api-uat                                              # STATUS "Up …"
docker logs --tail 30 ulink-api-uat                                                # "Server listening on port 3088"
curl -s -o /dev/null -w "api %{http_code}\n" http://localhost:3088/api/docs        # 200
curl -s -o /dev/null -w "via nginx %{http_code}\n" http://localhost:5173/api/docs  # 200 (502 before the container)
```

Rebuild the runtime image only when `ulink-api-runtime.Dockerfile` changes (see "Adding a library"); reinstall the
script when `ulink-deploy-api.sh` changes.

## Adding a library

**npm package** (most cases) — nothing to do on the server:

1. On your machine: `npm install <pkg>` in `src/ulink-api`, commit `package.json` **and** `package-lock.json`.
2. Release as usual — the deploy's `npm ci` installs it into that environment's `node_modules`.

Exception: a package that compiles native code at install time and has no prebuilt binary for Linux x64 / glibc
2.31 (`npm ci` fails with `gyp` / `make` / `python` errors). It then needs build tools in the image — treat it as a
Linux library below (`python3 make g++`).

**Linux library / command** (like `poppler-utils` for `pdftoppm`) — a new runtime image, tried on uat first. Each
environment's container keeps the image it was created with, and the deploy script uses that same image for
`npm ci` / migrate, so prod is untouched until you move it.

```bash
# 1. your machine: add the package to the apt-get install line in ulink-api-runtime.Dockerfile; commit; upload it
# 2. server, as ulinkai: build under a NEW tag (never overwrite the tag prod uses)
cd ~/upload && docker build -t ulink-api-runtime:22-2 -f ulink-api-runtime.Dockerfile . && cd
# 3. recreate the uat container on the new image (same docker run as one-time setup, new tag)
docker rm -f ulink-api-uat
D=/home/ulinkai/uat
docker run -d --name ulink-api-uat --restart unless-stopped --log-opt max-size=20m --log-opt max-file=3 --network host --user $(id -u):$(id -g) \
  -v $D/ulink-api:/app -v $D/ulink-attachments:$D/ulink-attachments \
  -w /app -e NODE_ENV=production ulink-api-runtime:22-2 node bin/www
# 4. test uat; then the same rm + run for prod with D=/home/ulinkai/prod, name ulink-api-prod
docker ps --format '{{.Names}} {{.Image}}'          # which env runs which image
```

`docker restart` does **not** switch images — only `rm -f` + `run` does. Recreating a container keeps the code,
`.env` and attachments (they are folders on the server, mounted in). Bump the tag each time (`22-3`, …); delete
an old image only when no container uses it: `docker image rm ulink-api-runtime:22`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker: invalid reference format` → `FAILED at npm-ci` | Old `ulink-deploy-api.sh` (before 2026-10-14 fix) on a first deploy — reinstall the current script and rerun. |
| `FAILED at no-env` | `~/uat/ulink-api/.env` missing — see "Change a setting". |
| `FAILED at restart` on the very first deploy | Expected — create the container (one-time setup). |
| `FAILED at npm-ci` | No internet from the container, or `package-lock.json` out of date — commit a fresh lock file. |
| `FAILED at migrate` | DB unreachable (outbound 5432) or a migration error — `docker logs` is empty here; rerun the `in_node` command by hand to see the error. |
| `FAILED at health` | App crashed on start — `docker logs --tail 50 ulink-api-uat`. |
| `pthread_create` / `Operation not permitted` in logs | Wrong image (bookworm) — must be `ulink-api-runtime:22` (bullseye base, runbook Part 4b). |
| `docker build`: `404 Not Found` from `deb.debian.org/debian-security` | Debian 11 (bullseye) is end-of-life; its packages moved to `archive.debian.org`. The Dockerfile switches apt there — make sure the uploaded Dockerfile is the current one (2026-10-14). |
| `pdftoppm failed` / `pdftotext` not found | Container not using `ulink-api-runtime:22`. |
| Browser login gives 502 | Container not running / not on 3088 — `docker ps`, `ss -ltnp \| grep 3088`. |
| Console "run pipeline" fails with `403` on `/api/jobs/...` | Old nginx file with the `/api/jobs/` block (before 2026-10-14) — install the current `ulinkai-console-uat-nginx.conf`. The console calls those routes itself. |
| `got permission denied … docker.sock` | Not ulinkai, or ulinkai session predates the docker group — log out and `su - ulinkai` again. |
