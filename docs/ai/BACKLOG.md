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
  > **This one stopped being hypothetical on 2026-08-12.** `canEdit === false`
  > reached the deployed stand — not through a role, but through a failed
  > membership read (TAS-162) — and took drag-and-drop with it on every project,
  > silently. Nobody had ever seen that state, in the mock or in a test, so
  > nothing caught it. The gap that mattered was not the missing role: it was
  > that the only path to `canEdit === false` was unobserved, so the *silence*
  > was never noticed either. Seeding the roles is still right, and TAS-163 adds
  > the coverage for the failure path.
- **`markAllNotificationsRead` loop needs an iteration cap** (unbounded if the
  gateway ever ignores `unreadOnly`).
- **The board's 100-issue page is now a functional ceiling, not just a paging
  detail** (from TAS-157). `BoardScreen` asks for `pageSize: 100` and the links
  section resolves its targets out of that one page: past 100 issues, a target
  cannot be offered in the picker at all, and an existing link to an issue
  outside the page renders as a raw UUID instead of a key and summary. It
  degrades honestly rather than breaking, but the fix is real paging or a
  server-side issue lookup, not a bigger number.
- **Comment row polish:** caret lands at position 0 when entering edit;
  a shared `isPending` disables Save/Delete on every row at once.
- **`getWorkflow` silently defaults `issueType` to `TASK`**; `listNotifications`
  returns a `Page` without `totalCount`. Minor contract-silence items.
- **Union members the contract does not back** (found by `api-contract-guard`,
  2026-08-05). `NotificationType` in `src/domain/types.ts` declares
  `MEMBER_ROLE_CHANGED`, which `NotificationTypeDto` does not have; nothing
  constructs it, so nothing renders it today. More broadly `IssuePriority`,
  `IssueStatus` and `UserStatus` are unions the contract types as bare
  `string`. `UserStatus` is the one with teeth: the gateway emits
  `"UNSPECIFIED"` as its zero value, and `RestTaskaApi` asserts the union
  rather than narrowing it, so that value would render an empty status pill
  with a class no stylesheet has a rule for. Fix at the mapper, the way
  TAS-151 did for `globalRole`.
- **BoardScreen.tsx split** (~1200 lines) — recorded as debt in `DESIGN.md` §8;
  do it with the next large board change.
- **A horizontally scrolling table is not keyboard-scrollable in Safari and
  Firefox** (found by `release-reviewer`, 2026-08-05). `.admin-table-scroll` has
  focusable children, so Chrome declines to make the container focusable
  itself; the other two engines never do. A table whose columns all happen to
  be non-sortable therefore cannot be scrolled sideways from the keyboard at
  all. `tabindex="0"` plus an accessible name on the scroll container is the
  usual fix, and it applies to any future wide table, not just this one.
- **Nothing moves focus on a route change** (found by `release-reviewer`,
  2026-08-05). Every in-app `<Link>` that swaps a route — "Go to projects",
  "Back to projects", the new Administration entry — leaves
  `document.activeElement` on `<body>`, so a keyboard user re-tabs from the top
  of the document on every navigation. It is consistent rather than a
  regression, which is exactly why it needs fixing in one place (focus the new
  screen's `<h1>`, or a skip-target) instead of per link. Note the trap this
  hid: a unit test asserting focus return passes because the component is never
  unmounted in the test, while the real app destroys the trigger a tick later.
- **The e2e suite flakes under CPU contention.** Observed 2026-08-05 at 45
  tests: a run with other dev servers alive took 2m and failed all three
  `[mobile] smoke` specs; the same specs passed in 4.4s alone, and the whole
  suite passed in 13.4s once the machine was quiet. Nothing was wrong with the
  code. Playwright's default is `workers: 7` here with three viewport projects
  starting their own Vite server, so CI on a small runner is one slow box away
  from a red build nobody can reproduce. Worth an explicit `workers` cap or
  per-test timeout rather than leaving it to luck.
- **The mock seed has no test of its own** (found by `release-reviewer`,
  2026-08-05). The only assertion that Mark is `GLOBAL_ADMIN` and Anna is
  `USER` lives in `HybridTaskaApi.test.ts` — a file about a different class, so
  a future seed change fails somewhere that does not explain itself. Related:
  two assertions there compare `toEqual` against a value the mock returns *by
  reference*, so both sides are the same object and only the neighbouring
  `toMatchObject` lines actually pin anything.
- **Duplicate accessible name on the login screen** — the segmented mode toggle
  and the submit button are both named "Sign in", so a role locator matches two
  elements. `e2e/smoke.spec.ts` works around it with a CSS locator; the fix
  belongs in `LoginScreen.tsx`.
- **e2e cannot see deploy-shaped regressions** — the suite runs the dev server
  with browser routing at base `/`, while Pages serves a hash-routed,
  base-prefixed build. Running one project against `vite preview` with the
  Pages env would close the gap.
- **`.primary-button` has no `:hover` or `:active` anywhere in the product**,
  though `DESIGN.md` §4.1 specifies `brightness(1.06)` / `brightness(.96)` for
  it. Found reviewing TAS-144, which fixed it only for its own CTA
  (`.notfound-action`) rather than changing every primary button in a PR about
  a 404 screen. Two lines on `.primary-button` closes it product-wide; the
  local override then goes away.
- **Issue-panel errors print the gateway's wording verbatim**
  (`BoardScreen.tsx` — the panel's "Issue not found" and the board error
  strip). TAS-144 made the *project* case deliberately indistinguishable
  between "missing" and "forbidden"; the issue case right next to it still
  leaks whichever phrasing the gateway chose. Same treatment, one screen over.
- **Pages serves its own 404 for a non-hash URL.** The `*` route only covers
  unknown *hash* routes; `https://…/taska-ui/nope` is answered by GitHub
  before the app loads. A `public/404.html` that redirects into the hash
  router would close it.
- **TAS-142 execution** — the a11y/contrast/gap list already agreed and filed.

### Left open by TAS-159 (from `art-director` and `release-reviewer`, 2026-08-10)

Non-blocking findings from the two verdicts on the admin area. The blocking
ones were fixed in the branch; these were not, and each says why.

- **`--fg-3` is 2.76:1 on `--surface-2` and 2.91:1 on `--bg` in light** —
  under the 3:1 floor §7 sets even for non-critical meta. It lands on the
  pager readout, the row count and other statements, not just decoration.
  Dark measures 3.2–3.3:1 and is fine. The token pair is product-wide and
  older than TAS-159, so changing it belongs with TAS-142 rather than inside
  an admin story; TAS-159 moved the `read-only` marker to `--fg-2` locally.
- **`.secondary-button` has no `:focus-visible` rule** — Apply, Try again and
  the pager fall back to Chrome's `auto 1px` instead of §7's `2px --accent`.
  Product-wide, now on the admin keyboard path.
- **Lucide icons ship at `stroke-width: 2`** against §8's 1.2–1.7. Only
  `ThemeToggle` sets it today; TAS-159 added ten more usages. One prop in one
  place if the icons are ever wrapped.
- **The admin area is desktop-first and now says so** (§5.8), but the phone
  layout it still renders has 26–29px targets against §7's 44. The real fix
  `art-director` proposed: below 720 make the catalog a disclosure whose
  trigger is the table name already in the plane head, so the rows get the
  whole screen. The fade mask on the list's bottom edge is a patch and goes
  away with it.
- **A paused react-query never renders "could not be reached"** — offline, the
  Data section sits on "Loading rows…" indefinitely. §5.8 promises the
  unreachable case as one of three distinguishable answers, and `fetchStatus:
  "paused"` is that case.
- **`/admin/data/:service` alone silently redirects to the first table of the
  first service**, discarding the service that was asked for.
- **Long values in ordinary columns are not clamped.** TAS-159 shortened the
  frozen primary key because its width is a permanent tax; an ordinary column
  can still print a 425px `actor_id`. `max-width` + ellipsis + `title` is the
  same treatment without the copy affordance.
- **No test anywhere renders `sortableColumns: []` / `filterableColumns: []`**,
  which is what the live gateway always sends (`API-DIVERGENCE.md`). The
  `stated()` fallback in `AdminDataSection` is the single thing keeping sorting
  and filtering alive against a real gateway, and if it regressed all 135 unit
  tests and 93 Playwright runs would stay green while every real table lost
  both. One screen test with both lists empty covers it. Found by
  `release-reviewer` and the more valuable half of the same lesson as the two
  bugs below: the fake agreeing with the mock is not the same as agreeing with
  the contract.
- **The page clamp has two narrow holes left** (`AdminDataSection`). An empty
  table plus a stale page is not clamped at all, because `totalPages >= 1` is a
  precondition rather than a floor — against a gateway that echoes
  `currentPage` the footer would read "Page 5 of 1". And `switchingTable`
  catches only a *table* mismatch, so a same-table transition where the filter
  changed can still compare against the previous filter's pagination;
  unreachable from the UI today because every filter change resets the page,
  reachable through history after the cache entry is gc'd. `!rowsQuery.isPlaceholderData`
  subsumes both.
- **`RestTaskaApi.listAdminRows` defaults the `pagination` object but not its
  fields**, all of which are optional in `PaginationInfoDto`. A present-but-
  partial object renders "Page 1 of NaN". Pre-existing and untested.
- **`.notfound-mascot`'s comment reasons about a 26px gap** that the 3:2 inset
  frame turned into a measured ~92px. Re-tune the spacing or drop the
  reasoning; do not leave the number that no longer describes anything.
- **The channel PNGs are stored as full RGB** (`docs/design/mascot-channels/`,
  2.7 MB). They are single-channel maps; a greyscale pass would remove most of
  that with no loss of source fidelity.

## Frontend stories already filed

Filed 2026-08-04 from the owner's own list, not from a review verdict. Each
frontend story is blocked by its backend half and ships mock-first meanwhile.

- [TAS-148](https://jira.ozero.dev/browse/TAS-148) — edit a project (name,
  description) with the key shown read-only. Blocked by TAS-145. Takes over
  the Description-textarea item that used to sit above: the field stops being
  a silent no-op once the backend has somewhere to put it.
- [TAS-149](https://jira.ozero.dev/browse/TAS-149) — archive a project from
  the UI, plus the read-only board state for an archived one. Blocked by
  TAS-146.
- [TAS-150](https://jira.ozero.dev/browse/TAS-150) — filed as a bug: no route
  guard exists, so a signed-out deep link lands on an empty projects screen
  with no way back to `/login`. Carries the auth-lifecycle item that used to
  sit above (`onAuthLost` from `RestTaskaApi` wired in `client.ts`) — the dead
  session ends in the same dead end.
- [TAS-151](https://jira.ozero.dev/browse/TAS-151) — show the global role in
  the profile menu. Blocked by TAS-147. Also wants a mock seed with both a
  plain user and a `GLOBAL_ADMIN`, which is the global-role twin of the
  VIEWER/MEMBER seed gap listed above.
- [TAS-152](https://jira.ozero.dev/browse/TAS-152) — admin entry in the
  profile menu for `GLOBAL_ADMIN` plus the `/admin` screen. Blocked by
  TAS-151. Filed when the console had nothing to show; the contract refresh
  below gave it content, so the screen it delivers is the shell TAS-155 fills
  rather than a permanent placeholder.
- [TAS-155](https://jira.ozero.dev/browse/TAS-155) — the read-only admin
  console itself, over the two `/readonly` endpoints the 2026-08-05 contract
  refresh brought in. Blocked by TAS-152 (the way in) and TAS-103 (the gateway
  half), so it shipped mock-first. TAS-103 landed on 2026-08-11 and moved the
  contract under it — [TAS-161](https://jira.ozero.dev/browse/TAS-161) followed
  it there and added the row card. Still mock-first, now because of
  [TAS-156](https://jira.ozero.dev/browse/TAS-156) and the null `primaryKey`.

## New contract surface not yet claimed by a story

The 2026-08-05 refresh of `docs/contract/openapi.yml` (backend develop
`25d0cf7000e5`) added three things, and all three are now spoken for —
`globalRole` by TAS-151, the `/readonly` endpoints by TAS-155, issue links by
TAS-157.

- ~~**Issue links.** `GET`/`POST /issues/{issueId}/links` and
  `DELETE /issues/{issueId}/links/{linkId}`.~~ Delivered by
  [TAS-157](https://jira.ozero.dev/browse/TAS-157). The `viewLinkType` /
  `linkType` asymmetry this item flagged was not treated as a typo: it is
  modelled as an open string and written up in `docs/ai/API-DIVERGENCE.md`. The
  half this item asked for that is **still outstanding** is the check against
  the running gateway — no request has yet reached these endpoints.

The 2026-08-11 refresh (backend `b22a2e020574`, TAS-103) moved the `/readonly`
surface under the admin area and added the row-by-id endpoint;
[TAS-161](https://jira.ozero.dev/browse/TAS-161) followed it. Two asks it
raised and did not close:

- **The row card cannot tell `null` from "the server did not return this
  column".** It renders the catalog's columns and reads each one out of the
  row payload, so a column the response omitted shows the same `—` as a column
  that is genuinely empty. In a raw-data console those are different facts, and
  one of them is a bug report about the gateway. This needs a contract answer
  before a visual one: `ReadOnlySingleRowResponseDto` states nothing about
  which columns a row is guaranteed to carry. File against the contract, not
  against the console.
- **`primaryKey` is null on every real table**, so no row is clickable against
  the deployed gateway and the row card is mock-only. Recorded in
  `API-DIVERGENCE.md`; worth a backend story of its own, since the card is
  finished frontend work that nothing but this can switch on.

### `--fg-3` on `--bg` is below the contrast floor, in two places TAS-161 did not touch

Found while fixing the same defect on the admin error block (art-director,
2026-08-11). `--fg-3` measures **2.91:1** on `--bg` and **3.10:1** on
`--surface`, so most of the product clears §7's 3:1 meta floor and anything
sitting on the page plane does not:

- `.admin-copied` — the "Copied" / "Couldn't copy" confirmation at 11px. It is
  the visible half of an action's result, not meta at all; `role="status"`
  covers a screen reader and nothing covers a sighted reader.
- `.admin-count` — the "27 rows" caption in the plane head.

Both are one-token changes to `--fg-2`. Left out of TAS-161 deliberately: both
predate it, neither is in its diff, and widening a story at merge time to sweep
adjacent instances is how a reviewable diff stops being one. Worth doing as a
pass over every `--fg-3` on `--bg` rather than two spot fixes, since the pattern
is what recurs.

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
- [TAS-145](https://jira.ozero.dev/browse/TAS-145) — `PATCH /projects/{id}`;
  `UpdateProject` does not exist and `taska.projects` has no `description`
  column, so the field the create form shows has nowhere to land yet. The
  project key stays immutable — it is part of every `issueKey`.
- [TAS-146](https://jira.ozero.dev/browse/TAS-146) — archive a project
  (`DELETE /projects/{id}` as a soft delete) and refuse writes to an archived
  one. `archived_at` already exists in the table and in `ProjectResponse`;
  nothing sets or filters on it. Restore is deliberately out of scope.
- [TAS-147](https://jira.ozero.dev/browse/TAS-147) — **Done.** `globalRole` is
  on `GET /users/me` in the 2026-08-05 contract, as
  `enum [GLOBAL_ADMIN, USER, UNSPECIFIED]`, which unblocked TAS-151. This is
  the *global* role, not the per-project role of TAS-137. The login response
  deliberately stays tokens-only. Contract-level only so far: the field has not
  been observed on the deployed gateway, which is why the frontend treats its
  absence as "not stated" rather than as an error.
