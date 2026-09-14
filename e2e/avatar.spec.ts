import { expect, test, type Page } from "@playwright/test";

/**
 * The user's avatar — upload, replace, delete and show (TAS-220, backend PR
 * #150, merged and not yet deployed).
 *
 * Mock-backed like every spec here (playwright.config.ts starts the server with
 * VITE_TASKA_API_MODE=mock), and for this feature that is not a convenience but
 * the only possibility: the four gateway routes answer Spring's static-resource
 * 404 on the stand today, and the *middle* leg of an upload never touches the
 * gateway even once they deploy — the browser PUTs the bytes straight to an
 * object store for which nothing in the backend repository configures CORS. So
 * nothing below is evidence about a server. It pins what the UI does with each
 * answer, and the answers come from `MockTaskaStore`. The undeployed state
 * itself is not here for the same reason: the mock cannot produce that
 * signature, so `UserProfileMenu.test.tsx` covers it against a stubbed API.
 *
 * One consequence of that store worth knowing while reading these: it hands
 * back the bytes it was given, as a `data:` URL, because it has no server to
 * serve them from. That is what makes "the picture replaced the initials"
 * something a browser can actually be asked about.
 */

/**
 * 219 bytes of two-tone PNG — the same image the mock seeds Sofia with. Small
 * enough to inline, and recognisably a picture rather than a coloured square,
 * which matters because the thing being proved is that an image is drawn where
 * a fill used to be.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAoklEQVR42u3XwQ2FMAwDUG/EnSUYmhn+CswBd2h/G1TXQZY8wJMaNQ6WdZMKDDLIoEKO3z4fdCFKmQCqaN6YMEgTNmGcJmbCUE3AlBwU0PSaDPoyKKzpMvnJDOKCvDoybnvFPqTYGBU7teLV4bssxVALfYxafeilpt0EmqbRBKamxQSy5q8JfE3dhCmaiikJiKApmTKAaJpHk0G9ILLmbpIDnTSYWlsbCRnnAAAAAElFTkSuQmCC",
  "base64",
);

/**
 * The same shape in different colours, and different **bytes** — which is the
 * whole point of a second image here: the mock hands back what it was given, so
 * two uploads of identical bytes would produce identical links and "the picture
 * changed" would be unprovable.
 */
const OTHER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAo0lEQVR42u3X0Q2EMAwDUG/CHizBaox4IzAC/EN7bVBdB1nyAE9q1DhYtlUqMMgggwo5fvt80IUoZQKoonljwiBN2IRxmpgJQzUBU3JQQNNrMujLoLCmy+QnM4gL8urIuO0V+5BiY1Ts1IpXh++yFEMt9DFq9aGXmnYTaJpGE5iaFhPImr8m8DV1E6ZoKqYkIIKmZMoAomkeTQb1gsiau0kOdAIE8Jve19hGDAAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(page: Page, email = "anna@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const trigger = (page: Page) => page.getByRole("button", { name: /Open profile/ });
const popover = (page: Page) => page.getByRole("dialog", { name: "Current user profile" });

/**
 * Hands a file to the input the "Upload a photo" button drives.
 *
 * `setInputFiles` on a `hidden` input rather than a file chooser dialog: the
 * input is deliberately out of the tab order (the button is the control), and
 * setting files directly is also what lets a *name* be chosen — the mock reads
 * the file name to decide which failure branch to take, and those failures are
 * otherwise unreachable from a browser.
 */
async function choose(page: Page, name: string, buffer: Buffer = PNG, mimeType = "image/png") {
  await page.locator(".avatar-input").setInputFiles({ name, mimeType, buffer });
}

test("uploads a photo from the profile menu, then deletes it and gets the initials back", async ({ page }) => {
  await signIn(page);

  // Anna is seeded without an avatar on purpose, so the flow starts where a new
  // account starts.
  await expect(trigger(page).locator(".avatar")).toHaveText("AI");
  await expect(trigger(page).locator("img")).toHaveCount(0);

  // The project card behind the menu holds Anna's member row too. Sofia's face
  // being drawn is what says the card's summary has loaded — so the change
  // below can only have come from the menu writing into it, not from the
  // card's own first answer arriving late.
  const card = page.locator(".project-card", { hasText: "Taska Platform" });
  await expect(card.locator(".avatar-stack img")).toHaveCount(1);

  await trigger(page).click();
  await expect(popover(page).getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
  // Nothing to remove yet, and the menu says so by not offering it — only a
  // successful read may claim there is none (§5.6).
  await expect(popover(page).getByRole("button", { name: "Remove photo" })).toHaveCount(0);

  await choose(page, "face.png");

  // The trigger and the popover header are the same circle twice, and both
  // become the picture.
  await expect(trigger(page).locator("img")).toHaveCount(1);
  await expect(popover(page).locator(".user-profile-head img")).toHaveCount(1);
  await expect(trigger(page).locator(".avatar")).toHaveText("");
  // The name never moves onto the image: the circle keeps it, so a screen
  // reader hears the person rather than "image".
  await expect(trigger(page).locator(".avatar")).toHaveAttribute("aria-label", "Anna Ivanova");
  await expect(trigger(page).locator("img")).toHaveAttribute("alt", "");
  // And the picture actually decoded, rather than merely being requested.
  expect(await trigger(page).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The new face is on the card as well, through the summary the card already
  // held: the menu writes it there rather than having every card on the page
  // read its issues and members again.
  await expect(card.locator(".avatar-stack img")).toHaveCount(2);

  // The button now offers the other two operations.
  await expect(popover(page).getByRole("button", { name: "Replace photo" })).toBeVisible();
  await popover(page).getByRole("button", { name: "Remove photo" }).click();

  // No confirmation dialog: this is undone by uploading again.
  await expect(trigger(page).locator("img")).toHaveCount(0);
  await expect(trigger(page).locator(".avatar")).toHaveText("AI");
  await expect(popover(page).getByRole("button", { name: "Upload a photo" })).toBeVisible();
  await expect(card.locator(".avatar-stack img")).toHaveCount(1);
});

test("gives Remove photo a real target in the control colour, and a focus ring the popover does not clip", async ({
  page,
}) => {
  await signIn(page);
  await trigger(page).click();
  await choose(page, "face.png");
  const remove = popover(page).getByRole("button", { name: "Remove photo" });
  await expect(remove).toBeVisible();

  const resting = await remove.evaluate((button) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--fg-2)";
    button.append(probe);
    const fg2 = getComputedStyle(probe).color;
    probe.remove();
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height, color: getComputedStyle(button).color, fg2 };
  });
  // §1's floor for anything clickable. The `.link-button` box this used to wear
  // was the text alone, 85.6×18.7.
  expect(resting.height).toBeGreaterThanOrEqual(28);
  expect(resting.width).toBeGreaterThanOrEqual(28);
  // A control's own label, so `--fg-2` (§4.1) — not the `--fg-3` that
  // `.link-button`, declared later at the same specificity, used to impose.
  expect(resting.color).toBe(resting.fg2);

  // From the keyboard, because `:focus-visible` is what is under test: the ring
  // is §7's outward one, and the band's padding keeps all of it inside the
  // popover's `overflow: hidden`.
  await popover(page).getByRole("button", { name: "Replace photo" }).focus();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  const ring = await remove.evaluate((button) => {
    const pop = button.closest(".user-profile-popover") as HTMLElement;
    const style = getComputedStyle(button);
    const panel = getComputedStyle(pop);
    const spread = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    const b = button.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const border = parseFloat(panel.borderTopWidth);
    return {
      offset: style.outlineOffset,
      width: style.outlineWidth,
      clearLeft: b.left - spread - (p.left + border),
      clearRight: p.right - border - (b.right + spread),
      clearTop: b.top - spread - (p.top + border),
      clearBottom: p.bottom - border - (b.bottom + spread),
    };
  });
  expect(ring.offset).toBe("2px");
  expect(ring.width).toBe("2px");
  expect(Math.min(ring.clearLeft, ring.clearRight, ring.clearTop, ring.clearBottom)).toBeGreaterThanOrEqual(0);
});

test("keeps a refused file's long name inside the popover", async ({ page }) => {
  await signIn(page);
  await trigger(page).click();

  // One unbroken word, the way a camera or a download names a file. The refusal
  // quotes it, and before `overflow-wrap: anywhere` the sentence ran through the
  // popover's edge, where `overflow: hidden` cut it off mid-name.
  const name = `IMG_${"20260914111400".repeat(6)}_screenshot_from_the_long_meeting.gif`;
  await choose(page, name, Buffer.from("GIF89a"), "image/gif");
  const note = popover(page).locator(".user-profile-photo-note.is-error");
  await expect(note).toContainText(name);

  const fit = await note.evaluate((element) => {
    const pop = element.closest(".user-profile-popover") as HTMLElement;
    const box = element.getBoundingClientRect();
    const panel = pop.getBoundingClientRect();
    return {
      overflow: element.scrollWidth - element.clientWidth,
      clearRight: panel.right - box.right,
      clearLeft: box.left - panel.left,
    };
  });
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.clearRight).toBeGreaterThanOrEqual(0);
  expect(fit.clearLeft).toBeGreaterThanOrEqual(0);
});

/**
 * Both cases below prove the same two things on different writes: focus
 * lands back on the upload button once the write settles, and the popover —
 * a `role="dialog"` with no focus trap — still has it, so the very next Tab
 * continues the sequence inside the menu instead of restarting at the top of
 * the document. That second assertion is the one that actually distinguishes
 * a fix from a coincidence: focus can equal the upload button for an instant
 * and still be about to fall through to `<body>` on the next render, and
 * "some element inside the dialog" would pass even if Tab jumped backwards.
 * Naming the exact next control — Anna carries no Administration entry, so it
 * is "Log out" once "Remove photo" is gone, and "Remove photo" once an upload
 * just mounted it — is what `edit-project.spec.ts` does for the same reason.
 */

test("returns focus to the upload button after Remove, so Tab continues inside the menu", async ({ page }) => {
  await signIn(page);
  await trigger(page).click();
  await choose(page, "face.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);

  // "Remove photo" unmounts along with the picture it just removed — the
  // button the reader pressed is gone a render later — which is the harder
  // of the two ways this band can lose focus to <body>.
  await popover(page).getByRole("button", { name: "Remove photo" }).click();
  await expect(trigger(page).locator("img")).toHaveCount(0);
  await expect(popover(page).getByRole("button", { name: "Upload a photo" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(popover(page).getByRole("button", { name: "Log out" })).toBeFocused();
});

test("returns focus to the upload button after a plain upload, so Tab continues inside the menu", async ({
  page,
}) => {
  await signIn(page);
  await trigger(page).click();

  // Nothing unmounts on this path — the button that starts an upload is the
  // same one that ends it — so the precondition has to be set up rather than
  // produced by the previous step: focus it first, the way a keyboard reader
  // who just activated it already would have it.
  const uploadButton = popover(page).getByRole("button", { name: "Upload a photo" });
  await uploadButton.focus();
  await expect(uploadButton).toBeFocused();

  await choose(page, "face.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);
  // `disabled` arrives on this same button the moment the upload starts, and
  // Chromium blurs a focused element the instant that happens — the button
  // is named "Replace photo" by the time it is enabled again, so this is a
  // fresh query rather than a re-check of the `uploadButton` handle above.
  await expect(popover(page).getByRole("button", { name: "Replace photo" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(popover(page).getByRole("button", { name: "Remove photo" })).toBeFocused();
});

test("replaces a photo with another, leaving one", async ({ page }) => {
  await signIn(page);
  await trigger(page).click();

  await choose(page, "first.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);
  const first = await trigger(page).locator("img").getAttribute("src");

  await choose(page, "second.png", OTHER_PNG);
  await expect(popover(page).getByRole("button", { name: "Replace photo" })).toBeVisible();

  // One circle, one picture — an avatar is replaced rather than appended to,
  // which is the whole difference from an attachment.
  await expect(trigger(page).locator("img")).toHaveCount(1);
  await expect(trigger(page).locator("img")).not.toHaveAttribute("src", first ?? "");
});

test("refuses a type and a size before spending a request, in the reader's terms", async ({ page }) => {
  await signIn(page);
  await trigger(page).click();

  // A GIF passes the picker on some systems — `accept` filters by the operating
  // system's idea of a type and `File.type` is the browser's.
  await choose(page, "wave.gif", Buffer.from("GIF89a"), "image/gif");
  await expect(
    popover(page).getByText("wave.gif is not a type this product accepts. Choose a JPEG, PNG or WebP image."),
  ).toBeVisible();
  await expect(trigger(page).locator("img")).toHaveCount(0);

  // 3 MB: inside the schema's declared 5 MB `maximum` and outside the 2 MB
  // auth-service actually enforces. Refusing it here is the difference between
  // a sentence and a wasted round trip with the bytes attached.
  await choose(page, "huge.png", Buffer.alloc(3 * 1024 * 1024));
  await expect(
    popover(page).getByText("huge.png is 3 MB. The largest photo this product accepts is 2 MB."),
  ).toBeVisible();
  await expect(trigger(page).locator("img")).toHaveCount(0);
});

test("reports a blocked cross-origin PUT as the store leg it is", async ({ page }) => {
  await signIn(page);
  await trigger(page).click();

  // The mock reads the file name for this, because nothing in the backend
  // repository configures CORS on the bucket and the failure is otherwise
  // unreachable from a browser.
  await choose(page, "cors-blocked.png");

  await expect(popover(page).getByText(/the browser could not reach the file store/)).toBeVisible();
  // The sentence names where the request was going, because "storage" being a
  // different server from Taska is the fact that makes it make sense.
  await expect(popover(page).getByText(/straight to storage rather than through Taska/)).toBeVisible();
  await expect(trigger(page).locator("img")).toHaveCount(0);
});

test("draws a member's face from the member row, on the board and on the project card", async ({ page }) => {
  await signIn(page);

  // The project card's avatar stack, from `listMembers` and nothing else: one
  // read for four faces, never one request per person.
  const card = page.locator(".project-card", { hasText: "Taska Platform" });
  await expect(card.locator(".avatar-stack img")).toHaveCount(1);
  await expect(card.locator(".avatar-stack .avatar", { hasText: "SR" })).toHaveCount(0);

  await card.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);

  // Same row, same picture, on the assignee filter in the board's filter bar.
  const sofia = page.locator(".avatar-filter", { has: page.locator("[aria-label='Sofia Reyes']") });
  await expect(sofia.locator("img")).toHaveCount(1);
  // Everybody else keeps their initials and their computed fill.
  await expect(page.locator(".avatar-filter [aria-label='Anna Ivanova']")).toHaveText("AI");
});

test("comes back to initials when a link no longer loads", async ({ page }) => {
  // A download URL is presigned for fifteen minutes, so a board left open over
  // lunch is holding expired links. That has to read as a person with no
  // picture, never as a hole where a face was — which is why the fill and the
  // initials are underneath rather than replaced.
  await page.route("**/broken-avatar.png", (route) => route.fulfill({ status: 403, body: "expired" }));
  await signIn(page);

  // Anna has no avatar in the seed, so the person this case is asked about is
  // Sofia: her link is swapped for one the network refuses, which is what an
  // expired presigned GET looks like from the browser's side.
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  const sofia = page.locator(".avatar-filter", { has: page.locator("[aria-label='Sofia Reyes']") });
  await expect(sofia.locator("img")).toHaveCount(1);

  await sofia.locator("img").evaluate((image: HTMLImageElement) => {
    image.src = "/broken-avatar.png";
  });

  await expect(sofia.locator("img")).toHaveCount(0);
  await expect(sofia.locator(".avatar")).toHaveText("SR");
});
