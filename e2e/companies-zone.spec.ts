import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, companyPath, inCompany, openCompanyZone } from "./companiesFixtures";

/*
 * The Company zone in the companies build (TAS-522, DESIGN.md §5.10, §4.34)
 * against the third e2e server's mock: «Manage company» — the switcher's at
 * 768 and wider, the profile menu's below (§4.16) — leads to the tab's
 * company's General with focus on its heading (AC2), the old Settings
 * addresses lead to the zone's (AC3), Settings keeps only the reader's own
 * sections, and the build without the flag has no zone at all (AC4). The
 * sections' own behaviour (AC1) is the companies-company, -members and -plan
 * specs, which reach them through the zone.
 */

const companiesPopover = (page: Page) => page.getByRole("dialog", { name: "Companies" });
const profileMenu = (page: Page) => page.getByRole("dialog", { name: "Current user profile" });

test("AC2: «Manage company» opens the tab's company's General with focus on its heading — for a plain member, every role", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the switcher is not in the bar below 768 (§4.34)");
  // Anna is a member of Globex, not its owner or an admin.
  await inCompany(page, "Globex", COMPANY.globex);
  await page.getByRole("button", { name: "Globex, switch company" }).click();
  const footer = companiesPopover(page).locator(".company-switcher-footer");
  await expect(footer.getByRole("link")).toHaveText(["Manage company", "All companies", "Create a company"]);
  const manage = footer.getByRole("link", { name: "Manage company" });
  await expect(manage).toHaveAttribute("href", `/c/${COMPANY.globex}/company`);
  await expect(manage).not.toHaveAttribute("aria-current", "page");
  await manage.click();

  await expect(companiesPopover(page)).toHaveCount(0);
  await expect(page).toHaveURL(companyPath(COMPANY.globex, "/company/general"));
  const heading = page.getByRole("heading", { level: 1, name: /General/ });
  await expect(heading).toBeFocused();
  await expect(heading.locator(".area-crumb")).toHaveText("Company ›");
  await expect(page).toHaveTitle("Globex — Taska");
  const rail = page.getByRole("navigation", { name: "Company" });
  await expect(rail.getByRole("link")).toHaveText(["General", "Members", "Plan", "Back to projects"]);
  await expect(rail.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");

  // Inside the zone the row says so, and nothing else about it changes; Esc hands focus to the trigger.
  const trigger = page.getByRole("button", { name: "Globex, switch company" });
  await trigger.click();
  await expect(companiesPopover(page).getByRole("link", { name: "Manage company" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  // Pushed: Back returns to the page it was opened from.
  await page.goBack();
  await expect(page).toHaveURL(companyPath(COMPANY.globex));
});

test("§4.34: the keyboard reaches the rows, then Manage company, All companies, Create a company; Enter lands on the zone's heading", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the switcher is not in the bar below 768 (§4.34)");
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(companyPath(COMPANY.northwind, "/company/members"));
  await expect(page.getByRole("heading", { level: 1, name: /Members/ })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Northwind, switch company" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(companiesPopover(page)).toBeVisible();

  const stops: { text: string; row: boolean }[] = [];
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return { text: active?.textContent?.trim() ?? "", row: active?.classList.contains("company-switcher-row") ?? false };
    });
    stops.push(stop);
    if (stop.text === "Create a company") break;
  }
  const footerStart = stops.findIndex((stop) => stop.text === "Manage company");
  expect(footerStart).toBeGreaterThan(0);
  expect(stops.slice(0, footerStart).every((stop) => stop.row)).toBe(true);
  expect(stops.slice(footerStart).map((stop) => stop.text)).toEqual(["Manage company", "All companies", "Create a company"]);

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(companiesPopover(page)).toHaveCount(0);
  await expect(page).toHaveURL(companyPath(COMPANY.northwind, "/company/general"));
  await expect(page.getByRole("heading", { level: 1, name: /General/ })).toBeFocused();
});

test("§4.34: a modified click on Manage company opens the zone in a new tab of the same company; this one keeps its page and the popover", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "a modifier click needs a keyboard; a phone opens links by long-press");
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.getByRole("button", { name: "Northwind, switch company" }).click();
  const opened = context.waitForEvent("page");
  await companiesPopover(page).getByRole("link", { name: "Manage company" }).click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(companyPath(COMPANY.northwind, "/company/general"));
  await expect(tab.getByRole("navigation", { name: "Company" })).toBeVisible();
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await expect(companiesPopover(page)).toBeVisible();
});

test("AC2 below 768: «Manage company» is the profile menu's second row, and a tap lands on General with focus on its heading (§4.16)", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "at 768 and wider the menu leaves it to the switcher — the next test");
  // Anna is a member of Globex, not its owner or an admin.
  await inCompany(page, "Globex", COMPANY.globex);
  await expect(page.locator(".company-switcher-trigger")).toBeHidden();
  const trigger = page.getByRole("button", { name: /Open profile/ });
  await trigger.click();
  await expect(profileMenu(page).getByRole("link")).toHaveText(["Switch company", "Manage company", "Settings"]);
  const manage = profileMenu(page).getByRole("link", { name: "Manage company" });
  await expect(manage).toHaveAttribute("href", `/c/${COMPANY.globex}/company`);
  await expect(manage).not.toHaveAttribute("aria-current", "page");
  await manage.tap();

  await expect(profileMenu(page)).toHaveCount(0);
  await expect(page).toHaveURL(companyPath(COMPANY.globex, "/company/general"));
  await expect(page.getByRole("heading", { level: 1, name: /General/ })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "General" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Inside the zone the row says so, and nothing else about it changes; Esc hands focus to the trigger.
  await trigger.click();
  await expect(profileMenu(page).getByRole("link", { name: "Manage company" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  // Pushed: Back returns to the page it was opened from.
  await page.goBack();
  await expect(page).toHaveURL(companyPath(COMPANY.globex));
});

test("at 768 and wider the profile menu has no «Manage company» — the switcher's row is the way in; at 767 it is the other way round", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "below 768 the menu has the row — the test above");
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.getByRole("button", { name: /Open profile/ }).click();
  const row = profileMenu(page).locator(".user-profile-manage");
  await expect(row).toBeHidden();
  // Out of the accessibility tree as well as out of sight.
  await expect(profileMenu(page).getByRole("link")).toHaveText(["Switch company", "Settings"]);

  // The switcher's breakpoint: at every whole width exactly one of the two is drawn — never neither.
  const viewport = page.viewportSize()!;
  const switcher = page.locator(".company-switcher-trigger");
  for (const [width, inMenu] of [
    [767, true],
    [768, false],
  ] as const) {
    await page.setViewportSize({ width, height: 1024 });
    if (inMenu) {
      await expect(profileMenu(page).getByRole("link", { name: "Manage company" })).toBeVisible();
      await expect(switcher).toBeHidden();
    } else {
      await expect(row).toBeHidden();
      await expect(switcher).toBeVisible();
    }
  }
  await page.setViewportSize(viewport);
  await page.keyboard.press("Escape");
  await expect(profileMenu(page)).toHaveCount(0);

  // The switcher's row still leads there, focus on the zone's heading.
  await openCompanyZone(page, COMPANY.northwind);
});

test("AC3: each old Settings address lands on the zone's, query and hash kept; an address without a company opens in the tab's", async ({
  page,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  for (const [from, to, label] of [
    ["/settings/company", "/company/general", "General"],
    ["/settings/members", "/company/members", "Members"],
    ["/settings/plan", "/company/plan", "Plan"],
  ] as const) {
    await page.goto(companyPath(COMPANY.northwind, `${from}?from=old#top`));
    await expect(page).toHaveURL(companyPath(COMPANY.northwind, `${to}?from=old#top`));
    await expect(page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Settings" })).toHaveCount(0);
  }
  // Without the prefix (§5.1): the tab's company, as /settings/… does.
  await page.goto(`${B2B}/company/members`);
  await expect(page).toHaveURL(companyPath(COMPANY.northwind, "/company/members"));
  await expect(page.getByRole("heading", { level: 1, name: /Members/ })).toBeVisible();
  await page.goto(`${B2B}/settings/plan`);
  await expect(page).toHaveURL(companyPath(COMPANY.northwind, "/company/plan"));
  // An address inside the zone that is no section is §4.18.
  await page.goto(companyPath(COMPANY.northwind, "/company/nope"));
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("Settings keeps only the reader's own sections — no «Company» group — and neither area is wider than the screen", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(companyPath(COMPANY.northwind, "/settings/profile"));
  const rail = page.getByRole("navigation", { name: "Settings" });
  await expect(rail.getByRole("link")).toHaveText(["My profile", "Access tokens", "Connected apps", "Appearance", "Back to projects"]);
  await expect(rail.getByRole("group")).toHaveCount(0);
  await expect(rail.getByText("Company", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  for (const section of ["general", "members", "plan"]) {
    await page.goto(companyPath(COMPANY.northwind, `/company/${section}`));
    await expect(page.getByRole("navigation", { name: "Company" }).locator('[aria-current="page"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test("AC4: the build without the flag has no Company zone, and its Settings is as it was", async ({ page }) => {
  // The first e2e server: the stand's build, flag off.
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".company-switcher")).toHaveCount(0);
  for (const path of ["/company", "/company/general", "/settings/company"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  }
  await page.goto("/settings/profile");
  await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link")).toHaveText([
    "My profile",
    "Access tokens",
    "Connected apps",
    "Appearance",
    "Back to projects",
  ]);
});
