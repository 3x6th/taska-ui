import { expect, test, type Locator, type Page } from "@playwright/test";

// The members dialog (TAS-158): find a person, add them, change a role, remove.
// People are found through the directory (`GET /users`, backend #204) since
// TAS-297; there is no adding by id any more.
//
// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password. Anna
// is the only ADMIN of Taska Platform; Mark is a MEMBER of it, the ADMIN of
// Mobile and the seed's only GLOBAL_ADMIN (which the member routes give no
// exemption); Tom is its VIEWER (since TAS-226); Priya is a real account on two
// other projects and not on this one.
//
// **Nothing below is evidence about the gateway.** Every rule the dialog reacts
// to — the last-admin refusal, the order of the checks, what the directory
// finds — is `MockTaskaStore` reading backend `develop`, not a measured answer.
// Read these as pinning what the UI does with such a response, never as proof
// that the server sends one.
//
// And none of it survives a reload: the store lives in memory and is rebuilt
// on every page load, so each case makes its change and checks it in one visit.
//
// A row the member read cannot name (TAS-227) can no longer be made from this
// dialog — search only finds accounts — and how one is drawn and removed is
// pinned in src/components/ProjectMembersModal.test.tsx.

async function openMembers(page: Page, email = "anna@example.com", project = "Taska Platform"): Promise<Locator> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  // Addressed by class: an ADMIN's card also carries an "Edit <name>" button.
  await page.locator(".project-card", { hasText: project }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  // `exact`: every project card on the way here is a button whose name
  // contains "members".
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Members" });
  await expect(dialog.locator(".member-row").first()).toBeVisible();
  return dialog;
}

const row = (dialog: Locator, text: string) => dialog.locator(".member-row", { hasText: text });
const search = (dialog: Locator) => dialog.getByRole("combobox", { name: "Add people" });
const result = (dialog: Locator, name: string) =>
  dialog.getByRole("listbox", { name: "People" }).getByRole("option", { name: new RegExp(name) });

test("an admin finds a person by name, adds them, changes their role, then removes them", async ({ page }) => {
  const dialog = await openMembers(page);
  const filterAvatars = page.locator(".assignee-row .avatar-filter");
  await expect(filterAvatars).toHaveCount(4);

  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await expect(add).toHaveAttribute("aria-disabled", "true");

  // Under three characters nothing is asked.
  await search(dialog).fill("pr");
  await expect(dialog.getByText("Type at least 3 characters to search.")).toBeVisible();

  // Members are marked from the list the dialog holds, in words.
  await search(dialog).fill("example.com");
  await expect(result(dialog, "Mark Lee")).toContainText("Already a member");
  await expect(result(dialog, "Mark Lee")).toHaveAttribute("aria-disabled", "true");
  // BLOCKED accounts are never found; INVITED ones are.
  await expect(result(dialog, "Nina Kowal")).toHaveCount(0);
  await expect(result(dialog, "Leo Fischer")).toBeVisible();

  await search(dialog).fill("priya");
  await result(dialog, "Priya Nair").click();
  await expect(dialog.getByRole("group", { name: "Add people" })).toContainText("priya@example.com");
  await expect(add).toBeFocused();
  await dialog.getByLabel("Role", { exact: true }).selectOption("VIEWER");
  await expect(dialog.getByText("Priya Nair will be added as Viewer.")).toBeVisible();
  await add.click();

  // The server's answer carries no name; the re-read does.
  const priya = row(dialog, "priya@example.com");
  await expect(priya.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveValue("VIEWER");
  await expect(search(dialog)).toHaveValue("");
  await expect(search(dialog)).toBeFocused();
  // The board behind the scrim reads the same list, so its filter gains her.
  await expect(filterAvatars).toHaveCount(5);

  await priya.getByRole("combobox", { name: "Role of Priya Nair" }).selectOption("MEMBER");
  await expect(priya.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveValue("MEMBER");
  await expect(priya.getByRole("combobox", { name: "Role of Priya Nair" })).not.toHaveAttribute("aria-disabled");

  // Asked before it goes, and nothing has gone yet.
  await priya.getByRole("button", { name: "Remove Priya Nair from this project" }).click();
  await expect(priya.getByText("Priya Nair will lose access to this project.")).toBeVisible();
  await expect(filterAvatars).toHaveCount(5);

  await priya.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(row(dialog, "priya@example.com")).toHaveCount(0);
  await expect(filterAvatars).toHaveCount(4);
});

test("results that overflow their box are not a Tab stop, and the arrows move the active row, not the box", async ({
  page,
}) => {
  const dialog = await openMembers(page);
  // Eight people match — Nina is BLOCKED and never found — at 44 a row, more
  // than the box's 242 holds.
  await search(dialog).fill("example");
  await expect(result(dialog, "Ivy Chen")).toBeVisible();
  const box = dialog.locator(".member-search.is-open");
  expect(await box.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  // Field, then Role, then Add: no stop on the box between them.
  await expect(search(dialog)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Role", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeFocused();

  // Back in the field, ArrowDown names a row rather than scrolling the box.
  await search(dialog).focus();
  await page.keyboard.press("ArrowDown");
  await expect(search(dialog)).toBeFocused();
  await expect(search(dialog)).toHaveAttribute("aria-activedescendant", /option-0$/);
  expect(await box.evaluate((element) => element.scrollTop)).toBe(0);
});

test("a search that finds nobody tells a global admin where to invite them, and anybody else who can", async ({
  page,
}) => {
  // Mark: the seed's global admin, and ADMIN of Mobile.
  const asAdmin = await openMembers(page, "mark@example.com", "Mobile");
  await search(asAdmin).fill("zoe");
  await expect(asAdmin.getByText("No one matches “zoe”.")).toBeVisible();
  const way = asAdmin.getByRole("link", { name: "Administration › Users" });
  await expect(way).toBeVisible();

  await way.click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test("a project admin who is not a global admin is told a global admin can invite", async ({ page }) => {
  const dialog = await openMembers(page);
  await search(dialog).fill("zoe");
  await expect(dialog.getByText("No one matches “zoe”.")).toBeVisible();
  await expect(dialog.getByText("People need a Taska account first — a global admin can invite them.")).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);
});

for (const reader of [
  { email: "mark@example.com", name: "Mark Lee", role: "Member", article: "a MEMBER" },
  { email: "tom@example.com", name: "Tom Becker", role: "Viewer", article: "a VIEWER" },
]) {
  test(`${reader.article} sees everyone and no control`, async ({ page }) => {
    const dialog = await openMembers(page, reader.email);

    await expect(dialog.locator(".member-row")).toHaveCount(4);
    await expect(row(dialog, reader.name)).toContainText("(you)");
    await expect(row(dialog, reader.name)).toContainText(reader.role);
    await expect(row(dialog, "Anna Ivanova")).toContainText("Admin");
    await expect(dialog.getByText("Only a project admin can add, change or remove members.")).toBeVisible();

    // Absent from the markup rather than hidden — and the server refuses these
    // writes for anybody but an ADMIN regardless (DESIGN.md §5.7).
    await expect(dialog.getByLabel("Add people")).toHaveCount(0);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  });
}

test("the only admin cannot step down until there is another, and then the controls leave with the role", async ({
  page,
}) => {
  const dialog = await openMembers(page);

  // Present before, so its absence at the end is the role leaving and not a
  // locator that never matched through the dialog's scrim.
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(1);

  const anna = row(dialog, "Anna Ivanova");
  await expect(anna.getByText(/You are this project’s only admin/)).toBeVisible();
  await expect(anna.getByRole("combobox")).toHaveCount(0);
  await expect(anna.getByRole("button", { name: /Remove/ })).toHaveCount(0);

  await row(dialog, "Mark Lee").getByRole("combobox", { name: "Role of Mark Lee" }).selectOption("ADMIN");

  // Two admins now, so Anna's own row offers her role — and asks first.
  const mine = anna.getByRole("combobox", { name: "Your role" });
  await expect(mine).toBeVisible();
  await mine.selectOption("MEMBER");
  await expect(anna.getByText(/You will stop being an admin of this project/)).toBeVisible();
  await anna.getByRole("button", { name: "Change to Member" }).click();

  await expect(dialog.getByText("You are now a Member of this project, so only an admin can change its members.")).toBeVisible();
  // Her role was read again: the add form and every row control are gone, and
  // so is the board's own ADMIN-only control behind the scrim.
  await expect(dialog.getByLabel("Add people")).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(0);
});

// Backend TAS-394: a stale list — two admins on screen, one on the server —
// is how the last-admin refusal reaches a dialog that hides the control. The
// mock's second actor (`MOCK_PROJECT_TRIGGERS.adminsLeftMeanwhile`, a project
// description) makes the other admin step down without the dialog knowing; the
// refusal is then told by `details.reason`, in the dialog's own words.
test("the last-admin refusal of a stale list says so, puts the role back and freezes the row", async ({ page }) => {
  let dialog = await openMembers(page);
  await row(dialog, "Mark Lee").getByRole("combobox", { name: "Role of Mark Lee" }).selectOption("ADMIN");
  await expect(row(dialog, "Anna Ivanova").getByRole("combobox", { name: "Your role" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  // Mark steps down "in another session".
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit project" });
  await edit.getByLabel("Description").fill("Core services [admins left meanwhile]");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();

  // The list on screen is the one read before: two admins, so Anna may step down.
  await page.getByRole("button", { name: "Members", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Members" });
  const anna = row(dialog, "Anna Ivanova");
  await anna.getByRole("combobox", { name: "Your role" }).selectOption("MEMBER");
  await anna.getByRole("button", { name: "Change to Member" }).click();

  await expect(dialog.getByText("You are this project’s only admin, so your role did not change.")).toBeVisible();
  // The list read again: Mark is a member, and Anna's row is the frozen one.
  await expect(anna.getByText(/You are this project’s only admin, so your role cannot change/)).toBeVisible();
  await expect(anna.getByRole("combobox")).toHaveCount(0);
  await expect(row(dialog, "Mark Lee").getByRole("combobox", { name: "Role of Mark Lee" })).toHaveValue("MEMBER");
});

test("an admin who removes themselves is taken to their projects, where this one is gone", async ({ page }) => {
  const dialog = await openMembers(page);
  await row(dialog, "Mark Lee").getByRole("combobox", { name: "Role of Mark Lee" }).selectOption("ADMIN");

  const anna = row(dialog, "Anna Ivanova");
  await anna.getByRole("button", { name: "Remove yourself from this project" }).click();
  await expect(anna.getByText("You will lose access to this project and go back to your projects.")).toBeVisible();
  await anna.getByRole("button", { name: "Remove me" }).click();

  // Against the gateway every read under that board would now answer 403, so
  // the reader is not left on it.
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(".project-card", { hasText: "Web App" })).toBeVisible();
  await expect(page.locator(".project-card", { hasText: "Taska Platform" })).toHaveCount(0);
});

test("the whole path works from the keyboard, and closing gives focus back to the Members button", async ({ page }) => {
  const dialog = await openMembers(page);
  const trigger = page.getByRole("button", { name: "Members", exact: true });

  // Field, arrows, Enter to choose, Enter on Add — the pointer is never needed.
  const field = search(dialog);
  await expect(field).toBeFocused();
  await field.fill("priya");
  await expect(result(dialog, "Priya Nair")).toBeVisible();
  await field.press("ArrowDown");
  await expect(result(dialog, "Priya Nair")).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await expect(add).toBeFocused();
  await add.press("Enter");
  await expect(row(dialog, "Priya Nair")).toBeVisible();
  await expect(search(dialog)).toBeFocused();

  // Esc closes the results first and keeps the text; the next one is the dialog's.
  await search(dialog).fill("sofia");
  await expect(result(dialog, "Sofia Reyes")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(search(dialog)).toHaveValue("sofia");
  await expect(dialog).toBeVisible();

  // Esc answers the nearer question first: an open confirmation, then the dialog.
  await row(dialog, "Priya Nair").getByRole("button", { name: "Remove Priya Nair from this project" }).press("Enter");
  await expect(row(dialog, "Priya Nair").getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row(dialog, "Priya Nair").getByText("Priya Nair will lose access to this project.")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
