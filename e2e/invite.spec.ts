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
// one routed by the hash, the way the Pages build routes — the build the link
// was broken on, since its router never sees `?token=`. At base `/` since
// TAS-426, as the site is served.
//
// Sign-up is off and no provider is configured here, as on the stand
// (`GET /auth/methods` answered `{signupEnabled: false, providers: []}` on
// 2026-10-27): `/login` then keeps its Accept invite tab, which the first case
// goes back to. e2e/signup.spec.ts covers the card with sign-up open.

const LEO_TOKEN = "Lk3vQ9xW2mTz8RbN4cYp7HfJ1sDg6EaU5oKiVwXqZrM";
const IVY_TOKEN = "Iv7yPq2Wd9Lm4Xs8Tb1Nc6Hf3Rg5Ja0Ku2Ze7Oy9Qvw";
const PORT = Number(process.env.TASKA_E2E_PORT) || 5183;
const HASH_ROOT = `http://localhost:${PORT + 1}/`;

const STRONG = "Correct-horse-1";
const DEAD_LINK = /^This invitation link no longer works — it expired, was used, or was replaced by a newer one\./;

const NOTE = "Confirm your name and choose a password to activate your Taska account.";

/**
 * The mock with a preview the server could not answer (TAS-425, §4.27): the
 * first `failures` previews are refused as a 503 the way `RestTaskaApi` would
 * throw one, and the rest are the mock's own. A browser-only fixture served in
 * place of client.ts, as `notification-preferences.spec.ts` does; plain
 * JavaScript, so no type annotations.
 */
const unavailablePreviewClient = (failures: number) => `
import { MockTaskaApi } from "/src/api/mock/MockTaskaApi.ts";

export const taskaApi = new MockTaskaApi();

const f = (window.taskaPreviewFixture = { failures: ${failures}, calls: 0 });
const preview = taskaApi.previewInvitation.bind(taskaApi);
taskaApi.previewInvitation = async (token) => {
  f.calls++;
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (f.failures > 0) {
    f.failures--;
    throw Object.assign(new Error("Service unavailable"), {
      status: 503,
      code: "UNAVAILABLE",
      requestId: "fixture-request-id",
    });
  }
  return preview(token);
};
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("taska.mockAuthMethods", JSON.stringify({ signupEnabled: false, providers: [] })),
  );
});

/** Leo's link, previewed (TAS-425): his address read-only, his invited name in Name, focus in New password. */
async function expectLandedOnInvite(page: Page) {
  await expect(page.getByRole("tab", { name: "Accept invite" })).toHaveAttribute("aria-selected", "true");
  // A captured token is never shown and never typed.
  await expect(page.getByLabel("Invitation token")).toHaveCount(0);
  await expect(page.getByText(NOTE)).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("leo@example.com");
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Leo Fischer");
  await expect(page.getByLabel("New password")).toBeFocused();
}

async function activate(page: Page, password = STRONG) {
  await page.getByLabel("New password").fill(password);
  await page.getByRole("button", { name: "Activate account" }).click();
}

async function signInAs(page: Page, email: string, password = STRONG) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
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

  // The link is single-use: pasted back whole into the form, its preview is
  // refused under Continue, and nothing else is asked for.
  await page.getByRole("tab", { name: "Accept invite" }).click();
  await page.getByLabel("Invitation token").fill(`https://taska.ozero.dev/?token=${LEO_TOKEN}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText(DEAD_LINK);
  await expect(page.getByLabel("Invitation token")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("New password")).toHaveCount(0);

  // And the account it activated signs in like any other.
  await page.getByRole("tab", { name: "Sign in" }).click();
  await signInAs(page, "leo@example.com");
});

test("an expired link is refused on arrival in the screen's own words, with no form, never as a session that died", async ({
  page,
}) => {
  await page.goto(`/?token=${IVY_TOKEN}`);

  await expect(page.getByText(DEAD_LINK)).toBeVisible();
  // A state found on arrival rather than an answer to anything done.
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const label of ["Email", "Name", "New password"]) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activate account" })).toHaveCount(0);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByText("Invalid or expired token")).toHaveCount(0);
  await expect(page.locator(".invite-preview-refusal")).toBeFocused();
  await expect(page).toHaveURL(/\/invite$/);
});

test("a link that could not be checked offers Try again, announces each refusal that answers it, and brings the form back", async ({
  page,
}) => {
  await page.route("**/src/api/client.ts", (route) =>
    route.fulfill({ contentType: "text/javascript", body: unavailablePreviewClient(3) }),
  );
  await page.goto(`/?token=${LEO_TOKEN}`);

  const refusal = page.locator(".invite-preview-refusal");
  await expect(refusal.getByText("This invitation could not be checked.")).toBeVisible();
  await expect(refusal.getByText("Service unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy request id fixture-request-id" })).toBeVisible();
  // Found on arrival, so not announced; no form to fill in.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("New password")).toHaveCount(0);

  const retry = page.getByRole("button", { name: "Try again" });
  await retry.click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("This invitation could not be checked.");
  await alert.evaluate((node) => node.setAttribute("data-answered", "1"));

  // The same sentence again, on a node mounted afresh, so that it is said again.
  await retry.click();
  await expect(alert).toHaveText("This invitation could not be checked.");
  await expect(alert).not.toHaveAttribute("data-answered", "1");
  const calls = await page.evaluate(
    () => (window as unknown as { taskaPreviewFixture: { calls: number } }).taskaPreviewFixture.calls,
  );
  expect(calls).toBe(3);

  await retry.click();
  await expectLandedOnInvite(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an invited person sees their address and invited name, changes the name, and signs in under it", async ({ page }) => {
  await page.goto(`/?token=${LEO_TOKEN}`);
  await expectLandedOnInvite(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveAccessibleDescription(
    "Shown to the people you work with. You can change it later in Settings.",
  );

  // The shared check stands where the hint stood, and Activate takes the
  // reader to Name rather than sending.
  const name = page.getByLabel("Name", { exact: true });
  await page.getByLabel("New password").fill(STRONG);
  for (const value of ["   ", String.fromCodePoint(0x200b, 0xfeff, 0x2060)]) {
    await name.fill(value);
    await expect(name).toHaveAccessibleDescription("Enter a name.");
    await page.getByRole("button", { name: "Activate account" }).click();
    await expect(name).toBeFocused();
    await expect(page).toHaveURL(/\/invite$/);
  }

  await name.fill("  Leo Fischer-Ng  ");
  await activate(page);

  await expect(page).toHaveURL(/\/login$/);
  await signInAs(page, "leo@example.com");
  await expect(page.getByRole("button", { name: "Open profile for Leo Fischer-Ng" })).toBeVisible();
});

test("a token typed into the form is previewed on Continue, and becomes the caught link's form", async ({ page }) => {
  await page.goto("/invite");
  await expect(page.getByText(NOTE)).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);

  await page.getByLabel("Invitation token").fill(LEO_TOKEN);
  await page.getByLabel("Invitation token").press("Enter");

  await expect(page.getByLabel("Invitation token")).toHaveCount(0);
  await expectLandedOnInvite(page);
  await activate(page);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Password set. Sign in with your email and new password.")).toBeVisible();
});

test("a link opened under somebody else's session warns first, and signs out only when the reader activates", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
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
    await expect(page.getByRole("tab", { name: "Accept invite" })).toHaveAttribute("aria-selected", "true");
  });
});
