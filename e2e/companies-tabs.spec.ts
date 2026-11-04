import { expect, test, type Page } from "@playwright/test";
import {
  ANNA,
  B2B,
  COMPANY,
  PROJECT,
  companyPath,
  inCompany,
  setHooks,
  signIn,
  switchCompany,
} from "./companiesFixtures";

/*
 * TAS-500's acceptance criteria against the companies build (DESIGN.md §5.1,
 * §4.34, §4.35): two tabs keep two companies, a late answer never lands in the
 * company switched to, Back and reload keep the company, a suspended
 * membership closes only its tab, and a key opens a different issue in each
 * company. Two pages of one browser context are two tabs: one `localStorage`,
 * a `sessionStorage` each.
 */

const keys = (page: Page) => page.locator("button.project-card .key-badge");
const subtitle = (page: Page) => page.locator(".projects-heading p");

test("AC1: two tabs keep their own companies; switching one leaves the other's company, bar and data as they were", async ({
  context,
  isMobile,
}) => {
  const northwind = await context.newPage();
  await inCompany(northwind, "Northwind", COMPANY.northwind);
  await expect(keys(northwind)).toHaveText(["TAS", "WEB", "MOB"]);

  const globex = await context.newPage();
  await globex.goto(companyPath(COMPANY.globex));
  await expect(keys(globex)).toHaveText(["OPS"]);
  await expect(subtitle(globex)).toHaveText("1 projects · Globex");
  await expect(globex).toHaveTitle("Globex — Taska");

  await switchCompany(globex, "Initech", isMobile);
  await expect(globex).toHaveURL(companyPath(COMPANY.initech));
  await expect(keys(globex)).toHaveText(["HLP"]);

  // The first tab: same company, same bar, same data — and it still works.
  await expect(northwind).toHaveTitle("Northwind — Taska");
  await expect(subtitle(northwind)).toHaveText("3 projects · Northwind");
  await expect(keys(northwind)).toHaveText(["TAS", "WEB", "MOB"]);
  await northwind.locator(`button.project-card[data-project-id="${PROJECT.taska}"]`).click();
  await expect(northwind).toHaveURL(companyPath(COMPANY.northwind, `/projects/${PROJECT.taska}/board`));
  await expect(northwind.getByRole("button", { name: /TAS-101/ }).first()).toBeVisible();
});

test("AC2: the late answer of the company left never appears under the next one; Back and reload keep the company", async ({
  page,
  isMobile,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  // Anything not Globex's drawn under Globex's address, recorded the moment it appears.
  await page.addInitScript((globex) => {
    const seen: string[] = [];
    (window as unknown as { leaked: string[] }).leaked = seen;
    new MutationObserver(() => {
      if (!window.location.pathname.includes(globex)) return;
      for (const node of document.querySelectorAll("button.project-card .key-badge")) {
        if (node.textContent !== "OPS") seen.push(node.textContent ?? "");
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }, COMPANY.globex);

  // Northwind's project read is held for two seconds; the switch goes while it is out.
  await setHooks(page, { delayMs: { listProjects: 2000 } });
  await page.reload();
  await expect(page.locator(".project-card.skeleton-card").first()).toBeVisible();
  await setHooks(page, null);
  await switchCompany(page, "Globex", isMobile);
  await expect(page).toHaveURL(companyPath(COMPANY.globex));
  await expect(keys(page)).toHaveText(["OPS"]);
  await page.waitForTimeout(2500);
  await expect(keys(page)).toHaveText(["OPS"]);
  expect(await page.evaluate(() => (window as unknown as { leaked: string[] }).leaked)).toEqual([]);

  // Back: a live page of the company left, not a cache of it (a phone came by the picker).
  if (isMobile) await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(companyPath(COMPANY.northwind));
  await expect(keys(page)).toHaveText(["TAS", "WEB", "MOB"]);
  await expect(subtitle(page)).toHaveText("3 projects · Northwind");
  // Reload: the same company.
  await page.reload();
  await expect(keys(page)).toHaveText(["TAS", "WEB", "MOB"]);
  await expect(page).toHaveTitle("Northwind — Taska");
});

test("AC3: a suspended membership closes the Globex tab with §4.35; the Northwind tab is untouched", async ({ context }) => {
  const northwind = await context.newPage();
  await inCompany(northwind, "Northwind", COMPANY.northwind);
  const globex = await context.newPage();
  await globex.goto(companyPath(COMPANY.globex));
  await expect(keys(globex)).toHaveText(["OPS"]);

  await setHooks(northwind, { suspend: [{ tenantId: COMPANY.globex, userId: ANNA }] });
  await globex.locator(`button.project-card[data-project-id="${PROJECT.ops}"]`).click();
  const closed = globex.getByRole("heading", { level: 1, name: "You no longer have access to Globex" });
  await expect(closed).toBeVisible();
  await expect(closed).toBeFocused();
  await expect(globex.getByText("Your membership was suspended or removed. If that’s a mistake, ask one of the company’s admins.")).toBeVisible();
  // At the address that was open, and none of the company's content under it.
  await expect(globex).toHaveURL(companyPath(COMPANY.globex, `/projects/${PROJECT.ops}/board`));
  await expect(globex.locator(".board-topbar, .project-card")).toHaveCount(0);
  await expect(keys(northwind)).toHaveText(["TAS", "WEB", "MOB"]);
  await northwind.locator(`button.project-card[data-project-id="${PROJECT.taska}"]`).click();
  await expect(northwind.getByRole("button", { name: /TAS-101/ }).first()).toBeVisible();

  // Choose a company: the picker says why Globex is in the second group.
  await globex.getByRole("link", { name: "Choose a company" }).click();
  await expect(globex).toHaveURL(`${B2B}/companies`);
  await expect(globex.getByRole("list", { name: "Companies" }).getByRole("link", { name: /^Globex/ })).toContainText(
    "You no longer have access",
  );

  // A direct link back asks the server again and is refused again. Globex has
  // left the reader's list by now, so it is «This company» (§4.35).
  await globex.goto(companyPath(COMPANY.globex, `/projects/${PROJECT.ops}/board`));
  await expect(globex.getByRole("heading", { level: 1, name: "You no longer have access to This company" })).toBeVisible();
  await expect(globex.locator(".board-topbar, .project-card")).toHaveCount(0);
});

test("AC3: a direct link into a company the reader cannot enter shows §4.35 or §4.18, never its data", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(`${B2B}/companies`);
  await page.goto(companyPath(COMPANY.umbrella, `/projects/${PROJECT.taska}/board`));
  await expect(page.getByRole("heading", { level: 1, name: "You no longer have access to This company" })).toBeVisible();
  await expect(page.locator(".board-topbar, .project-card")).toHaveCount(0);
  // A company that is not the reader's at all: §4.18, which does not name it.
  await page.goto(companyPath("9e0e2a4c-1b3d-4e5f-8a7b-9c0d1e2f3a4b", "/projects"));
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);
});

test("AC4: a company admin sees every project, a member only theirs; one key, a different issue in each company", async ({
  page,
  browser,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await expect(keys(page)).toHaveText(["TAS", "WEB", "MOB"]);
  await page.goto(companyPath(COMPANY.globex));
  await expect(keys(page)).toHaveText(["OPS"]);

  await page.goto(companyPath(COMPANY.northwind, "/browse/WEB-12"));
  await expect(page).toHaveURL(new RegExp(`/c/${COMPANY.northwind}/projects/58e93598-ea1a-460d-9d72-f1f201c310e2/issues/`));
  await expect(page.getByText("Responsive board layout").first()).toBeVisible();
  // Globex's WEB-12 is a project Anna is not on: not found, and nothing of Northwind's.
  await page.goto(companyPath(COMPANY.globex, "/browse/WEB-12"));
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Responsive board layout")).toHaveCount(0);

  // Priya, Globex's admin, opens Globex's own WEB-12.
  const priyaContext = await browser.newContext();
  const priya = await priyaContext.newPage();
  await signIn(priya, "priya@example.com", `/c/${COMPANY.globex}/browse/WEB-12`);
  await expect(priya).toHaveURL(new RegExp(`/c/${COMPANY.globex}/projects/5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c01/issues/`));
  await expect(priya.getByText("Checkout button overlaps the basket total on narrow screens").first()).toBeVisible();
  await priyaContext.close();
});

test("a duplicated tab gets its own company session, and both stay in the company through a forced renewal", async ({
  context,
}) => {
  const first = await context.newPage();
  await first.goto(`${B2B}/login`);
  // Two-second access tokens from here on, so the next reads renew both families.
  await setHooks(first, { accessTtlSeconds: 2 });
  await inCompany(first, "Northwind", COMPANY.northwind);
  const copied = await first.evaluate(() => ({ ...window.sessionStorage }));
  const original = JSON.parse(copied["taska.tab"]) as { tenantSessionId: string };

  const duplicate = await context.newPage();
  await duplicate.addInitScript((entries) => {
    if (window.sessionStorage.getItem("taska.tab")) return;
    for (const [key, value] of Object.entries(entries)) window.sessionStorage.setItem(key, value);
  }, copied);
  await duplicate.goto(companyPath(COMPANY.northwind));
  await expect(keys(duplicate)).toHaveText(["TAS", "WEB", "MOB"]);
  const own = await duplicate.evaluate(() => JSON.parse(window.sessionStorage.getItem("taska.tab") ?? "{}") as { tenantSessionId: string });
  expect(own.tenantSessionId).not.toBe(original.tenantSessionId);
  const still = await first.evaluate(() => JSON.parse(window.sessionStorage.getItem("taska.tab") ?? "{}") as { tenantSessionId: string });
  expect(still.tenantSessionId).toBe(original.tenantSessionId);

  await first.waitForTimeout(2500);
  for (const page of [first, duplicate]) {
    await page.locator(`button.project-card[data-project-id="${PROJECT.taska}"]`).click();
    await expect(page.getByRole("button", { name: /TAS-101/ }).first()).toBeVisible();
    await expect(page).toHaveURL(companyPath(COMPANY.northwind, `/projects/${PROJECT.taska}/board`));
  }
  await expect(first.getByRole("heading", { name: /no longer have access|could not be opened/ })).toHaveCount(0);
  await expect(duplicate.getByRole("heading", { name: /no longer have access|could not be opened/ })).toHaveCount(0);
});
