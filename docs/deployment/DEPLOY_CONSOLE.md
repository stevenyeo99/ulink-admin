# Deploy ulink-console to AWS

How to release a new ulink-console build to the AWS server. The console is static files only (no secrets, database
or Docker). UAT and prod live side by side on the same server, each in its own folder:

| Env | Folder | nginx file | URL |
|---|---|---|---|
| **uat** | `/home/ulinkai/uat/ulink-console/dist` | `ulinkai-console-uat-nginx.conf` | `http://<server ip>:5173` |
| **prod** | `/home/ulinkai/prod/ulink-console/dist` | `ulinkai-console-prod-nginx.conf` (not yet) | `http://<server ip>:5174` |

Always deploy to **uat** first; prod asks you to type `prod` to confirm. Server setup history and reasons:
`ULINK_AWS_User_and_Tailscale_Setup.md`.

| Where | Who | What |
|---|---|---|
| Your machine (WSL) | you | build the release `.tar.gz` |
| WinSCP | `admin` | upload to `/home/ulinkai/upload/` |
| Server shell | `ulinkai` | install it with `~/bin/ulink-deploy-console` |

## Every release

**1. Build (WSL, from `ulink-admin`)**

```bash
cd /mnt/c/git/ULINK/ULINK-STP-PROJECT/ulink-admin
git status -- src/                                   # commit first — the script refuses uncommitted src/ changes
bash docs/deployment/pack-release.sh ulink-console
```

Output: `release/console/ulink-console_<YYYYMMDD-HHMM>_<commit>.tar.gz` — in Windows
`C:\git\ULINK\ULINK-STP-PROJECT\ulink-admin\release\console\`. `release/` is git-ignored. To test uncommitted work:
`ALLOW_DIRTY=1 bash docs/deployment/pack-release.sh ulink-console` (the name then shows the last commit, not your
changes — test only).

**2. Upload (WinSCP, logged in as `admin`)**

Open `/home/ulinkai/upload/` directly (Ctrl+O) — `/home/ulinkai` itself cannot be listed by admin, that is expected.
Copy the `.tar.gz` there.

**3. Deploy (server: `sudo su -` → `su - ulinkai`)**

```bash
~/bin/ulink-deploy-console uat ~/upload/ulink-console_<YYYYMMDD-HHMM>_<commit>.tar.gz    # or: prod
tail -n 3 ~/uat/releases/ulink-deploy.log          # last line ends in OK
ls -la ~/uat/ulink-console/dist                     # index.html + assets/
```

The script moves the file into `~/<env>/releases/ulink-console/`, empties `dist/`, extracts, keeps the last 5 releases and
logs one line. nginx serves the new files at once — no reload needed. Hard-refresh the browser (Ctrl+F5).

## Rollback

```bash
ls -t ~/uat/releases/ulink-console/                               # newest first; last 5 kept
~/bin/ulink-deploy-console uat ulink-console_<older>.tar.gz       # name only — it is already in releases/
```

## Release log

`tail -n 30 ~/uat/releases/ulink-deploy.log` — one log per environment, shared with ulink-api:

```
2026-10-14 09:40:12 | uat/ulink-console  | ulink-console_20261014-0928_7a479f0.tar.gz | sha256 301b6a5bf4fd | by admin | OK
```

`by` is the SSH login behind `su - ulinkai`. A failure reads `FAILED at <step>` (`copy`, `extract`, `prune`).

## Quick look without nginx (optional)

```bash
cd ~/uat/ulink-console/dist && python3 -m http.server 8081 --bind <tailscale ip -4>   # Ctrl-C to stop
```

Laptop: `http://<tailscale ip>:8081` shows the login page. Deep links and `/api` calls return 404 here — nginx does
the SPA fallback and the `/api` proxy to ulink-api (uat 3088, prod 3089).

## One-time setup (done 2026-10-14 — only for a new server)

As root:

```bash
usermod -aG ulinkai admin                                      # admin may upload; reconnect WinSCP after
install -d -o ulinkai -g ulinkai -m 2770 /home/ulinkai/upload  # setgid: uploads get group ulinkai
```

Upload `docs/deployment/ulink-deploy-console.sh` to `/home/ulinkai/upload/` (WinSCP transfer mode Text or
Automatic), then as ulinkai:

```bash
sed -i 's/\r$//' ~/upload/ulink-deploy-console.sh             # strip Windows line endings if any
install -D -m 755 ~/upload/ulink-deploy-console.sh ~/bin/ulink-deploy-console && rm ~/upload/ulink-deploy-console.sh
```

Repeat that install whenever `ulink-deploy-console.sh` changes in the repo.

nginx (`/etc/nginx/conf.d/ulinkai-console-uat-nginx.conf`, root): see Part 6.3 of `ULINK_AWS_User_and_Tailscale_Setup.md`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| WinSCP `ls: cannot open directory '.'` | You are in `/home/ulinkai` (711). Open `/home/ulinkai/upload/` directly. |
| WinSCP upload "Permission denied" | admin not in group `ulinkai` yet: `id -nG admin` as root, then reconnect WinSCP. |
| `run as ulinkai` | You ran it as root/admin — `su - ulinkai` first. |
| `usage: … uat\|prod …` | Environment missing or misspelt — first argument is `uat` or `prod`. |
| `usage: … ulink-console_<YYYYMMDD-HHMM>_<commit>.tar.gz` | File was renamed (e.g. `(1)` from a second download) — keep the name `pack-release.sh` gave. |
| `bad interpreter: /bin/bash^M` | Script uploaded with Windows line endings — redo the `sed` + `install` above. |
| `Uncommitted changes in src/` (WSL) | Commit, or `ALLOW_DIRTY=1` for a test build. |
| Old page still shows | Browser cache — Ctrl+F5. |
