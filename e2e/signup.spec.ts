import { expect, test, type Page } from "@playwright/test";

/**
 * Sign-up by email (TAS-426, DESIGN.md §4.31) against MockTaskaApi, whose
 * `GET /auth/methods` is open by default (`taska.mockAuthMethods`, unset) — the
 * opposite of the stand, which answered `{signupEnabled: false, providers: []}`
 * on 2026-10-27, and which the last cases here pin as today's card.
 *
 * The link a sign-up sends is an invitation link; its preview says `SIGNUP`
 * for an account the sign-up made (the kind is the account's origin, not the
 * link's). The mock seeds one — Sam's, `MOCK_INVITE_TOKENS.signup` — since a
 * sign-up made here mints a token nobody can read, as the server's does.
 */

const SIGNUP_TOKEN = "gQOaiiI6BL8jx1CHrQ1kzPQRAzHbAtOTZKrnl1P0EsA";
const STRONG = "Correct-horse-1";
const METHODS_KEY = "taska.mockAuthMethods";
const CLOSED = { signupEnabled: false, providers: [] };

async function openCreateAccount(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
}

test("an invisible-only signup name stays in Name, and a corrected name with FORMAT can continue", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openCreateAccount(page);
  const name = page.getByLabel("Name", { exact: true });
  await name.fill(String.fromCodePoint(0x200b, 0xfeff, 0x2060));
  await page.getByLabel("Email").fill("format.name@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(name).toHaveAccessibleDescription("Enter a name.");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);

  await name.fill(`Rosa${String.fromCodePoint(0x200c)} Diaz`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
});

test("Create account sends the request, says «Check your email», and Resend opens after the minute", async ({ page }) => {
  await page.clock.install();
  await openCreateAccount(page);
  await page.getByLabel("Name").fill("Rosa Diaz");
  await page.getByLabel("Email").fill("rosa@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  const title = page.getByRole("heading", { name: "Check your email" });
  await expect(title).toBeFocused();
  await expect(
    page.getByText("If rosa@example.com can be used for a new Taska account, we’ve sent a link there. Open it to choose your password."),
  ).toBeVisible();
  // No provider buttons here, and the tabs stay two.
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(2);

  const resend = page.getByRole("button", { name: "Resend link" });
  await expect(resend).toHaveAttribute("aria-disabled", "true");
  await expect(resend).toHaveCSS("opacity", "0.58");
  await expect(resend).toHaveAccessibleDescription(/^You can resend in [01]:\d\d\.$/);
  // A press while it waits sends nothing: still «Check your email», no status.
  await resend.click({ force: true });
  await expect(page.locator(".signup-sent [role='status']")).toHaveText("");

  await page.clock.fastForward("01:01");
  await expect(resend).toHaveAccessibleDescription("Didn’t get it? Check your spam folder, then resend.");
  await expect(resend).not.toHaveAttribute("aria-disabled");

  await resend.click();
  await expect(page.locator(".signup-sent [role='status']")).toHaveText(
    "If rosa@example.com can be used for a new Taska account, we’ve sent another link there. Open it to choose your password.",
  );
  await expect(page.getByText(/we’ve sent another link there/).first()).toBeVisible();
  await expect(resend).toHaveAttribute("aria-disabled", "true");
  await expect(resend).toHaveAccessibleDescription(/^You can resend in [01]:\d\d\.$/);

  // Back to the form with both values, the address ready to retype.
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveValue("rosa@example.com");
  await expect(page.getByLabel("Name")).toHaveValue("Rosa Diaz");
  // The same address within its minute is refused by the server, said with the wait.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText(/^Too many attempts\. Try again in \d+ seconds\.$/);
});

test("a sign-up refused because sign-up was switched off meanwhile says so and takes the tab away", async ({ page }) => {
  await openCreateAccount(page);
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [METHODS_KEY, JSON.stringify(CLOSED)]);
  await page.getByLabel("Name").fill("Rosa Diaz");
  await page.getByLabel("Email").fill("rosa@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  // The methods are read again: Create account goes and Sign in opens. The
  // refusal would have gone with the form, so its sentence moves above the
  // tabs — not live again, the alert already said it — and focus goes to it
  // rather than to the Sign in tab.
  await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab")).toHaveText(["Sign in", "Accept invite"]);
  const notice = page.locator(".auth-refusal");
  await expect(notice).toHaveText("Taska isn’t open for new accounts right now. Ask a Taska admin to invite you.");
  await expect(notice).toBeFocused();
  await expect(notice).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sign in" })).not.toBeFocused();

  // Gone with the next tab change.
  await page.getByRole("tab", { name: "Accept invite" }).click();
  await expect(notice).toHaveCount(0);
});

test("a sign-up link lands on the invite tab worded as finishing an account, and the account signs in under the typed name", async ({
  page,
}) => {
  await page.goto(`/?token=${SIGNUP_TOKEN}`);

  await expect(page).toHaveURL(/\/invite$/);
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
  await expect(page.getByText("Confirm your name and choose a password.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("sam@example.com");
  await expect(page.getByText("Link expired? Create your account again to get a new one.")).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Sam O.");
  await page.getByLabel("New password").fill(STRONG);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password", { exact: true }).fill(STRONG);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("button", { name: "Open profile for Sam O." })).toBeVisible();
  // An account nobody added to a project.
  await expect(page.getByText("0 projects · Sam O.")).toBeVisible();
});

test("the sign-up link's words swap in place: the card does not move on a phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the ruling's 390");
  /** The card's box once the preview has answered, after the fonts are in. */
  const cardBox = async (token: string, email: string) => {
    await page.goto(`/?token=${token}`);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    // After the fonts and the card's entrance (`tk-pop`, 500 ms), which moves it.
    return page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().map((animation) => animation.finished));
      const { top, height } = document.querySelector(".auth-card")!.getBoundingClientRect();
      return { top, height };
    });
  };

  const signup = await cardBox(SIGNUP_TOKEN, "sam@example.com");
  const invitation = await cardBox("Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM", "leo@example.com");

  expect(Math.abs(signup.height - invitation.height)).toBeLessThan(0.5);
  expect(Math.abs(signup.top - invitation.top)).toBeLessThan(0.5);
});

test.describe("with sign-up off and no providers, as on the stand", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [METHODS_KEY, JSON.stringify(CLOSED)],
    );
  });

  test("/login and /invite are today's card: Sign in and Accept invite, no Create account, no provider button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("tab")).toHaveText(["Sign in", "Accept invite"]);
    await expect(page.getByText("Create account")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.locator(".auth-divider")).toHaveCount(0);

    await page.goto("/invite");
    await expect(page.getByRole("tab")).toHaveText(["Sign in", "Accept invite"]);
    await expect(page.getByRole("link")).toHaveCount(0);
  });
});
