# Xero integration: testing and diagnostics

This document describes how the **company-scoped Xero OAuth** flow works in this project, how to **test** it end-to-end, and how to **diagnose** common problems.

- Tokens stay on the **backend** only (encrypted at rest). The admin client only opens an **`authorization_url`** in a browser.
- Base path: **`/api/xero`** (see `backend/src/routes/xero.ts`).
- Official Xero references: [OAuth 2.0 auth flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow), [Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/), [Granular scopes FAQ](https://developer.xero.com/faq/granular-scopes).

---

## 1. Architecture (quick)

| Piece | Role |
|--------|------|
| `GET /api/xero/connect/start` | Authenticated admin gets JSON with `authorization_url`. |
| Browser | User opens `authorization_url`, logs into Xero, approves access. |
| `GET /api/xero/oauth/callback` | **Public** endpoint. Xero redirects here with `?code=` and `?state=`. Backend exchanges code, stores tokens per **company**. |
| `GET /api/xero/status` | Check connection for a company (admin JWT). |

**Do not** bookmark or manually open `/oauth/callback` without query parameters. Xero must redirect there with `code` and `state`.

### 1.1 Admin app (mobile)

In **Settings → Xero**, the admin app uses `xeroService` (`packages/shared/src/api/xeroService.ts`) to call **`/xero/status`**, **`/xero/connect/start`**, and **`/xero/disconnect`**. **Connect** opens the returned **`authorization_url`** in the system browser (`Linking.openURL`). Pull to refresh or **Refresh status** after returning from the browser. **Superadmins** pick a company from the list; **company admins** use their own `company_id` automatically.

Ensure `EXPO_PUBLIC_API_URL` in `apps/admin-app/.env` points at the same API as your backend (e.g. `http://localhost:3001/api` or your ngrok URL + `/api`). For device testing with localhost, use your machine’s LAN IP or ngrok.

Set **`EXPO_PUBLIC_XERO_REDIRECT_URI`** to the **same value** as **`XERO_REDIRECT_URI`** in `backend/.env` (character-for-character). The admin app uses it with `expo-web-browser` so the in-app browser can close when Xero redirects back to your API. **Phones cannot use `localhost` for the API or redirect** — use your PC’s LAN IP (e.g. `http://192.168.1.10:3001/api/xero/oauth/callback`) in both places, or ngrok. Restart Expo after changing `.env`.

After OAuth, **`GET /api/xero/status`** may return **`pending_tenant`** with **`pending_id`** when the Xero user has **multiple organisations**; the app must pick one (Settings → Xero shows a list). This is stored server-side until completed or disconnect.

---

## 2. Prerequisites checklist

### 2.1 Xero Developer app

1. [My apps](https://developer.xero.com/app/manage) → create or select a **Web app** (server-side OAuth with client secret).
2. **Redirect URI** in Xero must match **`XERO_REDIRECT_URI`** in `backend/.env` **exactly** (scheme, host, port, path, no stray slash).

Examples:

- Local: `http://localhost:3001/api/xero/oauth/callback`
- ngrok: `https://YOUR-SUBDOMAIN.ngrok-free.app/api/xero/oauth/callback`

3. Copy **Client ID** and **Client secret** into `backend/.env`.

### 2.2 Backend environment (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `XERO_CLIENT_ID` | From Xero app configuration |
| `XERO_CLIENT_SECRET` | From Xero app configuration |
| `XERO_REDIRECT_URI` | Same string as registered in Xero (see above) |
| `JWT_SECRET` | Must match what you use to sign JWTs for `/api/auth/login` (state is a JWT signed with this) |
| `XERO_TOKEN_ENCRYPTION_KEY` | Optional locally; **set in production**. 32+ characters. Encrypts tokens at rest (otherwise derived from `JWT_SECRET`) |
| `XERO_SCOPES` | Optional; space-separated OAuth scopes (see §5). Default includes `projects` |
| `XERO_OAUTH_SUCCESS_REDIRECT` | Optional; after success, redirect browser to this URL with query params |
| `XERO_TOKEN_REFRESH_JOB` | `true` / `false`. Production defaults to on. Refreshes tokens before they expire |
| `XERO_PUSH_ON_APPROVAL` | Default on. Set `false` to push only from **Settings → Xero** |
| `XERO_DEFAULT_TASK_NAME` | Optional. Task used for time entries. Default `Site labour` |
| `XERO_DEFAULT_CURRENCY` | Optional. Default `GBP` |
| `XERO_DEFAULT_TASK_RATE` | Optional hourly rate on that task. Default `0` |

Restart the API after any `.env` change.

### 2.3 Database

Xero tables must exist (`XeroConnection`, etc.):

```bash
cd backend
npx prisma migrate deploy
```

(If `prisma generate` fails on Windows with EPERM, stop the running Node process that locks the Prisma engine, then run `npx prisma generate`.)

### 2.4 Who can connect?

Only **company admins** (or **superadmin** with explicit `company_id`) can start connect/disconnect. Staff users get **403** on protected routes.

---

## 3. End-to-end test (Postman or curl)

Replace placeholders:

- `BASE` = `http://localhost:3001/api` (or your ngrok URL + `/api`)
- `COMPANY_ID` = UUID of the company (must match the admin user’s company for non–superadmin)
- `EMAIL` / `PASSWORD` = admin credentials

### Step A — Login (get JWT)

**POST** `{{BASE}}/auth/login`  
**Body (JSON):**

```json
{
  "email": "EMAIL",
  "password": "PASSWORD"
}
```

**Response:** copy `token` (JWT).

### Step B — Start OAuth (get `authorization_url`)

**GET** `{{BASE}}/xero/connect/start?company_id=<COMPANY_ID>`  
**Headers:** `Authorization: Bearer <token>`

**Success:** `200` JSON:

```json
{ "authorization_url": "https://login.xero.com/identity/connect/authorize?..." }
```

**Common errors:**

| Status / body | Meaning |
|----------------|--------|
| `503` / not configured | Missing `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, or `XERO_REDIRECT_URI` |
| `400` / `company_id required` | Query param missing, or superadmin without `company_id` |
| `403` / Only company admins… | User is not admin for that company |

### Step C — Browser (not Postman)

1. Copy **`authorization_url`** from the response.
2. Paste into **Chrome/Edge/Firefox** on a machine that can reach your redirect (same PC for `localhost`).
3. Sign in to Xero and approve.

If you use **Postman’s “Open in browser”** for the authorize URL, that is fine; the **OAuth redirect** must land back on your API.

### Step D — Callback (automatic)

After approval, Xero redirects to:

`https://<your-host>/api/xero/oauth/callback?code=...&state=...`

You should **not** type this URL manually. If the flow succeeds, the UI may show a short HTML page (“Xero connection updated…”) or redirect to `XERO_OAUTH_SUCCESS_REDIRECT` if set.

### Step E — Verify status

**GET** `{{BASE}}/xero/status?company_id=<COMPANY_ID>`  
**Headers:** `Authorization: Bearer <token>`

**Connected example:**

```json
{
  "status": "connected",
  "company_id": "...",
  "xero_connected": true,
  "xero_tenant_id": "...",
  "xero_tenant_name": "...",
  "connected_at": "...",
  "connected_by_user_id": "...",
  "last_refreshed_at": "...",
  "last_synced_at": "..."
}
```

**Disconnected example:**

```json
{
  "status": "disconnected",
  "company_id": "...",
  "xero_connected": false
}
```

### Step F — Optional: call Accounting API (smoke test)

**GET** `{{BASE}}/xero/test/organisation?company_id=<COMPANY_ID>`  
**Headers:** `Authorization: Bearer <token>`

Uses the stored tenant and `Xero-tenant-id` header. Requires a successful connection and valid scopes.

### Step G — Disconnect (optional)

**POST** `{{BASE}}/xero/disconnect`  
**Headers:** `Authorization: Bearer <token>`  
**Body (JSON):**

```json
{ "company_id": "<COMPANY_ID>" }
```

---

## 4. Multi-tenant selection (pending flow)

If the Xero account has **multiple organisations**, the callback may not complete immediately; the backend may return a **pending** flow. You will see redirect parameters like `xero_pending=<uuid>`.

1. **GET** `{{BASE}}/xero/pending/<pending_id>` (Bearer JWT) — list tenants to choose from.
2. **POST** `{{BASE}}/xero/pending/complete` with `pending_id` and `tenant_id` (see `backend/src/routes/xero.ts` for exact field names).

If you only have **one** Xero org, this usually completes automatically.

---

## 5. Scopes (important for “Invalid scope for client”)

- **Apps created on or after 2 March 2026** must use **granular** Accounting scopes. Broad scopes such as `accounting.settings`, `accounting.transactions`, `accounting.contacts` may be rejected with **`unauthorized_client` / `Invalid scope for client`**. See [Granular scopes FAQ](https://developer.xero.com/faq/granular-scopes).

- The backend default is **granular** (see `backend/src/services/xeroOAuth.ts`). Override if needed:

```env
XERO_SCOPES=openid profile email offline_access accounting.settings.read accounting.invoices accounting.contacts.read projects
```

The default granular set uses **`accounting.invoices`** (not `accounting.transactions` / `accounting.transactions.read`) for apps created on or after 2 March 2026 — Xero maps invoice access to that scope. If you still see **`unauthorized_client` / `Invalid scope for client`** on the Xero login page:

1. Restart the API after changing code or `XERO_SCOPES`, then call **`GET /connect/start` again** and use the **new** `authorization_url` (old links keep old scopes).
2. Confirm **`scope=`** in that URL matches what your Xero app allows — see [Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/) and [Granular scopes FAQ](https://developer.xero.com/faq/granular-scopes).
3. Try a **minimal** scope line to isolate the problem (then widen):  
   `XERO_SCOPES=openid email offline_access` — if that authorizes, add accounting scopes one at a time.
4. If nothing works, open a case with [Xero Developer Platform support](https://developer.xero.com/contact-xero-developer-platform-support) and include your **client id** and the exact **`scope=`** query string.

- **Legacy apps** (created before that cutoff) might still use broad scopes:

```env
XERO_SCOPES=openid profile email offline_access accounting.settings accounting.transactions accounting.contacts
```

Restart the API after changing `XERO_SCOPES` and use a **new** `authorization_url` from `/connect/start`.

---

## 6. Diagnosis: error / symptom → what to check

### 6.1 `{"error":"missing code or state"}` on `/api/xero/oauth/callback`

**Cause:** The callback was requested **without** `code` and `state` query parameters (e.g. opening the callback URL in the address bar).

**Fix:** Always start from **`GET /api/xero/connect/start`**, then open **`authorization_url`**. Let Xero redirect you.

---

### 6.2 `invalid or expired state`

**Causes:**

- `state` JWT expired (default ~10 minutes between `/connect/start` and completing login).
- `JWT_SECRET` changed between issuing `authorization_url` and callback.
- Tampered or wrong `state`.

**Fix:** Call `/connect/start` again and complete OAuth quickly. Ensure `JWT_SECRET` is stable across restarts.

---

### 6.3 `token exchange failed`

**Causes:**

- `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` wrong or for a different app.
- **`XERO_REDIRECT_URI`** does not **exactly** match the redirect URI used in the authorize URL (must match Xero app config and token exchange).
- Authorization `code` already used or expired (single use, short TTL).

**Fix:** Verify redirect URI character-for-character, regenerate client secret if unsure, retry full flow from `/connect/start`.

---

### 6.4 `unauthorized_client` / `Invalid scope for client` (on Xero’s page)

**Cause:** Requested OAuth scopes are not allowed for this Xero app (often **granular vs broad** mismatch for new apps).

**Fix:** Use granular defaults or set `XERO_SCOPES` appropriately (§5). Create a **Web app** OAuth client in Xero.

---

### 6.5 `403` / `Only company admins can connect Xero`

**Cause:** JWT user is not an admin for the requested `company_id`.

**Fix:** Use an admin user, or superadmin with correct `company_id`.

---

### 6.6 `503` / Xero integration is not configured

**Cause:** Missing `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, or `XERO_REDIRECT_URI`.

**Fix:** Set variables in `backend/.env` and restart.

---

### 6.7 Console: Content Security Policy / `blob:` worker on `login.xero.com`

**Cause:** Browser/extension/CSP on **Xero’s** site, not your app.

**Fix:** Often harmless. Try incognito or disable extensions. If OAuth still completes, ignore.

---

### 6.8 ngrok / HTTPS

- If the **authorize** URL uses `redirect_uri=https://....ngrok-free.app/...`, then **`XERO_REDIRECT_URI`** and the Xero portal must use that **same** HTTPS URL.
- Free ngrok URLs **change** when you restart ngrok; update `XERO_REDIRECT_URI` and Xero redirect list every time.

---

### 6.9 `401` / insufficient scope from Xero Accounting API later

**Cause:** Token scopes are read-only or missing a write scope for the endpoint you called.

**Fix:** Add the granular scopes required for that endpoint (see [Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)), set `XERO_SCOPES`, reconnect, and have the user reauthorize.

---

## 7. Audit trail

The backend writes to **`XeroAuditLog`** (e.g. connect started, connect failed, disconnect, token refresh). Use your DB or admin tooling to inspect `company_id`, `user_id`, `action`, `detail`, `meta` when debugging production issues.

---

## 8. Optional: background token refresh

If `XERO_TOKEN_REFRESH_JOB=true`, a background job refreshes tokens before expiry (see `backend/src/jobs/xeroTokenRefreshJob.ts`). Interval configurable via `XERO_TOKEN_REFRESH_INTERVAL_MS`.

---

## 9. Quick reference: API routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/xero/oauth/callback` | Public | Xero redirect; `code` + `state` |
| GET | `/api/xero/connect/start` | JWT | Returns `authorization_url` |
| GET | `/api/xero/status` | JWT | Connection status |
| POST | `/api/xero/disconnect` | JWT | Disconnect company |
| GET | `/api/xero/pending/:id` | JWT | Pending tenant selection |
| POST | `/api/xero/pending/complete` | JWT | Complete tenant selection |
| GET | `/api/xero/test/organisation` | JWT | Smoke test Accounting API |
| GET | `/api/xero/projects` | JWT | Pull in-progress Xero projects (`states` optional) |
| GET | `/api/xero/projects/links` | JWT | SiteSync projects plus their Xero link |
| POST | `/api/xero/projects/link` | JWT | Link a SiteSync project to a chosen Xero project |
| POST | `/api/xero/projects/match` | JWT | Match one project on the Sp/Sc/Sf/Sg/Is job-number prefix |
| POST | `/api/xero/projects/match-all` | JWT | Link every unique job-number match in the company |
| POST | `/api/xero/projects/create` | JWT | Create a Xero project (needs `contact_id`) and link it |
| DELETE | `/api/xero/projects/link` | JWT | Remove the link. Does not delete the Xero project or posted time |
| GET | `/api/xero/contacts` | JWT | Pull active Xero contacts (`search` optional) |
| GET | `/api/xero/users` | JWT | Xero project users (for the default time-entry user) |
| PUT | `/api/xero/settings` | JWT | Set `default_xero_user_id` |
| POST | `/api/xero/time/push` | JWT | Push approved timesheets. Optional `project_id` or `time_entry_id` |
| GET | `/api/xero/time/status` | JWT | Sync counts, last error, recent failures |
| GET | `/api/xero/audit` | JWT | Recent `xero_audit_logs` rows for the company |

All authenticated routes expect **`Authorization: Bearer <JWT>`** from **`POST /api/auth/login`**.

---

## 10. Projects and approved time

Xero project names for this business look like **`Sp1166 - <address>`**. The prefixes are **Sp, Sc, Sf, Sg, Is**. SiteSync reads that code from the project name, then the address.

From **Edit project** (admin app) an admin can:

1. **Match job number** — links the project when exactly one in-progress Xero project has the same code.
2. **Choose from the Xero list**.
3. **Create in Xero** — pick a contact. The created name is `Sp1166 - <address>` when both parts exist. A **Site labour** TIME task is created (rate from `XERO_DEFAULT_TASK_RATE`, currency `XERO_DEFAULT_CURRENCY`, default GBP and 0).

**Settings → Xero** shows connection status, last sync, last time push, the last error, recent failed rows, and the audit log. From there an admin can pull contacts and projects, link every unique job code, choose the fallback Xero user, and push approved time.

Push rules:

- Only timesheets with a sign-out and `approved_at` are sent.
- Duration is whole minutes between sign-in and sign-out (Xero allows 1–59940). A sub-minute shift is sent as 1 minute.
- The Xero user is the project user with the same email, otherwise the company’s default Xero user.
- The Idempotency-Key is the SiteSync time entry id, and `xero_time_syncs` stores `synced` plus the Xero time id. A second push to the same organisation is skipped.
- Approval calls the push unless `XERO_PUSH_ON_APPROVAL=false`. A Xero failure does not undo the approval; the error is stored on the sync row and on the connection’s `last_sync_error`.
- Changing the connected Xero organisation clears project links. Time already posted to the previous organisation is not deleted.

The `projects` scope is required. Accounting granular scopes do not cover the Projects API. Connections made before this scope was requested must be disconnected and connected again.

---

## 11. Xero demo company

1. In [My apps](https://developer.xero.com/app/manage), create a **Web app**. Add the redirect URI that `XERO_REDIRECT_URI` will use. For a phone, that host must be reachable from the phone (LAN IP or https tunnel), not `localhost`.
2. Put the client id, client secret, redirect URI, and a long `XERO_TOKEN_ENCRYPTION_KEY` in `backend/.env` and in the Render service. Set `EXPO_PUBLIC_XERO_REDIRECT_URI` in `apps/admin-app/.env` to the same redirect string. Restart the API and Expo.
3. In the Xero developer account, open or create a **Demo Company** (the trial organisation Xero provides for API testing). Add a contact, and either create a project named like `Sp1166 - 12 High Street` or let SiteSync create it.
4. Add a Xero user whose email matches a SiteSync staff user, or set a default Xero user after connecting. Demo companies often only have the user you log in as, so the default user is the usual path. The timesheet description still contains the SiteSync staff name.
5. Sign in to SiteSync Admin as a company admin. **Settings → Xero → Connect to Xero**, approve the demo company, and confirm status is **Connected**. If several organisations are listed, pick the demo company.
6. Edit the SiteSync project and match, pick, or create the Xero project.
7. Approve a completed timesheet (or use **Push approved time**). In the demo company, open **Projects → the job → time** and confirm one entry. Push again and confirm SiteSync reports it as skipped and Xero does not gain a second row.
8. Disconnect from Settings and confirm status is disconnected and a later push reports that Xero is not connected.

Production on Render also needs a new admin (and staff) binary from EAS (`eas.json`) so the store builds pick up `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_XERO_REDIRECT_URI`. Those public values are baked in at build time. The client secret and encryption key stay on the API only.
