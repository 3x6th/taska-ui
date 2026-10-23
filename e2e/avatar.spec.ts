import { expect, test, type Page } from "@playwright/test";

/**
 * The user's avatar — upload, replace, delete and show (TAS-220, backend PR
 * #150, merged and deployed on 2026-09-14). The controls are on Settings → My
 * profile since TAS-380; they lived in the profile menu before.
 *
 * Mock-backed like every spec here (playwright.config.ts starts the server with
 * VITE_TASKA_API_MODE=mock), and for this feature that is not a convenience but
 * the only possibility: the *middle* leg of an upload never touches the
 * gateway at all — the browser PUTs the bytes straight to an object store for
 * which nothing in the backend repository configures CORS. So nothing below is
 * evidence about a server. It pins what the UI does with each answer, and the
 * answers come from `MockTaskaStore`. The write routes' undeployed answer — the
 * static-resource 404 — is not here for the same reason: the mock cannot
 * produce that signature, so `UserProfileMenu.test.tsx` covers it against a
 * stubbed API.
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
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const trigger = (page: Page) => page.getByRole("button", { name: /Open profile/ });
/** Settings → My profile, where the photo controls are. */
const profile = (page: Page) => page.locator(".settings-profile");

/**
 * Settings → My profile, reached the way a reader reaches it — the profile
 * menu's Settings row — so the app's cache comes along: the project cards a
 * write rewrites are the ones `/projects` already holds.
 */
async function openMyProfile(page: Page) {
  await trigger(page).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(profile(page).getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
}

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

/**
 * What the photo column spends under its last drawn line: from the last child
 * that draws anything to the column's own bottom edge. Measured against what
 * has height rather than against the last child, because the defect this
 * guards against was an empty one — the mounted live region, zero tall but in
 * flow, which took the column's 7px gap with nothing under it.
 */
async function photoColumnInset(page: Page) {
  return profile(page)
    .locator(".settings-photo")
    .evaluate((column) => {
      const drawn = [...column.children].filter((child) => child.getBoundingClientRect().height > 0);
      const last = drawn[drawn.length - 1];
      return column.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
    });
}

test("keeps the empty live region out of the flow, and lays a refusal out in it", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  // At rest the live region is mounted and empty — and takes no gap.
  const live = profile(page).locator(".settings-photo-sentence");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toHaveText("");
  expect(await photoColumnInset(page)).toBeCloseTo(0, 1);

  // A refusal decided without a request fills that same region, in flow, in
  // the `.admin-write-failure` recipe, capped at 440.
  await choose(page, "animation.gif", Buffer.from("GIF89a"), "image/gif");
  await expect(live).toContainText("animation.gif is not a type this product accepts.");
  const box = profile(page).locator(".settings-photo-live.admin-write-failure");
  await expect(box).toBeVisible();
  expect(await photoColumnInset(page)).toBeCloseTo(0, 1);
  expect((await box.boundingBox())!.width).toBeLessThanOrEqual(440);
});

test("uploads a photo on My profile, then deletes it and gets the initials back", async ({ page }) => {
  await signIn(page);

  // Anna is seeded without an avatar on purpose, so the flow starts where a new
  // account starts.
  await expect(trigger(page).locator(".avatar")).toHaveText("AI");
  await expect(trigger(page).locator("img")).toHaveCount(0);

  // The project card holds Anna's member row too. Sofia's face being drawn is
  // what says the card's summary has loaded — so the change below can only
  // have come from the page writing into it, not from the card's own first
  // answer arriving late.
  const card = page.locator(".project-card", { hasText: "Taska Platform" });
  await expect(card.locator(".avatar-stack img")).toHaveCount(1);

  await openMyProfile(page);
  // Nothing to remove yet, and the page says so by not offering it — only a
  // successful read may claim there is none (§5.6).
  await expect(profile(page).getByRole("button", { name: "Remove photo" })).toHaveCount(0);

  await choose(page, "face.png");

  // The trigger and the page's 64 are the same circle twice, and both become
  // the picture.
  await expect(trigger(page).locator("img")).toHaveCount(1);
  await expect(profile(page).locator(".settings-profile-head .avatar-xl img")).toHaveCount(1);
  await expect(trigger(page).locator(".avatar")).toHaveText("");
  // The name never moves onto the image: the circle keeps it, so a screen
  // reader hears the person rather than "image".
  await expect(trigger(page).locator(".avatar")).toHaveAttribute("aria-label", "Anna Ivanova");
  await expect(trigger(page).locator("img")).toHaveAttribute("alt", "");
  // And the picture actually decoded, rather than merely being requested.
  expect(await trigger(page).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The button now offers the other two operations.
  await expect(profile(page).getByRole("button", { name: "Replace photo" })).toBeVisible();

  // The new face is on the card as well, through the summary the card already
  // held: the page writes it there rather than having every card on /projects
  // read its issues and members again.
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(card.locator(".avatar-stack img")).toHaveCount(2);

  await openMyProfile(page);
  await profile(page).getByRole("button", { name: "Remove photo" }).click();

  // No confirmation dialog: this is undone by uploading again.
  await expect(trigger(page).locator("img")).toHaveCount(0);
  await expect(trigger(page).locator(".avatar")).toHaveText("AI");
  await expect(profile(page).getByRole("button", { name: "Upload a photo" })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(card.locator(".avatar-stack img")).toHaveCount(1);
});

test("gives Remove photo a real target in the control colour, and a focus ring the page does not clip", async ({
  page,
}) => {
  await signIn(page);
  await openMyProfile(page);
  await choose(page, "face.png");
  const remove = profile(page).getByRole("button", { name: "Remove photo" });
  await expect(remove).toBeVisible();
  // At rest means not under the pointer: on the touch project the tap that
  // opened Settings leaves its hover wherever it landed, which can be here.
  await page.mouse.move(1, 1);

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
  // is §7's outward one, and the plane's padding keeps all of it inside the
  // scroller's clip.
  await profile(page).getByRole("button", { name: "Replace photo" }).focus();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  const ring = await remove.evaluate((button) => {
    const plane = button.closest(".settings-plane") as HTMLElement;
    const style = getComputedStyle(button);
    const spread = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    const b = button.getBoundingClientRect();
    const p = plane.getBoundingClientRect();
    return {
      offset: style.outlineOffset,
      width: style.outlineWidth,
      clearLeft: b.left - spread - p.left,
      clearRight: p.right - (b.right + spread),
      clearTop: b.top - spread - p.top,
      clearBottom: p.bottom - (b.bottom + spread),
    };
  });
  expect(ring.offset).toBe("2px");
  expect(ring.width).toBe("2px");
  expect(Math.min(ring.clearLeft, ring.clearRight, ring.clearTop, ring.clearBottom)).toBeGreaterThanOrEqual(0);
});

test("keeps a refused file's long name inside its 440 line", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  // One unbroken word, the way a camera or a download names a file. The refusal
  // quotes it; without `overflow-wrap: anywhere` the sentence would run through
  // its box's edge.
  const name = `IMG_${"20260914111400".repeat(6)}_screenshot_from_the_long_meeting.gif`;
  await choose(page, name, Buffer.from("GIF89a"), "image/gif");
  const note = profile(page).locator(".settings-photo-live.admin-write-failure");
  await expect(note).toContainText(name);

  const fit = await note.evaluate((element) => {
    const column = element.closest(".settings-column") as HTMLElement;
    const box = element.getBoundingClientRect();
    const panel = column.getBoundingClientRect();
    return {
      overflow: element.scrollWidth - element.clientWidth,
      clearRight: panel.right - box.right,
      clearLeft: box.left - panel.left,
    };
  });
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.clearRight).toBeGreaterThanOrEqual(0);
  expect(fit.clearLeft).toBeGreaterThanOrEqual(0);
  expect((await note.boundingBox())!.width).toBeLessThanOrEqual(440);
});

/**
 * Focus never falls to <body> during a write (ruling 4, TAS-380). An upload
 * keeps it on the button that started it — `aria-disabled` while the legs are
 * out, where `disabled` made Chromium blur it — and a removal, whose button
 * unmounts with the picture, hands it to Upload first. Naming the exact next
 * control after Tab is what tells a fix from a coincidence.
 */

test("moves focus to Upload when Remove takes its own button away", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);
  await choose(page, "face.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);

  await profile(page).getByRole("button", { name: "Remove photo" }).click();
  await expect(trigger(page).locator("img")).toHaveCount(0);
  await expect(profile(page).getByRole("button", { name: "Upload a photo" })).toBeFocused();
});

test("keeps focus on the button that started an upload, so Tab continues from it", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  const uploadButton = profile(page).getByRole("button", { name: "Upload a photo" });
  await uploadButton.focus();
  await expect(uploadButton).toBeFocused();

  await choose(page, "face.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);
  // The same button, renamed once the photo is there.
  await expect(profile(page).getByRole("button", { name: "Replace photo" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(profile(page).getByRole("button", { name: "Remove photo" })).toBeFocused();
});

/**
 * Backend PR #193 (head `3bd33cac`): `GET /users/me` answers 200 with
 * `avatar: null, avatarUnavailable: true` when the gateway's profile read
 * failed. The way the mock reaches that state is a row whose storage object
 * is gone — storage losing it — which a file named `object-lost` produces:
 * the confirm succeeds and answers with its link, then the object is dropped.
 * Nothing is wrong until the profile is read again, so the case reads it again
 * the way the app does on its own: past the twenty-second stale time, on the
 * next screen that reads it. Not on the tab becoming visible — since TAS-202 a
 * return to the tab re-reads only what failed (DESIGN.md §6).
 */
test("says the photo could not be loaded when the profile read fails, and an upload clears it", async ({ page }) => {
  // Before the first navigation, so the page's own timers run on this clock
  // from the start; time still flows, and `fastForward` is the lid closing.
  await page.clock.install();
  await signIn(page);
  await openMyProfile(page);

  await choose(page, "object-lost.png");
  // The confirm's own answer carried the link, so the picture is drawn at
  // first — exactly as the server's answer would draw it.
  await expect(trigger(page).locator("img")).toHaveCount(1);
  const note = profile(page).getByText("Your photo could not be loaded.");
  await expect(note).toHaveCount(0);

  // A return to the tab after the profile went stale reads nothing (TAS-202)…
  await page.clock.fastForward(21_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(trigger(page).locator("img")).toHaveCount(1);
  // …and the next screen does: Projects reads `["me"]` again on its way in,
  // and this time the read fails. Back on My profile, the face is gone.
  await page.goBack();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/profile$/);

  await expect(trigger(page).locator("img")).toHaveCount(0);
  await expect(trigger(page).locator(".avatar")).toHaveText("AI");
  await expect(note).toBeVisible();
  // Quiet, not a refusal: no danger tint, not announced, no request id.
  await expect(note).not.toHaveClass(/admin-write-failure/);
  expect(await note.evaluate((element) => element.closest("[aria-live]") === null)).toBe(true);
  await expect(profile(page).locator(".settings-photo-detail")).toHaveCount(0);
  // But not the hint's fine print either: the same size and slot, set apart by
  // tone alone — `--fg` where the hint above it is `--fg-2` — and no tint.
  const tones = await note.evaluate((element) => {
    const probe = (token: string) => {
      const span = document.createElement("span");
      span.style.color = `var(${token})`;
      element.append(span);
      const color = getComputedStyle(span).color;
      span.remove();
      return color;
    };
    const hint = element.parentElement?.querySelector(".settings-photo-hint") as HTMLElement;
    return {
      note: getComputedStyle(element).color,
      noteBackground: getComputedStyle(element).backgroundColor,
      noteSize: getComputedStyle(element).fontSize,
      hint: getComputedStyle(hint).color,
      hintSize: getComputedStyle(hint).fontSize,
      fg: probe("--fg"),
      fg2: probe("--fg-2"),
    };
  });
  expect(tones.note).toBe(tones.fg);
  expect(tones.hint).toBe(tones.fg2);
  expect(tones.noteSize).toBe(tones.hintSize);
  expect(tones.noteBackground).toBe("rgba(0, 0, 0, 0)");
  // The note is the last thing in the column, and the empty live region under
  // it adds no gap.
  expect(await photoColumnInset(page)).toBeCloseTo(0, 1);
  // Upload is the way out; there is nothing the server says to remove.
  await expect(profile(page).getByRole("button", { name: "Upload a photo" })).toBeEnabled();
  await expect(profile(page).getByRole("button", { name: "Remove photo" })).toHaveCount(0);

  await choose(page, "face.png");

  await expect(trigger(page).locator("img")).toHaveCount(1);
  await expect(note).toHaveCount(0);
  await expect(profile(page).getByRole("button", { name: "Remove photo" })).toBeVisible();
});

test("replaces a photo with another, leaving one", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  await choose(page, "first.png");
  await expect(trigger(page).locator("img")).toHaveCount(1);
  const first = await trigger(page).locator("img").getAttribute("src");

  await choose(page, "second.png", OTHER_PNG);
  await expect(profile(page).getByRole("button", { name: "Replace photo" })).toBeVisible();

  // One circle, one picture — an avatar is replaced rather than appended to,
  // which is the whole difference from an attachment.
  await expect(trigger(page).locator("img")).toHaveCount(1);
  await expect(trigger(page).locator("img")).not.toHaveAttribute("src", first ?? "");
});

test("refuses a type and a size before spending a request, in the reader's terms", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  // A GIF passes the picker on some systems — `accept` filters by the operating
  // system's idea of a type and `File.type` is the browser's.
  await choose(page, "wave.gif", Buffer.from("GIF89a"), "image/gif");
  await expect(
    profile(page).getByText("wave.gif is not a type this product accepts. Choose a JPEG, PNG or WebP image."),
  ).toBeVisible();
  await expect(trigger(page).locator("img")).toHaveCount(0);

  // 3 MB: over the 2 MB the schema declares and auth-service enforces (the two
  // agree since backend TAS-222). Refusing it here is the difference between a
  // sentence and a round trip that comes back "Invalid request parameters".
  await choose(page, "huge.png", Buffer.alloc(3 * 1024 * 1024));
  await expect(
    profile(page).getByText("huge.png is 3 MB. The largest photo this product accepts is 2 MB."),
  ).toBeVisible();
  await expect(trigger(page).locator("img")).toHaveCount(0);
});

test("reports a blocked cross-origin PUT as the store leg it is", async ({ page }) => {
  await signIn(page);
  await openMyProfile(page);

  // The mock reads the file name for this, because nothing in the backend
  // repository configures CORS on the bucket and the failure is otherwise
  // unreachable from a browser.
  await choose(page, "cors-blocked.png");

  await expect(profile(page).getByText(/the browser could not reach the file store/)).toBeVisible();
  // The sentence names where the request was going, because "storage" being a
  // different server from Taska is the fact that makes it make sense.
  await expect(profile(page).getByText(/straight to storage rather than through Taska/)).toBeVisible();
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
