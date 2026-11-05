import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, PROJECT, companyPath, companyRow, inCompany, openCompanyZone, setHooks } from "./companiesFixtures";

/*
 * Company › Members in the companies build (TAS-502, DESIGN.md §4.38, §5.10)
 * against the third e2e server's mock: the story's four acceptance criteria —
 * a member sees the directory and nothing to manage; an invitation holds a
 * seat, resend does not, revoke frees it; the owner and the last admin are the
 * server's refusals; a role or a state changes only after the server.
 */

const membersPath = (companyId: string) => companyPath(companyId, "/company/members");

/** Opens Company › Members as a reader does: «Manage company» and the zone's rail, or the zone's address on a phone (TAS-522). */
async function openMembers(page: Page, companyId: string) {
  await openCompanyZone(page, companyId, "Members");
  await expect(page.getByRole("heading", { level: 2, name: /^Members/ })).toBeVisible();
}

const row = (page: Page, text: string) => page.locator(".company-member-row").filter({ hasText: text });
const said = (page: Page) => page.locator('.company-members > [role="status"]');
const seatLine = (page: Page) => page.locator(".company-seats");

test("a member sees the directory without controls, invitations or seats", async ({ page }) => {
  await inCompany(page, "Globex", COMPANY.globex);
  await openMembers(page, COMPANY.globex);
  await expect(page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Everyone in Globex. Only its admins can invite people or change members.")).toBeVisible();
  await expect(row(page, "Priya Nair")).toContainText("Owner");
  await expect(row(page, "Anna Ivanova")).toContainText("(you)");
  await expect(page.locator(".company-members").getByRole("combobox")).toHaveCount(0);
  await expect(page.locator(".company-members").getByRole("button", { name: /Suspend|Reactivate|Remove|Resend|Revoke/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Invite a member" })).toHaveCount(0);
  await expect(page.getByText("Pending invitations")).toHaveCount(0);
  await expect(seatLine(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave company" })).toBeVisible();
  // The zone's strip scrolls inside itself: the document is never wider than the screen (§5.8, §5.10).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("an invitation holds a seat: a full Northwind refuses it, revoking Kai frees the seat, resend takes none", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openMembers(page, COMPANY.northwind);
  await expect(seatLine(page)).toContainText("All 5 seats are in use · 1 held by an invitation");
  await expect(seatLine(page)).toContainText("To invite someone, remove a member or revoke an invitation.");
  // TAS-512: the plan's explanation is one link away (§4.38 → §4.40), its target at least 28 high.
  const seePlan = seatLine(page).getByRole("link", { name: "See Plan" });
  await expect(seePlan).toHaveAttribute("href", "/c/" + COMPANY.northwind + "/company/plan");
  expect((await seePlan.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(28);

  // «Invite a member» is not disabled by the snapshot: the server's 422 decides.
  const invite = page.getByRole("button", { name: "Invite a member" });
  await invite.click();
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  await dialog.getByLabel("Email").fill("lin@example.com");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  // The limit quoted from the snapshot the page read (TAS-512, §4.38).
  await expect(dialog.getByRole("alert")).toHaveText(
    "All 5 seats are in use, so this invitation was not created. Remove a member or revoke an invitation to free a seat.",
  );
  await expect(dialog.getByLabel("Email")).toHaveValue("lin@example.com");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Revoke the invitation to kai@example.com" }).click();
  const strip = page.locator(".company-member-confirm");
  await expect(strip).toContainText("The invitation to kai@example.com stops working, and its seat is freed.");
  await strip.getByRole("button", { name: "Revoke" }).click();
  await expect(seatLine(page)).toHaveText("4 of 5 seats in use");
  await expect(said(page)).toHaveText("The invitation to kai@example.com was revoked. Its seat is free.");
  await expect(row(page, "kai@example.com")).toHaveCount(0);

  await invite.click();
  await dialog.getByLabel("Email").fill("lin@example.com");
  await dialog.locator(".company-invite-project-label").filter({ hasText: "Web App" }).click();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(invite).toBeFocused();
  const pending = page.getByRole("list", { name: /Pending invitations/ });
  await expect(pending.locator(".company-member-name").first()).toHaveText("lin@example.com");
  await expect(row(page, "lin@example.com")).toContainText("Invited by you");
  await expect(row(page, "lin@example.com")).toContainText("1 project");
  await expect(seatLine(page)).toContainText("All 5 seats are in use · 1 held by an invitation");
  await expect(said(page)).toContainText("lin@example.com is invited. The email is queued");

  await page.getByRole("button", { name: "Resend the invitation to lin@example.com" }).click();
  await expect(said(page)).toContainText("Another invitation email to lin@example.com is queued. The earlier link stops working");
  await expect(seatLine(page)).toContainText("All 5 seats are in use · 1 held by an invitation");
});

test("the owner's row has no controls, and a refused last-admin change shows the server's answer", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "tom@example.com");
  await openMembers(page, COMPANY.umbrella);
  const owner = row(page, "Tom Becker");
  await expect(owner).toContainText("Owner");
  await expect(owner.getByRole("combobox")).toHaveCount(0);
  await expect(owner.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("You own Umbrella, so you can’t leave it.")).toBeVisible();

  await setHooks(page, { refuseNext: { setTenantMemberRole: { status: 409, code: "LAST_ADMIN", title: "last admin" } } });
  const role = page.getByRole("combobox", { name: "Role of Priya Nair" });
  await role.selectOption("MEMBER");
  const strip = page.locator(".company-member-confirm");
  await expect(strip).toContainText(
    "Priya Nair will be a Member and keep only the projects they were added to. The invitation they sent is revoked.",
  );
  await expect(strip.getByRole("button", { name: "Cancel" })).toBeFocused();
  await strip.getByRole("button", { name: "Make Member" }).click();
  await expect(row(page, "Priya Nair").locator(".error-note")).toContainText(
    "Priya Nair is the only active admin, so their role did not change.",
  );
  await expect(role).toHaveValue("TENANT_ADMIN");
  await expect(role).toBeFocused();
  // Lena's invitation is still pending: nothing changed.
  await expect(row(page, "lena@example.com")).toBeVisible();
});

test("a role change is in flight until the server answers, and only then changes", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openMembers(page, COMPANY.northwind);
  await setHooks(page, { delayMs: { setTenantMemberRole: 1500 } });
  const role = page.getByRole("combobox", { name: "Role of Sofia Reyes" });
  await role.selectOption("TENANT_ADMIN");
  await expect(role).toHaveAttribute("aria-disabled", "true");
  await expect(role).toHaveValue("TENANT_ADMIN");
  await expect(said(page)).toHaveText("");
  await expect(row(page, "Sofia Reyes").getByRole("button", { name: "Suspend Sofia Reyes" })).toHaveAttribute("aria-disabled", "true");
  await expect(said(page)).toHaveText("Sofia Reyes is now an Admin.", { timeout: 10_000 });
  await expect(role).not.toHaveAttribute("aria-disabled");
  await expect(role).toHaveValue("TENANT_ADMIN");
});

test("a removal is under way while its operation runs, and the seat is free once it succeeds", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openMembers(page, COMPANY.northwind);
  await setHooks(page, { memberOperationStepMs: 1500 });
  await page.getByRole("button", { name: "Remove Tom Becker from Northwind" }).click();
  const strip = page.locator(".company-member-confirm");
  await expect(strip).toContainText("Tom Becker is removed from Northwind and loses access at once. Their seat is freed.");
  await strip.getByRole("button", { name: "Remove" }).click();
  await expect(row(page, "Tom Becker")).toContainText("Being removed");
  await expect(row(page, "Tom Becker").getByRole("button")).toHaveCount(0);
  await expect(row(page, "Tom Becker")).toHaveCount(0, { timeout: 15_000 });
  await expect(seatLine(page)).toContainText("4 of 5 seats in use · 1 held by an invitation");
  await expect(said(page)).toHaveText("Tom Becker was removed from Northwind. Their seat is free.");
});

test("a suspended Omar, reactivated, comes back as a Member", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await openMembers(page, COMPANY.northwind);
  const omar = row(page, "Omar Haddad");
  await expect(omar).toContainText("Suspended · omar@example.com");
  await expect(omar.getByRole("combobox")).toHaveCount(0);
  const reactivate = page.getByRole("button", { name: "Reactivate Omar Haddad" });
  await reactivate.click();
  await expect(said(page)).toHaveText("Omar Haddad is active again, as a Member.");
  await expect(omar).not.toContainText("Suspended");
  await expect(page.getByRole("combobox", { name: "Role of Omar Haddad" })).toHaveValue("MEMBER");
  await expect(page.getByRole("button", { name: "Suspend Omar Haddad" })).toBeFocused();
});

test("leaving Globex lands on the picker, never on «no longer have access»", async ({ page }) => {
  await inCompany(page, "Globex", COMPANY.globex);
  await openMembers(page, COMPANY.globex);
  await page.getByRole("button", { name: "Leave company" }).click();
  const strip = page.locator(".company-leave-confirm");
  await expect(strip).toContainText("You’ll lose access to Globex and its projects at once. Only an admin can invite you back.");
  await strip.getByRole("button", { name: "Leave company" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a company" })).toBeFocused();
  await expect(companyRow(page, /^Globex/)).toHaveCount(0);
  await expect(companyRow(page, /^Northwind/)).toBeVisible();
  await expect(page.getByText("You no longer have access")).toHaveCount(0);
});

test("the project Members dialog sends a company admin to Company › Members", async ({ page }) => {
  await inCompany(page, "Northwind", COMPANY.northwind);
  await page.locator(`button.project-card[data-project-id="${PROJECT.taska}"]`).click();
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Members" });
  await dialog.getByRole("combobox", { name: "Add people" }).fill("nobody-here");
  const way = dialog.locator(".member-search-way");
  await expect(way).toHaveText("Only members of Northwind can be added. Invite people from Company › Members.");
  await expect(dialog.getByRole("link", { name: "Administration › Users" })).toHaveCount(0);
  await way.getByRole("link", { name: "Company › Members" }).click();
  await expect(page).toHaveURL(membersPath(COMPANY.northwind));
  await expect(page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
});

test("an admin's own demotion re-enters the company: the tab stays, the controls go, focus is on the heading", async ({ page }) => {
  await inCompany(page, "Umbrella", COMPANY.umbrella, "priya@example.com");
  await openMembers(page, COMPANY.umbrella);
  await page.getByRole("combobox", { name: "Role of Priya Nair" }).selectOption("MEMBER");
  const strip = page.locator(".company-member-confirm");
  await expect(strip).toContainText("You’ll be a Member and keep only the projects you were added to.");
  await expect(strip).toContainText("The invitation you sent is revoked.");
  await strip.getByRole("button", { name: "Make me a Member" }).click();
  await expect(page.getByText("Everyone in Umbrella. Only its admins can invite people or change members.")).toBeVisible();
  await expect(page).toHaveURL(membersPath(COMPANY.umbrella));
  await expect(page.getByRole("heading", { level: 1, name: /Members/ })).toBeFocused();
  await expect(page.getByRole("button", { name: "Invite a member" })).toHaveCount(0);
  await expect(page.getByText("lena@example.com")).toHaveCount(0);
  await expect(page.getByText("You no longer have access")).toHaveCount(0);
});

test("a leave whose answer was lost says so, and pressing again finds the leave applied: the picker, never «no longer have access»", async ({
  page,
}) => {
  await inCompany(page, "Globex", COMPANY.globex);
  await openMembers(page, COMPANY.globex);
  await setHooks(page, { loseAnswer: ["leaveTenant"] });
  await page.getByRole("button", { name: "Leave company" }).click();
  await page.locator(".company-leave-confirm").getByRole("button", { name: "Leave company" }).click();
  await expect(page.locator(".company-leave .error-note-sentence")).toHaveText(
    "Taska couldn’t confirm that you left Globex. Press Leave company again to check.",
  );
  await expect(page).toHaveURL(membersPath(COMPANY.globex));
  await page.getByRole("button", { name: "Leave company" }).click();
  await page.locator(".company-leave-confirm").getByRole("button", { name: "Leave company" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a company" })).toBeFocused();
  await expect(companyRow(page, /^Globex/)).toHaveCount(0);
  await expect(page.getByText("You no longer have access")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
});

test("after a leave whose answer was lost, the next page's read finds it applied: the picker with «You left», no §4.35", async ({
  page,
}) => {
  await inCompany(page, "Globex", COMPANY.globex);
  // Loaded rather than reached through the switcher: the point is that Projects
  // *reads* on the way back, and Projects seen within the cache's 20 s
  // (`STALE_TIME_MS`) would be drawn from the cache without a read.
  await page.goto(membersPath(COMPANY.globex));
  await expect(page.getByRole("heading", { level: 2, name: /^Members/ })).toBeVisible();
  await setHooks(page, { loseAnswer: ["leaveTenant"] });
  await page.getByRole("button", { name: "Leave company" }).click();
  await page.locator(".company-leave-confirm").getByRole("button", { name: "Leave company" }).click();
  await expect(page.locator(".company-leave .error-note-sentence")).toContainText("Taska couldn’t confirm that you left Globex.");
  // Not pressed again: the reader goes on to Projects, whose reads meet the server's «no longer a member».
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(`${B2B}/companies`);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a company" })).toBeFocused();
  await expect(page.locator('.companies-card [role="status"]')).toHaveText("You left Globex.");
  await expect(companyRow(page, /^Globex/)).toHaveCount(0);
  await expect(page.getByText("You no longer have access")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
});
