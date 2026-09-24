# SSR SaaS

A **React + Express + Supabase** application for **Sales, Stock & Reporting (SSR)** — an enterprise MIS admin panel for managing distributor sales data, product aliases, scheme imports, and monthly quality summaries.

## Features

- Company and distributor management from the Network screen
- Product and product alias management
- Product scheme imports from Excel
- SSR Excel upload processing with segregation calculations
- Missing alias detection with downloadable Excel output
- Recent duplicate distributor upload protection
- Monthly Siza and Raazee quality summaries
- Email/password auth via Supabase Auth, with email confirmation on signup and emailed password-reset links

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 6, Lucide React |
| Backend | Express 4, Node.js ESM |
| Database & Auth | Supabase (Postgres + Supabase Auth) |
| File Processing | JSZip, fast-xml-parser |
| File Upload | Multer |

## Setup

1. Create a [Supabase](https://supabase.com) project.

2. Run `server/supabase/migrations/0001_init.sql` against it (Supabase dashboard's SQL Editor, or `supabase db push` with the CLI).

3. In the Supabase dashboard:
   - **Authentication > Providers > Email**: enable "Confirm email".
   - **Authentication > URL Configuration**: set the Site URL to your app's origin (`http://localhost:5180` in development) and add `<origin>/confirm` and `<origin>/reset-password` as redirect URLs.
   - **Authentication > Emails / SMTP Settings**: configure outgoing SMTP for confirmation and password-reset mail (Supabase's built-in mailer is rate-limited and meant for development only).

4. Install dependencies:

```bash
npm install
```

5. Copy the environment file and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from your project's **Settings > API** page:

```bash
copy .env.example .env
```

6. Run the full development app:

```bash
npm run dev
```

Frontend: `http://localhost:5180`

Backend: `http://localhost:5050`

## Build

```bash
npm run build
npm start
```

The production server serves the React build from `dist/` and the API from `/api`.

## Main Paths

- `client/` - React app
- `server/src/` - Express API, services, and the Supabase-backed storage layer
- `server/supabase/migrations/0001_init.sql` - Postgres schema, RLS policies, and RPC functions
- `server/scripts/migrateMongoToSupabase.js` - One-off migration from an existing MongoDB database

## Admin Flow

- Admin panel opens at `http://localhost:5180` on the `Admin Panel` screen.
- Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_RECOVERY_CODE`, and `ADMIN_TOKEN_SECRET` in `.env`. Never use documented or placeholder credentials outside local development. This built-in administrator is separate from Supabase Auth.
- The administrator's password, reset through `/admin-recovery`, is securely hashed in `server/.data/admin-auth.json` and invalidates earlier login tokens.
- Regular user accounts (sign-up/sign-in/forgot-password) are handled by Supabase Auth; passwords are never stored by this app.
- Other services can be managed from `Other Services`; stored in the `services` table.
- Missing products/aliases are detected from SSR Check or SSR Upload and shown in `Missing`.
- Saving a missing alias stores it permanently as a `product_aliases` row.
- File activity is stored in the `upload_logs` table.

## Verification

`npm run check` syntax-checks every server file. `npm test` runs the Supabase-backed multi-tenancy integration suite (authentication, isolation, CRUD, security, and performance). It skips automatically with a "0 tests" pass when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are not configured, so run it against a real or local (`supabase start`) test project:

```bash
npm test
npm run verify
```
