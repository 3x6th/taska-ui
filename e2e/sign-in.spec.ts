import { expect, test } from "@playwright/test";

/**
 * The sign-in tab since TAS-299 (DESIGN.md §4.27): Password takes New
 * password's layout — `<label for>` over `.password-field`, the show-password
 * toggle inside the box — and both fields keep 40 on the right for it. Before
 * TAS-299 `.field input` sat lower in the cascade and put 12 back, so text ran
 * under the eye. Mock-backed like every spec here; nothing is signed in.
 */
test("names the field exactly Password, puts the toggle beside it, and keeps the text clear of it on both tabs", async ({
  page,
}) => {
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  const toggle = page.getByRole("button", { name: "Show password" });

  await expect(password).toHaveAccessibleName("Password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveCSS("padding-right", "40px");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // The text box ends before the eye begins.
  const [field, eye] = await Promise.all([password.boundingBox(), toggle.boundingBox()]);
  expect(field!.x + field!.width - 40).toBeLessThanOrEqual(eye!.x);

  await page.getByRole("button", { name: "Accept invite" }).click();
  const newPassword = page.getByLabel("New password");
  await expect(newPassword).toHaveCSS("padding-right", "40px");
  // A shown password does not follow the reader to the other tab.
  await expect(newPassword).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in", pressed: true })).toBeVisible();
});
