# Site Check-in

A phone web app for field teams. The manager sends a job; the worker gets a notification
(or a WhatsApp message) and has to send a GPS-checked, time-stamped photo from the site when
they arrive, then whatever else the job asks for, and a photo when they leave.

No app store: workers open a link and add it to their home screen.

## What it does

**Manager**

- Add workers with their mobile number and a PIN. Send them their login on WhatsApp in one tap.
- Create a job: title, worker, time, address with a map pin, and the check-in distance
  (for example "within 150 m").
- Choose what the worker must send for each job. The arrival photo is always required;
  work photos, notes, a customer signature and a leaving photo are optional per job.
- The worker gets a phone notification. Workers who haven't turned notifications on get a
  **Send job on WhatsApp** button with the job, directions and link filled in.
- **Today** shows late jobs (not checked in 15 minutes after the start time), who is on site
  and the latest check-ins. Managers get a notification when someone arrives or finishes.
- Each job shows the proof: photos with time, distance from the site, GPS accuracy, a map of
  where each photo was taken, notes, the signature and time on site.
- **Export CSV** of jobs and check-in times (payroll, customer records).

**Worker**

1. Opens the job → **Directions in Google Maps**.
2. At the site: **I'm here: take arrival photo**. The live camera opens; the shutter only
   works inside the job's check-in circle.
3. Work photos / notes / customer signature, if the job asks for them.
4. **Take leaving photo & finish** (or **Finish job**).

## How a check-in is protected

- **Live camera only.** The app takes photos from the camera preview and offers no gallery
  picker. If a phone can't open the live camera, it falls back to the phone's camera app and
  the photo is marked "Not live camera" for the manager. (Someone who builds requests by hand
  could still upload any picture; the location check applies to it all the same.)
- **GPS checked twice.** The phone checks the distance to guide the worker; the server checks
  it again on upload and its answer counts. Readings less accurate than ±200 m are refused.
- **Stamped.** The job, time, worker, coordinates and distance are burned into the photo. The
  server also records its own time, the coordinates, the accuracy and the distance.
- **Limit:** the location comes from the phone, and no web app can detect a fake-GPS app on a
  phone set up to spoof its location. The photo itself (what's in it, and where the map dot
  is) is the evidence to look at.
- **Logins:** 6–8 digit PINs; after 5 wrong PINs the number is locked for 15 minutes, even
  when guesses are sent all at once.

## Put it online (about 15 minutes)

You need a free [Vercel](https://vercel.com) account and a free
[Supabase](https://supabase.com) database.

1. **Vercel → Add New → Project →** import this repository → **Deploy**.
   The first deploy says "No database is connected". That's expected.
2. In the Vercel project: **Storage → Create Database → Supabase → Connect** to this project.
   Keep the default variable names (no custom prefix). This adds `POSTGRES_URL`,
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. **Deployments → ⋯ → Redeploy.**
4. Open the site and create your manager account. Set a `SETUP_CODE` environment variable
   first (any random text) and enter it on the setup page; without one, the first person to
   open a new deployment becomes its manager.
5. **Workers →** add each worker → **Send login on WhatsApp**. They open the link, log in,
   add it to their home screen and tap **Turn on job alerts**.

The database tables, the private photo bucket and the notification keys are created
automatically on first use.

**Costs.** Supabase's free plan has a 500 MB database and 1 GB of file storage (several
thousand photos; each is about 0.2–0.5 MB). Vercel's free Hobby plan is for non-commercial
use only; for a business, use Vercel Pro or host the app elsewhere (it is a standard Next.js
app). The WhatsApp button is free (you tap send). Address search and map tiles use
OpenStreetMap's free services, which are meant for light use.

### Settings (environment variables)

| Variable | Needed? | What it does |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | yes, in production | Postgres connection string (Supabase, Neon, any Postgres). |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | optional | Keep photos in a private Supabase Storage bucket. Without them, photos are stored in the database. If an upload to Supabase fails, the photo goes to the database instead. |
| `SUPABASE_BUCKET` | optional | Bucket name, default `site-checkin`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional | Push notification keys. Generated and stored in the database if not set. |
| `SETUP_CODE` | recommended | A secret the first-time setup page asks for, so nobody else can claim a fresh deployment. Only used until the first manager exists. |
| `APP_URL` | optional | Base URL used in WhatsApp messages. Defaults to the Vercel production domain. |

## On the phones

- **Android (Chrome):** works in the browser. Chrome offers "Install app". Job alerts work
  as soon as the worker taps **Turn on job alerts** and allows notifications.
- **iPhone (iOS 16.4 or newer):** open the link in Safari → **Share → Add to Home Screen** →
  open the app from the home screen → **Turn on job alerts**. Apple only allows notifications
  for web apps added to the home screen.
- Allow **location** and **camera** when asked. If one was refused, turn it back on in the
  phone's settings for the browser or the app.

## Develop

```bash
npm install
npm run dev          # http://localhost:3000, with an embedded Postgres in .data/pglite
npm test             # unit tests (GPS rules, phone numbers, timezones, push)
npm run test:e2e     # build + browser tests: fake camera and GPS, full manager/worker flow
npm run lint
npm run typecheck
```

`npm run dev` needs no setup: without `DATABASE_URL` the app runs on
[PGlite](https://pglite.dev) (Postgres in WebAssembly) in `.data/pglite`. Camera and GPS
work on `http://localhost`; to try it on a phone, deploy it or serve it over HTTPS.

The e2e suite uses Playwright's Chromium (`npx playwright install chromium`, or point
`CHROMIUM_PATH` at an installed one). Extra modes:

- `E2E_DATABASE_URL=postgres://…` runs against a real, empty Postgres through the
  production driver.
- `E2E_FAKE_SUPABASE=1` sends photos through the Supabase Storage code path, using a local
  stand-in for its API (`tests/e2e/fake-supabase.mjs`).

## How it's built

Next.js 16 (App Router, Server Actions) · Postgres through node-postgres (PGlite locally) ·
plain SQL migrations applied on first use (`src/lib/migrations.ts`) · phone + PIN login with
database sessions (scrypt, lockout after 5 wrong PINs) · Web Push with VAPID (`web-push`,
`public/sw.js`) · Leaflet + OpenStreetMap · Tailwind CSS 4.

| Path | What's there |
| --- | --- |
| `src/app/m/` | Manager screens: Today, Jobs, Workers, Settings, and their server actions |
| `src/app/w/` | Worker screens: my jobs, the job with its steps |
| `src/app/api/` | Photo / signature / notes / finish uploads, protected file access, push, address search, CSV |
| `src/lib/geo.ts` | The check-in rule (`checkOnSite`), used by the phone and the server |
| `src/lib/db.ts` | Postgres / PGlite adapter and migrations |
| `src/lib/storage.ts` | Photo storage (Supabase Storage or the database) |
| `src/components/CameraCapture.tsx` | Live camera, GPS gate and photo stamp |

## Ideas for later

- Reminders and "late" alerts pushed to managers (needs a scheduler, e.g. Supabase cron).
- Fully automatic WhatsApp messages through the WhatsApp Business API (needs Meta approval,
  paid per message).
- Several workers per job, and repeating jobs.
- Keep photos taken without signal in an upload queue when the app is closed.
- Delete photos older than N months to stay inside the free storage.
