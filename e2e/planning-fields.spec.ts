import { expect, test, type Locator, type Page } from "@playwright/test";
import { START_DATE_AFTER_STORED_DUE_MESSAGE } from "../src/api/planningFields";
import { PLANNING_ESTIMATE_HINT } from "../src/lib/planning";

// The five planning fields on the issue panel and in the create modal
// (TAS-189). Mock-backed like every spec here — playwright.config.ts starts the
// server with VITE_TASKA_API_MODE=mock, so any seeded user signs in with any
// password and no request leaves the process.
//
// What the seed gives these tests (src/api/mock/MockTaskaApi.ts): TAS-101
// carries all five — 3 points, 2026-06-15 to 2026-06-26, 480 minutes estimated
// with 240 left — and TAS-102 carries **nought** story points and nothing else,
// which is the pair that separates "none" from "zero". Every case below needs
// one of those two facts, so they are named rather than discovered.
//
// What this file is NOT: a statement about the gateway. The contract declares
// all five (docs/contract/openapi.yml, backend develop 21a0d9d177a1, merged PR
// #148) and so does the deployed gateway's /v3/api-docs (measured 2026-09-11),
// but no write carrying a planning field has been made against it and no
// response body carrying one has been read (docs/ai/API-DIVERGENCE.md). The
// refusals asserted here are `planningFieldRefusal`'s, applied by the mock
// exactly as the REST implementation applies them — read these as pinning what
// this client does.

const MOBILE_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openBoard(page: Page) {
  await signIn(page);
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
}

/** The panel of one issue, and the Planning block inside it. */
async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-planning");
}

async function closePanel(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".issue-planning")).toHaveCount(0);
}

test("shows the five an issue carries, in the units a reader thinks in", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  await expect(planning.getByLabel("Story points")).toHaveValue("3");
  // A calendar day, held as the string the contract's `format: date` states.
  // Never built through a `Date`, which is how the 15th becomes the 14th for
  // half the world.
  await expect(planning.getByLabel("Start date")).toHaveValue("2026-06-15");
  await expect(planning.getByLabel("Due date")).toHaveValue("2026-06-26");
  // 480 and 240 minutes on the wire; hours to the reader, and no days — the
  // length of a working day is not a thing this product has decided.
  await expect(planning.getByLabel("Original estimate")).toHaveValue("8h");
  await expect(planning.getByLabel("Remaining estimate")).toHaveValue("4h");
});

test("separates an estimate of nought from no estimate at all", async ({ page }) => {
  await openBoard(page);
  // TAS-102 is seeded with `storyPoints: 0` and nothing else, which is the only
  // shape that can tell the two apart.
  const planning = await openIssuePanel(page, "TAS-102");

  // Zero is a count and is printed.
  await expect(planning.getByLabel("Story points")).toHaveValue("0");

  // Unset is empty, and says so with an em dash rather than with a number
  // nobody entered.
  const remaining = planning.getByLabel("Remaining estimate");
  await expect(remaining).toHaveValue("");
  await expect(remaining).toHaveAttribute("placeholder", "—");
  await expect(planning.getByLabel("Original estimate")).toHaveValue("");
  // `type="date"` draws the browser's own empty mask instead of any
  // placeholder, so the value is what there is to assert — and it is empty, not
  // a date this issue does not have.
  await expect(planning.getByLabel("Start date")).toHaveValue("");
  await expect(planning.getByLabel("Due date")).toHaveValue("");
});

test("edits story points on blur and keeps them", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  const points = planning.getByLabel("Story points");
  await points.fill("5");
  await points.blur();
  await expect(points).toHaveValue("5");

  // Reopened rather than merely re-read: the value has to have reached the
  // store, not just the draft the input was holding.
  await closePanel(page);
  const reopened = await openIssuePanel(page, "TAS-101");
  await expect(reopened.getByLabel("Story points")).toHaveValue("5");
  // And the other four came back untouched, which on a wire that replaces is a
  // property of the API layer rather than a given (see `resolvePlanningFields`).
  await expect(reopened.getByLabel("Start date")).toHaveValue("2026-06-15");
  await expect(reopened.getByLabel("Original estimate")).toHaveValue("8h");
});

test("clears story points, and the field stays empty rather than falling back to zero", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  const points = planning.getByLabel("Story points");
  await points.fill("");
  await points.blur();
  await expect(points).toHaveValue("");

  await closePanel(page);
  const reopened = await openIssuePanel(page, "TAS-101");
  const cleared = reopened.getByLabel("Story points");
  // The failure this pins is `Number("")`, which is `0`: a cleared field that
  // came back as `0` would look like an estimate somebody made.
  await expect(cleared).toHaveValue("");
  await expect(cleared).toHaveAttribute("placeholder", "—");
});

test("shows the refusal when a start date passes the stored due date, and puts the stored value back", async ({
  page,
}) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");

  const start = planning.getByLabel("Start date");
  // Past the stored due date of 2026-06-26. The server compares an incoming
  // start date against the *stored* due date, so this cannot succeed — and
  // `planningFieldRefusal` says so before the request is spent.
  await start.fill("2026-07-01");
  await start.blur();

  // The API layer's own sentence, imported rather than retyped: what is pinned
  // is that the refusal reaches the reader, not a particular wording.
  await expect(panel.locator(".form-error")).toContainText(START_DATE_AFTER_STORED_DUE_MESSAGE);
  // And the box goes back to the day the issue actually starts on, rather than
  // keeping a date the server never accepted (§5.5).
  await expect(start).toHaveValue("2026-06-15");
});

test("creates an issue with a plan, and the panel reads it back", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Summary").fill("Plan the planning fields");
  await modal.getByLabel("Story points").fill("2");
  // Typed as a duration, sent as minutes: this is the one assertion that covers
  // the parse and the format in one round trip.
  await modal.getByLabel("Original estimate").fill("1h 30m");
  await modal.getByRole("button", { name: "Create issue" }).click();

  // The board navigates to the new issue's own panel.
  const planning = page.locator(".issue-planning");
  await expect(planning.getByLabel("Story points")).toHaveValue("2");
  await expect(planning.getByLabel("Original estimate")).toHaveValue("1h 30m");
  // Nothing was invented for the fields left alone.
  await expect(planning.getByLabel("Due date")).toHaveValue("");
  await expect(planning.getByLabel("Remaining estimate")).toHaveValue("");
});

test("a viewer reads the plan and is offered no way to change it", async ({ page }) => {
  // Anna is not a member of the Mobile project, so the mock answers VIEWER for
  // it, and the board is reachable by URL — hiding a control is a courtesy and
  // the server stays the authority (§5.7).
  await signIn(page);
  await page.goto(`/projects/${MOBILE_PROJECT_ID}/board`);
  const planning = await openIssuePanel(page, "MOB-5");

  // Read-only rather than absent or disabled (§5.7): a viewer still has to be
  // able to read the plan — and to reach it, which is what `disabled` took
  // away. An empty field still reads as empty rather than as nought.
  for (const label of ["Story points", "Start date", "Due date", "Original estimate", "Remaining estimate"]) {
    const field = planning.getByLabel(label);
    await expect(field).toHaveJSProperty("readOnly", true);
    await expect(field).toBeEnabled();
    await field.focus();
    await expect(field).toBeFocused();
  }
  await expect(planning.getByLabel("Remaining estimate")).toHaveAttribute("placeholder", "—");

  // And nothing a read-only box can still fire reaches the server: a blur after
  // a picker change would otherwise commit. Typing is refused by the control,
  // so the value is unchanged and no refusal or write appears.
  const points = planning.getByLabel("Story points");
  const before = await points.inputValue();
  await points.focus();
  await page.keyboard.type("9");
  await points.blur();
  await expect(points).toHaveValue(before);
  await expect(page.locator(".issue-panel .form-error")).toHaveCount(0);
});

test("says what an estimate box accepts on screen, not in a tooltip", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  // A `title` was the first answer and never fires on a touch device, so the
  // syntax is a line under the box. Described-by rather than part of the label:
  // the field is still called "Original estimate" and nothing else.
  const estimate = planning.getByLabel("Original estimate");
  await expect(estimate).toHaveAccessibleName("Original estimate");
  await expect(estimate).toHaveAccessibleDescription(PLANNING_ESTIMATE_HINT);
  await expect(estimate).not.toHaveAttribute("title");
  await expect(planning.getByText(PLANNING_ESTIMATE_HINT)).toHaveCount(2);
});

test("a half-typed date leaves the stored one alone", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  // `<input type="date">` reads `""` both when it is empty and when only some
  // of its segments are filled, and `""` means *clear it*. So a reader who
  // starts typing a date and tabs away would erase the day the issue has —
  // unless `validity.badInput` is consulted, which is the fix this pins.
  const start = planning.getByLabel("Start date");
  await start.fill("");
  await start.click();
  await page.keyboard.type("12");
  await start.blur();

  // The stored day is back in the box, and nothing was said about it, because
  // nothing was sent.
  await expect(start).toHaveValue("2026-06-15");
  await expect(page.locator(".issue-panel .form-error")).toHaveCount(0);

  // Reopened, because the assertion that matters is about the store rather than
  // about the draft the input was holding.
  await closePanel(page);
  const reopened = await openIssuePanel(page, "TAS-101");
  await expect(reopened.getByLabel("Start date")).toHaveValue("2026-06-15");
});
