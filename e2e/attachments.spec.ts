import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// **This is the only place the attachment feature can be exercised at all.**
// The five gateway routes ship in backend PR #147 and are not deployed —
// measured 2026-09-06, they answer Spring's static-resource 404 while their
// neighbour `…/comments` answers 401 — and the *middle* leg of an upload never
// touches the gateway even once they are: the browser PUTs the bytes straight
// to an S3-compatible store whose only checked-in address is
// `http://127.0.0.1:9000` and for which nothing in the backend repository
// configures CORS. So nothing below is evidence about a server. It pins what
// the UI does with each answer, and the answers come from `MockTaskaStore`.
//
// The seed puts two files on TAS-101 from two different people, which is what
// makes the split delete rule visible: Anna is an ADMIN of Taska Platform and
// may remove either; Mark is a MEMBER and may remove only his own.

const MOB_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function openIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.getByRole("button", { name: /Taska Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();

  return page.locator(".issue-attachments");
}

// Remounting the section is what proves the store answered rather than the
// cache. A `page.reload()` would not do: `MockTaskaStore` lives in memory and is
// rebuilt on every page load, so a reload would discard the very upload the
// round trip is meant to prove.
async function reopenIssuePanel(page: Page, issueKey: string): Promise<Locator> {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toHaveCount(0);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  await expect(page.getByRole("complementary", { name: `${issueKey} issue` })).toBeVisible();
  return page.locator(".issue-attachments");
}

/**
 * Hands a file to the input the "Attach a file" button drives.
 *
 * `setInputFiles` on a `hidden` input rather than a file chooser dialog: the
 * input is deliberately out of the tab order (the button is the control), and
 * Playwright sets files on it directly, which is also what lets a name be
 * chosen — the mock reads the file *name* to decide which failure branch to
 * take, and three of those failures are otherwise unreachable from a browser.
 */
async function attach(page: Page, name: string, body = "trace line\n", mimeType = "text/plain") {
  await page.locator(".attachment-input").setInputFiles({ name, mimeType, buffer: Buffer.from(body) });
}

test("lists the files an issue already carries, with size, uploader and time", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");

  await expect(attachments.getByRole("heading", { name: /Attachments/ })).toBeVisible();
  const row = attachments.getByRole("button", { name: "Download login-500-trace.txt" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2.4 KB");
  await expect(row).toContainText("Anna Ivanova");
  await expect(attachments.getByRole("button", { name: "Download validation-error.png" })).toBeVisible();
});

test("states the limit and the accepted types before a file is chosen", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  // The list refuses more than people expect — no .docx, no GIF, no SVG,
  // nothing without an extension — so it is said up front rather than
  // discovered by being refused after choosing.
  const hint = attachments.locator(".attachment-hint");
  await expect(hint).toContainText("Up to 2 MB");
  await expect(hint).toContainText("JPEG, PNG or WebP images, PDF");
  await expect(hint).toContainText("ZIP");
  await expect(attachments.getByText("No attachments yet")).toBeVisible();
});

test("uploads a file through all three legs and keeps it across a remount", async ({ page }) => {
  await signIn(page);
  let attachments = await openIssuePanel(page, "TAS-102");

  await attach(page, "handover-notes.txt", "one\ntwo\nthree\n");

  await expect(attachments.getByRole("button", { name: "Download handover-notes.txt" })).toBeVisible();
  await expect(attachments.getByText("No attachments yet")).toHaveCount(0);

  // The row survives a refetch, which is what tells "the confirm landed" from
  // "the cache was written".
  attachments = await reopenIssuePanel(page, "TAS-102");
  await expect(attachments.getByRole("button", { name: "Download handover-notes.txt" })).toBeVisible();

  // And the activity feed carries the event the same write produced, in a
  // sentence about attaching rather than the catch-all "updated this issue".
  await expect(page.locator(".activity")).toContainText("attached handover-notes.txt");
});

test("refuses a file the server's allowlist would refuse, without uploading anything", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  // The `.zip` several Windows browsers report as `application/x-zip-compressed`
  // rather than `application/zip`. Same bytes, same extension, refused — because
  // the server compares the exact string. The picker's `accept` filter cannot
  // catch this, which is why the refusal is here as well.
  await page.locator(".attachment-input").setInputFiles({
    name: "bundle.zip",
    mimeType: "application/x-zip-compressed",
    buffer: Buffer.from("PK"),
  });

  // Named, and in a sentence — the refusal this side produces says which file
  // and which types would have worked, rather than repeating the MIME string
  // the server would have answered with.
  await expect(
    attachments.getByText("bundle.zip is not a type this issue accepts. Attach JPEG, PNG or WebP images"),
  ).toBeVisible();
  await expect(attachments.getByRole("button", { name: "Download bundle.zip" })).toHaveCount(0);
  await expect(attachments.getByText("No attachments yet")).toBeVisible();
});

test("names a blocked cross-origin upload as a network or CORS problem", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  // The mock's stand-in for a refused preflight: `fetch` rejects with no
  // response and no status, which is all the browser will ever tell script.
  // "Upload failed" would be true and useless; the panel has to say where the
  // request was going and why nothing here can fix it.
  await attach(page, "cors-blocked.txt");

  const message = attachments.locator(".attachment-note.is-error");
  await expect(message).toContainText("could not reach the file store");
  await expect(message).toContainText("straight to storage rather than through Taska");
  await expect(attachments.getByText("No attachments yet")).toBeVisible();
});

test("reads an expired upload link as expired rather than as a permission failure", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  // A presigned link lasts fifteen minutes from the moment the file is chosen.
  // The store answers 403 for a stale signature — the same status a gateway
  // uses for "not yours", about an entirely different thing.
  await attach(page, "expired-link.txt");

  await expect(attachments.locator(".attachment-note.is-error")).toContainText("15 minutes from the moment the file is chosen");
});

test("re-reads the list after a failed confirm instead of claiming the file was lost", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  // Legs 1 and 2 succeed and leg 3 fails, so the bytes are in the bucket with
  // no row pointing at them. Nothing sweeps that and the delete route is a soft
  // delete that never touches storage, so the panel says the file was not
  // attached and claims no tidying up.
  await attach(page, "confirm-fails.txt");

  await expect(attachments.locator(".attachment-note.is-error")).toContainText("confirm-fails.txt was not attached");
  await expect(attachments.getByRole("button", { name: "Download confirm-fails.txt" })).toHaveCount(0);
  await expect(attachments.getByText("No attachments yet")).toBeVisible();
});

test("asks for a fresh download link and opens it away from the app", async ({ page }) => {
  // Installed **before** the first navigation, which is the only time an init
  // script gets a chance to run: everything after the sign-in is client-side
  // routing inside one document.
  //
  // `window.open` is recorded rather than allowed: the link points at a
  // presigned S3 host nothing in this suite serves, so letting a tab open would
  // assert on a failed navigation instead of on the link that was handed over.
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.defineProperty(window, "__openedUrls", { value: opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null as unknown as Window;
    };
  });

  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");
  await attachments.getByRole("button", { name: "Download login-500-trace.txt" }).click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls))
    .toEqual([expect.stringContaining("X-Amz-Signature=")]);

  // The stub returns null, which is exactly what a popup blocker returns, so
  // the row offers the link as something to click instead of swallowing it.
  await expect(attachments.getByRole("link", { name: "Open" })).toBeVisible();
});

test("downloads from the keyboard", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.defineProperty(window, "__openedUrls", { value: opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return {} as Window;
    };
  });

  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");
  const row = attachments.getByRole("button", { name: "Download login-500-trace.txt" });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls.length))
    .toBe(1);
});

test("an admin removes any attachment and it stays gone", async ({ page }) => {
  await signIn(page);
  let attachments = await openIssuePanel(page, "TAS-101");

  // Mark uploaded this one; Anna is the project's ADMIN, and
  // `delete-attachment-roles: ADMIN` is what lets her remove it.
  await attachments.getByRole("button", { name: "Delete validation-error.png" }).click();
  await expect(attachments.getByRole("button", { name: "Download validation-error.png" })).toHaveCount(0);

  attachments = await reopenIssuePanel(page, "TAS-101");
  await expect(attachments.getByRole("button", { name: "Download validation-error.png" })).toHaveCount(0);
  await expect(attachments.getByRole("button", { name: "Download login-500-trace.txt" })).toBeVisible();
  await expect(page.locator(".activity")).toContainText("removed validation-error.png");
});

test("a member is offered a delete on their own file and on nobody else's", async ({ page }) => {
  // Mark is a MEMBER of Taska Platform, not its ADMIN. Two rules apply on one
  // list: `delete-own-attachment-roles` (ADMIN, MEMBER) for his own file and
  // `delete-attachment-roles` (ADMIN) for Anna's.
  await signIn(page, "mark@example.com");
  const attachments = await openIssuePanel(page, "TAS-101");

  await expect(attachments.getByRole("button", { name: "Delete validation-error.png" })).toBeVisible();
  await expect(attachments.getByRole("button", { name: "Delete login-500-trace.txt" })).toHaveCount(0);
  // Uploading is `upload-attachment-roles: ADMIN,MEMBER`, so he keeps that.
  await expect(attachments.getByRole("button", { name: /Attach a file/ })).toBeVisible();
});

test("a viewer reads the files and is offered neither upload nor delete", async ({ page }) => {
  // Anna is not a member of the Mobile project, so the mock answers VIEWER.
  // The board is reachable by URL on purpose: hiding a control is a courtesy
  // and the server stays the authority.
  await signIn(page);
  await page.goto(`/projects/${MOB_PROJECT_ID}/board`);
  await page.locator(".issue-card", { hasText: "MOB-5" }).click();
  await expect(page.getByRole("complementary", { name: "MOB-5 issue" })).toBeVisible();

  const attachments = page.locator(".issue-attachments");
  await expect(attachments.getByRole("button", { name: "Download crash-report.json" })).toBeVisible();
  await expect(attachments.getByRole("button", { name: /Attach a file/ })).toHaveCount(0);
  await expect(attachments.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  await expect(attachments.locator(".attachment-hint")).toHaveCount(0);
});
