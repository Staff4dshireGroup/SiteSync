# Staff4dshire Render staging plan

This is a plan for a second API process. It does not deploy anything, does not change `render.yaml`, and does not migrate or write the live database.

The live API `https://sitesync-backend.onrender.com` stays in its current Render account. The new workspace `tea-dbmv4dc9v7es73aqvj6g` (tom@staff4dshiregroup.com) is empty. Both processes would use the existing Supabase project `twydnjdzrfkqivvlurux`. No new database.

## Blueprint to plan

| Item | Value |
| --- | --- |
| Branch | `cursor/xero-projects-time-sync-d0b1` |
| Blueprint path | `render.staff4dshire.yaml` (repository root) |
| Service name | `sitesync-api-s4` |
| Plan | free |
| Region | oregon |
| Auto-deploy | `autoDeployTrigger: off` |
| Preview environments | `previews.generation: off` |
| Build | `npm install --workspaces=false --include=dev` then `npm run db:generate` then `npm run build` |
| Start | `npm start` (`node dist/index.js`) |
| Health | `GET /health` |
| Root directory | `backend` |

Render Blueprint auto-sync is a dashboard choice, not a field in the YAML. When the blueprint is linked, leave auto-sync off. Do not apply the plan until the owner approves it.

The public URL is assigned by Render at creation. It is not written into this repo. Do not assume `sitesync-api-s4.onrender.com` and do not reuse `sitesync-backend.onrender.com`.

## What staging is allowed to do

`SITESYNC_READ_ONLY=true` makes `GET /health` the only HTTP route. Every other method and path returns 503. Socket connections are refused. The process exits on boot in production if `JWT_SECRET` is missing or is the dev fallback, or if `DATABASE_URL` is missing.

`/health` does not query Supabase. A successful health check only proves the process started.

## Jobs that stay off

These stay off unless the named variable is `true`, and read-only mode forces them off even if the flag is `true`:

| Job | Variable on this blueprint | What it would write |
| --- | --- | --- |
| Xero token refresh | `XERO_TOKEN_REFRESH_JOB=false` | Rotates OAuth tokens in `xero_connections` on the shared database |
| Xero time push on approval | `XERO_PUSH_ON_APPROVAL=false` | Creates Xero time entries and `xero_time_syncs` rows |
| Onboarding reminders | `ONBOARDING_REMINDER_JOB=false` | Inserts notifications and updates onboarding rows |

The build does not run `prisma migrate`, `prisma db seed`, or a `preDeployCommand`. `SEED_ON_DEPLOY=false` is set as well. There is no Render cron service in this blueprint.

## Secrets: keys only

Paste values in the Render dashboard after the service exists. Do not commit them, put them in the blueprint, or send them in chat.

| Key | How to obtain it | Staging value |
| --- | --- | --- |
| `DATABASE_URL` | Supabase project `twydnjdzrfkqivvlurux`, Project Settings → Database. Use the existing pooled connection string. Do not create a project and do not reset the database password. A password reset would break the live API. | Required before the process will boot |
| `DIRECT_URL` | Same Supabase page, the direct (non-pooler) connection string. Not used by the staging build. Required only for a later approved `migrate deploy`. | Paste now so it is not forgotten; unused while staging |
| `JWT_SECRET` | The value already used by the live API. This workspace cannot read the other Render account. Recover it from a password manager or an admin who can still open that account. Do not generate a new one. | Required before boot. A new value would reject every existing session |
| `XERO_TOKEN_ENCRYPTION_KEY` | The current production encryption key, from the same recovery path as `JWT_SECRET`. It must be at least 32 characters. Do not generate a replacement. | Not required to boot while read-only. Required before read-only is ever turned off, or stored tokens will not decrypt |
| `XERO_CLIENT_ID` | The owner has authorized an existing Xero app client id. Paste that id in the dashboard. It is intentionally absent from git. | Can be set after the service exists. Unused while read-only |
| `XERO_CLIENT_SECRET` | Not yet available. Collect it from the Xero developer app’s secure store, or rotate it in the Xero app as its own approved change. Rotation invalidates existing refresh tokens. | Do not invent one. Leave unset until it is collected |
| `PUBLIC_API_BASE_URL` | After Render creates the service, copy the hostname Render displays and set `https://<that-host>` with no path. | Leave empty until then |
| `XERO_REDIRECT_URI` | Not the old host. After the hostname exists, the later cutover value is `https://<that-host>/api/xero/oauth/callback`. | Leave empty during staging. Do not change the Xero app’s redirect list yet |
| `XERO_SCOPES` | Optional. Leave empty to use the code default, which includes `projects`. | Empty during staging |
| `ALLOWED_ORIGINS` | Browser origins for a later cutover. No app should call this service yet. | Leave empty |
| `RESEND_API_KEY` | Resend dashboard, only if this process should send mail. | Leave empty so mail cannot send |
| `GOOGLE_MAPS_API_KEY` | Existing Google key if places search is required later. | Leave empty |
| `EMAIL_FROM` | Not a secret. Set in the blueprint to `developer@sitesync.uk`. | Already set |

`render.yaml` in the other account still has `generateValue` for `JWT_SECRET` and `XERO_TOKEN_ENCRYPTION_KEY`. This blueprint does not. Nothing here replaces those live values.

## Rollback

The live service and Supabase are not modified by planning or by booting this read-only service.

- Suspend or delete `sitesync-api-s4` in workspace `tea-dbmv4dc9v7es73aqvj6g`.
- Leave `https://sitesync-backend.onrender.com` as the only API clients use.
- Do not run a down migration. Staging does not migrate.

## Later cutover (separate approval)

Do not do this as part of creating the staging service.

1. Regain a way to stop writers on the old Render service. That account is not accessible from this workspace. Until it is stopped, turning on jobs or writes here would race the live process on the same database and the same Xero tokens.
2. Take a Supabase backup of project `twydnjdzrfkqivvlurux`.
3. Run `npx prisma migrate deploy` once, from a machine that has `DATABASE_URL` and `DIRECT_URL`, against that same project. The migration only adds columns and tables. It does not drop or rename existing Xero data.
4. Set `PUBLIC_API_BASE_URL` and `XERO_REDIRECT_URI` from the hostname Render assigned. Add the new redirect URI in the Xero app. Keep the old redirect until the old service is retired.
5. Set `SITESYNC_READ_ONLY=false` only after the encryption key and client secret are present. Then set `XERO_TOKEN_REFRESH_JOB=true` and `XERO_PUSH_ON_APPROVAL=true` if this process becomes the only writer.
6. Point the apps at the new URL with a new EAS build. `EXPO_PUBLIC_*` values are baked in at build time.
7. Change this blueprint’s `branch` from the pull-request branch to `main` only after that pull request is merged.

If the additive migration has already run, the previous API can still boot against the same database. Rollback of traffic is: turn this service back to read-only or suspend it, and send clients to the old host. Do not drop the new tables as part of that rollback.
