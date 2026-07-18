import { test, expect } from "@playwright/test";
import { paidSmokeEnabled, waitForMain } from "./helpers";

/**
 * Opt-in only: burns Places/Firecrawl credits.
 * Run with: E2E_PAID_SMOKE=1 npm run test:e2e -- e2e/paid-smoke.spec.ts
 */
test.describe("Paid smoke (gated)", () => {
  test.skip(!paidSmokeEnabled, "Set E2E_PAID_SMOKE=1 to enable credit-burning smokes");

  test("smoke-sample launch surfaces live timeline", async ({ page }) => {
    await page.goto("/launch?mode=smoke");
    await waitForMain(page);
    await page.getByRole("button", { name: /Run smoke sample|Smoke|Launch/i }).first().click();
    await expect(
      page.getByText(/Live run|Local CLI|streaming|starting|Spawning/i).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    const cancel = page.getByTestId("cancel-job");
    await expect(cancel).toBeVisible({ timeout: 15_000 });
    await cancel.click();
  });
});
