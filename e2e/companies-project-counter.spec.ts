import { expect, test, type Locator, type Page } from "@playwright/test";
import { COMPANY, PLAN, PROJECT, companyPath, inCompany, setHooks } from "./companiesFixtures";

/*
 * A project's issue counter in the companies build (TAS-528, DESIGN.md §4.43)
 * against the third e2e server's mock: read only when New issue or Edit
 * project opens, one template at, below and over the limit, nothing switched
 * off by it, never stale after the reader's own create, read again in place
 * after a quota refusal; a failed read out of the way; nothing for a VIEWER;
 * and the create's key per draft (H1) — a retry after a lost answer is the
 * same issue. Requests are counted by the mock's `count` hook: there is no
 * network to watch.
 */

const TAS = PROJECT.taska;
const WEB = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const MOB = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";
const LNG = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c07";
const RND = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c04";
const READ = "getProjectTaskQuota";
/** A create whose answer never came (art-director BLK-1), exactly. */
const UNCONFIRMED = "Taska couldn’t confirm the issue was created. Press Create issue again without changing anything — it won’t create a second one.";

const boardPath = (companyId: string, projectId: string) => companyPath(companyId, `/projects/${projectId}/board`);
const storedHooks = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem("taska.mockTenantHooks") ?? "{}") as Record<string, unknown>);
/** How many counter reads the mock has answered since the hooks were last set with `count`. */
const reads = async (page: Page) => ((await storedHooks(page)).calls as Record<string, number> | undefined)?.[READ] ?? 0;
/** Sets hooks with the counter's reads counted from zero. */
const counting = (page: Page, hooks: Record<string, unknown> = {}) => setHooks(page, { ...hooks, count: [READ] });

async function openNewIssue(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openEditProject(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Edit project" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const newIssueLine = (dialog: Locator) => dialog.locator(".new-issue-count");
const issuesRow = (dialog: Locator) => dialog.locator("dl.form-static-field").filter({ has: dialog.page().locator("dt", { hasText: /^Issues$/ }) });

/** Rects of the named elements relative to the form, after every finite animation (tk-pop) has ended — and after the fonts. */
async function formRects(dialog: Locator, selectors: string[]) {
  return dialog.evaluate(async (node, list) => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished));
    const form = node.querySelector("form")!.getBoundingClientRect();
    return list.map((selector) => {
      const rect = node.querySelector(selector)!.getBoundingClientRect();
      return { top: +(rect.top - form.top).toFixed(2), height: +rect.height.toFixed(2) };
    });
  }, selectors);
}

test("E1/E3: TAS 47 of 50 in both dialogs; after the reader's own create the next open shows the skeleton, then 48 — never 47 — and the create read nothing", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await counting(page);
  await page.goto(boardPath(COMPANY.northwind, TAS));
  await expect(page.locator(".issue-card").first()).toBeVisible();
  // The board's first paint asks nothing (guard §3).
  expect(await reads(page)).toBe(0);

  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("47 issues created · 50 allowed");
  expect(await reads(page)).toBe(1);
  // Not a Tab stop, not live, nothing described by it.
  await expect(newIssueLine(dialog)).not.toHaveAttribute("tabindex");
  await expect(newIssueLine(dialog)).not.toHaveAttribute("aria-live");
  await expect(dialog.getByRole("button", { name: "Create issue" })).not.toHaveAttribute("aria-describedby");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Edit project within 20 s: the same key, no second read.
  const edit = await openEditProject(page);
  await expect(issuesRow(edit).locator("dd")).toHaveText("47 created · 50 allowedDeleted issues still count.");
  expect(await reads(page)).toBe(1);
  await edit.getByRole("button", { name: "Cancel" }).click();

  const again = await openNewIssue(page);
  await expect(newIssueLine(again)).toHaveText("47 issues created · 50 allowed");
  await again.getByLabel("Summary").fill("Counted once");
  await again.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\/[^/]+$/);
  expect(await reads(page)).toBe(1);

  // Reopened: the cached 47 is gone — the skeleton until the server's 48.
  await counting(page, { delayMs: { [READ]: 1500 } });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const after = await openNewIssue(page);
  await expect(newIssueLine(after).locator(".value-skeleton")).toBeVisible();
  await expect(newIssueLine(after)).toHaveAttribute("aria-hidden", "true");
  await expect(after).not.toContainText("47 issues created");
  await expect(newIssueLine(after)).toHaveText("48 issues created · 50 allowed");
  expect(await reads(page)).toBe(1);
  await after.getByRole("button", { name: "Cancel" }).click();
  const edited = await openEditProject(page);
  await expect(issuesRow(edited).locator("dd")).toHaveText("48 created · 50 allowedDeleted issues still count.");
});

test("E2: loading reserves the line — typing at once, and Summary, Name and the actions stay where they were when the answer lands", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await setHooks(page, { delayMs: { [READ]: 2000 } });
  await page.goto(boardPath(COMPANY.northwind, TAS));

  const edit = await openEditProject(page);
  await expect(issuesRow(edit).locator(".value-skeleton")).toHaveCount(2);
  const editLoading = await formRects(edit, ["input", ".modal-actions", "dl.form-static-field + dl.form-static-field"]);
  await expect(issuesRow(edit).locator("dd")).toHaveText(/^47 created/);
  const editLoaded = await formRects(edit, ["input", ".modal-actions", "dl.form-static-field + dl.form-static-field"]);
  expect(editLoaded).toEqual(editLoading);
  await edit.getByRole("button", { name: "Cancel" }).click();

  // Past the 20 s the answer was fresh for, a new open reads again; here the cache is dropped by reloading.
  await page.reload();
  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog).locator(".value-skeleton")).toBeVisible();
  await dialog.getByLabel("Summary").pressSequentially("Typed while it loads");
  const loading = await formRects(dialog, ["input", ".new-issue-count", ".modal-actions"]);
  await expect(newIssueLine(dialog)).toHaveText("47 issues created · 50 allowed");
  const loaded = await formRects(dialog, ["input", ".new-issue-count", ".modal-actions"]);
  expect(loaded).toEqual(loading);
  await expect(dialog.getByLabel("Summary")).toHaveValue("Typed while it loads");
});

test("E4: TAS at 49 takes one more — 50 — and then the plan's sentence; the line above the refusal, re-read once in place", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await setHooks(page, { taskLifetime: { [TAS]: 49 } });
  await page.goto(boardPath(COMPANY.northwind, TAS));
  const first = await openNewIssue(page);
  await expect(newIssueLine(first)).toHaveText("49 issues created · 50 allowed");
  await first.getByLabel("Summary").fill("The fiftieth");
  await first.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\/[^/]+$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("50 issues created · 50 allowed");
  await counting(page, { taskLifetime: { [TAS]: 49 }, delayMs: { [READ]: 1500 } });
  await dialog.getByLabel("Summary").fill("One too many");
  const create = dialog.getByRole("button", { name: "Create issue" });
  await create.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "TAS has reached its plan’s limit on issues, so this issue was not created. Deleted issues still count, and existing issues can still be edited, moved and commented on.",
  );
  await expect(create).toBeFocused();
  // Re-read in place: the number stays while the read is out — no skeleton, no flash.
  await expect(newIssueLine(dialog)).toHaveText("50 issues created · 50 allowed");
  await expect(newIssueLine(dialog).locator(".value-skeleton")).toHaveCount(0);
  await expect.poll(() => reads(page)).toBe(1);
  await page.waitForTimeout(1700);
  await expect(newIssueLine(dialog)).toHaveText("50 issues created · 50 allowed");
  expect(await reads(page)).toBe(1);

  // The line sits before the refusal; between the refusal and the actions there is nothing of it.
  const order = await dialog.evaluate((node) => {
    const stack = node.querySelector("form.form-stack")!;
    return [...stack.children].map((child) =>
      child.classList.contains("new-issue-count")
        ? "count"
        : child.querySelector('[role="alert"]')
          ? "refusal"
          : child.classList.contains("modal-actions")
            ? "actions"
            : "other",
    );
  });
  expect(order.slice(-3)).toEqual(["count", "refusal", "actions"]);
});

test("E5: WEB at 50 of 50 — New, every «+» and Create issue stay enabled and unmarked", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(boardPath(COMPANY.northwind, WEB));
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeEnabled();
  const pluses = page.getByRole("button", { name: /^Create issue in / });
  await expect(pluses.first()).toBeVisible();
  for (const plus of await pluses.all()) {
    await expect(plus).toBeEnabled();
    await expect(plus).not.toHaveAttribute("aria-disabled");
  }
  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("50 issues created · 50 allowed");
  await dialog.getByLabel("Summary").fill("Still pressable");
  const create = dialog.getByRole("button", { name: "Create issue" });
  await expect(create).toBeEnabled();
  await expect(create).not.toHaveAttribute("aria-disabled");
  await expect(create).not.toHaveClass(/is-unavailable/);
  // No colour of state on the line: the same --fg-2 as below the limit.
  const color = await newIssueLine(dialog).evaluate((node) => getComputedStyle(node).color);
  const fg2 = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--fg-2)";
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(color).toBe(fg2);
});

test("E6: Umbrella's RND on a plan without a task limit — «no limit» in both, as the server counts", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await page.goto(boardPath(COMPANY.umbrella, RND));
  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("50 issues created · no limit");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const edit = await openEditProject(page);
  await expect(issuesRow(edit).locator("dd")).toHaveText("50 created · no limitDeleted issues still count.");
});

test("E7: a failed read stays out of the way — its own box, no alert, no Try again — and creating and saving still work", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  // A 503, retried once, then an answer that never came.
  await counting(page, { refuseNext: { [READ]: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } }, loseAnswer: [READ] });
  await page.goto(boardPath(COMPANY.northwind, MOB));
  const dialog = await openNewIssue(page);
  await expect(dialog.locator(".error-note")).toHaveText("The issue count could not be loaded.");
  expect(await reads(page)).toBe(2);
  await expect(newIssueLine(dialog)).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(dialog).not.toContainText(/0 issues created|no limit/);
  await dialog.getByLabel("Summary").fill("Created without a count");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\/[^/]+$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // A definite refusal: no retry, its request id the one new Tab stop; Save still saves.
  await counting(page, { refuseNext: { [READ]: { status: 404, code: "RESOURCE_NOT_FOUND" } } });
  const edit = await openEditProject(page);
  const box = edit.locator(".error-note");
  await expect(box.locator(".error-note-sentence")).toHaveText("The issue count could not be loaded.");
  await expect(box.getByRole("button", { name: /^Copy request id / })).toBeVisible();
  await expect(issuesRow(edit)).toHaveCount(0);
  await expect(edit.getByRole("alert")).toHaveCount(0);
  expect(await reads(page)).toBe(1);
  // Name keeps the focus it opened with; Shift+Tab reaches the copy, and nothing else of the counter.
  await expect(edit.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(box.getByRole("button", { name: /^Copy request id / })).toBeFocused();
  await edit.getByRole("textbox", { name: "Name" }).fill("Mobile, renamed");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator(".board-topbar")).toContainText("Mobile, renamed");
  // The board was not told: no §4.18, no closed company.
  await expect(page.locator(".issue-card").first()).toBeVisible();
});

test("E8: LNG moved to FREE — 64 of 50 in both; a create is refused READ_ONLY with the reason and the count stays 64", async ({ page }) => {
  await inCompany(page, "Consolidated", COMPANY.longName, "priya@example.com");
  await setHooks(page, { applyPlan: { [COMPANY.longName]: PLAN.free } });
  await page.goto(boardPath(COMPANY.longName, LNG));
  const edit = await openEditProject(page);
  await expect(issuesRow(edit).locator("dd")).toHaveText("64 created · 50 allowedDeleted issues still count.");
  await edit.getByRole("button", { name: "Cancel" }).click();
  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("64 issues created · 50 allowed");
  await counting(page, { applyPlan: { [COMPANY.longName]: PLAN.free } });
  await dialog.getByLabel("Summary").fill("Over the plan");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(dialog.getByRole("alert")).toContainText("is over its plan’s limits, so nothing in it can be changed.");
  await expect.poll(() => reads(page)).toBe(1);
  await expect(newIssueLine(dialog)).toHaveText("64 issues created · 50 allowed");
});

test("E9: today's build — no line in New issue, no «Issues» row in Edit project, the forms as they were", async ({ page }) => {
  // The first e2e server: `VITE_TASKA_TENANTS` off, the stand's build. Its mock refuses the read without a request.
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  const dialog = await openNewIssue(page);
  await expect(dialog.getByLabel("Summary")).toBeFocused();
  await expect(newIssueLine(dialog)).toHaveCount(0);
  await expect(dialog.locator(".value-skeleton, .error-note")).toHaveCount(0);
  // Planning is followed directly by the actions, as before.
  const after = await dialog.evaluate((node) => node.querySelector("fieldset.planning-fieldset")?.nextElementSibling?.className);
  expect(after).toBe("modal-actions");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const edit = await openEditProject(page);
  await expect(edit.locator("dl.form-static-field")).toHaveCount(1);
  await expect(edit.locator("dt")).toHaveText(["Key"]);
  await expect(edit.locator(".value-skeleton, .error-note")).toHaveCount(0);
});

test("E10: a VIEWER has no entry point and asks nothing — board, Projects, Plan", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind, "tom@example.com");
  await counting(page);
  await page.goto(boardPath(COMPANY.northwind, TAS));
  await expect(page.locator(".issue-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Create issue in / })).toHaveCount(0);
  await page.goto(companyPath(COMPANY.northwind));
  await expect(page.locator("button.project-card").first()).toBeVisible();
  await page.goto(companyPath(COMPANY.northwind, "/settings/plan"));
  await expect(page.getByText(/^The plan /)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await reads(page)).toBe(0);
});

test("E11: Projects asks nothing per card; Edit project from a card reads once per open", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await counting(page);
  await page.goto(companyPath(COMPANY.northwind));
  await expect(page.locator("button.project-card")).toHaveCount(3);
  expect(await reads(page)).toBe(0);
  await page.getByRole("button", { name: "Edit Web App" }).click();
  const edit = page.getByRole("dialog", { name: "Edit project" });
  await expect(issuesRow(edit).locator("dd")).toHaveText("50 created · 50 allowedDeleted issues still count.");
  await edit.getByRole("button", { name: "Cancel" }).click();
  expect(await reads(page)).toBe(1);
});

test("E12: reduced motion — the skeleton stands still and stays visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await inCompany(page, "Northwind", COMPANY.northwind);
  await setHooks(page, { delayMs: { [READ]: 2000 } });
  await page.goto(boardPath(COMPANY.northwind, TAS));
  const dialog = await openNewIssue(page);
  const bar = newIssueLine(dialog).locator(".value-skeleton");
  await expect(bar).toBeVisible();
  await page.waitForTimeout(100);
  const opacity = await bar.evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(opacity).toBeGreaterThanOrEqual(0.35);
});

test("H1: a create whose answer was lost is retried with the same key — one issue, counted once; a changed draft is a new one", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await setHooks(page, { loseAnswer: ["createIssue"] });
  await page.goto(boardPath(COMPANY.northwind, TAS));
  const dialog = await openNewIssue(page);
  await expect(newIssueLine(dialog)).toHaveText("47 issues created · 50 allowed");
  await dialog.getByLabel("Summary").fill("Sent twice, made once");
  const create = dialog.getByRole("button", { name: "Create issue" });
  await create.click();
  // The answer never came: the form says so and what to do (art-director BLK-1); the draft stays, and the same press goes again.
  await expect(dialog.getByRole("alert")).toHaveText(UNCONFIRMED);
  await expect(dialog.locator(".error-note-detail")).toHaveCount(0);
  await expect(create).toBeFocused();
  await expect(dialog.getByLabel("Summary")).toHaveValue("Sent twice, made once");
  await create.click();
  await expect(page).toHaveURL(/\/issues\/[^/]+$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".issue-card", { hasText: "Sent twice, made once" })).toHaveCount(1);
  const reopened = await openNewIssue(page);
  await expect(newIssueLine(reopened)).toHaveText("48 issues created · 50 allowed");

  // Lost again — and then the summary changed: that is another request, another issue.
  await setHooks(page, { loseAnswer: ["createIssue"] });
  await reopened.getByLabel("Summary").fill("First wording");
  await reopened.getByRole("button", { name: "Create issue" }).click();
  await expect(reopened.getByRole("alert")).toHaveText(UNCONFIRMED);
  await reopened.getByLabel("Summary").fill("Second wording");
  await reopened.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(/\/issues\/[^/]+$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".issue-card", { hasText: "First wording" })).toHaveCount(1);
  await expect(page.locator(".issue-card", { hasText: "Second wording" })).toHaveCount(1);
  const last = await openNewIssue(page);
  await expect(newIssueLine(last)).toHaveText("50 issues created · 50 allowed");
});
