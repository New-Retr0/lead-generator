import { expect, test } from "@playwright/test";
import { expectPageTitle, gotoNav, waitForMain } from "./helpers";

test.describe("Release gate", () => {
  test("health API reports db status", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("db");
    expect(body).toHaveProperty("timestamp");
  });

  test("yield API exposes north-star counters", async ({ request }) => {
    const res = await request.get("/api/yield");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("discovered");
    expect(body).toHaveProperty("enriched");
    expect(body).toHaveProperty("verifiedDm");
  });

  test("launch modes are reachable without paid runs", async ({ page }) => {
    await page.goto("/launch");
    await waitForMain(page);
    await expectPageTitle(page, "Launch");

    for (const mode of ["campaign", "request", "single", "smoke"] as const) {
      await page.getByTestId(`launch-mode-${mode}`).click();
      await expect(page).toHaveURL(new RegExp(`[?&]mode=${mode}`));
      await expect(page.getByText(/Execution/i).first()).toBeVisible();
    }
  });

  test("sidebar IA covers Command → Settings", async ({ page }) => {
    await page.goto("/");
    await waitForMain(page);
    await gotoNav(page, "Launch", "Launch");
    await gotoNav(page, "Runs", "Runs");
    await gotoNav(page, "Data", "Lead Data");
    await gotoNav(page, "Costs", "Costs & Credits");
    await gotoNav(page, "Learn", "Learn");
    await gotoNav(page, "Settings", "Settings");
    await gotoNav(page, "Command Center", "Command Center");
  });
});

test.describe("Visual smoke", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("command center desktop screenshot", async ({ page }) => {
    await page.goto("/");
    await waitForMain(page);
    await expect(page).toHaveScreenshot("command-center-desktop.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.04,
    });
  });
});

test.describe("Visual smoke · reduced motion", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    contextOptions: { reducedMotion: "reduce" },
  });

  test("command center reduced-motion screenshot", async ({ page }) => {
    await page.goto("/");
    await waitForMain(page);
    await expect(page).toHaveScreenshot("command-center-reduced.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.04,
    });
  });
});
