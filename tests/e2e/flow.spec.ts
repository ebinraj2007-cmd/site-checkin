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

// A real JPEG, drawn and encoded by the browser like the app's camera does.
async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `hsl(${(i * 47) % 360} 70% 50%)`;
      ctx.fillRect((i * 53) % 320, (i * 29) % 240, 40, 30);
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
async function upload(page: Page, jobId: string, kind: string, where: { latitude: number; longitude: number; accuracy: number }, takenAt = new Date()) {
  return page.request.post(`/api/jobs/${jobId}/photo`, {
    multipart: {
      kind,
      lat: String(where.latitude),
      lng: String(where.longitude),
      accuracy: String(where.accuracy),
      live: "1",
      deviceTime: takenAt.toISOString(),
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: await jpeg(page) },
    },
  });
}

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
  await worker.getByRole("button", { name: "Log in" }).click();
  await expect(worker.getByText("Wrong phone number or PIN.")).toBeVisible();
  await worker.getByLabel("PIN").fill("246810");
  await worker.getByRole("button", { name: "Log in" }).click();
  await expect(worker).toHaveURL(/\/w$/);
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

const WRONG = "Wrong phone number or PIN. After 5 wrong tries, the number is locked for 15 minutes.";

async function guessPins(page: Page, phone: string, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByLabel("Phone number").fill(phone);
    await page.getByLabel("PIN").fill("999999");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeEnabled();
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
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(WRONG)).toBeVisible();
  await ctx.close();

  // Ravi's own phone has logged in before, so the guesses above don't lock it out.
  await workerCtx.clearCookies({ name: "sc_session" });
  await worker.goto("/login");
  await worker.getByLabel("Phone number").fill("0502222222");
  await worker.getByLabel("PIN").fill("246810");
  await worker.getByRole("button", { name: "Log in" }).click();
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
  await manager.getByRole("button", { name: "Log in" }).click();
  await expect(manager).toHaveURL(/\/m$/);
});
