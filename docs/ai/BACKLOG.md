# Backlog — working memory

Things worth remembering that are not yet agreed work. Per `AGENTS.md`, this
is where a problem the agents *found* lands first — work the owner hands over
gets its story filed directly instead. A line graduates to Jira when it
survives the two tests there (it is not a mock artifact, and it duplicates
nothing already filed); that call is the orchestrator's and needs no asking.
Items graduate and get struck from here with their key beside them; items that
stop mattering get deleted with a line of why.

Sources: the three first-run review verdicts (2026-08-03) unless noted.

## Conscious decisions to revisit

- **`VITE_TASKA_ASSUME_PROJECT_ADMIN=true` is a deploy variable.** Every
  signed-in user gets the ADMIN surface of the UI. Accepted by the owner while
  the stand has no external users; falls away with TAS-137. Until then, no
  passing permission check proves role gating works.
- **The single stand is dev and prod at once.** Mock-backed features deploy so
  the team can click them; that is the point of the stand, not a risk.

## Frontend, needs a story when its turn comes

- **Record leftovers from the TAS-161 review** (`api-contract-guard`,
  2026-08-18), all in `docs/ai/API-DIVERGENCE.md` and all the same shape — a
  claim pinned to a state the 2026-08-18 stand session moved past:
  - the page-basis entry still says the response echo "could not be observed"
    and that no request has ever returned a `pagination` object, which a
    different entry answers 100 lines earlier;
  - the empty `sortableColumns`/`filterableColumns` entry is pinned to
    "Still true at `b22a2e020574`" while the snapshot moved to `7fb303b53ba6`
    and that session had `meta` in hand.
- **`AdminRowsTable` takes columns from `rows.meta.columns` and `sensitive` from
  the catalog**, so a column in `meta` and absent from the catalog is drawn with
  no lock. Not a plaintext leak while the server masks — it would print `"***"`
  as data. The mock cannot reproduce it: it derives `meta.columns` from the
  catalog. Fail-closed already holds at table granularity, not at column
  granularity.
- **`IssuePriority` and `UserStatus` are closed unions over contract-open
  strings**, with no narrowing at the mapper and no divergence entry. The
  existing "status keys are open" entry covers only workflow `statusKey`.
- **The mock filters and sorts already-masked values** where the gateway
  operates on the underlying column. Unreachable from the console, since
  sensitive columns are stripped from both sort and filter — but the mock is the
  reference implementation.
- **`title="masked column"` sits on a `role=generic` span** that already carries
  the visually-hidden `", masked column"`. Name-from-author is prohibited on
  generic, and the header computes correctly with no doubling in Chrome — but
  some AT surfaces `title` as a description, so this wants a manual AT pass.
  Same family as the `aria-label` note on `.admin-hidden-cell`.
- **No screen-level test pins 403 to the Not-found screen.** `errors.test.ts`
  pins the collapse in `isMissingOrForbidden`, and `BoardScreen.test.tsx` uses a
  404 — so the path that is now the *production* answer for "not yours"
  (observed 2026-08-18) is covered only by the helper beneath it. Deferred out
  of the docs-only branch that found it, on purpose: adding a test there would
  have pulled a second reviewer role onto a documentation change.
- **Contrast leftovers from the TAS-161 review** (`art-director`, 2026-08-18):
  `.admin-hidden-cell` at `--fg-3` on a hovered row (`--surface-3`) measures
  2.60:1 light / 2.82:1 dark, under §7's 3:1 floor. Pre-existing, but the hover
  rule and that token pair now meet on every row of a `HIDE` column.
- **`.logo-text` declares no `color`** while §1 forbids implicit text colour; the
  only rule that sets it is a `:hover`.
- **A `HIDE` column stacks a header lock over an identical lock in every row**
  (12 visible at 390 on `auth.sessions`). Worth suppressing the cell glyph when
  the whole column is withheld — the word `hidden` already carries the cell.
- **On `/projects` the logo links to `/projects`.** Either `aria-current="page"`
  or no link on the current route.
- **`/admin/data/auth/<unknown-table>` sits on "Loading rows…" forever** — no
  terminal error, no empty state. Pre-existing, outside the TAS-161 diff.
- **Masking leftovers from the TAS-161 review** (release-reviewer, 2026-08-18),
  all in the admin console and none blocking:
  - `isWithheld` tests `value.includes("*")`. A shape test —
    `v === "***" || /^.\*+.$/.test(v)` — would fail *closed* if the backend ever
    changes `maskPartial`, where the substring test fails open. It would also
    close the one false positive: a legitimate value containing `*` on a flagged
    column, reachable in principle for the free-form `auth.credentials.meta`.
  - `isWithheld(true, null)` returns `false`, so a sensitive null draws the `—`
    dash. From backend source a correct server can never send it — all three
    treatments write a string or drop the key — so reaching that branch *means*
    masking did not run, and the dash then leaks set-versus-unset. Treating it as
    withheld is a two-word change.
  - `aria-label` on the `.admin-hidden-cell` span is name-prohibited on
    `role=generic` in ARIA 1.2. Chrome honours it, NVDA may not. Pre-existing,
    and it wants a `role="img"` or a visually-hidden span instead.

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
- **Mock seed lacks a project where the viewer is a *member* with a read-only
  role.** ~~so `canEdit === false` has never been observed~~ — corrected
  2026-08-12: `canEdit === false` **is** reachable and now has e2e coverage.
  Anna is not in `MOB`'s member list, and `getMembership` falls back to
  `role: "VIEWER"` for a non-member, so her Mobile board is a genuine viewer
  board. What the seed still cannot produce is `isMember: true` with a
  `VIEWER` or explicitly read-only role — `project()` assigns `ADMIN` to the
  first member and `MEMBER` to the rest, and nothing is ever seeded `VIEWER`.
  So "not a member" and "a member who may not write" remain the same picture
  in every test, and only the first one exists.
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

### Found while reviewing TAS-163/164 (2026-08-12), pre-existing

None of these were caused by that branch; they were seen while two reviewers
had the board open, and are recorded so they are not re-discovered a third
time.

- **`.form-error` fails §7 wherever it appears, not just on the board.**
  `--danger` on its own 12% danger tint measures **2.96:1 light** / 4.92:1
  dark — under every floor in §7 — and the same class sets the login form's
  errors on `--surface` at 3.17:1. TAS-163 fixes the board's use of it by
  setting the sentence to `--fg` and carrying the error colour in an accent
  bar, which is what §5.6 actually asks for. The other call sites still
  inherit the failing combination, and the fix is the same one.
- **dnd-kit announces a keyboard drag that does not exist.** Every card
  carries `aria-describedby` → "To pick up a draggable item, press the space
  bar…", while the sensor list has no `KeyboardSensor`. The instruction is
  false for every user, not only a viewer. The button path required by §5.3
  does work, so this is a wrong instruction rather than a dead end — but it is
  worse than silence. Either register a `KeyboardSensor` or supply
  `screenReaderInstructions` that describe the transition buttons instead.
- **§5.7 says a `VIEWER` gets `readOnly` fields; the code gives them
  `disabled` ones.** A viewer therefore cannot select or copy an issue's
  summary or description — `disabled` removes the text from reach entirely,
  which is not what read-only means.
- **The filter bar's "X of Y" counter clips at 390px** — measured 10.2px wide
  by 50px tall inside a 46px bar.
- **`--font-mono` is specified in §2.3 and never declared in `styles.css`.**
  TAS-163 defines it and converts the copies it found; check for others.
- **`listIssues` is still all-or-nothing internally.** Its N+1 hydration uses
  `Promise.all`, so one unreadable issue still zeroes its own project's count.
  TAS-163 contained the blast radius to a single card; it did not remove it,
  and TAS-124/125 is what actually does.
- ~~No test proves a real `VIEWER` cannot drag.~~ **Withdrawn the same day it
  was written.** It rested on "the mock seeds no VIEWER project", which is
  false: Anna is not a member of `MOB`, and a non-member gets `VIEWER`. TAS-163
  covers that board in e2e. The narrower gap that *is* real is recorded on the
  seed item above — a member who may not write has still never been seen.
- **`MouseSensor` accepts a middle-click press** where `PointerSensor`
  required button 0. Harmless in practice; noted so it is a known trade.

### Added after the re-verdicts (2026-08-12)

- **The editable board still announces a drag gesture it cannot perform.**
  TAS-163 retired the false `aria-roledescription="draggable"` and the
  "press the space bar" instruction for *viewers* only, by withholding
  dnd-kit's attributes. `MEMBER` and `ADMIN` cards still carry both, and there
  is still no `KeyboardSensor` — so the instruction remains false for exactly
  the people who can actually move a card. The panel's transition buttons are
  the real keyboard path (§5.3), so this is a wrong instruction rather than a
  dead end, but it is now inconsistent as well as wrong.
- **28×28 controls on a touch plane.** The new dismiss and request-id buttons
  meet §7's dense-toolbar floor and not its 44×44 touch floor. Same gap §7
  already records for the 22px column `+`, so this is a doc-alignment question
  — decide the rule in §7 rather than patching the two newest buttons.
- **The projects screen now stacks a danger tint over the accent radial.**
  `.projects-page`'s gradient is already a recorded §1 violation awaiting
  TAS-142; the new failure notice composites on top of it, which is two tinted
  planes and slightly strengthens the case for removing the gradient rather
  than working around it.

### Left open by TAS-169 (from `art-director` and `release-reviewer`, 2026-08-21)

- **A card silently drops its third row of labels, including the one the board
  was filtered on.** The two-row cap works and §4.8 sanctions it — verified by
  injecting nine chips, it clamps to 46px against a 98px scrollHeight and cuts
  between rows without severing a chip. What it does not do is say more exist.
  On an unfiltered board that is the right trade; with a label filter on, every
  card matches that label and a heavily labelled card may not show the one it
  was matched by, so the board looks like it filtered wrongly. Cheapest honest
  fix with no new tokens: a trailing `+N` chip styled as §4.5's count pill.
  Needs a measurement pass the card does not currently do, which is why it is
  here and not in TAS-169.
- **The 390px filter bar's horizontal overflow more than doubled.** Measured at
  390x844: `scrollWidth` 741 against `clientWidth` 390. The two label controls
  are ~201px of that, so the pre-existing ~150px is now well over twice as
  much, and because the pair sits before the spacer, the label picker, the
  manage button, Clear and the counter are all off-screen behind a scroll
  strip on the first screenful. It does scroll and everything is reachable, so
  it is not a defect — but below 820px the bar probably wants to wrap to two
  rows rather than scroll, or the label picker wants to sit ahead of the
  assignee row.
- **Opening an issue panel can now drive a full re-read of the issue page.**
  `IssueLinksSection`'s own observer on `["issues", projectId, "ALL"]` refetches
  on mount when the entry is stale (`staleTime` 20_000), where before the panel
  added no observer at all. Against the real gateway that is not one call:
  `RestTaskaApi.listIssues` hydrates every item with a per-issue `getIssue` at
  concurrency 6. Nothing required — if it shows as load, the smallest change is
  `refetchOnMount: false` on that one observer, which consumes the cached page
  without ever driving a fetch of it.
- **The picker's `onError` restore is the one write to picker state that still
  happens after the press, and nothing pins it.** TAS-169 moved both picker
  resets into their submit handlers; the failure path still puts the choice
  back from `onError`, guarded by `current === ""` so it can never overwrite a
  newer one. Untested because the mock has no failure injection for
  `addIssueLabel` — pinning it means adding one. Same gap on the links half of
  the same fix, which has no in-flight test of its own.
- **Chromium resolves a point hit test as a 1x1 rect, so at any shared edge the
  lower of two boxes wins from ~0.95px before its own top edge.** Found while
  measuring the label chips' remove controls (TAS-169), then reproduced on two
  bare absolutely-positioned divs with no gap and no pseudo-elements — it is an
  engine constant, not this component's doing, and it appears at DPR 1 and 3
  and at integer and fractional layout origins alike. The only way to remove it
  is a >=1px dead strip between hit boxes. Recorded because the next person to
  measure a hit target will find the same 1px and think they have a bug. It is
  also Chromium-only as measured: whether Safari and Firefox resolve a shared
  edge the same way is unknown.
- **`--danger` as bare text is 3.68:1 on light `--surface`, product-wide.**
  `.form-error` is the same recipe on a 12% tint. Pre-existing, but a second
  class (`.filter-error`, TAS-169) now uses it, so it is worth a row in the
  §7 recorded-gap list rather than staying folded into one component.
- **§2.4's spacing scale has no 24, and the panel's section rhythm is 24** in
  four places (`.issue-labels`, `.issue-links`, `.comments`, `.activity`).
  TAS-169 joining that family was right; the doc/code divergence predates it
  and belongs to §2.4, not to a component.
- **The board's assignee filter cannot distinguish loading from empty**, the
  way the label picker now can after TAS-169. Same pattern, same fix.
- **The create-label input's placeholder is `backend`**, which is also the
  name of a seeded label — at a glance in dark it reads as a pre-filled value
  rather than a hint.
- **`.compact-button` is radius 8 where §2.5 gives buttons 9.** Repo-wide and
  shared with the Links section's button, so the Labels "Add" matches its
  sibling; fixing one without the other would be worse.
- **No modal in the product handles `Esc`.** DESIGN.md §4.11 specifies `Esc`
  as cancel for every modal, and `src/components/Modal.tsx` implements none —
  closing is by the backdrop or the Close button only. Pre-existing and not
  TAS-169's doing; noticed by `frontend-builder` while driving the new
  manage-labels dialog, which is simply the newest modal to inherit the gap.
  Belongs to no story yet.
- **The board's transition mutation options are defined inline, so the
  rollback key cannot be unit-tested.** TAS-169 fixed a real key-drift bug
  there with no test: the mutation is reachable only through dnd-kit's
  `onDragEnd`, and jsdom gives every element a zero-size rect so no drag
  completes. Extracting the options into a pure factory taking
  `(queryClient, issuesKey)` would let a test call `onMutate`, change the key,
  call `onError` and assert which entry was restored — no dnd-kit involved. Do
  it the next time that mutation is edited, not before.

### Found while fixing the TAS-169 review blocker (2026-08-21)

- **Two call sites now produce the query key `["issues", projectId, "ALL"]`
  with `queryFn` bodies that differ cosmetically.** The board passes
  `labelId: undefined` explicitly; `IssueLinksSection` omits the key entirely.
  Identical across mock, rest and hybrid today, and deliberately the same cache
  entry so an unfiltered board costs the panel nothing. The hazard is later:
  add a parameter to the board's `listIssues` call without adding it here and
  the two observers disagree, silently, about what one cache entry holds. A
  shared options helper would remove the class. Not filed — it is a latent
  coupling with no user-visible symptom yet, and it disappears if either call
  site stops needing the page.
- **The links section still resolves link targets from a page**
  (`pageSize: 100`), so on a project past a hundred issues a link row still
  falls back to its raw id. Unchanged by TAS-169 and correct as documented —
  worth a story only when a project that large exists.

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
