# Backlog — working memory

Things worth remembering that are not yet agreed work. Per `AGENTS.md`, Jira
stories are created by the owner or after proposing to the owner; this file is
where proposals and keep-in-mind items live until then. Items graduate to Jira
and get struck from here; items that stop mattering get deleted with a line of
why.

Sources: the three first-run review verdicts (2026-08-03) unless noted.

## Conscious decisions to revisit

- **`VITE_TASKA_ASSUME_PROJECT_ADMIN=true` is a deploy variable.** Every
  signed-in user gets the ADMIN surface of the UI. Accepted by the owner while
  the stand has no external users; falls away with TAS-137. Until then, no
  passing permission check proves role gating works.
- **The single stand is dev and prod at once.** Mock-backed features deploy so
  the team can click them; that is the point of the stand, not a risk.

## Frontend, needs a story when its turn comes

- **Toast component** (`DESIGN.md` §5.6 is the contract). Unlocks two things
  at once: optimistic rollbacks stop failing silently, and `requestId` gets a
  place to appear once the gateway exposes it over CORS (TAS-141).
- **Auth lifecycle:** a dead session (failed refresh) clears tokens but
  nothing navigates to `/login` — the user is left on a board of bare errors.
  Needs an `onAuthLost` hook from `RestTaskaApi` wired in `client.ts`.
- **Invite flow:** after a successful accept (204, no tokens) the screen calls
  `getCurrentUser` unauthenticated and reports failure — or, with stale tokens
  in localStorage, logs in as the previous user. Fix: on success, switch to
  sign-in mode with a "account is active" message.
- **`RestTaskaApi` has no tests** — the adapter carrying every compensation is
  the one implementation without a stubbed-fetch test file.
- **Shared error type:** `TaskaApi` does not name an error type; mock throws
  `MockApiError` (no `status`), rest throws `ApiError`. First screen that
  branches on `error.status` behaves differently per mode.
- **`getMembership` disagreement:** mock returns `projectExists: false`
  shapes, hybrid hardcodes healthy, rest propagates 404 — pick one contract.
- **Mock seed lacks VIEWER/MEMBER projects**, so `canEdit === false` has never
  been observed. Seed one of each so gating is exercisable.
- **`markAllNotificationsRead` loop needs an iteration cap** (unbounded if the
  gateway ever ignores `unreadOnly`).
- **Create-project Description textarea** sends a field the contract does not
  have — remove it, or keep only if TAS-141 adds the field.
- **Comment row polish:** caret lands at position 0 when entering edit;
  a shared `isPending` disables Save/Delete on every row at once.
- **`getWorkflow` silently defaults `issueType` to `TASK`**; `listNotifications`
  returns a `Page` without `totalCount`. Minor contract-silence items.
- **BoardScreen.tsx split** (~1200 lines) — recorded as debt in `DESIGN.md` §8;
  do it with the next large board change.
- **Duplicate accessible name on the login screen** — the segmented mode toggle
  and the submit button are both named "Sign in", so a role locator matches two
  elements. `e2e/smoke.spec.ts` works around it with a CSS locator; the fix
  belongs in `LoginScreen.tsx`.
- **e2e cannot see deploy-shaped regressions** — the suite runs the dev server
  with browser routing at base `/`, while Pages serves a hash-routed,
  base-prefixed build. Running one project against `vite preview` with the
  Pages env would close the gap.
- **TAS-142 execution** — the a11y/contrast/gap list already agreed and filed.

## Backend asks already filed

- [TAS-139](https://jira.ozero.dev/browse/TAS-139) — 500 on commented issues;
  the one item that breaks the deployed board today.
- [TAS-137](https://jira.ozero.dev/browse/TAS-137) — membership/member reads;
  removes `HybridTaskaApi` and the admin flag.
- [TAS-141](https://jira.ozero.dev/browse/TAS-141) — contract gaps: read-all,
  nullable assignee, comment ordering, CORS-exposed `X-Request-Id`,
  404-on-empty-projects bug. (The board-capable list DTO was dropped from it
  as a duplicate of TAS-124/125.)
- [TAS-124](https://jira.ozero.dev/browse/TAS-124) /
  [TAS-125](https://jira.ozero.dev/browse/TAS-125) — Board API; removes the
  N+1 hydration.
