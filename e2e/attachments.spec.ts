import { expect, test, type Locator, type Page } from "@playwright/test";

// Mock-backed like every spec here (playwright.config.ts starts the server with
// VITE_TASKA_API_MODE=mock): any seeded user signs in with any password.
//
// The five gateway routes merged with backend PR #147 and are deployed — the
// list route answered Spring's static-resource 404 on 2026-09-06 and `401`
// without a token on 2026-09-16 — but the *middle* leg of an upload never
// touches the gateway: the browser PUTs the bytes straight to an S3-compatible
// store whose only checked-in address is `http://127.0.0.1:9000` and for which
// nothing in the backend repository configured CORS when PR #147 was read at
// its head `f53dca38`. So nothing below is evidence about a server. It pins
// what the UI does with each answer, and the answers come from
// `MockTaskaStore`.
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
  // Addressed by class, not by role and name: since TAS-148 an ADMIN's card
  // carries an "Edit <name>" button of its own, and a loose match on the
  // project's name finds both.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
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
  const row = attachments.getByRole("button", { name: "Open login-500-trace.txt in a new tab" });
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

/**
 * The store is `http://127.0.0.1:9000` in mock mode and nothing serves it, so
 * every request a test's tab makes there is answered here, in the browser
 * context, and never leaves the machine. The app itself never fetches it: the
 * mock answers `getAttachmentBytes` from memory.
 */
async function serveStore(page: Page) {
  await page.context().route("http://127.0.0.1:9000/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "stand-in store" }),
  );
}

test("opens a file in a new tab from the store's link, and says nothing about a blocker", async ({ page }) => {
  await serveStore(page);
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");

  // A real popup this time, not a stub: the defect was a false "blocked"
  // notice over a tab that had in fact opened (TAS-253).
  const [tab] = await Promise.all([
    page.waitForEvent("popup"),
    attachments.getByRole("button", { name: "Open login-500-trace.txt in a new tab" }).click(),
  ]);
  await expect.poll(() => tab.url()).toContain("X-Amz-Signature=");
  expect(tab.url()).toContain("http://127.0.0.1:9000/taska-attachments/");
  // Cut from the page that opened it, so a store page cannot reach back.
  expect(await tab.evaluate(() => window.opener)).toBeNull();

  await expect(attachments.getByText(/did not open a tab/)).toHaveCount(0);
  await expect(attachments.getByRole("link", { name: "Open" })).toHaveCount(0);
});

test("offers the link when the browser genuinely refuses the tab", async ({ page }) => {
  // `null` from `window.open` without `noopener` is what a popup blocker
  // returns, and the only case the fallback is for.
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");
  await attachments.getByRole("button", { name: "Open login-500-trace.txt in a new tab" }).click();

  await expect(attachments.getByRole("link", { name: "Open" })).toHaveAttribute("href", /X-Amz-Signature=/);
  await expect(attachments.locator(".attachment-note")).toContainText(
    "Your browser did not open a tab for login-500-trace.txt. Use the Open link beside it.",
  );
});

test("downloads a file under its own name, with the bytes that were uploaded", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");
  await attach(page, "handover-notes.txt", "one\ntwo\nthree\n");
  const download = attachments.getByRole("button", { name: "Download handover-notes.txt" });
  await expect(download).toBeVisible();

  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("handover-notes.txt");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("one\ntwo\nthree\n");
  await expect(attachments.locator(".attachment-note")).toHaveCount(0);
});

test("downloads from the keyboard", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-101");
  const button = attachments.getByRole("button", { name: "Download login-500-trace.txt" });
  await button.focus();
  await expect(button).toBeFocused();

  const [file] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect(file.suggestedFilename()).toBe("login-500-trace.txt");
  // Focus stays on the control the reader pressed.
  await expect(button).toBeFocused();
});

test("opens the file instead, as information, when the store will not hand over its bytes", async ({ page }) => {
  await serveStore(page);
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");
  // The mock's byte GET fails with no response for this name — the shape a
  // store whose CORS does not allow the GET would give.
  await attach(page, "download-blocked.txt");
  const download = attachments.getByRole("button", { name: "Download download-blocked.txt" });
  await expect(download).toBeVisible();

  const [tab] = await Promise.all([page.waitForEvent("popup"), download.click()]);
  await expect.poll(() => tab.url()).toContain("X-Amz-Signature=");
  const note = attachments.locator(".attachment-note");
  await expect(note).toContainText("could not be saved directly, so it opened in a new tab instead");
  await expect(note).not.toHaveClass(/is-error/);
});

/** Drops files on the section the way a desktop drag does. */
async function dropFiles(attachments: Locator, files: { name: string; type: string; body: string }[]) {
  const dataTransfer = await attachments.page().evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const file of list) transfer.items.add(new File([file.body], file.name, { type: file.type }));
    return transfer;
  }, files);
  await attachments.dispatchEvent("dragenter", { dataTransfer });
  await expect(attachments).toHaveClass(/is-drop-target/);
  await expect(attachments.locator(".attachment-drop-overlay")).toHaveText("Drop to attach");
  await attachments.dispatchEvent("dragover", { dataTransfer });
  await attachments.dispatchEvent("drop", { dataTransfer });
}

test("uploads dropped files one after another and refuses the type the server would", async ({ page }) => {
  await signIn(page);
  const attachments = await openIssuePanel(page, "TAS-102");

  await dropFiles(attachments, [
    { name: "dropped-one.txt", type: "text/plain", body: "1" },
    { name: "cat.gif", type: "image/gif", body: "GIF89a" },
    { name: "dropped-two.txt", type: "text/plain", body: "2" },
  ]);

  await expect(attachments).not.toHaveClass(/is-drop-target/);
  await expect(attachments.getByText(/cat\.gif is not a type this issue accepts/)).toBeVisible();
  await expect(attachments.getByRole("button", { name: "Download dropped-one.txt" })).toBeVisible();
  await expect(attachments.getByRole("button", { name: "Download dropped-two.txt" })).toBeVisible();
  await expect(attachments.getByRole("button", { name: "Download cat.gif" })).toHaveCount(0);

  // And they are real rows on the server, not a cache write.
  const reopened = await reopenIssuePanel(page, "TAS-102");
  await expect(reopened.getByRole("button", { name: "Download dropped-two.txt" })).toBeVisible();
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

  // A file dragged over a section that cannot take it draws no drop state,
  // and the drop is swallowed rather than letting the tab navigate to it.
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "nope.txt", { type: "text/plain" }));
    return transfer;
  });
  await attachments.dispatchEvent("dragenter", { dataTransfer });
  await expect(attachments).not.toHaveClass(/is-drop-target/);
  await attachments.dispatchEvent("drop", { dataTransfer });
  await expect(page).toHaveURL(new RegExp(`/projects/${MOB_PROJECT_ID}/`));
  await expect(attachments.getByRole("button", { name: "Download nope.txt" })).toHaveCount(0);
  await expect(attachments.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  await expect(attachments.locator(".attachment-hint")).toHaveCount(0);
});
