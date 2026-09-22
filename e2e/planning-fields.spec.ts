import { expect, test, type Locator, type Page } from "@playwright/test";
import { START_DATE_AFTER_STORED_DUE_MESSAGE } from "../src/api/planningFields";
import {
  PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE,
  PLANNING_ESTIMATE_HINT,
  planningDateIncompleteEditMessage,
} from "../src/lib/planning";

/**
 * The mock store's own refusal of a transition that does not leave the issue's
 * current status (src/api/mock/MockTaskaApi.ts). Written out rather than
 * imported because it is a string literal in the store and not an exported
 * constant — and what the cases below pin is that this sentence *reaches the
 * reader*, so the sentence has to be stated somewhere they can compare.
 */
const TRANSITION_UNAVAILABLE_MESSAGE = "Transition is not available for the current issue status";

/**
 * Half-type a date: empty the box, then type a month and nothing else, so the
 * control holds an entry the browser cannot read as a day (`validity.badInput`)
 * while its `value` is still `""`. Emptying first matters — typing into a box
 * that already holds a stored day only replaces one segment and leaves a whole
 * date behind.
 */
async function halfTypeDate(page: Page, box: Locator) {
  await box.fill("");
  await box.click();
  await page.keyboard.type("12");
  await box.blur();
}

/**
 * Press a control the way a hand does: aim once, then press and release without
 * looking again.
 *
 * `locator.click()` cannot see the defect this exists for. Playwright re-reads
 * the element's box immediately before pressing and follows whatever moved, so a
 * row that shifts between `mousedown` and `mouseup` is invisible to it — and the
 * shift is caused by the `blur` that `mousedown` itself fires, one event earlier.
 * One position, taken before the press, is what puts both events where the
 * reader's pointer actually was.
 */
async function pressWithoutFollowing(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("the control has no box to press");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

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
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
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

test("a half-typed date says so, and leaves the stored one alone", async ({ page }) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");

  // `<input type="date">` reads `""` both when it is empty and when only some
  // of its segments are filled, and `""` means *clear it*. So a reader who
  // starts typing a date and tabs away would erase the day the issue has —
  // unless `validity.badInput` is consulted, which is what `isIncompleteDateEntry`
  // does and what the revert below rests on.
  const start = planning.getByLabel("Start date");
  await halfTypeDate(page, start);

  // The stored day is back in the box **and the panel says why** (TAS-231).
  // Until then this assertion read `toHaveCount(0)`: the revert was the entire
  // response, so the reader watched their entry disappear with nothing said
  // anywhere on screen, which is the half of the bug report about editing.
  //
  // The sentence names the box, which is the part the panel cannot say any
  // other way: two date fields sit side by side and the entry has already been
  // taken out of the one at fault, so a line about "that date" would leave the
  // reader to guess which (art-director, TAS-231).
  await expect(panel.locator(".form-error")).toHaveText(planningDateIncompleteEditMessage("startDate"));
  await expect(panel.locator(".form-error")).toContainText("start date");
  await expect(start).toHaveValue("2026-06-15");
  // And the box carries no `aria-invalid`, where the create form's does: the
  // entry has already been taken out of it and what stands there now is the
  // stored day, which is perfectly valid. Marking it would be a false
  // statement about the control the reader is looking at.
  await expect(start).not.toHaveAttribute("aria-invalid");
  // One line and not two. The panel keeps a single slot for this and the local
  // refusal takes it, so this pins the slot rather than the absence of a
  // request — the absence of a request is what the reopen below is for.
  await expect(panel.locator(".form-error")).toHaveCount(1);

  // Reopened, because the assertion that matters is about the store rather than
  // about the draft the input was holding — and it is also what proves nothing
  // was sent. A commit of the `""` this box reported would have cleared the
  // stored day, and it is still there.
  await closePanel(page);
  const reopened = await openIssuePanel(page, "TAS-101");
  await expect(reopened.getByLabel("Start date")).toHaveValue("2026-06-15");
});

test("the same refusal twice over is a new line both times", async ({ page }) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");
  const start = planning.getByLabel("Start date");
  const notice = panel.locator(".form-error");

  await halfTypeDate(page, start);
  await expect(notice).toHaveText(planningDateIncompleteEditMessage("startDate"));
  // Marked on the node itself, through the DOM: React manages no `data-seen`,
  // so it survives a re-render and cannot survive a remount.
  await notice.evaluate((node) => {
    node.setAttribute("data-seen", "first");
  });

  await halfTypeDate(page, start);

  // The same box refused the same way, so the sentence is identical — and
  // identical text is a re-render of nothing: the live region emits no
  // mutation and announces nothing, which leaves the second refusal exactly as
  // silent as the bug this story removes. art-director measured those zero
  // mutations with a MutationObserver, on start-then-due, which said the same
  // thing before the sentence began naming the field. The node carries the
  // refusal's own counter as its `key`, so it is replaced rather than updated.
  await expect(notice).toHaveText(planningDateIncompleteEditMessage("startDate"));
  await expect(notice).not.toHaveAttribute("data-seen");
});

test("a write that succeeds clears the date line rather than captioning itself with it", async ({ page }) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");

  await halfTypeDate(page, planning.getByLabel("Start date"));
  await expect(panel.locator(".form-error")).toHaveText(planningDateIncompleteEditMessage("startDate"));

  // An unrelated write, and a successful one. Until this round only
  // `updateIssue` cleared the line, so the transition below left it standing
  // byte for byte: a sentence about a date entry from a minute ago, sitting
  // under an issue that had just moved to Done (art-director, TAS-231).
  await panel.getByRole("button", { name: "Complete" }).click();

  await expect(panel.locator(".status-pill")).toHaveText("Done");
  await expect(panel.locator(".form-error")).toHaveCount(0);
});

test("a refused write takes the slot from the date line instead of going unsaid", async ({ page }) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");

  await halfTypeDate(page, planning.getByLabel("Start date"));
  await expect(panel.locator(".form-error")).toHaveText(planningDateIncompleteEditMessage("startDate"));

  // Two clicks in one task, which is what it takes to get a refused transition
  // out of this panel: the first moves TAS-101 out of In Progress, the second
  // sends the same transition id from a status it does not leave, and the mock
  // refuses it. They both land because the button only disables itself on the
  // re-render, and the query client notifies its observers on a macrotask.
  await panel.getByRole("button", { name: "Complete" }).evaluate((button) => {
    const target = button as HTMLButtonElement;
    target.click();
    target.click();
  });

  // This slot is the *only* account a refused write gets — DESIGN.md §5.6
  // specifies a toast and records that there is none — so a date sentence
  // holding it is not a cosmetic mismatch: before this round the refusal
  // appeared nowhere on screen at all, which is the story's own defect moved
  // one surface over.
  await expect(panel.locator(".form-error")).toHaveText(TRANSITION_UNAVAILABLE_MESSAGE);
  await expect(panel.locator(".form-error")).toHaveCount(1);
});

test("a refusal the date line replaced does not come back when the date line clears", async ({ page }) => {
  await openBoard(page);
  const panel = page.locator(".issue-panel");
  const planning = await openIssuePanel(page, "TAS-101");

  // A refused write first: past the stored due date of 2026-06-26, which
  // `planningFieldRefusal` answers before the request is spent.
  const start = planning.getByLabel("Start date");
  await start.fill("2026-07-01");
  await start.blur();
  await expect(panel.locator(".form-error")).toHaveText(START_DATE_AFTER_STORED_DUE_MESSAGE);

  // Then a date refusal, which takes the slot — and drops the one it replaced
  // rather than queueing it.
  const due = planning.getByLabel("Due date");
  await halfTypeDate(page, due);
  await expect(panel.locator(".form-error")).toHaveText(planningDateIncompleteEditMessage("dueDate"));

  // Now the reader simply finishes the date. The day typed is the one the issue
  // already has, so nothing is sent: no attempt stands behind the slot, and the
  // slot has to be empty. Without the reset above, the refusal from the first
  // step would surface again here and `role="alert"` would announce it a second
  // time — an error line with no action behind it, which is a ghost and not a
  // record (art-director, TAS-231).
  await due.fill("2026-06-26");
  await due.blur();
  await expect(panel.locator(".form-error")).toHaveCount(0);
});

test("edits a date on blur and keeps it", async ({ page }) => {
  await openBoard(page);
  const planning = await openIssuePanel(page, "TAS-101");

  // Inside the stored due date of 2026-06-26, so the server's own cross-check
  // has nothing to say and what is under test is the write itself: the story
  // this fixes reported that editing a date sent no `updateIssue` at all.
  const start = planning.getByLabel("Start date");
  await start.fill("2026-06-20");
  await start.blur();

  await expect(page.locator(".issue-panel .form-error")).toHaveCount(0);
  await closePanel(page);
  const reopened = await openIssuePanel(page, "TAS-101");
  await expect(reopened.getByLabel("Start date")).toHaveValue("2026-06-20");
  // The other date came back untouched, which on a wire that replaces is the
  // API layer's doing rather than a given (see `resolvePlanningFields`).
  await expect(reopened.getByLabel("Due date")).toHaveValue("2026-06-26");
});

test("the create form refuses a half-typed date in its own words, and points at the box", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Summary").fill("Plan with a half-typed date");
  // One whole date and one the reader did not finish. Before TAS-231 this form
  // left the refusal to native validation, which does not fire `submit` at all:
  // no request, no line on screen, and a tooltip in the *browser's* language
  // beside a box the reader is no longer standing in. "Create issue" read as
  // broken, and the way out a reader finds alone is to empty the dates — which
  // is one of the routes to the "both dates empty" in the report itself.
  await modal.getByLabel("Due date").fill("2026-09-19");
  const start = modal.getByLabel("Start date");
  await start.click();
  await page.keyboard.type("12");

  // Reached and pressed from the keyboard, the path that loses the native
  // tooltip's context entirely.
  const create = modal.getByRole("button", { name: "Create issue" });
  await create.focus();
  await page.keyboard.press("Enter");

  await expect(modal.locator(".form-error")).toHaveText(PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE);
  // Nothing was created and the form is still standing, with focus on the box
  // the sentence is about — the part of "which of the two dates" that survives
  // without sight. The box says the same thing in its own right: marked
  // invalid, and described by the line, so a reader who lands on it hears the
  // sentence rather than having to find it. The other date carries neither
  // (TAS-231, art-director).
  await expect(modal).toBeVisible();
  await expect(start).toBeFocused();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(start).toHaveAccessibleDescription(PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE);
  await expect(modal.getByLabel("Due date")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator(".issue-planning")).toHaveCount(0);

  // And the refusal is spent once the box holds a day: the same keystroke now
  // goes through, and both dates are on the issue it makes.
  await start.fill("2026-09-18");
  await create.focus();
  await page.keyboard.press("Enter");

  const planning = page.locator(".issue-planning");
  await expect(planning.getByLabel("Start date")).toHaveValue("2026-09-18");
  await expect(planning.getByLabel("Due date")).toHaveValue("2026-09-19");
});

test("the press that fixes the date creates the issue, rather than being swallowed", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Summary").fill("Plan with a corrected date");
  const start = modal.getByLabel("Start date");
  const create = modal.getByRole("button", { name: "Create issue" });

  // Half typed, then pressed with the pointer straight from the box. Every
  // other case in this file either presses Enter or clicks after focus has
  // already left the date, and that is the whole reason this one exists: the
  // blur arrives on `mousedown`, one event ahead of the `click` it belongs to,
  // and whatever it does to the notice slot moves the action row directly
  // beneath it before `mouseup` lands.
  await start.click();
  await page.keyboard.type("12");
  await pressWithoutFollowing(page, create);

  // This press is allowed to be lost, and is: putting the line up pushes the
  // button down by 46.4px at 1440 and 63.8px at 390, against a height of 34px,
  // so `mouseup` lands above it. What the reader gets either way is the
  // sentence that accounts for the press, and no issue made behind their back —
  // which is the state this story set out to deliver.
  await expect(modal.locator(".form-error")).toHaveText(PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE);
  await expect(page.locator(".issue-planning")).toHaveCount(0);

  // Now the reader does exactly what the sentence asks. The fix and the press
  // are one gesture, with nothing in between to shed the focus that makes the
  // blur land inside the press.
  await start.fill("2026-09-18");
  await expect(start).toBeFocused();
  await pressWithoutFollowing(page, create);

  // And the issue exists after that one press — the button measures Δy 0.0px
  // between `mousedown` and `mouseup` on all three viewports now. While blur
  // was still allowed to clear the line, that same `mousedown` withdrew it, the
  // row jumped up out from under the pointer by the same 46.4 / 63.8px, no
  // `click` ever reached the button, and the reader was left with nothing
  // created and nothing said — the dead button this story removes, handed back
  // on the recovery path.
  const planning = page.locator(".issue-planning");
  await expect(planning.getByLabel("Start date")).toHaveValue("2026-09-18");
  await expect(modal).toHaveCount(0);
});

test("the create form's refusal is announced once, not on every exit from a date box", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Summary").fill("Plan with one date half typed");
  const start = modal.getByLabel("Start date");
  const due = modal.getByLabel("Due date");
  const notice = modal.locator(".form-error");

  await start.click();
  await page.keyboard.type("12");
  await due.focus();
  await expect(notice).toHaveText(PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE);
  // Marked on the node itself, through the DOM: React manages no `data-seen`,
  // so it survives a re-render and cannot survive a remount.
  await notice.evaluate((node) => {
    node.setAttribute("data-seen", "first");
  });

  // Out of the box that is fine, back into the one that is not, and out again.
  // Both boxes are re-judged on every exit, so each of these used to mint a
  // fresh refusal count and replace the node — art-director's MutationObserver
  // counted three insertions for one fault that never changed, which is one
  // sentence read out three times to a screen reader, twice of them on leaving
  // a box that is perfectly fine.
  await start.focus();
  await due.focus();
  await start.focus();
  await due.focus();

  await expect(notice).toHaveText(PLANNING_DATE_INCOMPLETE_CREATE_MESSAGE);
  await expect(notice).toHaveAttribute("data-seen", "first");
});

test("creates an issue with both dates, and they are still there when the panel is reopened", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Summary").fill("Plan both ends of the work");
  await modal.getByLabel("Start date").fill("2026-09-18");
  await modal.getByLabel("Due date").fill("2026-09-19");
  await modal.getByRole("button", { name: "Create issue" }).click();

  const planning = page.locator(".issue-planning");
  await expect(planning.getByLabel("Start date")).toHaveValue("2026-09-18");
  await expect(planning.getByLabel("Due date")).toHaveValue("2026-09-19");

  // Read back off the store rather than out of the drafts the create left
  // behind: the issue is found again from the board by the key the panel shows.
  // (A browser reload cannot stand in for this here — the mock's issues live in
  // memory for the life of the page, so a reload would take the issue with it.)
  const issueKey = await page.locator(".issue-panel .issue-key").innerText();
  await closePanel(page);
  const reopened = await openIssuePanel(page, issueKey);
  await expect(reopened.getByLabel("Start date")).toHaveValue("2026-09-18");
  await expect(reopened.getByLabel("Due date")).toHaveValue("2026-09-19");
});
