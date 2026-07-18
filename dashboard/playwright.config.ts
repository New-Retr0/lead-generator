import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3847);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `bash -c 'npm run build && E2E_ALLOW_MOCK=1 npx next start -H 127.0.0.1 -p ${port}'`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 300_000,
        env: {
          ...process.env,
          E2E_ALLOW_MOCK: "1",
        },
      },
});
