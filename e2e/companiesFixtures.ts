import { expect, type Page } from "@playwright/test";

/*
 * The companies build's server (TAS-500): playwright.config.ts starts it two
 * ports up with `VITE_TASKA_TENANTS=true`, and only `e2e/companies*.spec.ts`
 * address it — by absolute URL, as the invitation specs address the hash
 * server. Every other spec stays on the first server, the stand's build.
 *
 * The fixture ids are `MOCK_TENANT_IDS` and the seeded project ids in
 * src/api/mock/MockTenantServer.ts and MockTaskaApi.ts, copied rather than
 * imported: those modules are written for the browser.
 */
const PORT = Number(process.env.TASKA_E2E_PORT) || 5183;
export const B2B = `http://localhost:${PORT + 2}`;

export const COMPANY = {
  northwind: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01",
  globex: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b02",
  initech: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b03",
  umbrella: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04",
  hooli: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b05",
  massive: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b06",
  longName: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b07",
  // TAS-501: Tom's creations — awaiting its first payment, and cancelled.
  stark: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b08",
  wayne: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b09",
} as const;

export const LONG_NAME =
  "Consolidated Intercontinental Widget Manufacturing and Logistics Holdings of Northern Europe, Asia and the Pacific Coast";

export const PROJECT = {
  taska: "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e",
  ops: "64d70a2b-72b0-4866-bdbf-4f71a416f9e4",
} as const;

/** TAS-512: the mock catalogue's plan ids (`MOCK_PLAN_IDS`). */
export const PLAN = {
  free: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d01",
  team: "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d02",
} as const;

export const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";

export const companyPath = (companyId: string, rest = "/projects") => `${B2B}/c/${companyId}${rest}`;

/** Signs in on the companies server's form; any password does (the mock's rule). */
export async function signIn(page: Page, email = "anna@example.com", from = "/login") {
  await page.goto(`${B2B}${from}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
}

/** The picker's row for a company. */
export const companyRow = (page: Page, name: string | RegExp) =>
  page.getByRole("list", { name: "Companies" }).getByRole("link", { name });

/** Signs Anna in and opens `company` from the picker. */
export async function inCompany(page: Page, name: string, companyId: string, email = "anna@example.com") {
  await signIn(page, email);
  await companyRow(page, new RegExp(`^${name}`)).click();
  await expect(page).toHaveURL(companyPath(companyId));
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  // The projects arrive only once the tab holds the company's session: the
  // page is drawn, loading, from the frame of the click (DESIGN.md §4.34).
  await expect(page.locator("button.project-card").first()).toBeVisible();
}

/** The project cards' keys, in order, once the grid has answered. */
export async function projectKeys(page: Page): Promise<string[]> {
  await expect(page.locator(".project-card.skeleton-card")).toHaveCount(0);
  return page.locator("button.project-card .key-badge").allInnerTexts();
}

/**
 * Switches the tab to another company the way a reader does at this width:
 * the bar's switcher at 768 and wider, the profile menu's «Switch company»
 * and the picker below (DESIGN.md §4.34, §4.16).
 */
export async function switchCompany(page: Page, name: string, isMobile: boolean) {
  if (!isMobile) {
    await page.locator(".company-switcher-trigger").click();
    await page.getByRole("dialog", { name: "Companies" }).getByRole("link", { name: new RegExp(`^${name}`) }).click();
    return;
  }
  await page.getByRole("button", { name: /Open profile/ }).click();
  await page.getByRole("link", { name: "Switch company" }).click();
  await companyRow(page, new RegExp(`^${name}`)).click();
}

/** A section of the Company zone (TAS-522, DESIGN.md §5.10), in its rail's order. */
export type ZoneSection = "General" | "Members" | "Plan";

const zonePath = (section: ZoneSection) => `/company/${section.toLowerCase()}`;

/**
 * Opens a section of the tab's company's zone (TAS-522, DESIGN.md §5.10) the
 * way a reader does at this width: at 768 and wider the switcher's «Manage
 * company», which lands on General with focus on its heading, then the zone's
 * rail. Below 768 there is no switcher and no menu entry (§5.10 «Входы»), so
 * the zone's address — loaded, or with `inApp` moved to inside the page the
 * way a router link would (the push `CompanyRouter.go` makes, as
 * companies-tabs.spec.ts does for the picker), for a test whose point is that
 * nothing is reloaded.
 */
export async function openCompanyZone(page: Page, companyId: string, section: ZoneSection = "General", options: { inApp?: boolean } = {}) {
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await page.locator(".company-switcher-trigger").click();
    await page.getByRole("dialog", { name: "Companies" }).getByRole("link", { name: "Manage company" }).click();
    await expect(page).toHaveURL(companyPath(companyId, "/company/general"));
    await expect(page.getByRole("heading", { level: 1, name: /General/ })).toBeFocused();
  } else if (options.inApp) {
    await page.evaluate((path) => {
      const index = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
      window.history.pushState({ usr: null, key: "e2e-zone", idx: index }, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/c/${companyId}${zonePath(section)}`);
  } else {
    await page.goto(companyPath(companyId, "/company"));
    await expect(page).toHaveURL(companyPath(companyId, "/company/general"));
  }
  const rail = page.getByRole("navigation", { name: "Company" });
  await expect(rail.getByRole("link")).toHaveText(["General", "Members", "Plan", "Back to projects"]);
  if (section !== "General" && !page.url().endsWith(zonePath(section))) {
    await rail.getByRole("link", { name: section }).click();
  }
  await expect(page).toHaveURL(companyPath(companyId, zonePath(section)));
  await expect(rail.getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
}

/** Writes the companies mock's test hooks into the shared storage (src/api/mock/MockTenantServer.ts). */
export async function setHooks(page: Page, hooks: Record<string, unknown> | null) {
  await page.evaluate((value) => {
    if (value === null) window.localStorage.removeItem("taska.mockTenantHooks");
    else window.localStorage.setItem("taska.mockTenantHooks", JSON.stringify(value));
  }, hooks);
}
