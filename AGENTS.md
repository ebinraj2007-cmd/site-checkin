<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Site Check-in

Phone web app: managers send jobs, workers check in at the site with a live-camera photo
that the server accepts only inside the job's GPS circle. See README.md for the product and
deploy steps.

## Commands

- `npm run dev`: local app on an embedded Postgres (PGlite in `.data/pglite`), no setup.
- `npm test`: Vitest unit tests (`tests/unit`).
- `npm run test:e2e`: production build + Playwright flow with fake camera/GPS (`tests/e2e`).
  Set `CHROMIUM_PATH` to use an installed Chromium. `E2E_DATABASE_URL` runs it on a real,
  empty Postgres; `E2E_FAKE_SUPABASE=1` routes photos through the Supabase Storage code path.
- `npm run lint`, `npm run typecheck`.

## Rules

- The check-in rule lives in one place, `checkOnSite` in `src/lib/geo.ts`. The phone uses it
  to guide the worker; the upload route re-runs it and its answer is final. Change both
  behaviours by changing that function.
- SQL goes through `src/lib/db.ts` (`query`, `queryOne`, `transaction`) with `$n` params.
  Schema changes are new entries in `src/lib/migrations.ts`; never edit a shipped migration.
- Modules that touch the database, cookies or secrets import `server-only`. Code shared
  with the phone (`geo.ts`, `time.ts`, `phone.ts`, `job-rules.ts`, `messages.ts`) must not.
- Every route handler and server action checks the session itself (`apiUser`,
  `requireUser`, `requireManager`); layouts are not an auth boundary.
- Times are stored in UTC and shown in the company timezone from settings (`src/lib/time.ts`).
- Forms that can come back with an error use `useFormAction` (keeps what the user typed).
