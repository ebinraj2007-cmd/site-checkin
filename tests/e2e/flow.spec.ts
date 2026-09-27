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
  await manager.getByLabel("Choose a PIN").fill("1234");
  await manager.getByLabel("Repeat PIN").fill("1234");
  await expect(manager.getByText("Asia/Dubai")).toBeVisible();
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
  await manager.getByLabel("PIN", { exact: true }).fill("5678");
  await manager.getByRole("button", { name: "Add worker" }).click();
  await expect(manager.getByText("Ravi Kumar added. PIN: 5678")).toBeVisible();
  const invite = manager.getByRole("link", { name: /Send login on WhatsApp/ });
  const href = await invite.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/971502222222\?text=/);
  expect(decodeURIComponent(href!)).toContain("PIN: 5678");
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
  expect(text).toContain("Customer: Ali Hassan, +971553334444");
  await expect(manager.getByText("Waiting for the arrival photo.")).toBeVisible();
});

test("worker logs in and sees the job", async () => {
  await worker.goto("/login");
  await worker.getByLabel("Phone number").fill("0502222222");
  await worker.getByLabel("PIN").fill("0000");
  await worker.getByRole("button", { name: "Log in" }).click();
  await expect(worker.getByText("Wrong phone number or PIN.")).toBeVisible();
  await worker.getByLabel("PIN").fill("5678");
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
  const res = await worker.request.post(`/api/jobs/${jobId}/photo`, {
    multipart: {
      kind: "arrival",
      lat: String(FAR.latitude),
      lng: String(FAR.longitude),
      accuracy: "10",
      live: "1",
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) },
    },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toContain("from the job site");

  // Not-a-photo is refused too.
  const junk = await worker.request.post(`/api/jobs/${jobId}/photo`, {
    multipart: {
      kind: "arrival",
      lat: String(NEAR.latitude),
      lng: String(NEAR.longitude),
      accuracy: "10",
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html>not an image</html>") },
    },
  });
  expect(junk.status()).toBe(400);
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

test("five wrong PINs lock the account for a while", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("Phone number").fill("0502222222");
    await page.getByLabel("PIN").fill("9999");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeEnabled();
  }
  await expect(page.getByText("Too many wrong PINs")).toBeVisible();
  await page.getByLabel("PIN").fill("5678");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Too many wrong PINs")).toBeVisible();
  await ctx.close();
});
