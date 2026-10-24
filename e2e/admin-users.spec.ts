import { expect, test, type Page } from "@playwright/test";

// Like the other suites, this runs against MockTaskaApi
// (playwright.config.ts starts the server with VITE_TASKA_API_MODE=mock): any
// seeded ACTIVE user's email signs in with any password. Mark is the seed's
// only GLOBAL_ADMIN, so he is the only one who can reach this section — and
// being the only one is also what makes the last-active-admin refusal reachable
// by clicking.
//
// The seed carries one account of every status: Leo is INVITED and Nina is
// BLOCKED since TAS-186, Omar is LOCKED since TAS-188, and everybody else is
// ACTIVE. Omar is the only row that offers the third action — the server
// refuses Block from LOCKED, so nothing else can reach it. He is seeded rather
// than produced: reaching `LOCKED` takes repeated failed sign-ins against the
// real auth-service, which no test here can drive, so the mock is where the
// state is seen.

async function openUsers(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("mark@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/admin");
  // `/admin` settles in two redirects — into Data, then, once the catalog has
  // answered, into its first table — and the rail is drawn before the second.
  // A rail click in between can be undone by it: the catalog answer renders
  // the Data section under the address the click has just left, and its
  // redirect replaces the click's history entry (the PR #103 CI flake). So the
  // address settles first.
  await expect(page).toHaveURL(/\/admin\/data\/[^/]+\/[^/]+$/);
  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
}

test("blocks an account with a reason and the row's status changes to the one the server named", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Anna Ivanova" });
  await expect(row.getByText("Active")).toBeVisible();

  await row.getByRole("button", { name: "Block Anna Ivanova" }).click();

  const dialog = page.getByRole("dialog", { name: "Block Anna Ivanova" });
  await expect(dialog).toBeVisible();
  // The transition is named before it is asked for, and the confirmation is off
  // until there is a reason — the server refuses a blank one with a 400, and
  // the boundary is the worst place to learn that.
  await expect(dialog.getByText("ACTIVE → BLOCKED")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Block", exact: true })).toBeDisabled();

  await dialog.getByLabel("Reason").fill("Left the company");
  await dialog.getByRole("button", { name: "Block", exact: true }).click();

  // Nothing was optimistic: the pill flips only once the server has answered,
  // and it flips to the status the *server* named (§5.8).
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Blocked")).toBeVisible();
  await expect(row.getByRole("button", { name: "Unblock Anna Ivanova" })).toBeVisible();
});

test("resets the lockout on a locked account, which is the one action that row offers", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Omar Haddad" });
  await expect(row.getByText("Locked")).toBeVisible();
  // Not Block and not Unblock: the server refuses both from LOCKED, so the row
  // carries the third write or none at all.
  await expect(row.getByRole("button", { name: /^(Block|Unblock) Omar Haddad$/ })).toHaveCount(0);

  await row.getByRole("button", { name: "Reset lockout for Omar Haddad" }).click();

  const dialog = page.getByRole("dialog", { name: "Reset lockout for Omar Haddad" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("LOCKED → ACTIVE")).toBeVisible();
  // The question an admin actually has, answered before they ask it.
  await expect(dialog.getByText(/does not change the password/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reset lockout", exact: true })).toBeDisabled();

  await dialog.getByLabel("Reason").fill("Called in, identity confirmed");
  await dialog.getByRole("button", { name: "Reset lockout", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Active")).toBeVisible();
  // And the row now offers what an active account offers, with focus back on
  // it — *drawn*. The confirm was a pointer press, so a plain programmatic
  // `focus()` here matches `:focus-visible` false and the operator would get
  // focus back with nothing on screen saying where it went (§7).
  const back = row.getByRole("button", { name: "Block Omar Haddad" });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);
});

test("refuses to block the last active global admin and keeps the dialog open", async ({ page }) => {
  await openUsers(page);

  const row = page.getByRole("row").filter({ hasText: "Mark Lee" });
  await row.getByRole("button", { name: "Block Mark Lee" }).click();

  const dialog = page.getByRole("dialog", { name: "Block Mark Lee" });
  // Blocking your own account is not forbidden on the client — the server owns
  // the only rule there is, and the dialog says which account this is instead.
  await expect(dialog.getByText(/account you are signed in as/i)).toBeVisible();
  await dialog.getByLabel("Reason").fill("Testing the guard");
  await dialog.getByRole("button", { name: "Block", exact: true }).click();

  await expect(dialog.getByRole("alert")).toContainText("Cannot block the last active global admin");
  await expect(dialog).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
});

// Inviting (TAS-204, DESIGN.md §5.8). The mock answers as
// `AdminInviteUserServiceImpl` does: 201 for a new address, 200 for an invited
// one — nothing sent while Leo's link still works, a new link for Ivy, whose
// link expired — 409 for an account, and 429 inside a minute of the last link.
// Every outcome says "queued", never "sent" or "delivered".

const statusLine = (page: Page) => page.locator(".admin-users-status");

async function invite(page: Page, email: string) {
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite user" });
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  return dialog;
}

test("invites a new address: queued, with the link's deadline in UTC, and the new row in the list", async ({ page }) => {
  await openUsers(page);
  const trigger = page.getByRole("button", { name: "Invite user" });

  const dialog = await invite(page, "zoe@example.com");

  await expect(dialog).toHaveCount(0);
  await expect(statusLine(page)).toHaveText(
    /^zoe@example\.com is invited\. The email is queued for sending; the link works until [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC\.$/,
  );
  await expect(trigger).toBeFocused();
  const row = page.getByRole("row").filter({ hasText: "zoe@example.com" });
  await expect(row.getByText("Invited", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Resend invite to zoe" })).toBeVisible();
});

test("an empty address looks as off as it is, and typing one moves nothing under it", async ({ page }) => {
  await openUsers(page);
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite user" });
  const send = dialog.getByRole("button", { name: "Send invitation" });

  await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(send).toHaveCSS("opacity", "0.58");
  // Measured once the dialog's own entrance (`tk-pop`, a 7px rise) has ended,
  // so the only thing that could move the field is the hint above it.
  await dialog.evaluate((element) =>
    Promise.all(element.closest(".modal-layer")!.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const before = await dialog.getByLabel("Display name (optional)").boundingBox();

  await dialog.getByLabel("Email").fill("z");

  await expect(send).not.toHaveAttribute("aria-disabled");
  await expect(send).toHaveCSS("opacity", "1");
  await expect(dialog.getByText("Enter an email address.")).toHaveCount(0);
  expect((await dialog.getByLabel("Display name (optional)").boundingBox())?.y).toBe(before?.y);
});

test("an invitation whose link still works sends nothing until a new link is asked for", async ({ page }) => {
  await openUsers(page);

  const dialog = await invite(page, "leo@example.com");

  await expect(dialog.getByText(/^leo@example\.com is already invited and their link still works until/)).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send new link" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(statusLine(page)).toHaveText(/^A new invitation link for leo@example\.com is queued; it works until/);
});

test("an expired invitation is re-issued; an account is refused with 409; a second link inside a minute with 429", async ({
  page,
}) => {
  await openUsers(page);

  await invite(page, "ivy@example.com");
  await expect(statusLine(page)).toHaveText(/^ivy@example\.com was already invited but did not have a working link, so a new one is queued;/);

  const taken = await invite(page, "anna@example.com");
  await expect(taken.getByRole("alert")).toHaveText(
    "This email already belongs to a Taska account, so there is nothing to invite.",
  );
  await expect(taken.getByText("An account with this email already exists")).toBeVisible();
  await taken.getByRole("button", { name: "Cancel" }).click();

  // Ivy's new link was made a moment ago: asking for another is too soon.
  const again = await invite(page, "ivy@example.com");
  await again.getByRole("button", { name: "Send new link" }).click();
  await expect(again.getByRole("alert")).toHaveText(
    /^An invitation to ivy@example\.com was sent less than a minute ago\. Try again in \d+ seconds?\.$/,
  );
  await expect(again).toBeVisible();
});

test("resends from an INVITED row only after asking, and the row's two buttons keep Block rightmost", async ({
  page,
}) => {
  await openUsers(page);
  const row = page.getByRole("row").filter({ hasText: "Leo Fischer" });
  const buttons = row.getByRole("button");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveAccessibleName("Resend invite to Leo Fischer");
  await expect(buttons.nth(1)).toHaveAccessibleName("Block Leo Fischer");

  const resend = row.getByRole("button", { name: "Resend invite to Leo Fischer" });
  await resend.click();
  const dialog = page.getByRole("dialog", { name: "Resend invitation" });
  await expect(dialog.getByText("A new link is emailed to leo@example.com. The link sent earlier stops working.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Cancel sends nothing and hands focus back.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(resend).toBeFocused();

  await resend.click();
  await dialog.getByRole("button", { name: "Send new link" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statusLine(page)).toHaveText(/^A new invitation link for Leo Fischer is queued; it works until/);
  await expect(resend).toBeFocused();
});

/**
 * The person column on a narrow screen (DESIGN.md §5.8, TAS-396): at ≤720 it
 * is frozen on the Data key's recipe, at most 150 wide, and the scroll box's
 * padding keeps an action scrolled into view clear of it — before this, focus
 * on Unblock at 375 scrolled the whole column out and only the tint marked the
 * row. Above 720 the column stays in place. Measured in one `evaluate`.
 */
test("keeps the person column in view while a row's action has focus, frozen only on a narrow screen", async ({
  page,
}) => {
  await openUsers(page);
  await page.evaluate(() => document.fonts.ready);
  const unblock = page.getByRole("button", { name: "Unblock Nina Kowal" });
  await unblock.focus();
  await expect(unblock).toBeFocused();

  const measured = await page.evaluate(() => {
    const button = document.activeElement as HTMLElement;
    const person = button.closest("tr")!.querySelector<HTMLTableCellElement>("td.admin-cell-frozen")!;
    const head = document.querySelector<HTMLTableCellElement>(".admin-users-table thead th.admin-cell-frozen")!;
    const box = document.querySelector<HTMLElement>(".admin-users-plane .admin-table-scroll")!;
    const scrollBox = box.getBoundingClientRect();
    const cell = person.getBoundingClientRect();
    return {
      overflows: box.scrollWidth > box.clientWidth,
      position: getComputedStyle(person).position,
      headPosition: getComputedStyle(head).position,
      edge: getComputedStyle(person).borderRightWidth,
      cellLeft: cell.left - scrollBox.left,
      headLeft: head.getBoundingClientRect().left - scrollBox.left,
      cellWidth: cell.width,
      buttonLeft: button.getBoundingClientRect().left,
      cellRight: cell.right,
      title: person.title,
    };
  });

  expect(measured.title).toBe("Nina Kowal · nina@example.com");
  // The head cell keeps its sticky top either way.
  expect(measured.headPosition).toBe("sticky");
  if (page.viewportSize()!.width <= 720) {
    expect(measured.overflows).toBe(true);
    expect(measured.position).toBe("sticky");
    expect(measured.edge).toBe("1px");
    // At the box's left edge (inside its 1px border), head and row alike.
    expect(measured.cellLeft).toBeLessThanOrEqual(1.5);
    expect(measured.headLeft).toBeLessThanOrEqual(1.5);
    expect(measured.cellWidth).toBeLessThanOrEqual(150.5);
    expect(measured.buttonLeft).toBeGreaterThanOrEqual(measured.cellRight);
  } else {
    expect(measured.position).toBe("static");
    expect(measured.edge).toBe("0px");
  }
});
