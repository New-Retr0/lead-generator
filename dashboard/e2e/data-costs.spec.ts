import { test, expect } from "@playwright/test";
import { expectPageTitle, gotoNav, waitForMain } from "./helpers";

test.describe("Data + Costs", () => {
  test("data explorer quality-first columns", async ({ page }) => {
    await page.goto("/data");
    await waitForMain(page);
    await expectPageTitle(page, "Lead Data");
    await expect(page.getByRole("button", { name: "Verified" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unverified" })).toBeVisible();
    await expect(page.getByText(/Default view is Verified leads/i)).toBeVisible();
    const table = page.locator("table").first();
    await expect(table.getByRole("columnheader", { name: "Phone" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Decision maker" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Verification" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Score" })).toBeVisible();
    await expect(page.getByPlaceholder(/Search business/i)).toBeVisible();

    const dataRow = page.locator("tbody tr").filter({
      hasNot: page.getByText(/No leads|Loading|Could not/),
    });
    if ((await dataRow.count()) === 0) {
      await expect(
        page.getByText(/No leads match|Loading leads|Could not load/i).first(),
      ).toBeVisible();
      return;
    }

    await dataRow.first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("/triage redirects into data", async ({ page }) => {
    await page.goto("/triage");
    await expect(page).toHaveURL(/\/data/);
    await expectPageTitle(page, "Lead Data");
    await expect(page.getByRole("tab", { name: "Triage" })).toHaveCount(0);
  });

  test("costs page shows spend range tabs", async ({ page }) => {
    await page.goto("/costs");
    await waitForMain(page);
    await expectPageTitle(page, "Costs & Credits");
    await expect(page.getByRole("tab", { name: "7d" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "30d" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "90d" })).toBeVisible();
  });

  test("nav inventory → ops", async ({ page }) => {
    await page.goto("/data");
    await waitForMain(page);
    await gotoNav(page, "Costs", "Costs & Credits");
    await gotoNav(page, "Data", "Lead Data");
  });
});
