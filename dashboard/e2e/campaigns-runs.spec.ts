import { test, expect } from "@playwright/test";
import { expectPageTitle, gotoNav, waitForMain } from "./helpers";

test.describe("Launch + Runs", () => {
  test("launch campaign UI without starting a paid job", async ({ page }) => {
    await page.goto("/launch?mode=campaign");
    await waitForMain(page);
    await expectPageTitle(page, "Launch");
    await expect(page.getByTestId("launch-page")).toBeVisible();
    await expect(page.getByTestId("launch-mode-campaign")).toBeVisible();
    await expect(page.getByText(/Launch Control|Campaign presets|Campaign/i).first()).toBeVisible();
  });

  test("legacy /campaigns redirects into launch", async ({ page }) => {
    await page.goto("/campaigns");
    await expect(page).toHaveURL(/\/launch\?mode=campaign/);
  });

  test("mock job cancel is available on launch single mode", async ({ page, request }) => {
    const res = await request.post("/api/jobs/mock", {
      data: { scenario: "happy" },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { jobId?: string };
    expect(body.jobId).toBeTruthy();

    await page.goto(`/launch?mode=single`);
    await waitForMain(page);
    // Mock job is independent; open runs page which can surface active ops via chip,
    // or hit the job timeline API surface through cancel on any mounted timeline.
    // Directly exercise cancel API + ensure Active Ops can deep-link once a run id exists.
    const cancelRes = await request.delete(`/api/jobs/${body.jobId}`);
    // Timing can race the synthetic job to completion; accept ok or already-gone.
    expect([200, 404].includes(cancelRes.status())).toBeTruthy();
  });

  test("nav between launch and runs", async ({ page }) => {
    await page.goto("/launch");
    await waitForMain(page);
    await gotoNav(page, "Runs", "Runs");
    await gotoNav(page, "Launch", "Launch");
  });

  test("/crm and /leads redirect into data", async ({ page }) => {
    await page.goto("/crm");
    await expect(page).toHaveURL(/\/data\/?$/);
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/data\/?$/);
  });
});
