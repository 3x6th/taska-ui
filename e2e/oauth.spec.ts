import { expect, test, type Page } from "@playwright/test";

/**
 * Provider sign-in (TAS-426, DESIGN.md §4.31) against MockTaskaApi's fake
 * provider: a provider button's address is where the gateway's callback would
 * send the browser back to — `/auth/callback?code=…` or `?error=…`, **at the
 * origin root**, whatever the base, as the backend builds it. So a press is a
 * full page load of the landing, exactly as in production, and the code is
 * taken out of the address before the router mounts.
 *
 * Who the provider vouches for is the `taska.mockOAuth` knob (Anna when unset),
 * set before the page loads; `taska.mockAuthMethods` is open when unset. The
 * mock keeps exchanged codes in sessionStorage, so opening the same callback
 * address twice is a reused code, as on the server.
 *
 * The callback cases run twice: on the suite's own server (browser routing)
 * and on the hash-routed one at base `/` — production's shape (playwright.config.ts).
 */

const PORT = Number(process.env.TASKA_E2E_PORT) || 5183;
const BOARD = "/projects/2e74e49f-0f29-4e03-b4ec-adc4dbf2382e/board";

const setKnobs = async (page: Page, knobs: Record<string, unknown>) => {
  await page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, JSON.stringify(value));
  }, knobs);
};
const identity = (value: Record<string, unknown>) => ({ "taska.mockOAuth": value });

const ROUTINGS = [
  {
    name: "browser routing",
    root: "",
    route: (path: string) => path,
    at: (path: string) => new RegExp(`^http://localhost:${PORT}${escape(path)}$`),
  },
  {
    name: "hash routing at base /",
    root: `http://localhost:${PORT + 1}/`,
    route: (path: string) => `http://localhost:${PORT + 1}/#${path}`,
    at: (path: string) => new RegExp(`^http://localhost:${PORT + 1}/#${escape(path)}$`),
  },
] as const;

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const routing of ROUTINGS) {
  test.describe(`the return from a provider, ${routing.name}`, () => {
    test("signs a known account in and goes back to the page the guard remembered, with no code left behind", async ({ page }) => {
      await page.goto(routing.route(BOARD));
      await expect(page).toHaveURL(routing.at("/login"));
      const google = page.getByRole("link", { name: "Continue with Google" });
      // The fake provider answers at the origin root, never under a base.
      const href = await google.getAttribute("href");
      expect(href).toMatch(new RegExp(`^http://localhost:${routing.root ? PORT + 1 : PORT}/auth/callback\\?code=`));

      await google.click();

      await expect(page).toHaveURL(routing.at(BOARD));
      await expect(page.getByRole("button", { name: "Open profile for Anna Ivanova" })).toBeVisible();
      expect(page.url()).not.toContain("code=");
      // Back does not return to the address that carried the code.
      await page.goBack();
      await expect(page).toHaveURL(routing.at("/projects"));
      expect(page.url()).not.toContain("code=");
      expect(page.url()).not.toContain("/auth/callback");
    });

    test("opens the name step for an address with no account, and the new account lands on an empty /projects", async ({ page }) => {
      await setKnobs(page, identity({ email: "new.person@example.com", name: "New Person" }));
      await page.goto(routing.route("/login"));
      await page.getByRole("link", { name: "Continue with GitHub" }).click();

      await expect(page).toHaveURL(routing.at("/auth/callback"));
      await expect(page.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
      await expect(page.getByText("You’re signing up with your GitHub account.")).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue("new.person@example.com");
      await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
      const name = page.getByLabel("Name", { exact: true });
      await expect(name).toBeFocused();
      await expect(name).toHaveValue("New Person");
      await expect(page.getByRole("tab")).toHaveCount(0);

      await name.fill("Nova Person");
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page).toHaveURL(routing.at("/projects"));
      await expect(page.getByText("0 projects · Nova Person")).toBeVisible();
      await expect(page.locator(".project-card")).toHaveCount(0);
    });

    test("tells the reader on /login when the callback refused, focused, with the address clean", async ({ page }) => {
      await setKnobs(page, identity({ email: "nina@example.com" }));
      await page.goto(routing.route("/login"));
      await page.getByRole("link", { name: "Continue with Apple" }).click();

      await expect(page).toHaveURL(routing.at("/login"));
      const refusal = page.locator(".auth-refusal");
      await expect(refusal).toHaveText("The Taska account for this email is blocked. Ask a Taska admin to unblock it.");
      await expect(refusal).toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(page.url()).not.toContain("error=");
    });
  });
}

test.describe("refusals of a provider sign-in", () => {
  test("a locked account is told in two lines, with no time made up", async ({ page }) => {
    await setKnobs(page, identity({ email: "omar@example.com" }));
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Google" }).click();

    await expect(page.locator(".auth-refusal .auth-lock > span")).toHaveText([
      "Account is locked after too many failed sign-ins.",
      "Try again later.",
    ]);
    await expect(page.locator(".auth-refusal time")).toHaveCount(0);
  });

  test("an address with no account while sign-up is off is told an invitation is needed", async ({ page }) => {
    await setKnobs(page, {
      ...identity({ email: "stranger@example.com" }),
      "taska.mockAuthMethods": { signupEnabled: false, providers: ["GOOGLE"] },
    });
    await page.goto("/login");
    // Sign-up off: today's tabs, and the one configured provider.
    await expect(page.getByRole("tab")).toHaveText(["Sign in", "Accept invite"]);
    await expect(page.getByRole("link")).toHaveText(["Continue with Google"]);
    await page.getByRole("link", { name: "Continue with Google" }).click();

    await expect(page.locator(".auth-refusal")).toHaveText(
      "No Taska account uses this email, and new accounts need an invitation. Ask a Taska admin to invite you.",
    );
  });

  test("a cancelled sign-in shows nothing, on the tab it began on", async ({ page }) => {
    await setKnobs(page, identity({ error: "PROVIDER_CANCELLED" }));
    await page.goto("/login");
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByRole("link", { name: "Continue with GitHub" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".auth-refusal, .error-note")).toHaveCount(0);
  });

  test("an error value nobody sends is never printed", async ({ page }) => {
    await setKnobs(page, identity({ error: "<b>TYPED_BY_SOMEBODY</b>" }));
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Google" }).click();

    await expect(page.locator(".auth-refusal")).toHaveText("Sign-in with Google did not finish. Try again from this page.");
    await expect(page.getByText(/TYPED_BY_SOMEBODY/)).toHaveCount(0);
  });

  test("a code opened a second time is refused as used, in the exchange's own words", async ({ page }) => {
    await setKnobs(page, identity({ email: "twice@example.com" }));
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Continue with Google" });
    const href = (await link.getAttribute("href"))!;
    await link.click();
    await expect(page.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();

    // The same landing again: the code was spent by the first exchange.
    await page.goto(href);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".auth-refusal")).toHaveText(
      "That sign-in could not be finished — it took too long or was already used. Try again from this page.",
    );
    await expect(page.locator(".auth-refusal")).toBeFocused();
  });

  test("the browser's stale state on ?error= has its own sentence", async ({ page }) => {
    await setKnobs(page, identity({ error: "STATE_INVALID" }));
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Google" }).click();

    await expect(page.locator(".auth-refusal")).toHaveText(
      "That sign-in attempt is no longer valid: it expired, a newer one replaced it, or it began in another browser. Try again from this page.",
    );
  });

  test("the callback path with nothing on it goes to sign-in", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".auth-refusal")).toHaveCount(0);
  });

  test("a refusal keeps the page the guard remembered: the next password sign-in goes back there", async ({ page }) => {
    await setKnobs(page, identity({ email: "nina@example.com" }));
    await page.goto(BOARD);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Continue with Apple" }).click();
    await expect(page.locator(".auth-refusal")).toHaveText(
      "The Taska account for this email is blocked. Ask a Taska admin to unblock it.",
    );

    await page.getByLabel("Email").fill("anna@example.com");
    await page.getByLabel("Password", { exact: true }).fill("anything");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(new RegExp(`${escape(BOARD)}$`));
  });
});

test("no provider button on /invite, its Sign in tab included", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link")).toHaveCount(3);

  await page.goto("/invite");
  await expect(page.getByRole("tab")).toHaveText(["Sign in", "Accept invite"]);
  await expect(page.getByRole("link")).toHaveCount(0);
  await page.getByRole("tab", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.locator(".auth-divider")).toHaveCount(0);
});

for (const [theme, mono] of [
  ["light", "rgb(0, 0, 0)"],
  ["dark", "rgb(255, 255, 255)"],
] as const) {
  test(`the marks stand 12 from the button's edge, and Apple's mark and words are ${theme === "light" ? "black" : "white"} (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => window.localStorage.setItem("taska.theme", value), theme);
    await page.goto("/login");
    await expect(page.getByRole("link")).toHaveCount(3);

    const marks = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.querySelectorAll<HTMLAnchorElement>(".provider-button")].map((button) => {
        const mark = button.querySelector<SVGSVGElement | HTMLImageElement>(".provider-mark")!;
        // The glyph's own box: an <svg>'s path, the G's file edge to edge.
        const glyph = (mark.querySelector("path") ?? mark).getBoundingClientRect();
        const box = mark.getBoundingClientRect();
        const outer = button.getBoundingClientRect();
        return {
          label: button.textContent,
          glyphLeft: glyph.left - outer.left,
          markHeight: box.height,
          markTop: box.top - outer.top,
          buttonHeight: outer.height,
          color: getComputedStyle(button).color,
          fill: mark instanceof SVGSVGElement ? getComputedStyle(mark).fill : null,
        };
      });
    });

    for (const mark of marks) expect(mark.glyphLeft, mark.label!).toBeCloseTo(12, 1);
    const apple = marks.find((mark) => mark.label === "Continue with Apple")!;
    // Apple's file uncropped across the button's full height, centred.
    expect(apple.markHeight).toBeCloseTo(39, 1);
    expect(apple.markTop + apple.markHeight / 2).toBeCloseTo(apple.buttonHeight / 2, 1);
    expect(apple.color).toBe(mono);
    expect(apple.fill).toBe(mono);
    // GitHub's mark is the mono colour too; its words, like Google's, are not.
    const github = marks.find((mark) => mark.label === "Continue with GitHub")!;
    expect(github.fill).toBe(mono);
    expect(github.color).not.toBe(mono);
  });
}
