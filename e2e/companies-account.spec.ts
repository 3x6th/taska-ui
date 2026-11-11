import { expect, test, type Page } from "@playwright/test";
import { B2B, COMPANY, companyPath, companyRow, inCompany, setHooks, signIn } from "./companiesFixtures";

/*
 * TAS-527 against the companies build (art-director's evidence E1–E12 where a
 * suite can hold them; api-contract-guard §3, §6, §8): the reset from the
 * sign-in card by an emailed link, Settings › Account's email change by code
 * and password change, the new address in every tab of the account, and
 * nothing of a token, a code or a password left in the browser's storage.
 *
 * The mail is the companies mock's stand-in inbox, `taska.mockMailbox.v1`,
 * read here and only here (`page.evaluate`) — nothing in the app reads it.
 */

const MAILBOX = "taska.mockMailbox.v1";
const PASSWORD = "a long new password";

interface Mail {
  to: string;
  kind: "PASSWORD_RECOVERY" | "EMAIL_CHANGE_CODE";
  link?: string;
  code?: string;
}

const mailbox = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "[]") as Mail[], MAILBOX);

/** The newest mail of a kind, waited for. */
async function lastMail(page: Page, kind: Mail["kind"]): Promise<Mail> {
  await expect.poll(async () => (await mailbox(page)).filter((mail) => mail.kind === kind).length).toBeGreaterThan(0);
  const box = await mailbox(page);
  return box.filter((mail) => mail.kind === kind).at(-1) as Mail;
}

/** Everything the browser keeps for this origin but the stand-in inbox — where a mail would be. */
const storedOutsideTheInbox = (page: Page) =>
  page.evaluate((inbox) => {
    const dump = (storage: Storage) =>
      Object.keys(storage)
        .filter((key) => key !== inbox)
        .map((key) => `${key}=${storage.getItem(key)}`)
        .join("\n");
    return `${dump(window.localStorage)}\n${dump(window.sessionStorage)}`;
  }, MAILBOX);

async function requestLink(page: Page, email: string) {
  await page.goto(`${B2B}/forgot-password`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
}

/** Signs in with a password the mock checks (once TAS-527 has set one). */
async function signInWith(page: Page, email: string, password: string) {
  await page.goto(`${B2B}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator("form button[type=submit]").click();
}

async function openAccount(page: Page) {
  await page.goto(companyPath(COMPANY.northwind, "/settings/account"));
  await expect(page.getByRole("heading", { level: 1, name: /Account/ })).toBeVisible();
  // The account has answered: the rows are as they stay.
  await expect(page.locator(".settings-account-email")).toBeVisible();
}

test.describe("the sign-in card's way to a reset (E1)", () => {
  test("the companies build: a ghost link in the hint's slot, to /forgot-password with the typed address", async ({ page }) => {
    await page.goto(`${B2B}/login`);
    await expect(page.getByText("Taska has no password reset yet.", { exact: false })).toHaveCount(0);
    await page.getByLabel("Email").fill("anna@example.com");
    const link = page.getByRole("link", { name: "Forgot your password?" });
    await expect(link).toHaveAttribute("href", "/forgot-password");
    await link.click();
    await expect(page).toHaveURL(`${B2B}/forgot-password`);
    await expect(page.getByLabel("Email")).toHaveValue("anna@example.com");
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("today's build: /login as it was — the old hint, no link, and no reset route", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Forgot your password? Taska has no password reset yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveCount(0);
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("the reset by an emailed link (AC: recovery never says whether an account exists)", () => {
  test("E3: an unknown and an existing address get the same view, byte for byte but the address; only the existing gets mail", async ({ page }) => {
    const views: string[] = [];
    for (const email of ["nobody@nowhere.test", "anna@example.com"]) {
      await requestLink(page, email);
      views.push(
        (await page.locator(".auth-card").innerHTML())
          .replaceAll(email, "{email}")
          .replace(/\d+:\d\d/g, "m:ss")
          .replace(/(id|aria-describedby)="[^"]*"/g, ""),
      );
    }
    expect(views[1]).toBe(views[0]);
    expect((await mailbox(page)).map((mail) => mail.to)).toEqual(["anna@example.com"]);
  });

  test("E4: the link opens the form with the token out of the address, sets the password, signs this browser out, and lands on /login", async ({ page }) => {
    // A session in this browser, inside a company — the lead says it is one of them.
    await inCompany(page, "Northwind", COMPANY.northwind);
    await requestLink(page, "anna@example.com");
    const { link } = await lastMail(page, "PASSWORD_RECOVERY");
    const token = new URL(link ?? "").searchParams.get("token") ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.goto(link ?? "");
    await expect(page).toHaveURL(`${B2B}/reset-password`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
    await expect(
      page.getByText(
        "Setting a new password signs you out of Taska on every device, this browser included. It also revokes your access tokens and disconnects your connected apps.",
      ),
    ).toBeVisible();
    // Signed in here, `/login` goes on into the app, and the ghost says so (N3).
    await expect(page.getByRole("link", { name: "Back to Taska" })).toHaveAttribute("href", "/login");
    await expect(page.getByLabel("New password")).toBeFocused();
    // The invitation's capture never saw it: no invite form, no preview.
    await expect(page.getByRole("tab")).toHaveCount(0);
    expect(await storedOutsideTheInbox(page)).not.toContain(token);

    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByLabel("New password")).toHaveAccessibleDescription("Enter a new password.");
    await page.getByLabel("New password").fill("short");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("alert")).toHaveText("The new password must be 12 to 128 characters.");
    await expect(page.getByLabel("New password")).toHaveAttribute("aria-invalid", "true");

    // Nothing but the form in flight between the press and `/login`, through the 204 and the sign-out (B1).
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seenTexts: string[] }).seenTexts = seen;
      new MutationObserver(() => seen.push(document.body.innerText)).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByLabel("New password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(`${B2B}/login`);
    const texts = await page.evaluate(() => (window as unknown as { seenTexts: string[] }).seenTexts);
    expect(texts.some((text) => text.includes("Open the link from your email again"))).toBe(false);
    expect(texts.some((text) => text.includes("Setting password"))).toBe(true);
    const notice = page.getByText("Password reset. Sign in with your email and new password.");
    await expect(notice).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Password reset. Sign in with your email and new password.");
    expect(await page.evaluate(() => window.localStorage.getItem("taska.webSession"))).toBeNull();
    const stored = await storedOutsideTheInbox(page);
    for (const secret of [token, PASSWORD]) expect(stored).not.toContain(secret);

    // The old password (any, until now) no longer signs in; the new one does.
    await page.getByLabel("Email").fill("anna@example.com");
    await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("alert")).toContainText("Invalid credentials");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/companies$|\/c\//);
  });

  test("E5: a link used once, one expired, one malformed — the one dead-link sentence, focused; a reload asks for the link again", async ({ page }) => {
    await requestLink(page, "anna@example.com");
    const { link } = await lastMail(page, "PASSWORD_RECOVERY");
    await page.goto(link ?? "");
    await page.getByLabel("New password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(`${B2B}/login`);

    const dead = "This reset link no longer works: it expired or was already used. If you asked for more than one link, open the newest, or request a new one.";
    const expectDead = async () => {
      await expect(page.getByText(dead)).toBeVisible();
      await expect(page.locator(".auth-refusal-block")).toBeFocused();
      await expect(page.getByLabel("New password")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
    };
    // Used.
    await page.goto(link ?? "");
    await page.getByLabel("New password").fill("another long password");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expectDead();

    // Expired: past its 15 minutes on the mock's clock.
    await requestLink(page, "anna@example.com");
    const second = await lastMail(page, "PASSWORD_RECOVERY");
    await setHooks(page, { clockOffsetMs: 16 * 60_000 });
    await page.goto(second.link ?? "");
    await page.getByLabel("New password").fill("another long password");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expectDead();
    await setHooks(page, null);

    // Malformed: the server's `token` violation is the same dead link.
    await page.goto(`${B2B}/reset-password?token=too-short`);
    await expect(page).toHaveURL(`${B2B}/reset-password`);
    await page.getByLabel("New password").fill("another long password");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expectDead();

    // A reload: the token was in memory only.
    await page.reload();
    await expect(page.getByText("Open the link from your email again to choose a new password.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  });

  test("E2/E3: a 429 says the wait; Resend opens after the wait, says it in the status, and counts again", async ({ page }) => {
    await page.goto(`${B2B}/forgot-password`);
    await setHooks(page, { refuseNext: { requestPasswordRecovery: { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 42 } } });
    await page.getByLabel("Email").fill("anna@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again in 42 seconds.");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    const resend = page.getByRole("button", { name: "Resend link" });
    await expect(resend).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".auth-hint")).toContainText("You can resend in");
    // The rest of the minute, skipped on the page's clock.
    await page.clock.install();
    await page.clock.fastForward(61_000);
    await expect(page.locator(".auth-hint")).toHaveText("Didn’t get it? Check your spam folder, then resend.", { timeout: 10_000 });
    await expect(resend).not.toHaveAttribute("aria-disabled");
    await resend.click();
    await expect(page.getByRole("status")).toHaveText(
      "If anna@example.com belongs to a Taska account, we’ve sent another link there. Open it to choose a new password.",
    );
    await expect(resend).toBeFocused();
    await expect(page.locator(".auth-hint")).toContainText("You can resend in");
    expect((await mailbox(page)).filter((mail) => mail.kind === "PASSWORD_RECOVERY")).toHaveLength(2);
  });
});

test.describe("Settings › Account (AC: the profile is updated in every company tab)", () => {
  test("E10: the email change by code shows the new address in every tab of the account without a reload; it signs in, the old one does not", async ({
    context,
    isMobile,
  }) => {
    test.skip(isMobile, "the tabs are the desktop reader's; the flow is the same at every width");
    const a = await context.newPage();
    await inCompany(a, "Northwind", COMPANY.northwind);
    const b = await context.newPage();
    await b.goto(companyPath(COMPANY.globex, "/settings/profile"));
    await expect(b.locator(".settings-profile-email")).toHaveText("anna@example.com");
    await expect(b.locator("#notification-email-description")).toHaveText("anna@example.com");
    const c = await context.newPage();
    await c.goto(`${B2B}/companies`);
    await expect(c.getByText("Signed in as anna@example.com")).toBeVisible();

    await openAccount(a);
    await a.getByRole("button", { name: "Change email" }).click();
    await expect(a.getByLabel("New email")).toBeFocused();
    await a.getByLabel("New email").fill("sofia@example.com");
    await a.getByLabel("Current password", { exact: true }).fill("anything");
    await a.getByRole("button", { name: "Send code" }).click();
    // An address in use: no sentence of the client's (A100).
    await expect(a.getByRole("alert")).toHaveText("Your email was not changed.");
    await a.getByLabel("New email").fill("anna.new@example.com");
    await a.getByRole("button", { name: "Send code" }).click();
    await expect(a.getByLabel("Code")).toBeFocused();
    await expect(a.getByText(/^We sent a code to a•••@example\.com\. It works until /)).toBeVisible();
    // The password left memory with the 201.
    await expect(a.locator('input[type="password"]')).toHaveCount(0);

    const { code } = await lastMail(a, "EMAIL_CHANGE_CODE");
    const wrong = code === "00000000" ? "11111111" : "00000000";
    await a.getByLabel("Code").fill(wrong);
    await a.getByLabel("Code").press("Enter");
    await expect(a.getByRole("alert")).toHaveText("The code is not correct.");
    await expect(a.getByLabel("Code")).toHaveAttribute("aria-invalid", "true");
    await a.getByLabel("Code").fill(`${code?.slice(0, 4)}-${code?.slice(4)}`);
    await a.getByRole("button", { name: "Change email" }).click();
    await expect(a.getByRole("status").filter({ hasText: "Email changed." })).toHaveText("Email changed. Sign in with the new address from now on.");
    await expect(a.getByRole("button", { name: "Change email" })).toBeFocused();
    await expect(a.locator(".settings-account-email")).toHaveText("anna.new@example.com");

    // Every other tab of the account: no reload, no notice.
    await expect(b.locator(".settings-profile-email")).toHaveText("anna.new@example.com");
    await expect(b.locator("#notification-email-description")).toHaveText("anna.new@example.com");
    await expect(c.getByText("Signed in as anna.new@example.com")).toBeVisible();
    await b.getByRole("button", { name: /Open profile/ }).click();
    await expect(b.getByText("anna.new@example.com").first()).toBeVisible();

    const storage = await storedOutsideTheInbox(a);
    for (const secret of [code ?? "", "anything"]) expect(storage).not.toContain(secret);

    // The new address signs in; the old one signs in to nothing.
    await c.getByRole("button", { name: "Log out" }).click();
    await expect(c).toHaveURL(`${B2B}/login`);
    await signIn(c, "anna@example.com");
    await expect(c.getByRole("alert")).toContainText("Invalid credentials");
    await signIn(c, "anna.new@example.com");
    await expect(c).toHaveURL(/\/companies$|\/c\//);
  });

  test("E8: a dead code — out of attempts — is one sentence, focused; Start over returns to step 1 with the address kept", async ({ page }) => {
    await inCompany(page, "Northwind", COMPANY.northwind);
    await openAccount(page);
    await page.getByRole("button", { name: "Change email" }).click();
    await page.getByLabel("New email").fill("anna.new@example.com");
    await page.getByLabel("Current password", { exact: true }).fill("anything");
    await page.getByRole("button", { name: "Send code" }).click();
    // The challenge exists before the clock moves past its ten minutes.
    await expect(page.getByLabel("Code")).toBeFocused();
    await setHooks(page, { clockOffsetMs: 11 * 60_000 });
    await page.getByLabel("Code").fill("12345678");
    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page.locator(".settings-account-dead")).toBeFocused();
    await expect(page.getByText("This code can’t be used any more. Start over to get a new one.")).toBeVisible();
    await setHooks(page, null);
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel("New email")).toHaveValue("anna.new@example.com");
    await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
  });

  test("E9: the password change — a wrong current password in the server's words, then the new one, which signs in", async ({ page }) => {
    await inCompany(page, "Northwind", COMPANY.northwind);
    await openAccount(page);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
    await page.getByLabel("Current password", { exact: true }).fill("anything");
    await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Password changed." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password" })).toBeFocused();

    // Now the server checks it: a wrong one is a violation, never a sign-out.
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel("Current password", { exact: true }).fill("not it");
    await page.getByLabel("New password", { exact: true }).fill("another long password");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert")).toHaveText("The current password is not correct.");
    await expect(page.getByLabel("Current password", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(companyPath(COMPANY.northwind, "/settings/account"));
    expect(await storedOutsideTheInbox(page)).not.toContain(PASSWORD);

    // This browser stays signed in (the family that sent it); a new sign-in takes only the new password.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.evaluate(() => window.localStorage.removeItem("taska.webSession"));
    await signInWith(page, "anna@example.com", PASSWORD);
    await expect(page).toHaveURL(/\/companies$|\/c\//);
  });

  test("«Forgot your current password?» leaves the company for /forgot-password with the account's address", async ({ page }) => {
    await inCompany(page, "Northwind", COMPANY.northwind);
    await openAccount(page);
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByRole("link", { name: "Forgot your current password?" }).click();
    await expect(page).toHaveURL(`${B2B}/forgot-password`);
    await expect(page.getByLabel("Email")).toHaveValue("anna@example.com");
    // Signed in, the page works all the same: a reset link may be asked for from anywhere.
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("E12: at 390 every control of the section answers a 44 target", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the ≤820 rule");
    await inCompany(page, "Northwind", COMPANY.northwind);
    await openAccount(page);
    await page.getByRole("button", { name: "Change password" }).click();
    const targets = await page.evaluate(() => {
      const hit = (element: Element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        // Half a pixel inside the edge of a 44 target centred on the control.
        const top = box.top + box.height / 2 - 21.5;
        const bottom = box.top + box.height / 2 + 21.5;
        const at = (y: number) => {
          const found = document.elementFromPoint(x, y);
          return found === element || element.contains(found);
        };
        return { name: element.textContent?.trim() || element.getAttribute("aria-label"), ok: at(top) && at(bottom) };
      };
      return [
        ...document.querySelectorAll(".settings-account-actions button, .settings-account-trigger, .settings-account-form .password-toggle, .settings-account-forgot"),
      ].map(hit);
    });
    expect(targets.length).toBeGreaterThan(4);
    expect(targets.filter((target) => !target.ok)).toEqual([]);
  });
});

test("the companies picker reaches Settings › Account second in the rail, for a member as for an owner", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail's order is the same strip below 900");
  await signIn(page, "anna@example.com");
  await companyRow(page, /^Globex/).click();
  await page.goto(companyPath(COMPANY.globex, "/settings/profile"));
  const rail = page.getByRole("navigation", { name: "Settings" });
  await expect(rail.getByRole("link").nth(1)).toHaveText("Account");
  await rail.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(companyPath(COMPANY.globex, "/settings/account"));
  await expect(page.getByRole("button", { name: "Change email" })).toBeVisible();
});
