import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { devices } from "@playwright/test";
import path from "node:path";

// One story, start to finish: the manager sets up, adds a worker and sends a job;
// the worker is refused far from the site, checks in on site, adds the extra proof
// and leaves; the manager sees it all and exports it.

test.describe.configure({ mode: "serial" });

const SITE = { latitude: 25.2048, longitude: 55.2708 };
const NEAR = { latitude: 25.2051, longitude: 55.2709, accuracy: 12 }; // ~35 m away
const FAR = { latitude: 25.2148, longitude: 55.2708, accuracy: 10 }; // ~1.1 km away
const JOB_TITLE = "AC service – Villa 12";

const shotsDir = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  // Full-page captures would paint the sticky header mid-page.
  await page.addStyleTag({ content: "header { position: static !important; }" });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

// A real JPEG, drawn and encoded by the browser like the app's camera does. Every call
// draws a different picture, as a camera would (identical photos get flagged).
async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 70% 50%)`;
      ctx.fillRect(Math.random() * 300, Math.random() * 220, 20 + Math.random() * 60, 20 + Math.random() * 50);
    }
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

// A 1×1 PNG, as a canvas makes them.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// A photo upload the way the app sends it, for checks the camera screen can't reach.
async function upload(
  page: Page,
  jobId: string,
  kind: string,
  where: { latitude: number; longitude: number; accuracy: number },
  takenAt = new Date(),
  photo?: Buffer,
  extra: Record<string, string> = {},
) {
  return page.request.post(`/api/jobs/${jobId}/photo`, {
    multipart: {
      ...extra,
      kind,
      lat: String(where.latitude),
      lng: String(where.longitude),
      accuracy: String(where.accuracy),
      live: "1",
      deviceTime: takenAt.toISOString(),
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo ?? (await jpeg(page)) },
    },
  });
}

async function logIn(page: Page, phone: string, pin: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("PIN").fill(pin);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

// A job at `where` for `worker` (Ravi unless said), with extra proof steps ticked or not.
async function createJob(
  title: string,
  where: string,
  opts: { worker?: string; check?: string[]; uncheck?: string[]; customerPhone?: string } = {},
) {
  await manager.goto("/m/jobs/new");
  await manager.getByLabel("Job title").fill(title);
  await manager.getByLabel("Worker", { exact: true }).selectOption({ label: opts.worker ?? "Ravi Kumar" });
  await manager.getByLabel("Paste a Google Maps link or coordinates").fill(where);
  for (const step of opts.check ?? []) await manager.getByRole("checkbox", { name: new RegExp(`^${step}`) }).check();
  for (const step of opts.uncheck ?? []) await manager.getByRole("checkbox", { name: new RegExp(`^${step}`) }).uncheck();
  if (opts.customerPhone) await manager.getByLabel("Customer phone").fill(opts.customerPhone);
  await manager.getByRole("button", { name: "Create job & notify worker" }).click();
  await expect(manager).toHaveURL(/created=1/);
  return manager.url().match(/jobs\/([0-9a-f-]{36})/)![1];
}
const AT_SITE = `${SITE.latitude}, ${SITE.longitude}`;

let manager: Page;
let managerCtx: BrowserContext;
let worker: Page;
let workerCtx: BrowserContext;
let jobId = "";

test.beforeAll(async ({ browser }) => {
  managerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "Asia/Dubai" });
  manager = await managerCtx.newPage();
  workerCtx = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "en-US",
    timezoneId: "Asia/Dubai",
    permissions: ["geolocation", "camera", "notifications"],
    geolocation: FAR,
  });
  worker = await workerCtx.newPage();
});

test.afterAll(async () => {
  await managerCtx?.close();
  await workerCtx?.close();
});

test("manager sets up the company", async () => {
  await manager.goto("/");
  await expect(manager).toHaveURL(/\/setup$/);
  await manager.getByLabel("Company name").fill("Cool Air Services");
  await manager.getByLabel("Your name").fill("Maya Manager");
  await manager.getByLabel("Country code").fill("971");
  await manager.getByLabel("Your mobile number").fill("050 111 1111");
  await manager.getByLabel("Choose a PIN").fill("482615");
  await manager.getByLabel("Repeat PIN").fill("482615");
  await expect(manager.getByText("Asia/Dubai")).toBeVisible();
  await manager.getByLabel("Setup code").fill("guess");
  await manager.getByRole("button", { name: "Create my account" }).click();
  await expect(manager.getByText("That setup code is wrong.")).toBeVisible();
  await manager.getByLabel("Setup code").fill("e2e-setup-code");
  await shot(manager, "01-setup");
  await manager.getByRole("button", { name: "Create my account" }).click();
  await expect(manager).toHaveURL(/\/m$/);
  await expect(manager.getByText("Get started in 3 steps")).toBeVisible();

  // Setup is one-time.
  await manager.goto("/setup");
  await expect(manager).toHaveURL(/\/m$/);
});

test("manager adds a worker and gets a WhatsApp invite", async () => {
  await manager.goto("/m/workers");
  await manager.getByLabel("Name", { exact: true }).fill("Ravi Kumar");
  await manager.getByLabel("Mobile number").fill("050 222 2222");
  await manager.getByLabel("PIN", { exact: true }).fill("246810");
  await manager.getByRole("button", { name: "Add worker" }).click();
  await expect(manager.getByText("Ravi Kumar added. PIN: 246810")).toBeVisible();
  const invite = manager.getByRole("link", { name: /Send login on WhatsApp/ });
  const href = await invite.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/971502222222\?text=/);
  expect(decodeURIComponent(href!)).toContain("PIN: 246810");
  await expect(manager.getByRole("link", { name: /Ravi Kumar/ })).toBeVisible();

  // Same number twice is refused.
  await manager.getByLabel("Name", { exact: true }).fill("Ravi Again");
  await manager.getByLabel("Mobile number").fill("+971502222222");
  await manager.getByRole("button", { name: "Add worker" }).click();
  await expect(manager.getByText("already added")).toBeVisible();
  await shot(manager, "02-workers");
});

test("manager creates a job with every proof step", async () => {
  await manager.goto("/m/jobs/new");
  await manager.getByLabel("Job title").fill(JOB_TITLE);
  await manager.getByLabel("Worker", { exact: true }).selectOption({ label: "Ravi Kumar" });
  await expect(manager.getByText("Hasn't turned on job alerts yet")).toBeVisible();
  await manager.getByLabel("Address", { exact: true }).fill("Villa 12, Street 5, Jumeirah");
  await manager.getByLabel("Paste a Google Maps link or coordinates").fill(`${SITE.latitude}, ${SITE.longitude}`);
  await expect(manager.getByText("Pin: 25.20480, 55.27080")).toBeVisible();
  for (const step of ["Work photos", "Notes", "Customer signature", "Leaving photo"]) {
    await manager.getByRole("checkbox", { name: new RegExp(`^${step}`) }).check();
  }
  await manager.getByLabel("Customer name").fill("Ali Hassan");
  await manager.getByLabel("Customer phone").fill("055 333 4444");
  await manager.getByLabel("Instructions for the worker").fill("Gate code 4321. Bring a spare filter.");
  await shot(manager, "03-new-job");
  await manager.getByRole("button", { name: "Create job & notify worker" }).click();

  await expect(manager).toHaveURL(/\/m\/jobs\/[0-9a-f-]{36}\?created=1$/);
  jobId = manager.url().match(/jobs\/([0-9a-f-]{36})/)![1];
  await expect(manager.getByText("hasn't turned on job alerts, so send it on WhatsApp")).toBeVisible();
  const wa = await manager.getByRole("link", { name: /Send job on WhatsApp/ }).getAttribute("href");
  const text = decodeURIComponent(wa!.split("?text=")[1]);
  expect(wa).toMatch(/^https:\/\/wa\.me\/971502222222\?/);
  expect(text).toContain(`*${JOB_TITLE}*`);
  expect(text).toContain(`/w/jobs/${jobId}`);
  expect(text).toContain("Customer: Ali Hassan, +971 55 333 4444");
  await expect(manager.getByText("Waiting for the arrival photo.")).toBeVisible();
});

test("worker logs in and sees the job", async () => {
  await worker.goto("/login");
  await worker.getByLabel("Phone number").fill("0502222222");
  await worker.getByLabel("PIN").fill("000000");
  await worker.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(worker.getByText("Wrong phone number or PIN.")).toBeVisible();
  await worker.getByLabel("PIN").fill("246810");
  await worker.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(worker).toHaveURL(/\/w$/);
  // First, what the app records about them.
  await expect(worker.getByRole("heading", { name: "Before you start: what this app records" })).toBeVisible();
  await expect(worker.getByText(/Your location, only at the moment you take a photo/)).toBeVisible();
  await shot(worker, "04a-notice");
  await worker.getByRole("button", { name: "I understand" }).click();
  await expect(worker.getByText("Job alerts are off.")).toBeVisible();
  await shot(worker, "04-worker-home");
  await worker.getByRole("link", { name: new RegExp(JOB_TITLE) }).click();
  await expect(worker.getByRole("heading", { name: JOB_TITLE })).toBeVisible();
  await expect(worker.getByText("Gate code 4321")).toBeVisible();

  // Workers can't open the manager pages.
  const probe = await workerCtx.newPage();
  await probe.goto("/m");
  await expect(probe).toHaveURL(/\/w$/);
  await probe.close();
});

test("check-in is refused away from the site, on the phone and on the server", async () => {
  await worker.goto(`/w/jobs/${jobId}`);
  await worker.getByRole("button", { name: /take arrival photo/ }).click();
  await expect(worker.getByTestId("gps-status")).toContainText("from the site. Move closer");
  await expect(worker.getByRole("button", { name: "Take photo" })).toBeDisabled();
  await shot(worker, "05-camera-too-far");
  await worker.getByRole("button", { name: "Cancel" }).click();

  // A doctored upload is checked again by the server.
  const res = await upload(worker, jobId, "arrival", FAR);
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toContain("from the job site");

  // A photo taken on site earlier and sent later doesn't count as arriving now.
  const stale = await upload(worker, jobId, "arrival", NEAR, new Date(Date.now() - 20 * 60_000));
  expect(stale.status()).toBe(422);
  expect((await stale.json()).error).toContain("more than 15 minutes ago");

  // Not-a-photo is refused too, even when it starts like a JPEG.
  for (const buffer of [Buffer.from("<html>not an image</html>"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])]) {
    const junk = await worker.request.post(`/api/jobs/${jobId}/photo`, {
      multipart: {
        kind: "arrival",
        lat: String(NEAR.latitude),
        lng: String(NEAR.longitude),
        accuracy: "10",
        deviceTime: new Date().toISOString(),
        photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer },
      },
    });
    expect(junk.status()).toBe(400);
  }
});

async function takePhoto(page: Page, button: RegExp, expectMessage: string) {
  await page.getByRole("button", { name: button }).click();
  const shutter = page.getByRole("button", { name: "Take photo" });
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
  await page.getByRole("button", { name: "Send photo" }).click();
  await expect(page.getByText(expectMessage)).toBeVisible();
}

test("worker checks in on site and completes every step", async () => {
  await workerCtx.setGeolocation(NEAR);
  await worker.goto(`/w/jobs/${jobId}`);

  await worker.getByRole("button", { name: /take arrival photo/ }).click();
  await expect(worker.getByTestId("gps-status")).toContainText("At the site");
  await shot(worker, "06-camera-on-site");
  await worker.getByRole("button", { name: "Take photo" }).click();
  await expect(worker.getByRole("img", { name: "Your photo" })).toBeVisible();
  await shot(worker, "07-photo-preview");
  await worker.getByRole("button", { name: "Send photo" }).click();
  await expect(worker.getByText("Arrival recorded")).toBeVisible();
  await expect(worker.getByText("Still needed: work photos, notes, customer signature.")).toBeVisible();
  await expect(worker.getByRole("button", { name: /Take leaving photo/ })).toBeDisabled();

  await takePhoto(worker, /Add work photo/, "Photo added.");

  await worker.getByLabel("Notes").fill("Replaced the filter and cleaned the coils.");
  await worker.getByRole("button", { name: "Save notes" }).click();
  await expect(worker.getByText("Notes saved.")).toBeVisible();

  await worker.getByLabel("Customer's name").fill("Ali Hassan");
  const pad = worker.getByLabel("Signature box");
  await pad.scrollIntoViewIfNeeded(); // mouse coordinates only reach what's on screen
  const box = (await pad.boundingBox())!;
  await worker.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await worker.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await worker.mouse.move(box.x + 30 + i * 18, box.y + box.height * (0.6 + 0.2 * Math.sin(i / 2)));
  }
  await worker.mouse.up();
  await worker.getByRole("button", { name: "Save signature" }).click();
  await expect(worker.getByText("Signature saved.")).toBeVisible();
  await shot(worker, "08-worker-steps");

  // One signature per job: it can't be swapped afterwards.
  const again = await worker.request.post(`/api/jobs/${jobId}/signature`, {
    multipart: { name: "Someone Else", signature: { name: "signature.png", mimeType: "image/png", buffer: PNG } },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toContain("already signed");

  await takePhoto(worker, /Take leaving photo/, "Job finished. Good work!");
  await expect(worker.getByText(/^Finished /)).toBeVisible();
  await shot(worker, "09-worker-done");
});

test("manager sees the proof and exports it", async () => {
  await manager.goto(`/m/jobs/${jobId}`);
  await expect(manager.getByText("Done", { exact: true }).first()).toBeVisible();
  await expect(manager.getByText("✓ Arrived")).toBeVisible();
  await expect(manager.getByText("✓ Work photos (1)")).toBeVisible();
  await expect(manager.getByText("Replaced the filter and cleaned the coils.")).toBeVisible();
  await expect(manager.getByText("✓ Signed by Ali Hassan")).toBeVisible();
  await expect(manager.getByText("✓ Left the site")).toBeVisible();
  await expect(manager.getByText(/Time on site:/)).toBeVisible();
  await expect(manager.getByText(/\d+ m from site/).first()).toBeVisible();

  // The stored photos actually load.
  const img = manager.getByRole("img", { name: "arrival photo" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
  await shot(manager, "10-manager-job-proof");

  await manager.goto("/m");
  await expect(manager.getByText("Ravi Kumar left")).toBeVisible();
  await expect(manager.getByText("Ravi Kumar arrived")).toBeVisible();
  await shot(manager, "11-manager-today");

  if (process.env.E2E_FAKE_SUPABASE) {
    const stats = await (await manager.request.get("http://127.0.0.1:3299/__stats")).json();
    expect(stats.buckets).toEqual(["site-checkin"]);
    expect(stats.files).toBe(4); // arrival, work, leaving photo + signature
  }

  const csv = await (await manager.request.get("/api/export?view=all")).text();
  expect(csv).toContain(JOB_TITLE);
  expect(csv).toContain("Ravi Kumar");
  expect(csv).toContain("Replaced the filter and cleaned the coils.");
  expect(csv.split("\r\n")[1]).toContain(",Done,");
  expect(csv).toContain(",971 55 333 4444,"); // no "+" for spreadsheets to trip on
});

test("an on-site job stays with its worker, and reopening starts a new visit", async () => {
  await manager.goto("/m/jobs/new");
  await manager.getByLabel("Job title").fill("Pump repair");
  await manager.getByLabel("Worker", { exact: true }).selectOption({ label: "Ravi Kumar" });
  await manager.getByLabel("Paste a Google Maps link or coordinates").fill(`${SITE.latitude}, ${SITE.longitude}`);
  // New jobs ask for a leaving photo, so they get a real time on site.
  await expect(manager.getByRole("checkbox", { name: /^Leaving photo/ })).toBeChecked();
  await manager.getByRole("button", { name: "Create job & notify worker" }).click();
  await expect(manager).toHaveURL(/created=1/);
  const id = manager.url().match(/jobs\/([0-9a-f-]{36})/)![1];

  expect((await upload(worker, id, "arrival", NEAR)).status()).toBe(200);

  await manager.goto(`/m/jobs/${id}/edit`);
  await expect(manager.getByText("Ravi Kumar is on site now.")).toBeVisible();
  await expect(manager.getByLabel("Worker", { exact: true })).toBeDisabled();
  // Everything else can still change.
  await manager.getByLabel("Job title").fill("Pump repair (urgent)");
  await manager.getByRole("button", { name: "Save changes" }).click();
  await expect(manager.getByRole("heading", { name: "Pump repair (urgent)" })).toBeVisible();

  await manager.goto(`/m/jobs/${id}`);
  await expect(manager.getByText(/On site for .* so far/)).toBeVisible();
  manager.once("dialog", (d) => d.accept());
  await manager.getByRole("button", { name: "Cancel job" }).click();
  await expect(manager.getByText("This job was cancelled.")).toBeVisible();
  // A closed job can't be edited (e.g. handed to someone else) until it's reopened.
  await manager.goto(`/m/jobs/${id}/edit`);
  await expect(manager).toHaveURL(new RegExp(`/m/jobs/${id}$`));

  manager.once("dialog", (d) => d.accept());
  await manager.getByRole("button", { name: "Reopen" }).click();
  await expect(manager.getByText("Waiting for the arrival photo.")).toBeVisible();
  await expect(manager.getByRole("heading", { name: "Earlier visits" })).toBeVisible();
  await shot(manager, "12-reopened-job");

  // The worker checks in again for the new visit.
  await worker.goto(`/w/jobs/${id}`);
  await expect(worker.getByRole("button", { name: /take arrival photo/ })).toBeVisible();
  expect((await upload(worker, id, "arrival", NEAR)).status()).toBe(200);
  await worker.reload();
  await expect(worker.getByRole("button", { name: /Take leaving photo/ })).toBeEnabled();

  // Work photos are capped per visit.
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await upload(worker, id, "work", NEAR)).status());
  expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
  expect(statuses[20]).toBe(409);
});

test("access rules and push subscriptions", async ({ browser }) => {
  // Photos are private.
  const anon = await browser.newContext();
  await manager.goto(`/m/jobs/${jobId}`);
  const photoPath = await manager.getByRole("img", { name: "arrival photo" }).getAttribute("src");
  expect(photoPath).toMatch(/^\/api\/files\/photos\//);
  const blocked = await anon.request.get(`http://localhost:3210${photoPath}`);
  expect(blocked.status()).toBe(401);
  await anon.close();

  // A job assigned to someone else is invisible to the worker.
  await manager.goto("/m/jobs/new");
  await manager.getByLabel("Job title").fill("Office visit");
  await manager.getByLabel("Worker", { exact: true }).selectOption({ label: "Maya Manager (manager)" });
  await manager.getByLabel("Paste a Google Maps link or coordinates").fill("https://www.google.com/maps/@25.21,55.28,15z");
  await manager.getByRole("button", { name: "Create job & notify worker" }).click();
  await expect(manager).toHaveURL(/created=1/);
  const otherJob = manager.url().match(/jobs\/([0-9a-f-]{36})/)![1];
  const res = await worker.goto(`/w/jobs/${otherJob}`);
  expect(res?.status()).toBe(404);

  // Only real browser push services are accepted as endpoints.
  const evil = await worker.request.post("/api/push/subscribe", {
    data: { endpoint: "https://169.254.169.254/latest", keys: { p256dh: Buffer.alloc(65).toString("base64url"), auth: Buffer.alloc(16).toString("base64url") } },
  });
  expect(evil.status()).toBe(400);
  const notPush = await worker.request.post("/api/push/subscribe", {
    data: { endpoint: "https://storage.googleapis.com/bucket/x", keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } },
  });
  expect(notPush.status()).toBe(400);
  const keys = { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
  const good = await worker.request.post("/api/push/subscribe", {
    data: { endpoint: "https://fcm.googleapis.com/fcm/send/test-token", keys },
  });
  expect(good.status()).toBe(200);
  await manager.goto("/m/workers");
  await expect(manager.getByRole("link", { name: /Ravi Kumar/ }).getByText("Alerts on")).toBeVisible();

  // Cross-site POSTs are rejected.
  const forged = await worker.request.post("/api/push/test", { headers: { Origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);
});

test("a worker who can't check in sends the photo for approval, and the manager moves the pin", async () => {
  // The pin was dropped about a kilometre from where the work really is.
  const id = await createJob("Warehouse stock check", `${FAR.latitude}, ${FAR.longitude}`, { uncheck: ["Leaving photo"] });
  await workerCtx.setGeolocation(NEAR);
  await worker.goto(`/w/jobs/${id}`);
  await worker.getByRole("button", { name: /take arrival photo/ }).click();
  await expect(worker.getByTestId("gps-status")).toContainText("from the site. Move closer");
  await worker.getByRole("button", { name: "Can't check in here? Send for approval" }).click();
  await worker.getByRole("radio", { name: "The job pin is in the wrong place" }).check();
  await worker.getByLabel("Note for your manager").fill("The pin is on the main road; the warehouse is behind the mall.");
  await shot(worker, "14-send-for-approval");
  await worker.getByRole("button", { name: "Continue" }).click();
  await expect(worker.getByTestId("gps-status")).toContainText("For approval: The job pin is in the wrong place");
  await worker.getByRole("button", { name: "Take photo" }).click();
  await worker.getByRole("button", { name: "Send for approval" }).click();
  await expect(worker.getByText("Arrival sent. Your manager will check it; carry on with the job.")).toBeVisible();
  await expect(worker.getByText(/Sent for approval \(the job pin is in the wrong place\), your manager will check it/)).toBeVisible();

  // The manager sees it waiting, and approves it with the pin moved to the photo.
  await manager.goto("/m");
  await expect(manager.getByRole("link", { name: "1 check-in needs your review →" })).toBeVisible();
  await manager.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Review/ }).click();
  await expect(manager.getByRole("heading", { name: "Ravi Kumar · Arrival photo" })).toBeVisible();
  await expect(manager.getByText("“The pin is on the main road; the warehouse is behind the mall.”")).toBeVisible();
  await expect(manager.getByRole("checkbox", { name: "Also move the job pin to where this photo was taken" })).toBeChecked();
  await shot(manager, "15-review");
  await manager.getByRole("button", { name: "Approve" }).click();
  await expect(manager.getByText("Approved, and the job pin now marks where this photo was taken.")).toBeVisible();
  await manager.goto(`/m/jobs/${id}`);
  await expect(manager.getByText(/^Approved by Maya Manager/)).toBeVisible();
  await expect(manager.getByText("0 m from site", { exact: true })).toBeVisible();
});

test("the customer gives the worker a code that only the customer was sent", async () => {
  const id = await createJob("Boiler service", AT_SITE, { check: ["Customer code"], uncheck: ["Leaving photo"], customerPhone: "055 333 4444" });
  const code = (await manager.getByLabel("Customer code").textContent())!.trim();
  expect(code).toMatch(/^\d{4}$/);
  const wa = await manager.getByRole("link", { name: /Send code to customer on WhatsApp/ }).getAttribute("href");
  expect(wa).toMatch(/^https:\/\/wa\.me\/971553334444\?text=/);
  expect(decodeURIComponent(wa!)).toContain(`*${code}*`);

  expect((await upload(worker, id, "arrival", NEAR)).status()).toBe(200);
  await worker.goto(`/w/jobs/${id}`);
  await expect(worker.getByText("Still needed: customer code.")).toBeVisible();
  await worker.getByLabel("Customer code").fill(code === "0000" ? "1111" : "0000");
  await worker.getByRole("button", { name: "Check code" }).click();
  await expect(worker.getByText("That code is wrong. 4 tries left.")).toBeVisible();
  await worker.getByLabel("Customer code").fill(code);
  await worker.getByRole("button", { name: "Check code" }).click();
  await expect(worker.getByText("Customer code confirmed.")).toBeVisible();
  await worker.getByRole("button", { name: "✓ Finish job" }).click();
  await expect(worker.getByText("Job finished. Good work!")).toBeVisible();

  await manager.reload();
  await expect(manager.getByText(/^Given by the customer/)).toBeVisible();
  await expect(manager.getByText("✓ Customer gave the code")).toBeVisible();

  // A callback visit gets a new code: the old one, known to the worker now, proves nothing.
  manager.once("dialog", (d) => d.accept());
  await manager.getByRole("button", { name: "Reopen" }).click();
  await expect(manager.getByText("Not given yet")).toBeVisible();
  expect((await manager.getByLabel("Customer code").textContent())!.trim()).not.toBe(code);
});

test("a customer step can be skipped with a reason, and the manager can refuse the skip", async () => {
  const id = await createJob("Leak check", AT_SITE, { check: ["Customer signature"], uncheck: ["Leaving photo"] });
  expect((await upload(worker, id, "arrival", NEAR)).status()).toBe(200);
  await worker.goto(`/w/jobs/${id}`);
  await worker.getByRole("button", { name: "Customer can't do this? Skip with a reason" }).click();
  await worker.getByRole("radio", { name: "The customer isn't here" }).check();
  await worker.getByRole("button", { name: "Skip and tell my manager" }).click();
  await expect(worker.getByText("Skipped. Your manager will check it.")).toBeVisible();
  await expect(worker.getByText(/^Skipped: The customer isn't here · your manager will check it/)).toBeVisible();
  await expect(worker.getByRole("button", { name: "✓ Finish job" })).toBeEnabled();

  // Refused while the worker is still there: the signature is needed again.
  await manager.goto("/m/review");
  await expect(manager.getByRole("heading", { name: "Ravi Kumar · Skipped the customer signature" })).toBeVisible();
  await manager.getByLabel("Note for the worker").fill("The customer is in the back office.");
  await manager.getByRole("button", { name: "Reject" }).click();
  await expect(manager.getByText("Rejected.")).toBeVisible();
  await worker.reload();
  await expect(worker.getByText(/Your manager didn't accept skipping the customer signature: “The customer is in the back office.”/)).toBeVisible();
  await expect(worker.getByText("Still needed: customer signature.")).toBeVisible();
});

test("a job can ask for a selfie with the arrival photo", async () => {
  const id = await createJob("Night shift handover", AT_SITE, { check: ["Selfie"], uncheck: ["Leaving photo"] });
  const without = await upload(worker, id, "arrival", NEAR);
  expect(without.status()).toBe(400);
  expect((await without.json()).error).toBe("Take the selfie too.");

  await worker.goto(`/w/jobs/${id}`);
  await worker.getByRole("button", { name: /take arrival photo/ }).click();
  await worker.getByRole("button", { name: "Take photo" }).click();
  await expect(worker.getByText("Now a selfie")).toBeVisible();
  await worker.getByRole("button", { name: "Take selfie" }).click();
  await expect(worker.getByRole("img", { name: "Your selfie" })).toBeVisible();
  await shot(worker, "16-selfie");
  await worker.getByRole("button", { name: "Send photo" }).click();
  await expect(worker.getByText("Arrival recorded")).toBeVisible();

  await manager.goto(`/m/jobs/${id}`);
  const selfie = manager.getByRole("img", { name: "Selfie" });
  await expect(selfie).toBeVisible();
  await expect.poll(() => selfie.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);
});

test("the same photo sent for two jobs waits for review; a resend to the same job doesn't", async () => {
  const one = await createJob("Meter reading 1", AT_SITE, { uncheck: ["Leaving photo"] });
  const two = await createJob("Meter reading 2", AT_SITE, { uncheck: ["Leaving photo"] });
  const same = await jpeg(worker);
  expect(await (await upload(worker, one, "arrival", NEAR, new Date(), same)).json()).toMatchObject({ review: "none" });
  // A resend after a lost answer is the same photo, already saved.
  expect(await (await upload(worker, one, "arrival", NEAR, new Date(), same)).json()).toMatchObject({ ok: true, resent: true });
  expect(await (await upload(worker, two, "arrival", NEAR, new Date(), same)).json()).toMatchObject({ review: "pending" });

  await manager.goto("/m/review");
  await expect(manager.getByText("Same photo sent before")).toBeVisible();
  await expect(manager.getByText(/The same file as a photo from “Meter reading 1”/)).toBeVisible();
  manager.once("dialog", (d) => d.accept()); // "Reject? Ravi Kumar will have to send a new arrival photo"
  await manager.getByRole("button", { name: "Reject" }).click();
  await expect(manager.getByText("Rejected. Ravi Kumar has to send a new arrival photo from the site.")).toBeVisible();
  await worker.goto(`/w/jobs/${two}`);
  await expect(worker.getByText("Your manager didn't accept your arrival photo. Send a new one from the site.")).toBeVisible();
  await expect(worker.getByRole("button", { name: /take arrival photo/ })).toBeVisible();
});

test("rejecting a leaving photo opens the job for a new one", async () => {
  const id = await createJob("Generator check", AT_SITE);
  expect((await upload(worker, id, "arrival", NEAR)).status()).toBe(200);
  // Sent for approval from 1 km away.
  const leave = await upload(worker, id, "leave", FAR, new Date(), undefined, { request: "gps_wrong" });
  expect(await leave.json()).toMatchObject({ review: "pending" });
  await manager.goto(`/m/jobs/${id}`);
  await expect(manager.getByText(/once you approve the photos waiting for review/)).toBeVisible();
  await manager.getByLabel("Note for the worker").fill("That's the depot, not the site.");
  await manager.getByRole("button", { name: "Reject" }).click();
  await expect(manager.getByText(/^Rejected. The job is open again until Ravi Kumar sends a new leaving photo/)).toBeVisible();
  await worker.goto(`/w/jobs/${id}`);
  await expect(
    worker.getByText("Your manager didn't accept your leaving photo. Send a new one from the site. Their note: “That's the depot, not the site.”"),
  ).toBeVisible();
  await expect(worker.getByRole("button", { name: /Take leaving photo/ })).toBeEnabled();
  expect(await (await upload(worker, id, "leave", NEAR)).json()).toMatchObject({ review: "none" });
});

test("one phone sending check-ins for two people waits for review", async ({ browser }) => {
  await manager.goto("/m/workers");
  await manager.getByLabel("Name", { exact: true }).fill("Sara Ali");
  await manager.getByLabel("Mobile number").fill("050 333 3333");
  await manager.getByLabel("PIN", { exact: true }).fill("135790");
  await manager.getByRole("button", { name: "Add worker" }).click();
  await expect(manager.getByText("Sara Ali added. PIN: 135790")).toBeVisible();
  const raviJob = await createJob("Pool pump", AT_SITE, { uncheck: ["Leaving photo"] });
  const saraJob = await createJob("Pool filter", AT_SITE, { worker: "Sara Ali", uncheck: ["Leaving photo"] });

  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US", timezoneId: "Asia/Dubai" });
  const page = await phone.newPage();
  await logIn(page, "0502222222", "246810");
  await expect(page).toHaveURL(/\/w$/);
  expect(await (await upload(page, raviJob, "arrival", NEAR)).json()).toMatchObject({ review: "none" });
  // Ravi hands his phone to Sara.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, "0503333333", "135790");
  await page.getByRole("button", { name: "I understand" }).click();
  expect(await (await upload(page, saraJob, "arrival", NEAR)).json()).toMatchObject({ review: "pending" });
  await phone.close();

  await manager.goto("/m/review");
  await expect(manager.getByText("Phone used by someone else")).toBeVisible();
  await expect(manager.getByText(/Sent from the phone that sent Ravi Kumar's photo/)).toBeVisible();
  await manager.getByRole("button", { name: "Approve" }).click();
  await expect(manager.getByText("Approved.")).toBeVisible();
});

test("workers can log in with fingerprint or face, and the company can require it", async ({ browser }) => {
  const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US", timezoneId: "Asia/Dubai" });
  const page = await phone.newPage();
  // A phone with a fingerprint reader, which always recognises its owner.
  const cdp = await phone.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await logIn(page, "0503333333", "135790");
  await expect(page).toHaveURL(/\/w$/);
  await page.getByRole("button", { name: "Set up fingerprint login" }).click();
  await expect(page.getByText("Done. Next time, log in with your fingerprint or face.")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Log in with fingerprint or face" }).click();
  await expect(page).toHaveURL(/\/w$/);
  await manager.goto("/m/workers");
  await expect(manager.getByRole("link", { name: /Sara Ali/ }).getByText("Fingerprint")).toBeVisible();

  // Sara's PIN also works on a friend's phone, for now.
  const friend = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US", timezoneId: "Asia/Dubai" });
  const friendPage = await friend.newPage();
  await logIn(friendPage, "0503333333", "135790");
  await expect(friendPage).toHaveURL(/\/w$/);

  // The company requires it: Sara's PIN no longer works, also where she's already logged in
  // with it, but her fingerprint does.
  await manager.goto("/m/settings");
  await manager.getByRole("checkbox", { name: /Workers must log in with fingerprint or face/ }).check();
  await manager.getByRole("button", { name: "Save", exact: true }).click();
  await expect(manager.getByText(/^Saved. Workers are asked to set up fingerprint or face login/)).toBeVisible();
  await friendPage.goto("/w");
  await expect(friendPage).toHaveURL(/\/login$/);
  await friend.close();
  await page.goto("/w");
  await expect(page).toHaveURL(/\/w$/); // her own passkey login stays
  await phone.clearCookies({ name: "sc_session" });
  await logIn(page, "0503333333", "135790");
  await expect(page.getByText(/Your company asks you to log in with your fingerprint or face/)).toBeVisible();
  await page.getByRole("button", { name: "Log in with fingerprint or face" }).click();
  await expect(page).toHaveURL(/\/w$/);

  // Lost phone: a PIN reset removes her passkeys and turns her PIN back on.
  await manager.goto("/m/workers");
  await manager.getByRole("link", { name: /Sara Ali/ }).click();
  await manager.getByLabel("New PIN").fill("864201");
  await manager.getByRole("button", { name: "Reset PIN" }).click();
  await expect(manager.getByText(/their fingerprint logins are removed/)).toBeVisible();
  await page.goto("/w");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Log in with fingerprint or face" }).click();
  await expect(page.getByText(/isn't set up here any more/)).toBeVisible();
  await logIn(page, "0503333333", "864201");
  await expect(page).toHaveURL(/\/w$/);
  await phone.close();

  await manager.goto("/m/settings");
  await manager.getByRole("checkbox", { name: /Workers must log in with fingerprint or face/ }).uncheck();
  await manager.getByRole("button", { name: "Save", exact: true }).click();
  await expect(manager.getByText("Saved. Everyone can log in with their PIN again.")).toBeVisible();
});

const WRONG = "Wrong phone number or PIN. After 5 wrong tries, the number is locked for 15 minutes.";

async function guessPins(page: Page, phone: string, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByLabel("Phone number").fill(phone);
    await page.getByLabel("PIN").fill("999999");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled();
  }
  await expect(page.getByText(WRONG)).toBeVisible();
}

test("five wrong PINs lock the number, but not on its owner's own phone", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await guessPins(page, "0502222222", 5);
  // Locked: the right PIN is refused too, with the same answer.
  await page.getByLabel("PIN").fill("246810");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(WRONG)).toBeVisible();
  await ctx.close();

  // Ravi's own phone has logged in before, so the guesses above don't lock it out.
  await workerCtx.clearCookies({ name: "sc_session" });
  await worker.goto("/login");
  await worker.getByLabel("Phone number").fill("0502222222");
  await worker.getByLabel("PIN").fill("246810");
  await worker.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(worker).toHaveURL(/\/w$/);
});

// Last: it logs the manager out everywhere.
test("a locked-out manager gets back in with the setup code", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await guessPins(page, "0501111111", 5);
  await page.getByRole("link", { name: "Use the setup code" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await page.getByLabel("Setup code").fill("not-the-code-123");
  await page.getByLabel("Manager's mobile number").fill("050 111 1111");
  await page.getByLabel("New PIN", { exact: true }).fill("735184");
  await page.getByLabel("Repeat new PIN").fill("735184");
  await page.getByRole("button", { name: "Reset PIN and log in" }).click();
  await expect(page.getByText("That setup code is wrong.")).toBeVisible();
  await shot(page, "13-recover");
  await page.getByLabel("Setup code").fill(" E2E-SETUP-CODE ");
  await page.getByRole("button", { name: "Reset PIN and log in" }).click();
  await expect(page).toHaveURL(/\/m$/);
  await ctx.close();

  // The manager is logged out everywhere else.
  await manager.goto("/m/jobs");
  await expect(manager).toHaveURL(/\/login$/);
  await manager.getByLabel("Phone number").fill("0501111111");
  await manager.getByLabel("PIN").fill("735184");
  await manager.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(manager).toHaveURL(/\/m$/);
});
