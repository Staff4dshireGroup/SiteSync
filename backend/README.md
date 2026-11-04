# API server (Express + Prisma + PostgreSQL)

REST API and Socket.io server for the React Native apps. **Stack:** Node.js, TypeScript, Express, Prisma ORM, PostgreSQL.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ running locally (or a cloud URL)

**Step-by-step:** create the database in **pgAdmin** and test with **Postman** → see [docs/SETUP_DATABASE_AND_POSTMAN.md](../docs/SETUP_DATABASE_AND_POSTMAN.md).


## Setup

1. **Create database** (example):

   ```bash
   createdb staff4dshire
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   ```

   Edit `DATABASE_URL` to match your PostgreSQL user, password, host, port, and database name.

3. **Install & migrate** (from monorepo root):

   ```bash
   npm install
   ```

   From `backend/`:

   ```bash
   npx prisma generate
   npx prisma db push
   npx prisma db seed
   ```

   Or use migrations in production:

   ```bash
   npx prisma migrate dev --name init
   ```

## Run

From monorepo root:

```bash
npm run backend:dev
```

Or from `backend/`:

```bash
npm run dev
```

- HTTP: `http://localhost:3001`
- Health: `GET http://localhost:3001/health`
- API base: `http://localhost:3001/api`

## Seed user (after `db seed`)

| Field    | Value              |
|----------|--------------------|
| Email    | `admin@demo.local` |
| Password | `demo123456`       |

Change the password after first login in a real deployment.

## API overview

| Prefix | Notes |
|--------|--------|
| `POST /api/auth/login` | `{ email, password }` → `{ user, token }` |
| `POST /api/auth/register` | Creates org + user (admin) if no `company_id` |
| `GET /api/users` … | Bearer JWT required |
| `GET /api/companies` … | |
| `GET /api/projects` … | |
| `GET /api/timesheets` … | |
| `GET /api/chat/...` | |
| `GET /api/notifications` … | |
| `GET /api/job-completions` … | |
| `GET /api/incidents` … | |
| `GET /api/onboarding` … | |
| `GET /api/xero/...` | Company Xero OAuth, projects, and approved time. See `docs/XERO_INTEGRATION.md` |

Socket.io: same origin as `PORT`; client sends `auth: { token }` (JWT).

## Security

- Set a strong `JWT_SECRET` in production.
- Restrict `ALLOWED_ORIGINS` to your deployed web and Expo origins.
