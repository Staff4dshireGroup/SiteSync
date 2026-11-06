# Staff4dshire (React Native) — Feature Architecture Guide

This document mirrors the structure of the legacy Flutter **Staff4dshire — Feature Guide**: it explains what each major area does and how it maps to **this** codebase (`staff4dshire-rn`). **Chat** is summarized briefly; real-time chat lives in `packages/shared` (HTTP + Socket.io) and backend `routes/chat.ts`.

---

## Table of contents

1. [Architecture snapshot](#1-architecture-snapshot)
2. [Authentication & account security](#2-authentication--account-security)
3. [Multi-tenancy, companies & invitations](#3-multi-tenancy-companies--invitations)
4. [Users & roles](#4-users--roles)
5. [Projects & sites](#5-projects--sites)
6. [Time & attendance](#6-time--attendance-sign-in--out--timesheets)
7. [Job completions](#7-job-completions)
8. [Invoices](#8-invoices)
9. [Safety & compliance](#9-safety--compliance-fit-to-work-rams-toolbox-fire-roll)
10. [Documents](#10-documents)
11. [Incidents](#11-incidents)
12. [Onboarding](#12-onboarding)
13. [Inductions](#13-inductions)
14. [Notifications](#14-notifications)
15. [Reports & timesheet exports](#15-reports--timesheet-exports)
16. [Xero integration](#16-xero-integration)
17. [Dashboards & navigation](#17-dashboards--navigation)
18. [Chat (summary)](#18-chat-summary)
19. [Data flow: device vs server](#19-data-flow-device-vs-server)

---

## 1. Architecture snapshot

| Layer | Role |
|--------|------|
| **`apps/admin-app/`** | Expo React Native for **admin / superadmin**: users, companies, projects, timesheets, job approvals, reports placeholder, invoices placeholder, inductions placeholder, documents/incidents/onboarding via Settings stack. |
| **`apps/staff-app/`** | Expo React Native for **staff / supervisor / admin**: sign-in/out, timesheets, **safety & compliance hub** (fit-to-work, RAMS, toolbox, fire roll), job completions, incidents, export hook, Xero placeholder, chat tab, settings. |
| **`packages/shared/`** | TypeScript: models, `axios` API clients, **AuthContext**, **SocketProvider** (invalidates React Query on chat events), **role capabilities** (`hasCapability`, `isElevatedRole`), `AsyncStorage` session, theme. |
| **`backend/`** | Express + Prisma + PostgreSQL. REST under `/api/*`. Socket.io on the same HTTP server. Static uploads under `/files`. |

**Config:** `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SOCKET_URL` → `packages/shared/src/config/apiConfig.ts`.

---

## 2. Authentication & account security

**What it does**

- Login with **email + password**; emails normalized (lowercase) on the server.
- **Inactive** users (`is_active = false`) cannot authenticate.
- **JWT** bearer tokens; stored via `AuthProvider` + `AsyncStorage` in shared.
- **Last login** timestamp (`last_login_at`) updated on successful login/register when the backend column exists.

**Client**

- `packages/shared/src/hooks/AuthContext.tsx` — session, `login`, `logout`.
- `apps/*/src/screens/auth/LoginScreen.tsx`.

**Server**

- `POST /api/auth/login`, `POST /api/auth/register` — `backend/src/routes/auth.ts`.
- Password hashing: **bcrypt**.

**Password reset**

- `POST /api/password-reset/request` and `/reset` are **stubs** in `backend/src/app.ts` (same idea as legacy); wire real email + tokens when ready.

**Google Sign-In**

- Not wired in RN yet; add `expo-auth-session` or similar when required.

---

## 3. Multi-tenancy, companies & invitations

**What it does**

- Each **Company** is a tenant. Most queries filter by `company_id` from the JWT (see `middleware/auth.ts`).
- **Superadmin** can see all companies where implemented; **admin** is scoped to their company.

**Invitations**

- **Not implemented** in this repo yet. Legacy used tokenised invite links + `company-invitations` routes. Planned: Prisma model + `POST /api/company-invitations` + registration screen accepting `token`.

---

## 4. Users & roles

**Roles**

| Role | Typical use in this app |
|------|-------------------------|
| `staff` | Staff app; sign-in, compliance, jobs, incidents. |
| `supervisor` | Same + may use admin app for **reports** / approvals where capabilities allow. |
| `admin` | Admin app: tenant management. |
| `superadmin` | Cross-company (where routes allow). |

**Capabilities (client helper)**

- `packages/shared/src/roles/roleCapabilities.ts` — `hasCapability(role, capability)` aligns menu visibility with the legacy role matrix (e.g. `manage_users`, `view_reports`, `manage_invoices`, `inductions_admin`).

**API**

- `GET/POST/PUT/DELETE /api/users` — `backend/src/routes/users.ts`.

---

## 5. Projects & sites

**What it does**

- **Project** = site/job with name + `company_id`.

**API**

- `GET/POST/PUT/DELETE /api/projects` — `backend/src/routes/projects.ts`.

**Client**

- Admin: `apps/admin-app/src/screens/projects/*`, `ProjectsStack`.
- Staff sign-in: project selection in `SignInOutScreen` (extend with **lat/long**, **callout** flag, **100 m geofence** when you add fields to `Project` — legacy behaviour).

---

## 6. Time & attendance (sign-in / out & timesheets)

**What it does**

- **TimeEntry** rows: sign-in/out timestamps, optional GPS on in/out.
- **Timesheets** screens list and aggregate entries.

**API**

- `GET/POST/PUT /api/timesheets` — `backend/src/routes/timesheets.ts`.

**Client**

- Staff: `SignInOutScreen`, `TimesheetsScreen`.
- Admin: `TimesheetsScreen` (all entries where permitted).

**Legacy parity (not all ported yet)**

- Fit-to-work **before** sign-in, **before/after photos**, **geofence** vs **callout** bypass, **job completion dialog** blocking sign-out — **partially** reflected in UI (compliance hub + job completions); tighten flows in `SignInOutScreen` as you add APIs and project coordinates.

---

## 7. Job completions

**API**

- `GET/POST/PUT /api/job-completions` — `backend/src/routes/jobCompletions.ts`.

**Client**

- `apps/*/src/screens/jobCompletions/JobCompletionsScreen.tsx`.

**Legacy**

- Rich dialog (reasons, photos, callout rules) — **extend** RN screens to match.

---

## 8. Invoices

**Legacy**

- Full CRUD + pay endpoint.

**This repo**

- **Admin → Invoices** opens `InvoicesPlaceholderScreen` with guidance.
- **Prisma** has no `Invoice` model yet — add migration + `routes/invoices.ts` when ready.

---

## 9. Safety & compliance (fit-to-work, RAMS, toolbox, fire roll)

**What it does**

- **Hub** lists all four areas (like legacy separate screens).
- Each screen is a **functional scaffold**; persist to API when you add endpoints.

**Client**

- `ComplianceHubScreen`, `FitToWorkScreen`, `RamsScreen`, `ToolboxTalkScreen`, `FireRollScreen` under `apps/staff-app/src/screens/compliance/`.
- Staff `DashboardStack` registers these routes.

**Server**

- Add `/api/compliance/*` (or domain-specific routes) when you model declarations and sign-offs.

---

## 10. Documents

**API**

- Document model exists in Prisma; routes can be extended beyond current seed usage.

**Client**

- Admin: `DocumentsScreen` in **Settings** stack.
- **Provider:** legacy had simulated delays; RN uses **React Query** + services where wired.

---

## 11. Incidents

**API**

- `GET/POST/PUT /api/incidents` — `backend/src/routes/incidents.ts`.

**Client**

- `apps/*/src/screens/incidents/IncidentsScreen.tsx`.

---

## 12. Onboarding

**API**

- `backend/src/routes/onboarding.ts`.

**Client**

- Admin: `OnboardingScreen` in Settings stack.

---

## 13. Inductions

**Legacy**

- Admin/supervisor induction management UI.

**This repo**

- **Admin → Inductions** → `InductionsPlaceholderScreen` until scheduling APIs exist.

---

## 14. Notifications

**API**

- `GET /api/notifications`, read/delete — `backend/src/routes/notifications.ts`.

**Client**

- Admin: `NotificationsScreen` in Settings stack.

---

## 15. Reports & timesheet exports

**Reports**

- **Admin → Reports** — `ReportsScreen.tsx`: live summary from **timesheets** API (counts, last 7 days, open shifts).

**Exports**

- **Staff → Export timesheets** — `TimesheetExportScreen.tsx`: lists entry count; **PDF/Excel/CSV** via `expo-print` / sharing — **not** wired (legacy used `TimesheetExportService` in Dart).

---

## 16. Xero integration

**This repo**

- Company-scoped OAuth on the API (`backend/src/routes/xero.ts`). Tokens stay encrypted on the server.
- **Admin → Settings → Xero** connects or disconnects a Xero organisation, shows sync status and errors, pulls contacts and projects, and pushes approved time.
- **Admin → Edit project** links a SiteSync project to a Xero project (pick, job-number prefix, or create).
- Staff app does not hold Xero credentials. See `docs/XERO_INTEGRATION.md`.

---

## 17. Dashboards & navigation

**Staff**

- **Home tab** → `DashboardStack`: stats + quick access to sign-in, timesheets, **compliance hub**, jobs, incidents, export hook, Xero placeholder.
- **Chat / Settings** tabs as implemented.

**Admin**

- **Home tab** → `DashboardStack`: stats + **Management** menu filtered by **`hasCapability`** (e.g. supervisors see Reports + timesheets + jobs; admins see users/company/projects + invoices + inductions when capabilities match).

**Settings stack (admin)**

- Documents, incidents, notifications, onboarding, Xero, recycle bin.

---

## 18. Chat (summary)

- REST: `/api/chat/*` — conversations, messages, attachments (multipart uploads via `/api/uploads/chat`, files served from `/files`).
- Real-time: Socket.io `new-message` to per-user rooms; `SocketProvider` invalidates React Query; optional local notifications in apps.
- **Not** duplicated in full here — see code under `apps/*/src/screens/chat/` and `backend/src/routes/chat.ts`.

---

## 19. Data flow: device vs server

| Feature | Primary storage / transport |
|--------|-----------------------------|
| Login | Server (`POST /api/auth/login`); token + user in `AsyncStorage` |
| Companies / users / projects | Server REST |
| Timesheets / time entries | **Server** (Prisma `TimeEntry`) |
| Job completions | Server |
| Incidents | Server |
| Onboarding | Server |
| Notifications | Server |
| **Invoices** | **Not yet** — placeholder UI |
| **Company invitations** | **Not yet** |
| **Compliance declarations** | **UI + local state** until APIs exist |
| **Timesheet PDF/CSV export** | **Planned** (client-side generation) |
| **Xero** | **Server** (OAuth, project links, approved time push). Admin UI only |

---

## Related paths (quick reference)

| Concern | Location |
|---------|----------|
| API base URL | `packages/shared/src/config/apiConfig.ts` |
| HTTP client | `packages/shared/src/api/axiosInstance.ts` |
| Role helpers | `packages/shared/src/roles/roleCapabilities.ts` |
| Shared exports | `packages/shared/src/index.ts` |
| Server routes | `backend/src/routes/*.ts`, `backend/src/app.ts` |
| Prisma schema | `backend/prisma/schema.prisma` |
