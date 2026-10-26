import { expect, test, type Page } from "@playwright/test";

// A transition from the issue panel carries the version the panel read, as
// `If-Match` (backend TAS-422), and a stale one is 409 `ABORTED` with nothing
// moved. Against the mock, like every spec here: a reader alone cannot make
// their own version stale, so the mock's second actor does it — a comment
// holding `[changed meanwhile]` has another member change the issue just before
// the reader's next transition of it (`MOCK_PROJECT_TRIGGERS.changedMeanwhile`).
// Nothing here is evidence about the gateway.

async function openIssue(page: Page, issueKey: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("anna@example.com");
  await page.getByLabel("Password", { exact: true }).fill("mock-accepts-anything");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.locator(".project-card", { hasText: "Taska Platform" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);
  await page.locator(".issue-card", { hasText: issueKey }).click();
  const panel = page.getByRole("dialog", { name: `${issueKey} issue` });
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("aria-busy", "true");
  return panel;
}

test("a transition refused for a change made elsewhere says so, moves nothing, and shows the latest version", async ({
  page,
}) => {
  const panel = await openIssue(page, "TAS-102");
  const comments = panel.locator(".comments");
  await comments.getByPlaceholder("Leave a comment").fill("Picking this up [changed meanwhile]");
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(comments.locator(".comment-item")).toHaveCount(1);
  // TAS-102 is a Medium in the seed.
  await expect(panel.getByRole("button", { name: "Medium" })).toHaveClass(/is-active/);

  await panel.getByRole("button", { name: "Start Progress, move to In Progress" }).click();

  await expect(panel.getByRole("alert")).toHaveText(
    "Your change to the status was not saved: this issue was changed elsewhere after you opened it. The panel now shows the latest version.",
  );
  // Not moved: the panel still offers the move out of To Do, and the card is still in To Do.
  await expect(panel.getByRole("button", { name: "Start Progress, move to In Progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "To Do column" }).locator(".issue-card", { hasText: "TAS-102" })).toHaveCount(1);
  // The latest version is on screen: another member changed the priority, and
  // the activity says who.
  await expect(panel.getByRole("button", { name: "High" })).toHaveClass(/is-active/);
  await expect(panel.locator(".activity")).toContainText("set priority to High");

  // Sent again by the reader, over the version they now see, it goes through.
  await panel.getByRole("button", { name: "Start Progress, move to In Progress" }).click();
  await expect(page.getByRole("region", { name: "In Progress column" }).locator(".issue-card", { hasText: "TAS-102" })).toHaveCount(1);
  await expect(panel.getByText(/Your change to the status/)).toHaveCount(0);
});
