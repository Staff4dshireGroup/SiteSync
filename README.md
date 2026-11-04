# SiteSync (Staff4dshire) Platform

Comprehensive workforce, project, compliance, timesheet, incident, and chat platform built with:

- React Native + Expo (`apps/admin-app`, `apps/staff-app`)
- Shared TypeScript SDK and state utilities (`packages/shared`)
- Express + Prisma + PostgreSQL backend (`backend`)
- Socket.io real-time messaging and notifications

This repository is a standalone modern stack and does not depend on the legacy Flutter backend.

---

## What The Platform Does

SiteSync supports field teams end-to-end: onboarding, assignment, attendance, approvals, safety declarations, communication, incident management, and reporting.

### Main capabilities

- Multi-role authentication and access control
- Project lifecycle management (create, edit, complete, archive)
- Clock-in / clock-out with geolocation and address reverse geocoding
- Callout workflow with sign-in origin, arrival confirmation, travel time, and travel distance
- Supervisor and admin approval flows for timesheets and job completions
- Incident reporting with optional images, severity, resolution, and notifications
- Real-time direct chat with media upload, search, read state, and moderation actions
- Notifications with mark-as-read and dismissal controls
- Compliance capture (Fit to Work, RAMS)
- Export support for timesheets (CSV/PDF in staff app workflows)
- Xero integration hooks and payroll notification paths

---

## Role Capabilities

### Superadmin

- System-level company administration
- Multi-company user visibility and management
- Can chat only with admin users (enforced server-side)

### Admin

- Full company administration for users, projects, approvals, incidents
- User onboarding:
  - Direct create from admin app
  - Invitation code generation for signup
- Can edit users, including profile photo and activation status
- Can chat with all company users and with superadmin

### Supervisor

- Project-specific oversight of assigned teams
- Approve timesheets and review job completions
- Dashboard scoped by selected project
- Incident and operational visibility based on project/company rules

### Staff

- Sign in/out for shifts with compliance prerequisites
- Submit incidents and job completion data
- Use chat and receive notifications
- Manage declarations and operational workflow tasks

---

## Apps In This Repo

### `apps/admin-app`

Admin-facing UI for:

- User management and onboarding
- Project management and status lifecycle
- Reports, incidents, job completion approvals
- Dashboard overviews and operational controls

### `apps/staff-app`

Staff/supervisor-facing UI for:

- Attendance and shift actions
- Compliance declaration flows
- Timesheets and approvals visibility
- Chat, incidents, and field operations

### `packages/shared`

Shared code across apps:

- Typed API services
- Models and serializers
- Auth context/hooks
- Socket initialization/provider logic
- Storage utilities and common helpers

### `backend`

API and realtime layer:

- REST endpoints under `/api/*`
- Prisma schema/migrations
- Socket.io events
- Upload endpoints for chat/profile images
- Business logic and role authorization

---

## Architecture Overview

- **Frontend:** React Native + Expo (web + mobile), React Query, React Navigation
- **Shared SDK:** central source for API contracts and client behavior
- **Backend:** Express API + Prisma ORM
- **Database:** PostgreSQL
- **Realtime:** Socket.io for chat and notifications
- **Uploads:** multipart endpoints for chat attachments and profile photos

All role-sensitive operations are enforced server-side (not only in UI).

---

## Project Structure

```text
staff4dshire-rn/
├── apps/
│   ├── admin-app/
│   └── staff-app/
├── backend/
│   ├── prisma/
│   └── src/
├── packages/
│   └── shared/
└── docs/
```

---

## Getting Started

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+
- PostgreSQL
- Git

Optional:

- Android Studio (Android emulator)
- Xcode (iOS simulator, macOS only)

## Install

From repo root:

```bash
npm install
npm run shared:build
```

## Database setup

```bash
cd backend
npx prisma generate
npx prisma migrate dev
npx prisma db seed
cd ..
```

## Run services

Terminal 1 (backend):

```bash
npm run backend:dev
```

Terminal 2 (admin app):

```bash
npm run admin
```

Terminal 3 (staff app):

```bash
npm run staff
```

Press `w` in each Expo terminal to open web.

---

## Environment Configuration

### Backend

Copy `backend/.env.example` to `backend/.env` and configure:

- `DATABASE_URL`
- `DIRECT_URL` (Neon non-pooler URL for Prisma migrations/introspection)
- `JWT_SECRET`
- `EMAIL_FROM` (sender, for example `developer@sitesync.uk`)
- `SMTP_HOST`
- `SMTP_PORT` (usually `587`)
- `SMTP_SECURE` (`false` for 587 STARTTLS, `true` for 465 SSL)
- `SMTP_USER`
- `SMTP_PASS`
- Xero (see [docs/XERO_INTEGRATION.md](docs/XERO_INTEGRATION.md)): `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_TOKEN_ENCRYPTION_KEY`. No secrets are committed. `render.yaml` lists the same keys for the hosted API.

For Neon:
- Set `DATABASE_URL` to the pooled (`-pooler`) connection string for app runtime.
- Set `DIRECT_URL` to the non-pooled connection string for Prisma CLI operations.

### Admin / Staff apps

Copy `.env.example` in each app folder:

- `apps/admin-app/.env`
- `apps/staff-app/.env`

Typical local values:

```env
EXPO_PUBLIC_API_URL=http://localhost:3001/api
EXPO_PUBLIC_SOCKET_URL=http://localhost:3001
```

For Android emulator, use `10.0.2.2` instead of `localhost`.

---

## Core Functional Areas

## 1) User Management

- List, search, and edit users
- Profile photo handling
- Active/inactive user state
- Role assignment
- Direct creation path from admin app
- Invitation code generation path from admin app
- Profile photo enforced for new onboarding flows

## 2) Project Management

- Create/edit full project details
- Assign supervisor/staff
- Address geocoding support
- Project completion and archive lifecycle
- Glassmorphic management UI style for consistency with users section

## 3) Attendance & Timesheets

- Sign-in origin capture for all project types
- Callout arrival confirmation and travel metrics
- Supervisor/project-scoped approval and review views
- Export workflows (CSV/PDF) in staff-side timesheet workflows

## 4) Job Completions

- Submission with attachments
- Review modal with photos
- Approval progression (role-gated)
- Dashboard counters for pending reviews

## 5) Incidents

- Staff/supervisor/admin incident submission
- Optional photo support
- Severity tracking
- Resolution reporting and notification propagation
- Hide/show resolved handling across dashboards/reports

## 6) Chat & Notifications

- Direct conversations, message history, unread count
- Search by user/message content
- Long-press message actions:
  - copy
  - reply
  - forward (conversation picker)
  - edit/delete (sender-only)
- Conversation delete controls
- Forward success toast feedback
- Duplicate-conversation mitigation logic
- Superadmin chat restriction enforced:
  - superadmin ↔ admin only

## 7) Compliance

- Fit to Work declaration storage and gating
- RAMS save workflow
- Sign-in flow integration

---

## API + Realtime Notes

- REST base: `http://localhost:3001/api`
- Health endpoint: `http://localhost:3001/health`
- Socket base: `http://localhost:3001`
- JSON fields are snake_case to match shared model contracts

Uploads:

- `POST /api/uploads/chat`
- `POST /api/uploads/profile`

---

## Common Commands

From repo root:

```bash
npm install
npm run shared:build
npm run backend:dev
npm run admin
npm run staff
```

Useful DB commands:

```bash
cd backend
npx prisma studio
npx prisma migrate dev
npx prisma db seed
```

---

## Troubleshooting

## Port conflicts (`EADDRINUSE`)

Use the project guide:

- `docs/backend-port-3001-troubleshooting.md`

Or manually free the port on Windows:

```bash
netstat -ano | findstr :3001
taskkill //PID <PID> //F
```

## Web blank page / QueryClient errors

- Ensure only one clean Expo process per app is running
- Restart with cache clear:
  - `npm run start --workspace=admin-app -- --clear --port 8081`
  - `npm run start --workspace=staff-app -- --clear --port 8082`
- Hard refresh browser (`Ctrl+Shift+R`)

## Shared package changes not reflected

```bash
npm run shared:build
```

Then restart app dev servers.

## Cannot resolve modules

- Delete root `node_modules`
- reinstall via `npm install`
- rebuild shared package

---

## Security & Authorization

- JWT authentication on API
- Role checks in route handlers
- Company scoping on user/project/chat queries
- Server-side enforcement for sensitive chat policies and admin actions

---

## Documentation Index

- Backend API setup and details: [`backend/README.md`](backend/README.md)
- Go-live runbook (Render + Web + iOS + Android): [`docs/GO_LIVE_GUIDE.md`](docs/GO_LIVE_GUIDE.md)
- PostgreSQL + Postman setup: [`docs/SETUP_DATABASE_AND_POSTMAN.md`](docs/SETUP_DATABASE_AND_POSTMAN.md)
- Port troubleshooting: [`docs/backend-port-3001-troubleshooting.md`](docs/backend-port-3001-troubleshooting.md)
- Xero integration guide: [`docs/XERO_INTEGRATION.md`](docs/XERO_INTEGRATION.md)

---

## Development Conventions

- Keep backend response shapes aligned with `packages/shared/src/models`
- Rebuild `packages/shared` after changing shared source
- Prefer server-side authorization checks in addition to UI restrictions
- Keep role-driven behavior explicit and testable

---

## Quick Start (Web)

```bash
cd path/to/staff4dshire-rn
npm install
npm run shared:build
npm run backend:dev
npm run admin
# press w (admin web)
npm run staff
# press w (staff web)
```
