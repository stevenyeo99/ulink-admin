# Console users: create, reset, disable

The console has no Users page yet. You manage console users with `src/ulink-api/scripts/users.js`.

The script asks for each password at a hidden prompt. You never type a password on the command line.

## Rules

- The only role is `super_admin` (`src/ulink-api/modules/auth/auth.js`).
- A password must have at least 8 characters.
- A username is stored in lowercase.
- If the user already exists, `create` stops with `User "<name>" already exists.` and changes nothing.

## Commands

| Task | Command |
|---|---|
| Create a user | `create <username> [--name "Full Name"]` |
| Set a new password | `reset-password <username>` |
| Block sign-in | `disable <username>` |
| Allow sign-in again | `enable <username>` |

The sections below show where to run each command. Each example creates `ulink1`, `ulink2` and `ulink3`.

## Dev database, from your machine

Your machine uses `src/ulink-api/.env`, which points at the dev database.

```bash
cd /mnt/c/git/ULINK/ULINK-STP-PROJECT/ulink-admin/src/ulink-api
for u in ulink1 ulink2 ulink3; do npm run user:create -- "$u"; done
```

## UAT database, from your machine

This method uses `src/ulink-api/.env.uat`, the same file that `npm run db:migrate:uat` uses.

1. Make sure that `SUPABASE_DB_CONN_STR` in `.env.uat` is the UAT database.
2. Run the commands:

```bash
cd /mnt/c/git/ULINK/ULINK-STP-PROJECT/ulink-admin/src/ulink-api
for u in ulink1 ulink2 ulink3; do node --env-file=.env.uat scripts/users.js create "$u"; done
```

Node loads `.env.uat` first. The `dotenv` call in the script does not replace variables that already exist, so the script uses the UAT values.

If your machine cannot connect to the UAT database, the command fails with a connection error. In that case, use the server method below.

## UAT, on the server

1. Sign in to the server as `ulinkai` (see `ULINK_AWS_User_and_Tailscale_Setup.md`).
2. Run the script in the API runtime container, with `-it` for the password prompt:

```bash
for u in ulink1 ulink2 ulink3; do
  docker run --rm -it --user $(id -u):$(id -g) --network host \
    -v ~/uat/ulink-api:/app -w /app ulink-api-runtime:22 \
    npm run user:create -- "$u"
done
```

For prod, replace `~/uat/ulink-api` with `~/prod/ulink-api`.

## Other tasks

Use the same pattern. Replace `create` with the task. For example, to set a new password for `ulink1` on UAT from your machine:

```bash
node --env-file=.env.uat scripts/users.js reset-password ulink1
```
