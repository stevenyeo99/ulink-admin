# ULINK on AWS — `ulinkai` user, Tailscale and Docker setup

Companion to `ULINK_AWS_Deployment_Guide.docx`. Covers the dedicated user and the private link to LM Studio,
adjusted for this server: **Debian 9 (stretch), glibc 2.24** → ulink-api runs in Docker (`node:22-bullseye-slim`), not nvm.

| Piece | Runs as | Owned by |
|---|---|---|
| ulink-console | Not a process — static files served by nginx | `ulinkai` (`/home/ulinkai/<env>/ulink-console/dist`) |
| ulink-api | Docker container `ulink-api-<env>`, `--user` = `ulinkai` uid | `ulinkai` (`/home/ulinkai/<env>/ulink-api`) |
| Tailscale | System service (`tailscaled`, root — needs the network device) | root; tag + ACL skipped (owner's choice) |
| Docker engine | System service (`dockerd`, root); `ulinkai` in `docker` group (Part 4b) | root |
| Pipeline cron (Phase 8) | `ulinkai` crontab | `ulinkai` |

**UAT and prod on one server (owner's choice 2026-10-14)** — `<env>` is `uat` or `prod`; nothing is shared between
them except the `ulinkai` user, `bin/` scripts and the `upload/` drop folder:

| | UAT | Prod |
|---|---|---|
| Folder | `/home/ulinkai/uat/` | `/home/ulinkai/prod/` (created when prod starts) |
| Console (nginx) | port 5173, `ulinkai-console-uat-nginx.conf` | port 5174 until a domain, `ulinkai-console-prod-nginx.conf` |
| API | container `ulink-api-uat`, `PORT=3088` | container `ulink-api-prod`, `PORT=3089` |
| `.env` | UAT DB / inbox / IAS | prod DB / inbox / IAS — **never the same as UAT**, or both process the same claims |
| Cron | calls 3088 | calls 3089 |

Existing apps on the server (PM2 apps under `admin`, `hcbase`, `root`) stay as they are — this guide does not run,
list, restart or change them.

## Progress (2026-10-14)

- [x] Server inspected: Debian 9, glibc 2.24, x86_64, `/dev/net/tun` present. Baseline: `nameserver 172.31.0.2`;
      routes `default via 172.31.0.1 dev eth0`, `172.31.0.0/20 dev eth0`.
- [x] Tailscale 1.104.1 installed via apt (dry run: only `tailscale` + `tailscale-archive-keyring`, 0 upgraded).
      Other apt sources (Debian stretch, PHP, MongoDB, Yarn) were already broken — left as they are.
- [x] `tailscale up --hostname=ulink-aws --accept-dns=false` with the owner's account (Part 3 ACL/auth key skipped).
- [x] Key expiry disabled for `ulink-aws` (it is untagged, so it would otherwise drop off after ~180 days) — 2026-10-14.
- [x] `curl http://<LM Studio 100.x>:1234/v1/models` works from the server — 2026-10-14.
- [x] `/etc/resolv.conf` and `ip route` match the baseline after Tailscale — 2026-10-14.
- [x] Part 1: `ulinkai` (uid 113) already existed with home `/srv/ulinkai` (only `.bash_history` in it) → moved with
      `usermod -d /home/ulinkai -m ulinkai`; folders + `ulink-attachments/` created and permissions set (2026-10-13).
- [x] UAT/prod layout: folders moved into `/home/ulinkai/uat/`; `upload/` (2770) + admin in group ulinkai (2026-10-14).
- [x] UAT console deployed (build `7a479f0`) and nginx `ulinkai-console-uat-nginx.conf` on 5173 reloaded (2026-10-14):
      `:5173/` 200, deep link → index.html, `/api/docs` 502 (API not up yet — expected). Existing sites before reload:
      `http://localhost/` 200, `https://localhost/` 301.
- [x] Console opens from the laptop over Tailscale: `http://100.65.116.86:5173` (2026-10-14).
- [x] AWS IT opened inbound TCP **5173** (console) and **3088** (API, owner's choice — to call the API directly when
      needed) from the Outline VPN (2026-10-14). Checked from the owner's machine: `:5173/` 200,
      `:5173/api/jobs/...` 403 (nginx block works), `:3088/api/docs/` 200. Note: on 3088 nginx is bypassed, so
      `/api/jobs/*` (no auth) is callable by anyone on Outline — keep the rule's source Outline-only; close 3088 when
      direct access is no longer needed.
- [x] Existing sites unchanged after reload: `http://localhost/` 200, `https://localhost/` 301 — same as before (2026-10-14).
- [x] `upload/` tightened to 2770 (`drwxrws---`) before the `.env` passes through it (2026-10-14).
- [x] Shared Supabase DB already migrated: `db:migrate:status` → 0 pending; all 49 migrations in release `7a479f0` are
      up, so the first deploy's `db:migrate` is a no-op (2026-10-14).
- [x] First `docker build` of the runtime image failed (2026-10-14): `404` for bullseye-security packages on
      `deb.debian.org` — bullseye is end-of-life and moved to `archive.debian.org`; Dockerfile now points apt there.
- [x] Runtime image `ulink-api-runtime:22` built on the server (image `46dd4aae5408`, 2026-10-14) with the
      archive.debian.org Dockerfile.
- [x] UAT `.env` installed from `.env.uat`: `~/uat/ulink-api/.env` 600 ulinkai; PORT 3088, NODE_ENV production,
      UAT attachment roots, hosted middleware URL, CONSOLE_URL public IP (2026-10-14).
- [x] First API deploy stopped at `npm-ci` with `docker: invalid reference format` (2026-10-14): before the
      container exists, `docker inspect` printed an empty line that got glued to the fallback image name. Fixed in
      `ulink-deploy-api.sh`; rerun with the release name only (it was already copied into `releases/`).
- [x] First UAT API deploy (`7a479f0`): extract → `npm ci` (762 packages, 11 s) → `db:migrate` ("already up to
      date" — first proof the server reaches Supabase) → `FAILED at restart` as expected, no container yet (2026-10-14).
- [x] Deploy script no longer migrates by default (owner, 2026-10-14): only warns about pending migrations;
      `MIGRATE=1` opts in. Never seeds.
- [x] Container `ulink-api-uat` created (S7). From the owner's machine over Outline (2026-10-14): `:5173/` 200,
      deep link `/cases/1` 200, `:5173/api/docs/` 200 (API behind nginx works; `/api/docs` without slash → 301, normal),
      `POST :5173/api/jobs/...` 403.
- [x] Console "run pipeline" got `403` on `GET /api/jobs/api-pipeline/runs` (2026-10-14): the nginx `/api/jobs/`
      block from the Word guide also blocks the console itself, which calls those routes. Block removed from
      `ulinkai-console-uat-nginx.conf`; protecting `/api/jobs` properly before prod is BACKLOG B9.
- [x] Updated nginx file installed (`nginx -t` ok, reload); owner confirmed the console's pipeline screen works
      over the public IP (2026-10-14). **UAT console + API deployed and usable.**
- [x] Log rotation installed: `/etc/logrotate.d/ulinkai` (2026-10-14). Dry run clean: runs as ulinkai (uid 113),
      finds uat `combined.log` + `error.log`; first real rotation the next night (a new file is only recorded on day 1).
- [x] Cron usable by ulinkai: `crontab -l` → "no crontab for ulinkai" (allowed, empty — Part 1.4 needs nothing) (2026-10-14).
      API-case attachments already written to `~/uat/ulink-attachments/claims/api/` by a console-triggered run.
- [ ] Still open for UAT: paste-check `docker ps` / `docker logs ulink-api-uat`; restart survival
      (`docker restart ulink-api-uat`); cron (Phase 8, `CRONTAB_SETUP.md`) — only after deciding to stop pipelines on the local machine
      (shared inbox / DB / IAS staging).
- [ ] Before prod: BACKLOG B9 (auth on `/api/jobs`), close 3088, Elastic IP, domain + HTTPS, prod's own DB / inbox / IAS,
      recreate `ulink-api-uat` with `--log-opt` (Docker log cap).
- [x] Part 4b: Docker 19.03.15 installed, held, `overlay2`; `node:22-bullseye-slim` smoke test ok (2026-10-14).
- [x] Part 4b.5: `ulinkai` in the `docker` group; `docker ps` works as ulinkai (owner's choice, 2026-10-14).
- [x] Owner confirmed (2026-10-14): `ulink-api-n14` does not use our Supabase DB, IMAP inbox or port 3088, and no
      other user/app reads `ulink-attachments/csr/` (stays 750, ulinkai only).
- [x] Deploy ulink-api (Docker) — Part 6.1 / `DEPLOY_API.md` S1–S8 (2026-10-14).

Each part ends with a check. Do not continue until it passes.

---

## Part 0 — Before you start

- [ ] **Client approval** for: a new OS user, and Tailscale on their server (it adds a private network path).
- [x] **Which tailnet** the server joins — the one the LM Studio machine is already on.
- [x] **`ulink-api-n14`** confirmed not using the same Supabase DB / IMAP inbox / port 3088 (else two copies process
      the same emails).
- [ ] Record the current state, to compare at the end:

```bash
sudo su -
cat /etc/resolv.conf                                                    # DNS must be unchanged at the end
ip route                                                                # routes must be unchanged at the end
ip rule > /root/baseline_iprule.txt                                     # Tailscale adds only "table 52" rules
iptables -S > /root/baseline_iptables.txt                               # Tailscale adds only "ts-" chains/jumps
systemctl list-unit-files | grep -E -i "firewall|ufw|iptables|netfilter" # a reload script would wipe ts- rules
```

---

## Part 1 — Create the `ulinkai` user (as root)

**1.1 Check the name is free**

```bash
getent passwd ulinkai || echo "free"
```

**1.2 Create it** — system account: no password (cannot log in directly), no sudo.

```bash
adduser --system --group --shell /bin/bash --home /home/ulinkai ulinkai
id ulinkai                     # note uid and gid — used by docker run --user
```

**1.3 Create the app folders** — everything ULINK lives under the `ulinkai` home, like `admin` / `hcbase`:

```
/home/ulinkai/                        711  home — others may pass through (nginx), not list
├── bin/                                   deploy scripts (Part 6), shared by both environments
├── upload/                          2770  WinSCP drop folder (admin is in group ulinkai; others no access — .env passes through)
└── uat/   (and later prod/, same tree) 711
    ├── releases/                    700  uploaded .tar.gz files + ulink-deploy.log, kept for rollback (Part 6)
    │   ├── ulink-api/
    │   └── ulink-console/
    ├── ulink-api/                   750  extracted API + .env (secrets): ulinkai only
    ├── ulink-console/dist/          755  extracted console build, read by nginx
    └── ulink-attachments/           750  case files (personal data) — outside ulink-api/, so deploys never touch it
        ├── claims/                       STORAGE_ROOT — ULINK's private copy of every case's attachments (grows daily)
        ├── console-upload/               CONSOLE_UPLOAD_ROOT — only used when CONSOLE_UPLOAD_METHOD=folder (now cl-upload)
        └── csr/                          CSR_UPLOAD_ROOT — downloaded CSR PDFs (only ulinkai reads them — confirmed
                                          2026-10-14; if another app ever needs them, give csr/ a shared group, not 755)
```

"Console" in these names is the client's **document console** (barcodes), not ulink-console — ulink-console never
reads files from disk.

```bash
ls -ld /home/admin /home/hcbase   # for reference: same pattern as the existing app users
E=uat                              # later: E=prod
D=/home/ulinkai/$E
mkdir -p $D/releases/ulink-api $D/releases/ulink-console $D/ulink-api $D/ulink-console/dist \
         $D/ulink-attachments/{claims,console-upload,csr}
chown -R ulinkai:ulinkai $D
chmod 711 /home/ulinkai $D
chmod 700 $D/releases
chmod 750 $D/ulink-api
chmod 755 $D/ulink-console $D/ulink-console/dist
chmod -R 750 $D/ulink-attachments
```

On this server the folders were first made directly under `/home/ulinkai/` (2026-10-13) and moved into `uat/` on
2026-10-14 (as root, nothing was running from them):

```bash
install -d -o ulinkai -g ulinkai -m 711 /home/ulinkai/uat
cd /home/ulinkai && mv releases ulink-api ulink-console ulink-attachments uat/
```

**1.4 Allow cron for ulinkai** (only if the server restricts cron)

```bash
ls /etc/cron.allow /etc/cron.deny 2>/dev/null
# If /etc/cron.allow exists:      echo ulinkai >> /etc/cron.allow
# If ulinkai is in /etc/cron.deny: remove that line
```

**Check**

```bash
su - ulinkai -c 'whoami; touch ~/uat/ulink-api/.t && rm ~/uat/ulink-api/.t && echo api-writable'
ps -eo user,cmd | grep "nginx: worker" | grep -v grep          # nginx user, usually www-data
sudo -u www-data test -r /home/ulinkai/uat/ulink-console/dist && echo console-readable
sudo -u www-data ls /home/ulinkai 2>/dev/null || echo home-not-listable   # expected
sudo -l -U ulinkai             # expect: not allowed to run sudo
id -nG ulinkai                 # expect: ulinkai docker — NOT sudo (docker added after Docker install)
```

From now on: `sudo su -` then `su - ulinkai`, the same habit as `hcbase`.

Rollback: `deluser --remove-home ulinkai && delgroup ulinkai` (removes `/home/ulinkai` and everything in it)

---

## Part 2 — Prepare the LM Studio machine

1. LM Studio → Developer → **Serve on Local Network** on (port 1234).
2. Load the vision, chat and embedding models (`EMBEDDING_MODEL` in `.env`).
3. Disable sleep; start LM Studio on boot.
4. Tailscale installed and logged in on this machine; note its Tailscale IP:
   `tailscale ip -4` → `100.a.b.c`.
5. Windows only: allow inbound TCP 1234 in Windows Firewall (Tailscale traffic arrives on its own adapter).

**Check** (on the LM Studio machine): `curl http://100.a.b.c:1234/v1/models` lists the models.

---

## Part 3 — Tailscale admin console (before the server joins)

> **Skipped on this server (owner's choice, 2026-10-13):** no ACL, no auth key, no tag. `ulink-aws` joined untagged
> with the owner's login, so: disable key expiry by hand, and the default policy lets it reach every tailnet device.
> Kept below in case it is applied later.

**3.1 Access controls** — Admin console → Access controls. Add the tag, the LM Studio host, and the rule.

> Careful: the default policy is "everyone can reach everything" (`"src": ["*"], "dst": ["*:*"]`). If you keep it,
> the server can reach every device on your tailnet. Replace it with the member rule below — your own devices keep
> full access; the tagged server gets port 1234 on one host only.

```jsonc
{
  "tagOwners": {
    "tag:ulink-server": ["autogroup:admin"]
  },
  "hosts": {
    "lmstudio": "100.a.b.c"
  },
  "acls": [
    // your own (untagged) devices: unchanged access
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] },
    // the AWS server: LM Studio API only
    { "action": "accept", "src": ["tag:ulink-server"], "dst": ["lmstudio:1234"] }
  ],
  "tests": [
    { "src": "tag:ulink-server", "accept": ["lmstudio:1234"], "deny": ["lmstudio:22", "lmstudio:3389"] }
  ]
}
```

Save — the `tests` block is checked on save and rejects the policy if the server could reach more than 1234.

**3.2 Auth key** — Settings → Keys → Generate auth key:
- Reusable: **off** · Ephemeral: **off** · Pre-approved: **on** · Tags: **`tag:ulink-server`**
- Copy the `tskey-auth-...` value. Treat it like a password; it is single-use.

Tagged devices do not expire, so the server will not drop off after 180 days.

---

## Part 4 — Install Tailscale on the server (as root)

**4.1 Pre-checks**

```bash
uname -m                       # x86_64 → amd64 (aarch64 → arm64)
ls -l /dev/net/tun             # must exist
apt-get update                 # stretch is EOL: may show 404s for the Debian repos
```

**4.2a Install with the official script** (if `apt-get update` works)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled
tailscale version
```

**4.2b Fallback: static binaries** (if apt is broken or the script refuses stretch)

Get the current version from https://pkgs.tailscale.com/stable/#static, then:

```bash
V=<version>                    # e.g. as listed on that page
cd /tmp && curl -fsSLO https://pkgs.tailscale.com/stable/tailscale_${V}_amd64.tgz
tar xzf tailscale_${V}_amd64.tgz && cd tailscale_${V}_amd64
install -m 755 tailscale /usr/bin/ && install -m 755 tailscaled /usr/sbin/
install -m 644 systemd/tailscaled.service /etc/systemd/system/
install -m 644 systemd/tailscaled.defaults /etc/default/tailscaled
systemctl daemon-reload && systemctl enable --now tailscaled
tailscale version
```

Note: static installs do not auto-update — re-run with a newer version from time to time.

**4.3 Join the tailnet**

```bash
tailscale up \
  --authkey=tskey-auth-XXXX \
  --advertise-tags=tag:ulink-server \
  --hostname=ulink-aws \
  --accept-dns=false
```

As run on this server (Part 3 skipped): `tailscale up --hostname=ulink-aws --accept-dns=false`, logged in via the
printed URL with the owner's account.

- `--accept-dns=false`: leaves `/etc/resolv.conf` alone, so the existing apps' DNS is not changed. The server then
  reaches LM Studio by **IP** (`100.a.b.c`), not by MagicDNS name.
- Routes from other nodes are not accepted (Linux default) — the server's routing is unchanged.
- Do **not** add `--ssh`, `--advertise-exit-node`, or use `tailscale funnel` / `tailscale serve`.

**Check**

```bash
tailscale status                              # ulink-aws online; lmstudio listed
curl -s http://100.a.b.c:1234/v1/models       # must list the models
curl -s -m 5 http://100.a.b.c:3389 ; echo $?  # only with Part 3 ACL: must fail/time out
cat /etc/resolv.conf; ip route                # same as Part 0 (Tailscale routes live in table 52)
diff <(ip rule) /root/baseline_iprule.txt      # only table 52 lines added
diff <(iptables -S) /root/baseline_iptables.txt | grep '^[<>]' | grep -v ts-   # expect no output
```

In the admin console, `ulink-aws` shows "Expiry disabled" (and tag `tag:ulink-server` if Part 3 was applied).

Rollback: `tailscale down && tailscale logout && systemctl disable --now tailscaled`, then
`apt-get remove tailscale` (or delete the copied files), and remove the machine in the admin console.

---

## Part 4b — Install Docker (as root)

Done on this server 2026-10-14. Everything as root; dry run first, paste output before installing.

**On a newer server** (Debian 11+ / Ubuntu 22.04+, glibc ≥ 2.28): skip this part's version pins — install current
Docker CE from `download.docker.com` for that release, and plain `node:22-slim` is fine. The pins and the bullseye
image below exist only because of Debian 9.

**4b.1 Read-only checks**

```bash
uname -r                                       # this server: 4.9.0-12-amd64
df -h / /var/lib                               # images need ~1 GB; this server: 75 GB free
dpkg -l | grep -Ei 'docker|containerd|runc'    # expect nothing (clean install)
iptables -S | head -20                         # keep for comparison; Docker adds its own chains
which gpg                                      # needed to convert the repo key
```

**4b.2 Add Docker's repo** (adds one key file + one apt source, installs nothing)

```bash
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian stretch stable" \
  > /etc/apt/sources.list.d/docker.list
# refresh ONLY this source — the server's other apt sources are broken and belong to other apps
apt-get update -o Dir::Etc::sourcelist=sources.list.d/docker.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
```

**4b.3 Dry run, then install** — always `--no-install-recommends`

```bash
V=5:19.03.15~3-0~debian-stretch                # newest Docker CE published for stretch
apt-get install -s --no-install-recommends docker-ce=$V docker-ce-cli=$V containerd.io
# expect: only containerd.io docker-ce docker-ce-cli; 0 upgraded, 0 to remove. If anything else, stop.
apt-get install -y --no-install-recommends docker-ce=$V docker-ce-cli=$V containerd.io
apt-mark hold docker-ce docker-ce-cli containerd.io   # apt upgrade must not move Docker under the container
```

Without `--no-install-recommends` apt adds 10 more packages: `aufs-dkms`, `dkms` and kernel headers for **4.9.0-19**
while **4.9.0-12** runs — a kernel-module build on a shared server, for a storage driver Docker does not use
(it uses `overlay2`). `cgroupfs-mount` (systemd does this) and `pigz` (faster pulls only) are not needed either.

**4b.4 Check**

```bash
systemctl is-active docker; systemctl is-enabled docker     # active / enabled
apt-mark showhold                                           # containerd.io docker-ce docker-ce-cli
docker info --format '{{.ServerVersion}} {{.Driver}}'       # 19.03.15 overlay2 — stop if not overlay2
docker run --rm node:22-bullseye-slim node -e "require('worker_threads'); console.log(process.version, 'ok')"
cat /etc/resolv.conf; ip route   # DNS unchanged; only new route: 172.17.0.0/16 dev docker0 (linkdown until used)
```

Result here: `v22.23.2 ok`. **Why bullseye, not `node:22-slim`:** `node:22-slim` is bookworm (glibc 2.36), which
starts threads with the `clone3` syscall. Docker 19.03's seccomp profile answers unknown syscalls with EPERM instead
of ENOSYS, so glibc does not fall back to `clone` and Node fails with `pthread_create` / `Operation not permitted`.
`node:22-bullseye-slim` (glibc 2.31) never calls `clone3`. Do not "fix" it with `--security-opt seccomp=unconfined`.
Node 22 lists kernel ≥ 4.18 as supported; 4.9 works in practice — re-run the smoke test after any image change.

**4b.5 Let `ulinkai` run Docker** (owner's choice)

```bash
usermod -aG docker ulinkai
su - ulinkai -c 'id -nG; docker ps'     # "ulinkai docker" + empty list, not "permission denied"
```

The `docker` group is root-equivalent (`docker run -v /:/host …`): anyone who can log in as `ulinkai` can control
the whole server, including the other apps. Narrower alternative if that is not acceptable on a future server:
leave `ulinkai` out of the group and deploy as root instead (the deploy scripts then need a root variant).

Rollback: `apt-mark unhold docker-ce docker-ce-cli containerd.io && apt-get remove docker-ce docker-ce-cli
containerd.io`, `rm /etc/apt/sources.list.d/docker.list /usr/share/keyrings/docker.gpg`, `gpasswd -d ulinkai docker`.
Images and containers stay in `/var/lib/docker` until deleted.

---

## Part 5 — Hand-off values for Phase 5 (ulink-api `.env`)

| Key | Value |
|---|---|
| `LLM_URL` | `http://100.a.b.c:1234` (IP, because `--accept-dns=false`) |
| `EMBEDDING_URL` | empty (uses `LLM_URL`) |
| `PORT` | `3088` (uat) / `3089` (prod) |
| `STORAGE_ROOT` | `/home/ulinkai/<env>/ulink-attachments/claims` |
| `CONSOLE_UPLOAD_ROOT` | `/home/ulinkai/<env>/ulink-attachments/console-upload` |
| `CSR_UPLOAD_ROOT` | `/home/ulinkai/<env>/ulink-attachments/csr` |
| `CONSOLE_URL` | `http://<server ip>:5173` (uat) / `:5174` (prod) — links in team emails |

The container runs with `--network host`, so it uses the server's `tailscale0` link directly — no extra setup.
`docker run` is done as `ulinkai` (Part 4b.5) and always uses `--user <ulinkai uid>:<ulinkai gid>` (from step 1.2).

---

## Part 6 — Releases: build, deploy, log

**Routine releases: console → `DEPLOY_CONSOLE.md`, API → `DEPLOY_API.md`; index of all files → `README.md`.**

**Routine console releases: follow `DEPLOY_CONSOLE.md`** (WinSCP upload to `/home/ulinkai/upload/`, deploy as ulinkai).

Three scripts in this folder:

| Script | Where | Does |
|---|---|---|
| `pack-release.sh` | your machine (WSL) | builds `ulink-admin/release/<api|console>/<app>_<YYYYMMDD-HHMM>_<commit>.tar.gz` (git-ignored) |
| `ulink-deploy-api.sh` | server, as `~/bin/ulink-deploy-api`, **run as ulinkai** | API: extract → `npm ci` → warn on pending migrations (no migrate/seed unless `MIGRATE=1`) → restart → health; keeps last 5; logs |
| `ulink-deploy-console.sh` | server, as `~/bin/ulink-deploy-console`, **run as ulinkai** | console: replace `dist/`; keeps last 5; logs |

The API tarball is `git archive` of the committed `src/ulink-api` — no `.env`, `node_modules`, `data/` or logs, so
the server's `.env` and attachments are never overwritten. `pack-release.sh` refuses to run with uncommitted changes
in `src/`, so each release matches a commit.

**Who runs what (owner's choice 2026-10-14):** every deploy, container command and file in `/home/ulinkai` is done
**as `ulinkai`** (`sudo su -` → `su - ulinkai`). Root is needed only for the one-time nginx file in 6.3.

**Uploads:** WinSCP as `admin` into `/home/ulinkai/upload/` (Ctrl+O to open it — admin cannot list `/home/ulinkai`).
Scripts uploaded from Windows: run `sed -i 's/\r$//' <file>` before installing. Both deploy scripts take the
environment first (`uat|prod`) and ask you to type `prod` before touching prod.

**6.1 One-time setup (as `ulinkai`)**

```bash
install -D -m 755 ~/upload/ulink-deploy-api.sh ~/bin/ulink-deploy-api        # each env logs to ~/<env>/releases/ulink-deploy.log
install -D -m 755 ~/upload/ulink-deploy-console.sh ~/bin/ulink-deploy-console
rm ~/upload/ulink-deploy-*.sh

# runtime image: node:22-bullseye-slim + poppler-utils (pdftoppm/pdftotext for claim recognition)
cd ~/upload && docker build -t ulink-api-runtime:22 -f ulink-api-runtime.Dockerfile . && rm ulink-api-runtime.Dockerfile && cd
docker run --rm ulink-api-runtime:22 sh -c 'node -v && pdftoppm -v 2>&1 | head -1'

# .env per environment — the deploy script stops if it is missing. UAT: src/ulink-api/.env.uat on your machine
# (git-ignored; a copy of the local .env with the server paths/port/URL), uploaded to ~/upload/:
sed -i 's/\r$//' ~/upload/.env.uat
install -m 600 ~/upload/.env.uat ~/uat/ulink-api/.env && rm ~/upload/.env.uat
```

`.env.uat` differs from the local `.env` only in `NODE_ENV=production`, `LOG_LEVEL=info`, the three
`/home/ulinkai/uat/ulink-attachments/...` roots and `CONSOLE_URL=http://47.131.150.18:5173` (testers open it with Outline connected). It keeps the local
Supabase DB, IMAP inbox, IAS staging and `LLM_URL` (LM Studio's Tailscale IP) — so **do not run the pipelines on
your machine once UAT's cron is on**, or both process the same emails. `CONSOLE_MIDDLEWARE_URL` points
to the hosted console-middleware, `https://tpa.api.ias.staging.ins-link.com/admin/_` (the code appends
`/api/files/materials`, `/api/files/download/zip`, `/api/barcodes`) — not a local :3023. Owner confirmed on 2026-10-14 that
the server can call it with no auth (barcodes / materials, scanId `API-AYA-CL-26031486`).

First API deploy per environment: extract and install once, then create the container (it is restarted, not
recreated, on later deploys):

```bash
E=uat; D=/home/ulinkai/$E                            # prod: E=prod
~/bin/ulink-deploy-api $E ~/upload/ulink-api_<...>.tar.gz   # fails at "restart" the first time — container not there yet
docker run -d --name ulink-api-$E --restart unless-stopped --log-opt max-size=20m --log-opt max-file=3 --network host --user $(id -u):$(id -g) \
  -v $D/ulink-api:/app \
  -v $D/ulink-attachments:$D/ulink-attachments \
  -w /app -e NODE_ENV=production ulink-api-runtime:22 node bin/www
# the attachments mount uses the same path inside the container, so the absolute .env paths work;
# without it, files land inside the container and vanish when it is recreated
curl -s localhost:3088/api/docs | head               # prod: 3089
```

**6.2 Every deploy**

```bash
# your machine (WSL), from ulink-admin
bash docs/deployment/pack-release.sh both          # or ulink-api / ulink-console → release/{api,console}/
# WinSCP (admin): upload the .tar.gz to /home/ulinkai/upload/

# server, as ulinkai — uat first, prod only after uat is checked
~/bin/ulink-deploy-api uat ~/upload/ulink-api_20261013-1530_a41af1d.tar.gz
~/bin/ulink-deploy-console uat ~/upload/ulink-console_20261014-0928_7a479f0.tar.gz
```

The upload is moved into `~/<env>/releases/<app>/`. To release the same build to prod afterwards, upload it again
(each environment keeps its own copy). API: extract → `npm ci` → pending-migration warning (`MIGRATE=1` to migrate) (both in a throwaway
`ulink-api-runtime:22` container as ulinkai) → restart `ulink-api-<env>` → health check on `PORT` from that env's
`.env`. Console: empty `dist/`, extract; nginx serves it at once. Console details: `DEPLOY_CONSOLE.md`.

**Rollback:** give a name already in `~/<env>/releases/<app>/`: `~/bin/ulink-deploy-api uat ulink-api_20261012-0900_9f3c2aa.tar.gz`
(migrations are not undone — use `npm run db:migrate:undo` only if the old code needs it).

**Release log:** `tail -n 30 ~/uat/releases/ulink-deploy.log` — one log per environment, one line per run (both
scripts; `by` = the SSH login behind `su - ulinkai`):

```
2026-10-14 15:42:10 | uat/ulink-api      | ulink-api_20261014-1530_7a479f0.tar.gz | sha256 3f9a1c0b7e21 | by admin | OK
2026-10-14 16:05:33 | uat/ulink-console  | ulink-console_20261014-1600_7a479f0.tar.gz | sha256 b81e... | by admin | FAILED at extract
```

**6.3 First test: UAT console only** (2026-10-14)

Console deployed with `DEPLOY_CONSOLE.md`. Then nginx, as root — the only root step. Read-only checks first
(shared server — 10 existing sites in `conf.d/`, all on 80/443 by domain name; results on 2026-10-14 in brackets):

```bash
nginx -v                                               # [1.10.3]
grep -n "include" /etc/nginx/nginx.conf                # [conf.d/*.conf included]
ls /etc/nginx/conf.d /etc/nginx/sites-enabled
grep -rn "listen" /etc/nginx/conf.d /etc/nginx/sites-enabled   # [only 80 / 443]
ss -ltnp | grep -E ':(5173|3088) '                     # [no output = free]
grep -rn '5173' /etc/nginx/ /etc/systemd/system/ /etc/crontab /etc/cron.d/ 2>/dev/null   # nothing else set up for it
nginx -t                                               # [existing config ok BEFORE adding ours]
ps -eo user,cmd | grep "nginx: worker" | grep -v grep   # [www-data]
sudo -u www-data test -r /home/ulinkai/uat/ulink-console/dist/index.html && echo console-readable
```

Then add **one new file** from `docs/deployment/ulinkai-console-uat-nginx.conf` (uploaded to `/home/ulinkai/upload/`):

```bash
sed -i 's/\r$//' /home/ulinkai/upload/ulinkai-console-uat-nginx.conf
install -o root -g root -m 644 /home/ulinkai/upload/ulinkai-console-uat-nginx.conf /etc/nginx/conf.d/ulinkai-console-uat-nginx.conf
nginx -t                       # error → rm the file; nothing was loaded, other sites unaffected
systemctl reload nginx         # only after -t is ok; reload (not restart) keeps the other sites serving
```

Why not 80/443: without a domain, a request to the bare IP goes to nginx's default site (an existing app); taking
that over would change what every IP-only caller of the other apps gets. With a domain later: `listen 80;` +
`server_name ulink.<domain>;` in our file, then `certbot --nginx -d ulink.<domain>`.

**Public IP access (optional):** the server firewall already allows it (`iptables -P INPUT ACCEPT`; Docker only
changes FORWARD) — the block is the **AWS security group**. EC2 → Instances → this server → Security → the security
group → Edit inbound rules → Add: Custom TCP, port 5173, source **My IP** (never `0.0.0.0/0`), description
`ULINK UAT console`. The group is shared with the other apps; a 5173 rule does not affect their 80/443. If the public
IP is not an Elastic IP it changes on stop/start. Tailscale needs no rule.

Verify: `curl -sI http://localhost:5173/` → 200; a deep link (`/some/page`) also returns `index.html`; from your
laptop open `http://<tailscale ip -4>:5173` (no AWS change) or `http://<public ip>:5173` (security-group rule TCP
5173 from your IP only). Expected: login page loads, login itself gives **502** — ulink-api-uat is not running yet,
which proves `/api` is proxied to 3088.

Rollback: `rm /etc/nginx/conf.d/ulinkai-console-uat-nginx.conf && nginx -t && systemctl reload nginx`

---

## Part 7 — Adding prod (when UAT is signed off)

Same server, same `ulinkai`, same scripts — only `E=prod` and the prod values change. UAT keeps running untouched.

1. **Folders** (root): Part 1.3 block with `E=prod`.
2. **Port check** (root): `ss -ltnp | grep -E ':(5174|3089) '` → no output.
3. **`.env`** (ulinkai): `cat > ~/prod/ulink-api/.env && chmod 600 ~/prod/ulink-api/.env` with `PORT=3089`,
   `/home/ulinkai/prod/ulink-attachments/...` paths, `CONSOLE_URL=http://<server ip>:5174` and the **prod** DB, IMAP
   inbox, SMTP and IAS. Compare with UAT before going on: `diff ~/uat/ulink-api/.env ~/prod/ulink-api/.env` — DB, inbox
   and IAS lines must differ, or UAT and prod process the same claims.
4. **Console** (ulinkai): upload the UAT-tested `.tar.gz` again, `~/bin/ulink-deploy-console prod ~/upload/<file>`
   (type `prod` at the prompt).
5. **nginx** (root): copy `ulinkai-console-uat-nginx.conf` to `ulinkai-console-prod-nginx.conf` with `listen 5174;`,
   `root /home/ulinkai/prod/ulink-console/dist;` and both `proxy_pass http://127.0.0.1:3089;` — install into
   `/etc/nginx/conf.d/`, `nginx -t`, `systemctl reload nginx` (as 6.3).
6. **API** (ulinkai): 6.1 "first API deploy" with `E=prod` — container `ulink-api-prod`; check `curl -s localhost:3089/api/docs`.
7. **Cron** (ulinkai, Phase 8): prod's two lines on `127.0.0.1:3089` — `CRONTAB_SETUP.md` "Prod".
8. **Access**: `http://<tailscale ip>:5174`, or a security-group rule TCP 5174 from known IPs. With a domain later: see
   6.3 "With a domain later" — prod is the one to move to `https://ulink.<domain>` first.

Every later release: deploy to `uat`, check, then the same file to `prod`.

## Done when

- [x] `ulinkai` exists, owns `/home/ulinkai` (incl. `uat/releases/`), has no sudo; is in `docker` (owner's choice).
- [x] nginx user can read `/home/ulinkai/uat/ulink-console/dist` (2026-10-14).
- [x] Server is on the tailnet as `ulink-aws` with key expiry disabled.
- [x] `curl http://100.a.b.c:1234/v1/models` works from the server.
- [x] `/etc/resolv.conf` and `ip route` unchanged (checked 2026-10-14).
