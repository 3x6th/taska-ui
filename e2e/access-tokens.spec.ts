import { expect, test, type Page } from "@playwright/test";

/**
 * Settings → Access tokens (TAS-412): create a token, see its value once with
 * the Claude Code snippet carrying it, copy it, close — and find nothing of it
 * left in the page or in browser storage — then revoke a token through its
 * question.
 *
 * Mock-backed like every spec here (playwright.config.ts), which also sets
 * `VITE_TASKA_MCP_URL` to an address nothing listens on: the snippets only
 * print it. Any seeded user signs in with any password; Anna's account is
 * seeded with two tokens. No gateway serves these routes yet, so this is
 * evidence about the UI against the mock, never about the server.
 */
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const MCP_URL = "http://localhost:8087/mcp";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** Everything the page and the browser hold for this origin, as one string to search. */
const everythingHeld = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify({
      html: document.documentElement.outerHTML,
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
      url: window.location.href,
    }),
  );

test("creates a token, shows it once, and revokes one through its question", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Open profile/ }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Access tokens" }).click();
  await expect(page).toHaveURL(/\/settings\/tokens$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Access tokens/);

  const list = page.getByRole("list", { name: "Your access tokens" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  // The page's own snippet has the placeholder, never a token.
  await expect(page.locator(".mcp-snippet-code")).toHaveText(
    `claude mcp add --transport http --scope user taska ${MCP_URL} --header "Authorization: Bearer YOUR_TOKEN"`,
  );
  // In the product's mono, not the browser's `code` default (Courier).
  const snippetType = await page.locator(".mcp-snippet-code code").evaluate((code) => {
    const style = getComputedStyle(code);
    return { family: style.fontFamily, size: style.fontSize };
  });
  expect(snippetType).toEqual({ family: '"IBM Plex Mono", ui-monospace, monospace', size: "12px" });

  await page.getByRole("button", { name: "Create token" }).click();
  const form = page.getByRole("dialog", { name: "New access token" });
  await form.getByLabel("Name").fill("Cursor on laptop");
  await form.getByRole("radio", { name: "Read and write" }).check();
  await form.getByRole("button", { name: "90 days" }).click();
  await form.getByRole("button", { name: "Create token" }).click();

  const shown = page.getByRole("dialog", { name: "Token created" });
  await expect(shown.getByRole("heading", { name: "Token created" })).toBeFocused();
  await expect(shown.getByText("Copy this token now. Taska shows it only once.")).toBeVisible();
  const secret = await shown.getByLabel("Cursor on laptop").inputValue();
  expect(secret).toMatch(/^tsk_pat_[0-9A-Za-z]{32}$/);
  await expect(shown.locator(".mcp-snippet-code")).toHaveText(
    `claude mcp add --transport http --scope user taska ${MCP_URL} --header "Authorization: Bearer ${secret}"`,
  );

  await shown.getByRole("button", { name: "Copy token" }).click();
  await expect(shown.getByText("Token copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);

  await shown.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The new row, by its prefix only; the value is nowhere.
  const created = list.getByRole("listitem").filter({ hasText: "Cursor on laptop" });
  await expect(created).toContainText(`${secret.slice(0, 12)}…`);
  await expect(created).toContainText("Read and write");
  await expect(list.getByRole("listitem")).toHaveCount(3);
  expect(await everythingHeld(page)).not.toContain(secret);

  // Revoke, through the question.
  const row = list.getByRole("listitem").filter({ hasText: "Weekly report script" });
  await row.getByRole("button", { name: "Revoke Weekly report script" }).click();
  await expect(row.getByRole("button", { name: "Cancel" })).toBeFocused();
  await row.getByRole("button", { name: "Revoke token" }).click();
  await expect(list.getByRole("listitem").filter({ hasText: "Weekly report script" })).toHaveCount(0);
  await expect(list.getByRole("listitem")).toHaveCount(2);
});

test("Esc holds the token's one showing until it is copied, then closes it, and the value goes with it", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/tokens");
  await page.getByRole("button", { name: "Create token" }).click();
  await page.getByRole("dialog", { name: "New access token" }).getByLabel("Name").fill("Script");
  await page.keyboard.press("Enter");

  const shown = page.getByRole("dialog", { name: "Token created" });
  const secret = await shown.getByLabel("Script").inputValue();
  expect(secret).not.toBe("");

  // Not copied yet: Esc keeps it (§4.11), with the value where it was.
  await page.keyboard.press("Escape");
  await expect(shown).toBeVisible();
  await expect(shown.getByLabel("Script")).toHaveValue(secret);

  // Copied by the snippet that carries it, Esc closes.
  await shown.getByRole("button", { name: "Copy the Claude Code command" }).click();
  await expect(shown.getByText("Command copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`Bearer ${secret}`);
  await shown.getByLabel("Script").focus();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create token" })).toBeFocused();
  expect(await everythingHeld(page)).not.toContain(secret);
});
