import { expect, test, type Locator, type Page } from "@playwright/test";
import { avatarColor } from "../src/lib/format";
import { COMPANY, PROJECT, companyPath, inCompany, setHooks } from "./companiesFixtures";

/*
 * A deleted account (TAS-529) in the companies build, against the third e2e
 * server's mock (src/api/mock/MockTenantServer.ts, «deletedAccounts»):
 *
 * - after the cleanup, from the seed — Initech's HLP-3, whose reporter,
 *   comment, work log entry, attachment and history belong to an account
 *   nobody can name, beside an «Unknown» (art-director F1);
 * - in the window before the cleanup — Sofia in Northwind, marked on every
 *   read and still assigned, watching, on WEB and in the company (F2);
 * - named, then deleted, then re-read (F3).
 *
 * One drawing everywhere: «Deleted user» on §4.4's neutral circle, «a deleted
 * user» inside a sentence, nothing to act on, and nothing of the person — no
 * name, address, picture or colour (art-director §6's DOM assertions).
 *
 * Sofia owns Initech, and an owner is not an account the hook is for (its own
 * doc in MockTenantServer.ts: the server's prerequisite would refuse the
 * deletion). She is used anyway because every seeded account with an ACTIVE
 * membership, a project row, an assignment and a photo in a writable company
 * owns some company. F3's cleanup therefore also removes her Initech
 * membership — not a contract state — and nothing below reads Initech while a
 * hook names her (release-reviewer L3).
 */

const SOFIA = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const WEB = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const HLP = "5a1e9c3d-7b2f-4d6a-8e0c-2f4b6d8a0c03";
/** Sofia's colours: the one her account states, and the one her id computes to. */
const SOFIA_FILLS = [avatarColor(SOFIA, "#ec4899"), avatarColor(SOFIA)];

/** The hook's window: marked on every read, nothing removed (Addendum 2). */
const IN_THE_WINDOW = { deletedAccounts: [{ userId: SOFIA, cleanup: false }] };

async function openIssue(page: Page, companyId: string, projectId: string, issueKey: string): Promise<Locator> {
  await page.goto(companyPath(companyId, `/projects/${projectId}/board`));
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("dialog", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  return panel;
}

const chipLabels = (panel: Locator) => panel.locator(".meta-grid .assignee-chip span:last-child");

/**
 * §4.4's neutral circle and nothing of the person: the class, no inline style
 * (no fill computed from the id), no picture, no initials, «Deleted user» on
 * hover and aloud — and the disc is `--surface-3`.
 */
async function expectNeutral(circle: Locator) {
  await expect(circle).toHaveClass(/\bavatar-deleted\b/);
  await expect(circle).toHaveAttribute("title", "Deleted user");
  await expect(circle).toHaveAttribute("aria-label", "Deleted user");
  const facts = await circle.evaluate((node) => {
    const probe = document.createElement("span");
    probe.style.background = "var(--surface-3)";
    document.body.append(probe);
    const surface3 = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      style: node.getAttribute("style"),
      images: node.querySelectorAll("img").length,
      text: node.textContent,
      glyph: node.querySelectorAll("svg").length,
      background: getComputedStyle(node).backgroundColor,
      surface3,
    };
  });
  expect(facts).toMatchObject({ style: null, images: 0, text: "", glyph: 1 });
  expect(facts.background).toBe(facts.surface3);
}

/** Every circle on the page that says «Deleted user» is the neutral one. */
async function expectEveryDeletedNeutral(scope: Locator, atLeast: number) {
  const circles = scope.locator('.avatar[title="Deleted user"]');
  await expect.poll(() => circles.count()).toBeGreaterThanOrEqual(atLeast);
  for (const circle of await circles.all()) await expectNeutral(circle);
}

test("F1, after the cleanup: Initech's HLP-3 draws its deleted author everywhere the same way, beside an «Unknown»", async ({ page }) => {
  await inCompany(page, "Initech", COMPANY.initech);
  await page.goto(companyPath(COMPANY.initech, `/projects/${HLP}/board`));
  // The assignment went with the cleanup: the card is nobody's.
  const card = page.locator(".issue-card", { hasText: "HLP-3" });
  await expect(card.locator(".avatar")).toHaveClass(/avatar-empty/);
  await card.click();
  const panel = page.getByRole("dialog", { name: "HLP-3 issue" });

  // The reporter.
  await expect(panel.locator(".person-line strong")).toHaveText("Deleted user");
  await expectNeutral(panel.locator(".person-line .avatar"));

  // The comment: the name slot, the body as written.
  const comment = panel.locator(".comment-item", { hasText: "The new gateway takes the old client profiles" });
  await expect(comment.locator(".comment-head strong")).toHaveText("Deleted user");
  await expect(comment.locator(".comment-head strong")).toHaveClass(/person-deleted/);

  // The activity feed: the actor in the name slot, «a deleted user» inside a sentence.
  const sentences = panel.locator(".activity-item p");
  // Created, assigned, moved, attached, and two work log entries.
  await expect(sentences).toHaveCount(6);
  const said = await sentences.allInnerTexts();
  expect(said).toEqual(
    expect.arrayContaining([
      "Deleted user created this issue",
      "Sofia Reyes assigned a deleted user",
      "Deleted user moved To Do to In Progress",
      "Deleted user attached vpn-client-profiles.txt",
      "Deleted user logged 2h",
      "Unknown logged 30m",
    ]),
  );

  // The work log's head; Anna is a MEMBER here, so another's entry offers her nothing, as before.
  const entry = panel.locator(".worklog-row", { hasText: "Both laptops connect." });
  await expect(entry.locator(".worklog-head strong")).toHaveText("Deleted user");
  await expect(entry.getByRole("button")).toHaveCount(0);
  // «Unknown» beside it, untouched: the dashed circle, the plain word (B10).
  const unknown = panel.locator(".worklog-row", { has: page.locator(".worklog-head strong", { hasText: "Unknown" }) });
  await expect(unknown.locator(".avatar")).toHaveClass(/avatar-empty/);
  await expect(unknown.locator(".avatar")).toHaveAttribute("aria-label", "Unknown");

  // The attachment's meta.
  await expect(panel.locator(".attachment-row", { hasText: "vpn-client-profiles.txt" }).locator(".attachment-meta")).toContainText(
    "· Deleted user ·",
  );

  // The reporter, the comment, four history rows and the work log entry.
  await expectEveryDeletedNeutral(panel, 7);
});

test("F1: the project's admin may still change a deleted author's work log entry — its actions say «by a deleted user»", async ({ page }) => {
  await inCompany(page, "Initech", COMPANY.initech, "sofia@example.com");
  const panel = await openIssue(page, COMPANY.initech, HLP, "HLP-3");
  const entry = panel.locator(".worklog-row", { hasText: "Both laptops connect." });
  await expect(entry.getByRole("button", { name: /^Edit 2h logged on .+ by a deleted user$/ })).toHaveCount(1);
  await expect(entry.getByRole("button", { name: /^Delete 2h logged on .+ by a deleted user$/ })).toHaveCount(1);
});

test.describe("F2, the window before the cleanup: Sofia is marked on every read and nothing is removed yet", () => {
  test.beforeEach(async ({ page }) => {
    await inCompany(page, "Northwind", COMPANY.northwind);
    await setHooks(page, IN_THE_WINDOW);
  });

  test("the project card's stack and the board's cards draw her as the neutral circle; the filter leaves her out", async ({ page }) => {
    await page.goto(companyPath(COMPANY.northwind));
    const web = page.locator("button.project-card", { hasText: "WEB" });
    // In the server's position, beside Anna; the count stays the server's.
    await expect(web.locator(".avatar-stack .avatar")).toHaveCount(2);
    await expectNeutral(web.locator(".avatar-stack .avatar").first());
    await expect(web).toHaveAccessibleName(/2 members/);

    await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
    for (const key of ["WEB-12", "WEB-15"]) await expectNeutral(page.locator(".issue-card", { hasText: key }).locator(".avatar"));
    await expect(page.locator(".filterbar .avatar-filter")).toHaveCount(1);
    await expect(page.locator(".filterbar .avatar-filter .avatar")).toHaveAttribute("aria-label", "Anna Ivanova");
  });

  test("the panel: one active, disabled chip after «None», skipped by Tab, «None» still the way to clear it", async ({ page }) => {
    const panel = await openIssue(page, COMPANY.northwind, WEB, "WEB-12");
    await expect(chipLabels(panel)).toHaveText(["None", "Deleted user", "Anna"]);
    const held = panel.getByRole("button", { name: "Deleted user", exact: true });
    await expect(held).toBeDisabled();
    await expect(held).toHaveClass(/is-active/);
    await expect(held).toHaveAttribute("aria-pressed", "true");
    await expectNeutral(held.locator(".avatar"));
    await expect(held.locator(".avatar")).toHaveAttribute("aria-hidden", "true");

    // The Tab walk over the chips (art-director §6): «None» takes focus with
    // the ring, the deleted chip is no stop, Anna's is the next one.
    const none = panel.getByRole("button", { name: "None", exact: true });
    await expect(none).toBeEnabled();
    await none.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(none).toBeFocused();
    expect(await none.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Anna", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(none).toBeFocused();
  });

  test("a watcher row: «Deleted user», no ✕ and no «(you)» — the reader's own row keeps its ✕", async ({ page }) => {
    const panel = await openIssue(page, COMPANY.northwind, PROJECT.taska, "TAS-101");
    const rows = panel.locator(".watcher-row");
    const deleted = rows.filter({ has: page.locator(".watcher-name", { hasText: /^Deleted user$/ }) });
    await expect(deleted).toHaveCount(1);
    await expect(deleted.locator(".watcher-name")).toHaveClass(/person-deleted/);
    await expect(deleted.getByRole("button")).toHaveCount(0);
    await expect(deleted.locator(".watcher-remove-slot")).toHaveAttribute("aria-hidden", "true");
    await expectNeutral(deleted.locator(".avatar"));
    await expect(rows.filter({ hasText: "Anna Ivanova" }).getByRole("button")).toHaveCount(1);
  });

  test("the members dialog: her row has its role as a word and no control; the people search finds her by neither name nor address", async ({
    page,
  }) => {
    await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
    await page.getByRole("button", { name: "Members", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Members" });
    const row = dialog.locator(".member-row", { has: page.locator(".member-name", { hasText: /^Deleted user$/ }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".member-role-label")).toHaveText("Member");
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.locator(".member-line")).toHaveCount(0);
    await expectNeutral(row.locator(".avatar"));
    // Anna's own row beside it is as it was.
    await expect(dialog.locator(".member-row", { hasText: "Anna Ivanova" })).toHaveCount(1);

    const search = dialog.getByRole("combobox", { name: "Add people" });
    for (const text of ["Sofia", "sofia@example.com"]) {
      await search.fill(text);
      await expect(dialog.getByText(`No one matches “${text}”.`)).toBeVisible();
    }
  });

  test("Settings › Members: her row last, «Deleted user» with the role word only; Transfer ownership does not offer her", async ({ page }) => {
    await page.goto(companyPath(COMPANY.northwind, "/settings/members"));
    const members = page.locator(".company-member-row:not(.is-invitation)");
    await expect(members.last()).toHaveAttribute("data-row-key", `member:${SOFIA}`);
    const row = members.last();
    await expect(row.locator(".company-member-name")).toHaveText("Deleted user");
    await expect(row.locator(".company-member-name")).toHaveAttribute("title", "Deleted user");
    await expect(row.locator(".company-member-line")).toHaveText("");
    await expect(row.locator(".company-member-role-word")).toHaveText("Member");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expectNeutral(row.locator(".avatar"));
    await expect(page.locator(".company-members")).not.toContainText("sofia@example.com");

    await page.goto(companyPath(COMPANY.northwind, "/settings/company"));
    await page.getByRole("button", { name: "Transfer ownership" }).click();
    const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
    const select = dialog.getByRole("combobox", { name: "New owner" });
    await expect(select).toBeVisible();
    const options = await select.locator("option").allInnerTexts();
    expect(options.filter((option) => option !== "")).toEqual(expect.arrayContaining(["Tom Becker · tom@example.com"]));
    expect(options.join("|")).not.toMatch(/Sofia|Deleted user/);
  });
});

test("in the app, without a reload: the board's member list still names Sofia, the issue read marks her — the chip is the issue read's (release-reviewer B1)", async ({
  page,
}) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
  // The context is read now, with Sofia named — and kept for the board's life (TAS-202).
  await expect(page.locator(".filterbar .avatar-filter .avatar[aria-label='Sofia Reyes']")).toHaveCount(1);
  await setHooks(page, IN_THE_WINDOW);

  await page.locator(".issue-card", { hasText: "WEB-12" }).click();
  const panel = page.getByRole("dialog", { name: "WEB-12 issue" });
  await expect(chipLabels(panel)).toHaveText(["None", "Deleted user", "Anna"]);
  const held = panel.getByRole("button", { name: "Deleted user", exact: true });
  await expect(held).toBeDisabled();
  await expectNeutral(held.locator(".avatar"));
  const chips = panel.locator(".meta-grid .chip-row");
  await expect(chips).not.toContainText("Sofia");
  await expect(chips.locator("img")).toHaveCount(0);
  // Nor is she offered to subscribe.
  const picker = panel.locator(".watcher-form select");
  if (await picker.count()) expect((await picker.locator("option").allInnerTexts()).join("|")).not.toContain("Sofia");
});

test("F3: named, then deleted, then re-read — the former name, address, picture and colour are gone from the page", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  let panel = await openIssue(page, COMPANY.northwind, PROJECT.taska, "TAS-107");
  const hers = () => panel.locator(".comment-item", { hasText: "Picked this up" });
  await expect(hers().locator(".comment-head strong")).toHaveText("Sofia Reyes");
  const former = await hers().locator(".avatar img").getAttribute("src");
  expect(former).toBeTruthy();

  await setHooks(page, { deletedAccounts: [{ userId: SOFIA }] });
  panel = await openIssue(page, COMPANY.northwind, PROJECT.taska, "TAS-107");

  await expect(hers().locator(".comment-head strong")).toHaveText("Deleted user");
  await expect(panel.locator(".activity-item p", { hasText: "assigned" })).toHaveText("Anna Ivanova assigned a deleted user");
  await expect(panel.locator(".worklog-row .worklog-head strong", { hasText: /^Deleted user$/ })).toHaveCount(1);
  // Her comment, her move and her work log entry.
  await expectEveryDeletedNeutral(panel, 3);

  const traces = await page.evaluate(
    ({ src, fills }) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const rgb = fills.map((fill) => {
        probe.style.backgroundColor = fill;
        return getComputedStyle(probe).backgroundColor;
      });
      probe.remove();
      const panelNode = document.querySelector('[role="dialog"]');
      const labels = [...document.querySelectorAll("[title], [aria-label]")].flatMap((node) => [
        node.getAttribute("title") ?? "",
        node.getAttribute("aria-label") ?? "",
      ]);
      return {
        text: document.body.innerText,
        labels: labels.join("|"),
        images: [...document.querySelectorAll("img")].filter((img) => img.getAttribute("src") === src).length,
        filled: [...(panelNode?.querySelectorAll(".avatar") ?? [])].filter((node) => rgb.includes(getComputedStyle(node).backgroundColor))
          .length,
      };
    },
    { src: former, fills: SOFIA_FILLS },
  );
  for (const trace of ["Sofia", "sofia@example.com"]) {
    expect(traces.text).not.toContain(trace);
    expect(traces.labels).not.toContain(trace);
  }
  expect(traces.images).toBe(0);
  expect(traces.filled).toBe(0);

  // The cleanup took her assignments and her rows.
  await page.goto(companyPath(COMPANY.northwind, `/projects/${WEB}/board`));
  await expect(page.locator(".issue-card", { hasText: "WEB-12" }).locator(".avatar")).toHaveClass(/avatar-empty/);
  await page.goto(companyPath(COMPANY.northwind, "/settings/members"));
  await expect(page.locator(".company-member-row").first()).toBeVisible();
  await expect(page.locator(`[data-row-key="member:${SOFIA}"]`)).toHaveCount(0);
});
