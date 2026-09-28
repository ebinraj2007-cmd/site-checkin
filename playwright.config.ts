import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// End-to-end run against a production build. Chromium gets a fake camera; tests set
// the GPS position per step.
//   default:              throwaway PGlite database, photos in the database
//   E2E_DATABASE_URL=...  a real (empty) Postgres through the production driver
//   E2E_FAKE_SUPABASE=1   photos through the Supabase Storage code path (local fake)
const PORT = 3210;
const FAKE_SUPABASE_PORT = 3299;
const proxy = process.env.HTTPS_PROXY;
const fakeSupabase = !!process.env.E2E_FAKE_SUPABASE;

// The app server's environment. Blank values win over a pulled .env.local, so the tests
// never reach a real database or bucket.
const serverEnv: Record<string, string> = {
  SETUP_CODE: "e2e-setup-code",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
  POSTGRES_URL: "",
  SUPABASE_URL: fakeSupabase ? `http://127.0.0.1:${FAKE_SUPABASE_PORT}` : "",
  SUPABASE_SERVICE_ROLE_KEY: fakeSupabase ? "eyJfake.service.role" : "",
};
if (!process.env.E2E_DATABASE_URL) serverEnv.PGLITE_DIR = path.join(os.tmpdir(), `site-checkin-e2e-${Date.now()}`);
if (proxy) serverEnv.NODE_USE_ENV_PROXY = "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      // Map tiles come from openstreetmap.org; route them through the sandbox proxy if there is one.
      proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    ...(fakeSupabase
      ? [
          {
            command: "node tests/e2e/fake-supabase.mjs",
            url: `http://127.0.0.1:${FAKE_SUPABASE_PORT}/__stats`,
            reuseExistingServer: false,
            env: { FAKE_SUPABASE_PORT: String(FAKE_SUPABASE_PORT) },
          },
        ]
      : []),
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnv,
    },
  ],
});
