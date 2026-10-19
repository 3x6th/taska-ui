import { expect, test, type Page } from "@playwright/test";

// Accepting an invitation (TAS-208, DESIGN.md §4.27), against MockTaskaApi
// like every suite here. The email's link is `<accept-url>?token=…` — a query,
// never a fragment (backend #204) — and these cases land on it the way a reader
// does: by opening the address.
//
// The tokens are `MOCK_INVITE_TOKENS` in src/api/mock/MockTaskaApi.ts, the only
// ones anybody can accept: the server never returns a token, and neither does
// the mock's `inviteUser`. Leo's link works; Ivy's expired two days ago. The
// store is rebuilt on every page load, so each case spends a link once and
// checks the outcome in the same visit.
//
// Two servers (playwright.config.ts): the suite's own, path-routed at `/`, and
// one routed by the hash under `/taska-ui/`, the way the Pages build routes —
// the build the link was broken on, since its router never sees `?token=`.

const LEO_TOKEN = "Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM";
const IVY_TOKEN = "Iv7yPq2Wd9Lm4Xs8Tb1Nc6Hf3Rg5Ja0Ku2Ze7Oy9Qvw";
const PORT = Number(process.env.TASKA_E2E_PORT) || 5183;
const HASH_ROOT = `http://localhost:${PORT + 1}/taska-ui/`;

const STRONG = "Correct-horse-1";
const DEAD_LINK = /^This invitation link no longer works — it expired, was used, or was replaced by a newer one\./;

async function expectLandedOnInvite(page: Page) {
  await expect(page.getByRole("button", { name: "Accept invite" })).toHaveClass(/is-active/);
  // A captured token is never shown and never typed.
  await expect(page.getByLabel("Invitation token")).toHaveCount(0);
  await expect(page.getByText("Choose a password to activate your Taska account.")).toBeVisible();
  await expect(page.getByLabel("New password")).toBeFocused();
}

async function activate(page: Page, password = STRONG) {
  await page.getByLabel("New password").fill(password);
  await page.getByRole("button", { name: "Activate account" }).click();
}

test("the emailed link lands on the invite form with the token out of the address, and activation hands over to sign-in", async ({
  page,
}) => {
  await page.goto(`/login?token=${LEO_TOKEN}`);

  await expect(page).toHaveURL(/\/invite$/);
  expect(page.url()).not.toContain(LEO_TOKEN);
  await expectLandedOnInvite(page);
  // The false sentences TAS-208 was filed about are gone.
  await expect(page.getByText(/Taska Platform|12 characters|project admin/)).toHaveCount(0);

  // A weak password is the server's own sentence, the field is marked, what
  // was typed stays — and the link is not spent by it.
  await activate(page, "weakpassword");
  const refusal = page.getByRole("alert");
  await expect(refusal).toHaveText("Password must have at least 1 upper character");
  await expect(page.getByLabel("New password")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("New password")).toHaveValue("weakpassword");

  await activate(page);

  // No session from the activation: the sign-in form, a sentence, focus in Email.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByText("Forgot your password? Taska has no password reset yet.")).toBeVisible();

  // The link is single-use: pasted back whole into the form, it is refused.
  await page.getByRole("button", { name: "Accept invite" }).click();
  await page.getByLabel("Invitation token").fill(`https://taska.ozero.dev/?token=${LEO_TOKEN}`);
  await activate(page);
  await expect(page.getByRole("alert")).toHaveText(DEAD_LINK);

  // And the account it activated signs in like any other.
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("leo@example.com");
  await page.getByLabel("Password").fill(STRONG);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("an expired link is refused in the screen's own words, never as a session that died", async ({ page }) => {
  await page.goto(`/?token=${IVY_TOKEN}`);
  await expectLandedOnInvite(page);

  await activate(page);

  await expect(page.getByRole("alert")).toHaveText(DEAD_LINK);
  await expect(page.getByText("Invalid or expired token")).toHaveCount(0);
  await expect(page).toHaveURL(/\/invite$/);
});

test("a link opened under somebody else's session warns first, and signs out only when the reader activates", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/?token=${LEO_TOKEN}`);
  await expectLandedOnInvite(page);
  await expect(
    page.getByText("You’re signed in on this browser. Activating this invitation signs you out first."),
  ).toBeVisible();
  // Landing touched nothing: Anna is still signed in.
  expect(await page.evaluate(() => window.localStorage.getItem("taska.mockSession"))).not.toBeNull();

  await activate(page);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("taska.mockSession"))).toBeNull();
});

test("the new password can be shown and hidden again", async ({ page }) => {
  await page.goto(`/?token=${LEO_TOKEN}`);
  const field = page.getByLabel("New password");
  const toggle = page.getByRole("button", { name: "Show password" });

  await field.fill(STRONG);
  await expect(field).toHaveAttribute("type", "password");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveAttribute("type", "text");
  await toggle.press("Enter");
  await expect(field).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test.describe("on the hash-routed build", () => {
  test("the link's query lands on #/invite under the base, and activation on #/login", async ({ page }) => {
    await page.goto(`${HASH_ROOT}?token=${LEO_TOKEN}`);

    await expect(page).toHaveURL(`${HASH_ROOT}#/invite`);
    await expectLandedOnInvite(page);

    await activate(page);

    await expect(page).toHaveURL(`${HASH_ROOT}#/login`);
    await expect(page.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("a token in the hash's own query is taken the same way", async ({ page }) => {
    await page.goto(`${HASH_ROOT}#/invite?token=${LEO_TOKEN}`);

    await expect(page).toHaveURL(`${HASH_ROOT}#/invite`);
    await expectLandedOnInvite(page);
  });

  test("and one pasted into a running app, which changes only the hash, is taken too", async ({ page }) => {
    await page.goto(`${HASH_ROOT}#/login`);
    await expect(page.getByLabel("Email")).toBeVisible();

    await page.evaluate((token) => {
      window.location.hash = `#/invite?token=${token}`;
    }, LEO_TOKEN);

    await expect(page).toHaveURL(`${HASH_ROOT}#/invite`);
    await expect(page.getByLabel("Invitation token")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept invite" })).toHaveClass(/is-active/);
  });
});
