import { expect, type Page } from "@playwright/test";

/** Paid Firecrawl/Places smokes stay off unless explicitly enabled. */
export const paidSmokeEnabled = process.env.E2E_PAID_SMOKE === "1";

export async function expectPageTitle(page: Page, title: string) {
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

const NAV: Record<string, string> = {
  "Command Center": "/",
  Launch: "/launch",
  Data: "/data",
  Runs: "/runs",
  Costs: "/costs",
  Learn: "/learn",
  Settings: "/settings",
};

export async function gotoNav(page: Page, label: string, title: string) {
  const path = NAV[label];
  if (!path) throw new Error(`Unknown nav label: ${label}`);
  // Sidebar can render duplicate accessible names (tooltip + label); prefer nav link.
  const link = page.locator("nav").getByRole("link", { name: label, exact: true }).first();
  if ((await link.count()) > 0) {
    await link.click();
  } else {
    await page.getByRole("link", { name: label, exact: true }).first().click();
  }
  await expect(page).toHaveURL((url) => {
    const p = url.pathname.replace(/\/$/, "") || "/";
    return p === path || p.startsWith(`${path}/`) || (path === "/launch" && p === "/launch");
  });
  await expectPageTitle(page, title);
}

export async function waitForMain(page: Page) {
  await expect(page.locator("main").first()).toBeVisible();
}
