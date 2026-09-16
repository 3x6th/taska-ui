import { expect, test, type Locator, type Page } from "@playwright/test";

// The members dialog (TAS-158): add by user ID, change a role, remove.
//
// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password. Anna
// is the only ADMIN of Taska Platform; Mark is a MEMBER of it (and the seed's
// only GLOBAL_ADMIN, which the route gives no exemption) and Tom its VIEWER
// (since TAS-226); Priya is a real account on two other projects and not on
// this one.
//
// **Nothing below is evidence about the gateway.** Every rule the dialog reacts
// to — the last-admin refusal, the order of the checks, an unknown id accepted
// as a member (TAS-227) — is `MockTaskaStore` reading backend `develop`
// `1cfe4d79f074`, not a measured answer. Read these as pinning what the UI does
// with such a response, never as proof that the server sends one.
//
// And none of it survives a reload: the store lives in memory and is rebuilt
// on every page load, so each case makes its change and checks it in one visit.

const PRIYA_ID = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
/** Well-formed, and nobody's. */
const NOBODY_ID = "0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b";

async function openMembers(page: Page, email = "anna@example.com"): Promise<Locator> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  // Addressed by class: an ADMIN's card also carries an "Edit <name>" button.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  // `exact`: every project card on the way here is a button whose name
  // contains "members".
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Members" });
  await expect(dialog.getByText("Anna Ivanova")).toBeVisible();
  return dialog;
}

const row = (dialog: Locator, text: string) => dialog.locator(".member-row", { hasText: text });

test("an admin adds a person by user ID, changes their role, then removes them", async ({ page }) => {
  const dialog = await openMembers(page);
  const filterAvatars = page.locator(".assignee-row .avatar-filter");
  await expect(filterAvatars).toHaveCount(4);

  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await expect(add).toHaveAttribute("aria-disabled", "true");

  // A name is not an id, and the form says so rather than sending it.
  await dialog.getByLabel("Add by user ID").fill("Priya Nair");
  await expect(dialog.getByText(/This is not a user ID yet/)).toBeVisible();
  await expect(add).toHaveAttribute("aria-disabled", "true");

  // Pasted the way ids arrive: padded, in capitals.
  await dialog.getByLabel("Add by user ID").fill(`  ${PRIYA_ID.toUpperCase()} `);
  await dialog.getByLabel("Role", { exact: true }).selectOption("VIEWER");
  await add.click();

  // The server's answer carries no name; the re-read does.
  const priya = row(dialog, "Priya Nair");
  await expect(priya).toBeVisible();
  await expect(priya).toContainText("priya@example.com");
  await expect(priya.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveValue("VIEWER");
  await expect(dialog.getByLabel("Add by user ID")).toHaveValue("");
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

  await expect(row(dialog, "Priya Nair")).toHaveCount(0);
  await expect(filterAvatars).toHaveCount(4);
});

test("an ID nobody holds is added and drawn as that ID, never as a person", async ({ page }) => {
  const dialog = await openMembers(page);

  await dialog.getByLabel("Add by user ID").fill(NOBODY_ID);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  // TAS-227: the add does not check that the user exists, and the member read
  // names nobody for the id. The row says exactly that.
  const unknown = row(dialog, NOBODY_ID);
  await expect(unknown).toContainText("Unknown");
  await expect(unknown).toContainText("No account came back for this ID.");
  await expect(unknown.getByRole("combobox")).toHaveCount(0);

  await unknown.getByRole("button", { name: "Remove the member with ID 0b1c2d3e from this project" }).click();
  await unknown.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row(dialog, NOBODY_ID)).toHaveCount(0);
});

test("an admin row with no account does not let the only real admin step down", async ({ page }) => {
  const dialog = await openMembers(page);

  await dialog.getByLabel("Add by user ID").fill(NOBODY_ID);
  await dialog.getByLabel("Role", { exact: true }).selectOption("ADMIN");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const unknown = row(dialog, NOBODY_ID);
  await expect(unknown).toContainText("Admin");

  // The server counts two admins now and would let Anna leave — and then nobody
  // could sign in and manage the project. The dialog counts admins with an
  // account for her row, so she is still the only one.
  const anna = row(dialog, "Anna Ivanova");
  await expect(anna.getByText(/You are this project’s only admin with an account/)).toBeVisible();
  await expect(anna.getByRole("combobox")).toHaveCount(0);
  await expect(anna.getByRole("button", { name: /Remove/ })).toHaveCount(0);

  // The row with no account keeps the server's count, and can go.
  await unknown.getByRole("button", { name: "Remove the member with ID 0b1c2d3e from this project" }).click();
  await unknown.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row(dialog, NOBODY_ID)).toHaveCount(0);
  await expect(anna.getByText(/You are this project’s only admin, so/)).toBeVisible();
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
    await expect(dialog.getByLabel("Add by user ID")).toHaveCount(0);
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
  await expect(dialog.getByLabel("Add by user ID")).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage labels" })).toHaveCount(0);
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

  const field = dialog.getByLabel("Add by user ID");
  await expect(field).toBeFocused();
  await field.fill(PRIYA_ID);
  await field.press("Enter");
  await expect(row(dialog, "Priya Nair")).toBeVisible();

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
