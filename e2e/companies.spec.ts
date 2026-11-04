import { expect, test } from "@playwright/test";
import { ANNA, B2B, COMPANY, LONG_NAME, PROJECT, companyPath, companyRow, inCompany, setHooks, signIn } from "./companiesFixtures";

/*
 * The companies build's sign-in, picker and switcher (TAS-500, DESIGN.md
 * §4.33, §4.34, §4.16, §4.13) against the third e2e server.
 */

test("signing in lists the companies in the same card, and a row opens the company", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(page).toHaveTitle("Choose a company — Taska");
  // The card that held the form holds the list: one card, entered once.
  await expect(page.locator(".auth-card")).toHaveCount(1);
  await expect(page.locator(".auth-card-wrap.is-app-entrance")).toHaveCount(0);
  const heading = page.getByRole("heading", { level: 1, name: "Choose a company" });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("list", { name: "Companies" }).getByRole("link")).toHaveText([
    "Globex",
    "InitechPaused by its owner",
    "NorthwindOwner",
  ]);
  await expect(page.getByText("Signed in as anna@example.com")).toBeVisible();
  await companyRow(page, /^Northwind/).click();
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await expect(page).toHaveTitle("Northwind — Taska");
});

test("the picker opened from inside the app enters on the token, not the sign-in card's 500 ms", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(`${B2B}/companies`);
  await expect(page.locator(".auth-card-wrap.is-app-entrance")).toHaveCount(1);
  // A first screen of the tab takes no focus.
  await expect(page.getByRole("heading", { level: 1, name: "Choose a company" })).not.toBeFocused();
  // The tab's company is marked and still a link.
  await expect(companyRow(page, /^Northwind/)).toHaveAttribute("aria-current", "true");
});

test("with exactly one company in the first group, signing in goes straight there", async ({ page }) => {
  await page.goto(`${B2B}/login`);
  await setHooks(page, {
    suspend: [
      { tenantId: COMPANY.globex, userId: ANNA },
      { tenantId: COMPANY.initech, userId: ANNA },
    ],
  });
  await signIn(page);
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await expect(page.locator("button.project-card .key-badge")).toHaveText(["TAS", "WEB", "MOB"]);
});

test("an address remembered by the sign-in names its company, and the reader lands there", async ({ page }) => {
  await page.goto(companyPath(COMPANY.globex, `/projects/${PROJECT.ops}/board`));
  await expect(page).toHaveURL(`${B2B}/login`);
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(companyPath(COMPANY.globex, `/projects/${PROJECT.ops}/board`));
});

test("an address without a company opens in the tab's company", async ({ page }) => {
  await inCompany(page, "Globex", COMPANY.globex);
  await page.goto(`${B2B}/projects`);
  await expect(page).toHaveURL(companyPath(COMPANY.globex));
  await expect(page.locator("button.project-card .key-badge")).toHaveText(["OPS"]);
});

test("Nina, in no company, is told so; Mark, the administrator, meets the emailed-code note and no session", async ({ page }) => {
  await signIn(page, "nina@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "You’re not in a company yet" })).toBeVisible();
  await expect(page.getByText("Work in Taska happens inside a company. Ask a company admin to invite you.")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(`${B2B}/login`);

  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await page.locator("form button[type=submit]").click();
  await expect(
    page.getByText("Administrator accounts sign in with a code sent by email. This version of Taska can’t ask for it yet."),
  ).toBeVisible();
  await expect(page).toHaveURL(`${B2B}/login`);
  await expect(page.getByLabel("Email")).toHaveValue("mark@example.com");
  expect(await page.evaluate(() => window.localStorage.getItem("taska.webSession"))).toBeNull();
});

test("the companies build offers no provider buttons and no Administration", async ({ page }) => {
  await page.goto(`${B2B}/login`);
  await page.evaluate(() =>
    window.localStorage.setItem("taska.mockAuthMethods", JSON.stringify({ signupEnabled: false, providers: ["GOOGLE", "GITHUB"] })),
  );
  await page.reload();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("link", { name: /Google|GitHub/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Google|GitHub/ })).toHaveCount(0);
  await page.goto(`${B2B}/admin`);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("the switcher is in the shared bar at 768 and wider only, never in the board's; Switch company is in the menu everywhere", async ({
  page,
  isMobile,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  const trigger = page.getByRole("button", { name: "Northwind, switch company" });
  if (isMobile) await expect(trigger).toBeHidden();
  else await expect(trigger).toBeVisible();
  await page.getByRole("button", { name: /Open profile/ }).click();
  const menu = page.getByRole("dialog", { name: "Current user profile" });
  await expect(menu.getByRole("link", { name: "Switch company" })).toHaveAttribute("href", "/companies");
  await expect(menu.getByText("Taska role")).toBeVisible();
  await expect(menu.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.locator(`button.project-card[data-project-id="${PROJECT.taska}"]`).click();
  await expect(page.locator(".board-topbar")).toBeVisible();
  await expect(page.locator(".company-switcher")).toHaveCount(0);
  await page.locator(".board-topbar").getByRole("button", { name: /Open profile/ }).click();
  await expect(page.getByRole("link", { name: "Switch company" })).toBeVisible();
});

test("the 120-character name is cut on the switcher and whole in the profile menu", async ({ page, isMobile }) => {
  await signIn(page, "sofia@example.com");
  await companyRow(page, new RegExp(`^${LONG_NAME.slice(0, 40)}`)).click();
  await expect(page).toHaveURL(companyPath(COMPANY.longName));
  if (!isMobile) {
    const name = page.locator(".company-switcher-name");
    await expect(name).toHaveText(LONG_NAME);
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect(page.locator(".company-switcher-trigger")).toHaveAttribute("title", LONG_NAME);
  }
  await page.getByRole("button", { name: /Open profile/ }).click();
  const company = page.locator(".user-profile-company");
  await expect(company).toHaveText(LONG_NAME);
  expect(await company.evaluate((node) => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().height > 20)).toBe(
    true,
  );
});

test("a paused company opens, reads, and refuses a write on that write alone", async ({ page }) => {
  await inCompany(page, "Initech", COMPANY.initech);
  await expect(page.locator("button.project-card .key-badge")).toHaveText(["HLP"]);
  await expect(page.locator(".projects-heading p")).toHaveText("1 projects · Initech");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("textbox", { name: "Key", exact: true }).fill("NEW");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("New work");
  await dialog.getByRole("button", { name: "Create project" }).click();
  // The server's words and its request id, on the write — the company stays open.
  await expect(dialog.getByText("The company is read-only")).toBeVisible();
  await expect(page).toHaveURL(companyPath(COMPANY.initech));
  await expect(page.getByRole("heading", { name: /is paused|no longer have access/ })).toHaveCount(0);
});

test("Access tokens offers no Create token here, and focus goes to the heading once the last token is revoked", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(companyPath(COMPANY.northwind, "/settings/tokens"));
  const list = page.getByRole("list", { name: "Your access tokens" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Create token" })).toHaveCount(0);
  for (let left = 2; left > 0; left -= 1) {
    const row = list.getByRole("listitem").first();
    await row.getByRole("button", { name: /^Revoke / }).click();
    await row.getByRole("button", { name: "Revoke token" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(left - 1);
  }
  await expect(page.getByRole("heading", { level: 1, name: /Access tokens/ })).toBeFocused();
});
