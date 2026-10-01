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
  a selfie, work photos, notes, a customer code, a customer signature and a leaving photo
  are optional per job (the leaving photo is on by default: without it a job has no time on
  site).
- **Customer code:** the job gets a 4-digit code that you send to the customer (one tap on
  WhatsApp). The customer gives it to the worker when the work is done; the worker never
  sees it otherwise, so a correct code shows they were really there.
- The worker gets a phone notification. Workers who haven't turned notifications on get a
  **Send job on WhatsApp** button with the job, directions and link filled in.
- **Today** shows late jobs (not checked in 15 minutes after the start time), who is on site
  and the latest check-ins. Managers get a notification when someone arrives or finishes.
- Each job shows the proof: photos with time, distance from the site, GPS accuracy, a map of
  where each photo was taken, notes, the signature and time on site (arrival photo to
  leaving photo). A job is flagged if the same worker was checked in at another site more
  than 500 m away during the visit.
- **Review** lists check-ins that need a look: photos a worker sent for approval, photos
  with warning signs (see below) and customer steps skipped with a reason. Approve or
  reject each with a note for the worker; approving a "the pin is in the wrong place"
  photo can move the job pin there. Until approved, these don't count for time on site.
- **Export CSV** of jobs and check-in times (payroll, customer records), with the review
  state, warning signs, customer code and skipped steps.
- **Settings → Check-in security:** require workers to log in with their fingerprint or
  face instead of a PIN.

**Worker**

0. The first time: reads what the app records about them (location only at photo moments,
   photos, selfies, times, phone ID, login attempts) and taps **I understand**.
1. Opens the job → **Directions in Google Maps**.
2. At the site: **I'm here: take arrival photo** (and a selfie, if the job asks). The live
   camera opens; the shutter only works inside the job's check-in circle. If the worker
   really is there but can't check in (wrong pin, no GPS indoors, a site bigger than the
   circle), **Can't check in here? Send for approval** takes the photo anyway with a reason,
   for the manager to approve. They carry on with the job meanwhile.
3. Work photos / notes / customer code / customer signature, if the job asks for them. When
   the customer isn't there, **Skip with a reason** lets the worker finish; the manager
   reviews it.
4. **Take leaving photo & finish** (or **Finish job**).

Workers can set up **fingerprint or face login** (a passkey) on their phone and skip the PIN.

## How a check-in is protected

- **Live camera only.** The app takes photos from the camera preview and offers no gallery
  picker. If a phone can't open the live camera, it falls back to the phone's camera app and
  the photo is marked "Not live camera" for the manager. (Someone who builds requests by hand
  could still upload any picture; the location check applies to it all the same.)
- **GPS checked twice.** The phone checks the distance to guide the worker; the server checks
  it again on upload and its answer counts. Readings less accurate than ±200 m are refused.
- **Sent from the site, not later.** The GPS reading must be less than a minute old when the
  shutter is pressed, and arrival and leaving photos must reach the server within 15 minutes
  of being taken (a phone clock set ahead doesn't help). The server's own time is what's
  recorded, and the manager sees any photo that was sent late.
- **Stamped.** The job, time, worker, coordinates and distance are burned into the photo. The
  server also records its own time, the coordinates, the accuracy and the distance.
- **Time on site** runs from the arrival photo to the leaving photo, both taken inside the
  circle. A job finished with the Finish button (no leaving photo) has no time on site, since
  Finish can be tapped anywhere. Check-ins that overlap at sites far apart are flagged on the
  job and in the CSV. Reopening a job starts a new visit with a new arrival photo.
- **Warning signs.** Every photo is also checked on the server; strong signs send it to
  **Review** (it counts once approved), the rest are shown on the photo:
  - the same photo file sent before, or a look-alike of an earlier photo (re-saved,
    re-stamped or brightened copies are caught; two jobs in one building aren't flagged);
  - a dark or blank photo;
  - a GPS reading exactly on the job pin (fake-location apps are often set to it);
  - a check-in further from the worker's previous one than a car could drive in the time;
  - a phone that sent another person's check-in in the last 12 hours (a random ID kept in
    the browser);
  - and, as notes only: the same GPS point to the last digit as an earlier photo, moving
    faster than 90 km/h, GPS more precise than phones manage, a GPS reading older than the
    photo, and an internet connection from another country.
- **Customer code and selfie.** A code the customer gives in person, and a front-camera
  selfie next to the arrival and leaving photos, make someone else checking in for the
  worker much harder. A reopened job gets a new code, so last visit's code proves
  nothing. (The app shows the selfie to the manager; it doesn't do face recognition.)
- **Fingerprint or face login.** With **Workers must log in with fingerprint or face** on, a
  worker who has set it up can no longer use their PIN, and logins already made with the
  PIN (say, on a colleague's phone) stop working too. Workers can't switch it off
  themselves, and managers get a notification whenever a worker sets it up on a device.
  A lost phone: reset the worker's PIN, which also removes their passkeys (a manager's
  recovery with the setup code, or a manager's own PIN change, removes theirs). Managers
  always keep their PIN.
- **Reviews.** Rejecting an arrival photo while the worker is on site sends them back to
  check in again; rejecting the leaving photo reopens the job for a new one. When there is
  more than one manager, nobody reviews their own check-ins.
- **Limit:** the location comes from the phone, and no web app can directly detect a
  fake-GPS app on a phone set up to spoof its location. The warning signs above catch the
  common tricks, and the photo itself (what's in it, and where the map dot is) is the
  evidence to look at.
- **Logins:** 6–8 digit PINs; after 5 wrong PINs the number is locked for 15 minutes, even
  when guesses are sent all at once. A phone that has logged in before keeps its own count,
  so someone guessing elsewhere can't lock a person out of their own phone. Resetting a
  worker's PIN, or changing your own, logs out every other device and stops its alerts.
- **Storage:** only real JPEG photos from the app (up to 2 MB) and PNG signatures are
  accepted, with up to 20 work photos per visit. Photos kept in the database stop at
  `DB_FILES_LIMIT_MB`, so they can't fill a free Supabase database (which would turn the
  whole app read-only).

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
   first (at least 12 random characters) and enter it on the setup page; without one, the
   first person to open a new deployment becomes its manager. Keep the code: a manager who
   forgets their PIN or loses their phone uses it at **Log in → Use the setup code** to set
   a new PIN.
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
| `SETUP_CODE` | recommended | A secret the first-time setup page asks for, so nobody else can claim a fresh deployment. With 12 or more characters it also unlocks manager recovery (`/recover`). |
| `DB_FILES_LIMIT_MB` | optional | Most space photos may take in the database, default 300. Supabase's free database is 500 MB. |
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
npm test             # unit tests (GPS and photo rules, warning signs, passkeys, logins, storage, push)
npm run test:e2e     # build + browser tests: fake camera, GPS and fingerprint reader, full flows
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
| `src/app/m/` | Manager screens: Today, Jobs, Review, Workers, Settings, and their server actions |
| `src/app/w/` | Worker screens: my jobs, the job with its steps, what the app records |
| `src/app/api/` | Photo / signature / notes / code / skip / finish uploads, passkeys, protected file access, push, address search, CSV |
| `src/lib/geo.ts` | The check-in rule (`checkOnSite`), used by the phone and the server |
| `src/lib/fraud.ts`, `src/lib/photo-hash.ts` | The warning signs, and the photo fingerprints they use |
| `src/lib/webauthn.ts`, `src/lib/passkeys.ts` | Fingerprint / face login (passkeys), no extra libraries |
| `src/lib/db.ts` | Postgres / PGlite adapter and migrations |
| `src/lib/storage.ts` | Photo storage (Supabase Storage or the database) |
| `src/components/CameraCapture.tsx` | Live camera, GPS gate and photo stamp |

## Ideas for later

- Face matching of the selfie against the worker's photo. Left out on purpose: face data is
  sensitive personal data in most countries (e.g. the UAE's PDPL, India's DPDP Act, GDPR),
  and needs consent, a lawful reason and care with accuracy.
- NFC tags at fixed sites (tap to check in): needs tags fitted at each site and a phone
  with NFC; Chrome on Android only.
- Reminders and "late" alerts pushed to managers (needs a scheduler, e.g. Supabase cron).
- Fully automatic WhatsApp messages through the WhatsApp Business API (needs Meta approval,
  paid per message).
- Several workers per job, and repeating jobs.
- Keep photos taken without signal in an upload queue when the app is closed.
- Delete photos older than N months to stay inside the free storage.
