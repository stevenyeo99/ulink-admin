# Deployment — AWS server (UAT now, prod later)

Start here. Which file answers what:

| Question | File |
|---|---|
| **Every release, step by step (API + console, UAT → prod)** | `RELEASE_GUIDE.md` |
| Release a new **console** build | `DEPLOY_CONSOLE.md` |
| Release a new **API** build, change its `.env`, check / roll back | `DEPLOY_API.md` |
| Scheduled pipelines (cron) — install, change, pause, prod | `CRONTAB_SETUP.md` |
| How the server was set up, why, what was checked, progress | `ULINK_AWS_User_and_Tailscale_Setup.md` |
| Add **prod** next to UAT | `ULINK_AWS_User_and_Tailscale_Setup.md` Part 7 |
| Original plan (Phases 0–8, written before the server was inspected) | `ULINK_AWS_Deployment_Guide.docx` |

| File | Runs where | Purpose |
|---|---|---|
| `pack-release.sh` | your machine (WSL) | packs `release/api/` / `release/console/` `.tar.gz` |
| `ulink-deploy-console.sh` | server, `~/bin/ulink-deploy-console <uat\|prod> <file>` | installs a console release |
| `ulink-deploy-api.sh` | server, `~/bin/ulink-deploy-api <uat\|prod> <file>` | installs an API release |
| `ulink-api-runtime.Dockerfile` | server, `docker build` once | Node 22 (bullseye) + poppler-utils image for ulink-api |
| `ulinkai-logrotate.conf` | server, `/etc/logrotate.d/ulinkai` | daily rotate + gzip of ulink-api `logs/*.log`, 30 days |
| `ulinkai-console-uat-nginx.conf` | server, `/etc/nginx/conf.d/` | UAT site on port 5173: console files + `/api` → 3088 |

Quick facts: server `47.131.150.18` (Tailscale `100.65.116.86`), Debian 9; everything ULINK lives under
`/home/ulinkai/{uat,prod}` and runs as `ulinkai`; uploads go through WinSCP (`admin`) to `/home/ulinkai/upload/`.
