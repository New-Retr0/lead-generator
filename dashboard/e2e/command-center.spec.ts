import { test, expect } from "@playwright/test";
import { expectPageTitle, gotoNav, waitForMain } from "./helpers";

test.describe("Command Center + Launch", () => {
  test("command center renders attention strip and actions", async ({ page }) => {
    await page.goto("/");
    await waitForMain(page);
    await expectPageTitle(page, "Command Center");
    await expect(page.getByTestId("attention-strip")).toBeVisible();
    await expect(
      page.getByTestId("attention-strip").getByText("Verified DMs", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("attention-strip").getByText("Partial inventory", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Health check" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Launch" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Health check" }).click({ force: true });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  });

  test("requests mode dry-run path (no Firecrawl/Places)", async ({ page }) => {
    await page.goto("/launch?mode=request");
    await waitForMain(page);
    await expect(page.getByTestId("launch-page")).toBeVisible();
    await expect(page.getByTestId("request-estimate")).toBeVisible();
  });

  test("legacy /requests redirects into launch", async ({ page }) => {
    await page.goto("/requests");
    await expect(page).toHaveURL(/\/launch\?mode=request/);
  });

  test("nav reaches launch from command center", async ({ page }) => {
    await page.goto("/");
    await waitForMain(page);
    await gotoNav(page, "Launch", "Launch");
  });

  test("learn page renders", async ({ page }) => {
    await page.goto("/learn");
    await waitForMain(page);
    await expectPageTitle(page, "Learn");
    await expect(page.getByTestId("learn-page")).toBeVisible();
  });
});
