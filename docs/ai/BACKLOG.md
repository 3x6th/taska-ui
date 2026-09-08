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

- **`refused` and `rejected` open as near-synonyms in the admin write dialog**
  (`art-director`, 2026-09-08, TAS-196 verdict). "The server refused this."
  against "The gateway would not accept this request." — both resolve on their
  second clause, so a reader gets there, but the first four words do no work.
  Proposed wording for `rejected`, which names the stage rather than repeating
  the verdict: "The gateway read this request and would not take it." Declined
  inside TAS-196 on purpose — that story removes a sentence, and rewriting a
  neighbouring one in the same diff makes the removal harder to review, not
  easier. `refused` itself needs no change; TAS-196 did fix its *subject*, which
  named the account being blocked where it meant the reader.
- **`userWriteFailure` now serves two sections and is named for one**
  (`frontend-builder`, 2026-09-08, TAS-194). The outbox retry dialog imports it
  from `src/screens/admin/users.ts` rather than copying it, which is right — its
  ordering reasoning (`isConflict` before the 4xx arm, because
  `FAILED_PRECONDITION` arrives on a 400) is the exact subtlety the retry's most
  common refusal depends on, and two copies would be two chances to drift. But
  the name now under-describes it, and so does its home. Renaming and moving it
  under an Events story would be widening that story at merge time; it wants its
  own small pass.
- **The Retry column is off the right edge on a phone with no fade affordance**
  (`frontend-builder`, 2026-09-08, TAS-194). The Users table has one, scoped to
  `.admin-users-plane`; the Problems table was already wide enough to scroll for
  its data and already had an off-screen chevron, so the story did not widen its
  scope to generalise the affordance. Same recipe, one more caller.
- **`--fg-3` measures 2.54 / 2.60 on a flashed row**, for the `—` null mark
  (`frontend-builder`, 2026-09-08, TAS-194). Pre-existing and not caused by the
  flash: it is already 3.14 / 3.05 on plain `--surface`, under §7's floor, and
  the Users table has flashed the same dash since TAS-186. Belongs to the
  `--fg-3` pass this file already asks for rather than to a spot fix.
- **`RestIssue` tells the truth about seven fields and lies about the rest**
  (`api-contract-guard`, 2026-09-08, TAS-195 re-verdict). It is
  `Omit<Issue, seven fields> & { those seven restated optional }`, so the type
  already promises the other thirteen are guaranteed while the deployed spec
  types every one of them `["string","null"]` with no `required` block. TAS-195
  added `description` to the restated block, which makes the type wrong about
  twelve instead of thirteen. Making it systematically partial — so `toIssue`
  has to justify every field it passes through — is the change that would have
  caught the render-path hazard in [TAS-173](https://jira.ozero.dev/browse/TAS-173)
  at compile time instead of leaving it to a reviewer. Its own story, not a line
  in someone else's.
- **Nothing in `src` is an error boundary, and the gateway declares every issue
  field nullable** (`release-reviewer`, 2026-09-08, TAS-195 verdict). The
  deployed gateway's own generated spec — `https://api.taska.ozero.dev/v3/api-docs`,
  public, no token — types every property of `IssueResponseDto` as
  `["string","null"]` with no `required` block. `status` is the one that matters
  and the one TAS-195 deliberately did **not** default: a card given an invented
  status would be placed in a column it does not belong to, which is worse than
  a card that does not appear. Today a `null` status makes the card vanish from
  its column while still being counted, so the board reads "10 of 10" and draws
  nine. The honest fix is a visible one — count what is drawn, or surface the
  row as unplaceable — and it is a product decision, not a mapper default.
  Separately: `grep` finds no `ErrorBoundary`, `componentDidCatch` or
  `getDerivedStateFromError` anywhere in `src`, so any render-time throw blanks
  the whole application rather than one panel. That is what sets the scale of
  [TAS-173](https://jira.ozero.dev/browse/TAS-173), where an unrecognised
  `issueType` or `priority` throws on the first paint of every card. **That
  story stood in `Done` with none of its acceptance criteria met** — no helper,
  no error boundary, no tests, and the unguarded lookups still in place at seven
  sites rather than the six it lists. Found 2026-09-08 while filing a duplicate
  for the same defect; the duplicate was closed and TAS-173 returned to `To Do`.
  Worth knowing as a class: a story can be `Done` in Jira and absent from the
  code, and neither the ledger nor a green gate will say so — `git log --grep`
  on the key is the cheap check.

  Note what this line first claimed and got wrong, because the correction is the
  useful part: the `null` description TAS-195 defaulted at the mapper is **not**
  the app-blanking case. The board's filter reads `summary` before `description`,
  and `summary` is undefined on the same bare row — so a row that could reach
  that filter without a description would already have thrown one field earlier.
  The default is right for a duller reason the release reviewer supplied:
  `PUT /issues/{issueId}` is a full replace and `UpdateIssueRequestDto` requires
  `description`, so an undefined one would go out as a missing required key.
- **Two ways to prove a rest-mode claim without a credential**
  (`release-reviewer`, 2026-09-08, TAS-195 verdict). TAS-195 could not produce
  the evidence that would have settled it best — a network trace showing one
  list request and no detail burst — because the dev server needs a sign-in and
  the agent may not enter a password. Two routes around that, neither taken:
  (a) a component test rendering `BoardScreen` against a real `RestTaskaApi`
  over a stubbed `fetch` seeded with a list body, asserting cards land in
  columns with chips **and** that no stubbed URL matches `/issues/{id}` —
  `BoardScreen.test.tsx` already renders the board against a stub API, so this
  is a small delta and proves the one link nothing currently proves, that a list
  *response body* draws a board; (b) a second Playwright project with
  `VITE_TASKA_API_MODE: "rest"` and `page.route` fixtures for login and list,
  which needs a second `webServer` entry in `playwright.config.ts` and produces
  exactly the trace. (b) is worth a story — it unblocks every future rest-mode
  claim, not just this one.
- **`UserProfileMenu.tsx` calls `.toLowerCase()` on a contract-optional field**
  (`api-contract-guard`, 2026-09-08, TAS-196 re-verdict). `user.status` builds a
  class name at `src/components/UserProfileMenu.tsx:108`, but
  `ValidateAccessTokenResponseDto` has no `required` block, so `status` is
  optional by contract and an absent one throws in the render. `statusLabel`
  beside it is properly defensive; the class name is not. `?? ""` is the whole
  fix. Confidence that the gateway always sends it is high — it builds
  `GatewayUserContext` with a proto zero sink — which is why this is a line here
  and not a story. Pre-existing, outside TAS-196's diff.
- **`AdminError.tsx:31` carries the same clause the write dialog just had fixed**
  (`frontend-builder`, 2026-09-08, TAS-196). "Either this account is not a global
  admin as far as the gateway is concerned, or the table is not one it will
  serve." There the subject is unambiguous — a table read, the reader's own
  account, no third party named on screen — so the defect TAS-196 fixed in
  `AdminUserActionModal` does not apply. Worth one pass if the two sentences
  should read alike; not a correctness item.
- **Do not make the server's verbatim line conditional** in
  `AdminUserActionModal` (`art-director`, 2026-09-08). It renders unconditionally
  today, and it is the safety net that would contradict "or that user is no
  longer there" if a static-resource 404 ever came back from a rollback. Not
  work — a note for whoever tidies that component next.

- **The UI font stack is not a token** (`art-director`, 2026-08-25, TAS-167
  re-verdict): `--font-mono` is tokenised, the UI stack is a literal on
  `body`, so nothing like `--font-ui` exists for a rule that needs to name it
  — the TAS-167 heading fix had to use `font-family: inherit`. Tokenising it
  is a `:root` + DESIGN.md §2 change with product-wide reach; older than
  TAS-167.

- **The Events plane head stacks into three chrome rows at ≤1280**
  (`art-director`, 2026-08-25, TAS-167 review): two identically styled §4.2
  segmented controls (view, then service) sit flush-left one above the other,
  told apart only by order, and a few applied filters make the chip band
  louder than the one-row table under it — §1 wants pale chrome over
  contrasty content, and here it inverts. The cheapest differentiator is
  weight, not another label. A §5.8 spec-block question, not a patch.

- **The journal's first screen shows no diagnostic column**
  (`art-director`, 2026-08-25): the `payload` cell runs ~670px, pushing
  `status`/`attempts`/`last_error_message` past the plane's right edge, so
  the reader scrolls to learn whether anything failed. Inherited Data
  rendering, first conspicuous here; the in-repo recipe is the capped span
  plus full value in `title` already used for the summary's error column.
  Belongs to a Data-table width-policy pass (jsonb cells capped), which
  changes Data's observable behaviour and was out of TAS-167's scope by its
  own constraint.

- **`payload` is sortable in the outbox journal while unfilterable by
  design** (`release-reviewer`, 2026-08-25, TAS-167 review): the sortable set
  falls back to every column because the gateway states none
  (`masking.ts` `statedColumns`), so the one conspicuous jsonb column draws a
  sort button the filter popover deliberately refuses. Harmless — Postgres
  does order jsonb — and pre-existing Data behaviour, first visible here.
  Belongs to the `sortableColumns`/`filterableColumns` backend ask, not to a
  client special-case.

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
- ~~**`IssuePriority` and `UserStatus` are closed unions over contract-open
  strings**, with no narrowing at the mapper and no divergence entry.~~
  Graduated to [TAS-173](https://jira.ozero.dev/browse/TAS-173), which had
  already been filed for the same defect from the crash side and asks for the
  helper, the missing error boundary, and tests per enum. Two corrections this
  line got wrong, both from `api-contract-guard` on 2026-08-23: it omits
  `IssueType`, which is the one the search path newly reads, and it understates
  the failure — an unrecognised value is not a missing colour, it is a throw out
  of `typeMeta[value].label` with no error boundary anywhere in `src/` to catch
  it. Since TAS-179 that throw reaches the shared top bar, so it takes every
  screen rather than the board, on data from a project the reader never opened.
  Recorded on TAS-173 rather than re-filed.
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
- ~~**The filter bar's "X of Y" counter clips at 390px** — measured 10.2px wide
  by 50px tall inside a 46px bar.~~ **Graduated 2026-08-23**, handed over by the
  owner from an iPhone 17 Pro Max, and fixed on
  `claude/mobile-projects-tasks-layout-nq01aa`. The cause was `.counter` taking
  the default `flex-shrink: 1` in an overflowing bar and collapsing to the
  min-content width of the word "of". **Filed as
  [TAS-177](https://jira.ozero.dev/browse/TAS-177)** after the fact, from a
  later session that had Jira; the environment line at the foot of this section
  says why the fixing session could not. **Confirmed on the device the same
  day**: the owner re-checked the same iPhone 17 Pro Max once PR #34 was in —
  the counter reads on one line and the projects list reaches its last card.
  That confirmation is the one thing no test in this repository could give,
  because headless Chromium has no toolbars to retract.
- **`--font-mono` is specified in §2.3 and never declared in `styles.css`.**
  TAS-163 defines it and converts the copies it found; check for others.
- ~~**`listIssues` is still all-or-nothing internally.**~~ **Gone with the
  hydration (TAS-195, 2026-09-08.)** It used `Promise.all` over a per-row
  `getIssue`, so one unreadable issue zeroed its own project's count. There are
  no per-row reads left to fail. Note which prediction was wrong: this line said
  TAS-124/125 is what removes it. The board API never did — what did was the
  list DTO growing whole issues, measured rather than read off the contract.
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
- ~~**The 390px filter bar's horizontal overflow more than doubled.** Measured at
  390x844: `scrollWidth` 741 against `clientWidth` 390. The two label controls
  are ~201px of that, so the pre-existing ~150px is now well over twice as
  much, and because the pair sits before the spacer, the label picker, the
  manage button, Clear and the counter are all off-screen behind a scroll
  strip on the first screenful. It does scroll and everything is reachable, so
  it is not a defect — but below 820px the bar probably wants to wrap to two
  rows rather than scroll, or the label picker wants to sit ahead of the
  assignee row.~~ **Graduated 2026-08-23** with the counter line above, and its
  own recommendation is what shipped: the bar wraps instead of scrolling, at
  every width rather than only below 820 — confining the wrap to a phone
  breakpoint would have run the tail off the edge on an ordinary laptop
  instead. Re-measured after the spacer came out, the bar holds one row from
  ~791px and, with `Clear` showing, from ~883px (Taska Platform, 4 members,
  ADMIN); above 820 only the filtered bar wraps at all, in the band 821–882.
  Same story, TAS-177.
- **Opening an issue panel can now drive a full re-read of the issue page.**
  `IssueLinksSection`'s own observer on `["issues", projectId, "ALL"]` refetches
  on mount when the entry is stale (`staleTime` 20_000), where before the panel
  added no observer at all. Against the real gateway that is not one call:
  `RestTaskaApi.listIssues` hydrated every item with a per-issue `getIssue` at
  concurrency 6 until TAS-195 removed it, so whatever load this line was about
  is now one request per page. Nothing required — if it shows as load, the smallest change is
  `refetchOnMount: false` on that one observer, which consumes the cached page
  without ever driving a fetch of it.
- **Pressing "Add" by keyboard drops focus to `<body>`,** because the button
  disables itself in the same commit that submits. Costs a keyboard user their
  place in the panel. Present wherever a submit button gates on emptied state,
  so it wants a focus-management decision rather than a per-button patch.
- **One component, two vertical rhythms:** panel chip rows wrap at `row-gap: 8`
  (the hit targets need it), board card chip rows at 6. Both are inside §2.4's
  5-8 band and the card's 46px two-row arithmetic depends on 6, so the
  divergence is defensible — but neither comment mentions the other, and the
  next reader will trip over it.
- **The board card truncates its label row with no indicator** while the panel
  heading counts them all — a card can read "5 chips" beside a panel saying
  "Labels 7". Same family as the `+N` item above; recorded separately because
  the mismatch between the two surfaces is the part a user notices.
- **The "Manage labels" icon button takes its accessible name from `title`,
  not `aria-label`,** which §7 makes mandatory for text-free icon buttons.
  Pre-existing pattern, shared with other icon buttons on the board.
- **The three `onError` restores TAS-169 added are themselves late writes, and
  none is pinned.** Each is guarded (`current === ""`, so it can only ever
  write into a field the user has left empty) and each is there for a good
  reason — a refused create should not also cost the name that was typed. But
  the guard is the only thing between them and the hazard the story spent four
  rounds closing, and no test holds it: the mock has no failure injection for
  `addIssueLabel`, `createIssueLink` or `createProjectLabel`, so pinning them
  means building one. That injection is the actual work item here; the three
  tests are cheap once it exists.
- **The links picker's half of the same fix has no in-flight test.** Three of
  the four late-write paths are pinned; `IssueLinksSection`'s reset is covered
  only by typecheck, lint and the existing `issue-links.spec.ts`. The
  one-task interleaving pattern the label tests use transfers directly.
- **Only three components were audited for the late-write pattern.**
  `ProjectLabelsModal`, `IssueLabelsSection` and `IssueLinksSection` were read
  for it and are clean beyond the four found. `IssuePanel` and the board carry
  their own mutations that were not read for it — `updateIssue`, `assignIssue`,
  `transitionIssue`, the comment mutations. The shape to look for: anything
  written in `onSuccess` or `onSettled` that a user could have changed during
  the round trip.
- **A paused fetch is a third state the board does not model, and it looks
  exactly like an empty project.** Seen on the deployed stand (2026-08-21) on
  the project TAS-172 broke: the issues query sat at
  `status: "pending", fetchStatus: "paused", fetchFailureCount: 1,
  errorUpdateCount: 0` indefinitely. `useUnanswered` keys on
  `errorUpdateCount > 0`, so with the retry paused rather than failed it never
  reports, and the board drew "0" in every column head with "Drop issues here"
  under it — the claim §5.6 exists to prevent, made by a read that never
  answered.
  - **Not confirmed as a product defect, and it should not be written up as
    one without more evidence.** react-query pauses a retry when its
  `onlineManager` says offline. `navigator.onLine` read `true` at the time and
    a healthy project's board had loaded in the same pane minutes earlier, so
    something flipped that manager and did not flip it back — plausibly the
    502 seen in the console, plausibly the automation browser. Dispatching an
    `online` event did not resume it.
  - What *is* established: the error path itself works. The projects screen in
    the same session showed the same backend failure correctly — its own
    notice, the gateway's message, and a request id — so this is about the
    paused state specifically, not about the board's failure presentation.
  - Worth reproducing deliberately: throttle to offline mid-retry in a normal
    browser and see whether a real user can reach the same permanent
    "loading". If they can, the fix is to treat `fetchStatus === "paused"` as
    its own state and say so, rather than to touch `useUnanswered`.
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
- **`src/components/Modal.tsx` still handles neither `Esc` nor
  `Cmd/Ctrl+Enter`.** DESIGN.md §4.11 specifies both for every modal, and the
  shared component implements neither — closing is by the backdrop or the Close
  button. Pre-existing and not TAS-169's doing; noticed by `frontend-builder`
  while driving the new manage-labels dialog, which was simply the newest modal
  to inherit the gap. **Half-answered by TAS-186**, whose confirmation dialog
  binds both itself rather than changing the shared component under a story
  that is not about the board's two modals — so there is now a working
  implementation to lift into `Modal`, and two callers still without it.
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

### Left open by TAS-171 (from all three roles, 2026-08-21)

- **`.project-card` has no `:focus-visible` rule**, so a focused card draws
  Chrome's default `rgb(229,151,0) auto 1px` instead of §7's `2px var(--accent)`.
  `.topbar-home` has the correct ring, which means §7's own preamble — "focus-visible
  реализован только в меню профиля" — is stale as well. Found by `art-director`
  while checking the keyboard path around the key badge. Candidate for TAS-142.
- **Filed as [TAS-174](https://jira.ozero.dev/browse/TAS-174): the four assignee
  filter buttons have no accessible name at all.** `Avatar` puts `aria-label` on
  a bare `<span>`, where ARIA forbids it and browsers drop it, and the button
  contains nothing else — so §4.4's "всегда `title`/`aria-label`" currently
  holds only through `title`, which a touch screen never shows. Raised
  independently by `art-director` and `release-reviewer`; it predates TAS-171
  and survives on its own, which is why it got a key rather than a bullet.
- **`labelColorChoices` is now shared between a user-chosen value and a computed
  one.** Adding a ninth colour for labels silently reshuffles every project's
  badge colour, because the index is `hash % length` and a project's colour is
  meant to be stable. Nothing schedules a ninth colour; if one is ever added,
  give the badge its own frozen copy of the list in the same change.
- **`.avatar { background: var(--accent) }` is now unreachable** — every
  instance either sets its own inline fill or carries `avatar-empty` /
  `avatar-loading`. Keeping it as defence is fine; the comment TAS-171 added
  describes the case as though it occurs. **`.key-badge` is the opposite** and
  must not be swept up with it: since the glyph moved out of the inline style,
  `color: var(--fg-2)` there is the *only* source of the badge's letter colour
  on every screen, and its `background` is reached exactly on the empty-key
  path. Deleting either would repaint or unpaint every badge in the product.
- **The two colour branches have different safety properties**, which matters
  only if `User.color` ever becomes real. The computed branch draws from a
  palette measured against white initials; the stated branch returns any hex
  that passes `isLabelColor`, with no contrast floor behind it. The badge is
  immune — its colour lives only in the tint now — but an avatar colour chosen
  by a user would need its own floor.
- **`Project.color` and `User.color` remain in `src/domain/types.ts` for fields
  the contract does not have.** They are a forward hook for TAS-148 and the
  mock's own seed, and they are annotated as such — but if TAS-148 ever ships
  without a colour, deleting both fields is the honest end state, and the
  divergence entry becomes "computed, permanently".
- **"1 members"** on a freshly created project card — plural not handled.
  Cosmetic, pre-existing, noticed by `art-director` on the create path TAS-171
  made worth looking at.

### Left open by TAS-175 (from `art-director`, 2026-08-22)

- **The mock shows four of the five palette values.** Sofia computes to
  `#10b981` but states `#ec4899`, so emerald never renders — and it is the one
  worth looking at next to the green STORY chip (`--type-story`). Fixable by
  stating `#10b981` for Mark instead of `#0ea5e9`, at the cost of sky, which has
  no token neighbour on screen. Not taken during TAS-175: the owner was already
  looking at the current arrangement, and changing the picture underneath a
  review for the sake of the demo is the wrong trade.
- **`.avatar-loading` is `--surface-3`, which is 1.62:1 against the top bar in
  the dark theme** — a skeleton almost nobody can see. Pre-existing.
- **`.assignee-chip` disables at `opacity: .58` where §4.1 says `.5`.**
  Cosmetic drift, one value.
- **`.avatar-filter` and `.assignee-chip` have no `:focus-visible` rule** — the
  same §7 gap TAS-142 already holds for the rest of the app, now visible in one
  more row.
- **Disabled avatars fall below every contrast floor by construction:** under
  the chip's `opacity`, the glyph/fill pair composites to 2.08–2.82:1 light and
  2.44–3.56:1 dark. This is what `opacity` does to any pair — the darkened
  TAS-171 palette measured 2.39–2.50 / 3.39–3.48 in the same place — so it is
  the disabled recipe that would need fixing, not the palette.

### Left open by the phone-portrait fixes (from `art-director`, 2026-08-23)

- **The assignee group breaks across the wrap.** At 390 and 440 the label
  «Assignee» and its `All` button end row 1 while the four avatars open row 2,
  where the next thing after them is a divider and «Label» — so a reader
  scanning row 2 meets four faces under no heading. The row-2 divider closes
  the group correctly; the group's label is simply on the previous line. The
  fix is a wrapper element around label + `All` + `.assignee-row` so the group
  wraps as a unit, which is a DOM change to `BoardScreen.tsx` and belongs in
  its own story rather than in a CSS bug fix.
- **The login screen's card settles ~7px after first paint**, so any Playwright
  assertion about its pixel geometry is a race unless it waits. Two causes
  stacked: `.auth-card-wrap`'s `tk-pop` entrance (`translateY(7px)` over 500ms)
  and the Hanken Grotesk swap. Both land in the same place, so no user is
  affected — but a naive `goto` + `waitFor(button)` samples mid-flight, and it
  cost a measurement pass on 2026-08-23 before it was spotted. The reliable
  recipe, if a spec ever needs that screen's box tree: emulate
  `reducedMotion: "reduce"` (the stylesheet already collapses that animation
  under `prefers-reduced-motion`) and poll until the wrapper's height stops
  changing across frames.
- **The filtered filter bar gets *taller* as the viewport gets wider, across the
  820 step.** Measured: 817–820 → 72.67px, 821–828 → 84px, 829–882 → 72.67px.
  Crossing out of the media query swaps the bar's padding from `6 12` to `6 18`
  and so costs 12px of row width exactly where the bar is already one row short.
  Nobody hits it deliberately and it is not a defect. Smallest correction if it
  ever bothers anyone: carry `6px 12px` up to the filtered wrap point (~890)
  rather than to 820, so the narrower inset only ever applies to a bar that is
  already wrapping.
- **At 390 the counter takes a 35px row of its own for an ADMIN** — the bar
  measures 110px against 80px for a MEMBER, the difference being the label-manage
  button. The phone filter bar is carrying one control too many, and the manage
  button is the one with a home elsewhere.
- **A 12-member project strands the assignee row's trailing divider** at a row
  edge once `.assignee-row` wraps within itself: a hairline at x=417 of a 440px
  bar, or leading a row at x=12 at 390. The seed has four members, so this needs
  a wider mock to see.
- **`.board-topbar` at ≤820 uses `padding: 10px 12px`**, and `10` is not on
  §2.4's scale. One value, pre-existing, unrelated to this change beyond having
  been measured next to it.
- **`:focus-visible` in the filter bar is still the UA default ring** —
  measured `outline: 1px rgb(229,151,0)` on every button in the bar, with
  `2px var(--accent)` reaching only the native `<select>`. The same §7 gap
  TAS-142 already holds for the rest of the app, now visible in one more row.

### Session environment, found 2026-08-23 fixing the phone-portrait bugs

These three are about the harness rather than the product, and each will bite
the next session in this image exactly as it bit this one.

- **The runtime has no Jira MCP.** `mcp-atlassian` is not registered, so the
  `TAS` backlog could not be searched, the story for the phone-portrait fixes
  could not be filed, and nothing could be transitioned. **Closed the same day**
  from a session that had Jira: the backlog was searched — "mobile", "мобильн",
  "counter", "100vh", "filter bar" — nothing already covered the two bugs,
  [TAS-177](https://jira.ozero.dev/browse/TAS-177) was filed, both commits were
  rewritten to carry the key, and the story was transitioned on merge. The line
  stays because the next session in that image meets the same gap. The browser MCP tools (`mcp__Claude_Browser__*`) and
  `refero` are absent in the same session — the two read-only roles fell back
  to driving Playwright over `Bash`, which works and is not the same thing.
- **The pinned Playwright and the image's browsers are a version apart.**
  `@playwright/test@1.62.1` in the lockfile wants Chromium revision 1234
  (Chrome 151); `/opt/pw-browsers` carries revision 1194 (Chrome 141),
  provisioned for the globally installed `playwright@1.56.1`. `npm run
  test:e2e` cannot launch a browser at all without a `PLAYWRIGHT_BROWSERS_PATH`
  shim, and every local e2e result is therefore Chrome 141 driven by the 1.62
  driver. CI is unaffected — `frontend.yml` runs `npx playwright install
  --with-deps chromium` and gets the right one — so this is provisioning, not
  a repository defect, and the repository is the wrong place to fix it.
- **`npm run check` cannot pass in this image at the suite's default timeout.**
  Eighteen admin-console tests (six specs across three viewport projects) fail
  on `Test timeout of 30000ms exceeded` at their *third* `page.goto`; every
  test with two navigations passes at 26.7–28.2s against the same 30s budget.
  Navigation costs ~13s here under software rendering. Verified pre-existing by
  running `admin-console --project=desktop` against the unmodified tree: the
  same six fail, at the same line numbers. With `--timeout=120000` the whole
  suite is 165 passed, 15 skipped, 0 failed. Raising the repository's timeout
  to suit one slow sandbox would blunt hang detection everywhere else, so it
  has not been raised — but a `check` that cannot be run locally is worth a
  decision rather than a workaround repeated per session.
- **`.board-notices { max-height: 34vh }` still measures the large viewport**
  now that the shell around it is `dvh`. On iOS the cap can exceed 34% of the
  shell's real height while the toolbars show. Cosmetic, and out of scope of
  the change that made it visible.

### Left over from TAS-186 (2026-08-25)

- ~~**`UserStatusResponseDto.updatedAt` arrives as the 1970 epoch.**~~ Struck
  twice over, and the second strike is the interesting one. It does not arrive
  as the epoch — that came from PR #134's stale *Известные проблемы* — and the
  field is not called `updatedAt` either: at backend PR #146's head `01a5af4`
  it is **`changedAt`**, renamed by [TAS-188](https://jira.ozero.dev/browse/TAS-188)
  through the domain type, both implementations and every fixture. The reason
  given here for not drawing it was also wrong: `auth-service` builds
  `.changedAt(savedUser.getUpdatedAt())` on a `@LastModifiedDate` column, so the
  response timestamp *is* the row's `updated_at` rather than a second clock
  beside it. It stays undrawn because the section has one source of values — the
  refetched list. Three revisions of one line, and every wrong one was read out
  of a PR body or a superseded branch head.
- **The profile menu's status pill has no `LOCKED` arm, and cannot get one
  honestly yet** (`frontend-builder`, TAS-188). §4.5's `.user-status` tints
  `ACTIVE`, `BLOCKED` and `INVITED`; a `LOCKED` account falls back to the quiet
  base pill even though the domain now models the value. Deliberately left:
  `GET /users/me` cannot report `LOCKED` at all — the gateway's own
  `GatewayUserStatus` sends it through `UNSPECIFIED` (see the line above and
  `API-DIVERGENCE.md`) — so an arm added today would be unreachable code
  justified by a value that never arrives. It also sits on hardcoded hex
  (`#22c55e`, `#f59e0b`), which no agent here may extend, so the arm and the
  tokenisation are one job. Wants the gateway fixed first, then both together.
- **The admin user dialog never scrolls, so at a short viewport its buttons are
  unreachable by pointer** (`art-director`, TAS-188). Measured: at 500px tall,
  the reset dialog carrying a failure sentence is 579px starting at 11vh, so
  Cancel and submit sit below the fold with no scroll. `Esc` and the close
  control still work, so it is not a trap. Pre-existing — the block-an-`INVITED`
  dialog overflows at 561 — and it belongs to `Modal` rather than to any one
  dialog, which is why TAS-188 did not take it.
- **`BLOCKED` on the 22px scroll wash is below §7's contrast floor**
  (`art-director`, TAS-188 re-verdict — an upgrade from the first pass, which
  estimated "about 3.0"). Re-measured: **3.36:1** light at rest on that band and
  **2.82:1** with the row flash over it. 2.82 is under the 3:1 floor, which
  makes this an accessibility defect rather than a tight margin, and it is the
  tightest place in the whole Users table — tighter than anything the new
  `LOCKED` rule does, which bottoms out at 3.21 in the same worst case.

  Older than TAS-188 and not made worse by it: the wash, the row flash and the
  `BLOCKED` recipe all predate this story, which only measured the stack for the
  first time. Worth a pass over **the wash itself** rather than over each pill
  that crosses it — the band is a scroll affordance drawn over content, and any
  status pill in the table meets it at some scroll position. Reachable only
  where the table overflows, so phone portrait; at laptop and desktop the band
  is never drawn.
- **The reason counter measures the trimmed value while the textarea caps the
  raw one** (`api-contract-guard`, TAS-188 re-verdict).
  `AdminUserActionModal.tsx:182` sets `maxLength` from the raw length and `:195`
  counts from `trimmed.length`, so leading or trailing whitespace makes the hint
  report room the field will not accept. The direction is safe — nothing
  over-long can reach the wire — so it is cosmetic, and fixing it means deciding
  whether the cap should trim too, which is a question about the field rather
  than about the counter.
- **`errors.ts:53` says "The three do not share a status" where two of the three
  do** (`api-contract-guard`, TAS-188 re-verdict): the last-active-admin and
  not-in-`LOCKED` refusals are both 400. The enumeration directly below it is
  unambiguous and the sentence is wording rather than a contract claim, which is
  why it was left rather than opening another builder pass for one word.
- **`BoardScreen.test.tsx`'s `makeIssue` fixture omits the five planning fields**
  (`release-reviewer`, TAS-189). The fake API is cast `as unknown as TaskaApi`,
  so every issue that suite sees has `undefined` where the type says
  `number | null`, and nothing can tell you: the cast defeats the typecheck by
  construction. `??` treats the two alike but `=== null`, `in`, `typeof` and
  `Object.entries` do not. Five `null` lines; do it with the UI half, which is
  the code that will read them.
- **Two refusal-set edges where the client and the server differ harmlessly**
  (`release-reviewer`, TAS-189): the estimate rules test `Number.isInteger`
  before `< 0`, so `-1.5` is reported as "not a whole number" rather than "cannot
  be negative"; and `isDateOnly` refuses ISO expanded years (`+10000-01-01`) that
  `LocalDate.parse` accepts. Both refuse the same inputs the server refuses, in a
  different order or for a different stated reason.
- **`createIssue` orders its refusals differently in the two implementations**
  (`release-reviewer`, TAS-189): REST refuses a bad planning value before the
  project is checked, the mock throws `NOT_FOUND` for an inaccessible project
  first. Only observable on the pair "bad value on a project you cannot see".
- **`GlobalSearch.test.tsx`'s `hit()` fixture omits `storyPoints`**
  (`api-contract-guard`, TAS-189) — same class as the `BoardScreen.test.tsx`
  line below, hidden by the same `as unknown as TaskaApi` cast. Fix both with
  the UI half.
- **`RestTaskaApi.updateIssue` does not bump `version` while the mock does**
  (`api-contract-guard`, TAS-189): the update response DTO carries no `version`,
  so REST cannot. Pre-existing parity drift, now over eight fields instead of
  three.
- **A `NaN` estimate is refused as "not a whole number of minutes"** rather than
  as "not a number" (`api-contract-guard`, TAS-189): `storyPoints` gets an
  explicit finite check and the estimates get one only as a side effect of
  `Number.isInteger`.
- **`isDateOnly` accepts `0000-01-01`**, which `LocalDate.parse` accepts and the
  Postgres `date` type does not (`api-contract-guard`, TAS-189).
- **Which server layer refuses a negative estimate is unsettled**
  (`frontend-builder`, TAS-189). The pending contract gives both estimates
  `minimum: 0` and the gateway's generator runs with `useValidation=true`, so a
  generated `@Min(0)` on a `@Valid` body would refuse it in bean validation and
  it would never reach the gRPC validator the divergence entry credits. Cannot
  be settled without the generated sources. It does not change what this client
  refuses, only which layer the record names.
- **Three planning-field claims want one probe each, once backend PR #148
  deploys** (`api-contract-guard`, TAS-189): what status a story-points value at
  or above 1000 actually produces (the record says 500 as a *code read* and has
  guessed wrong twice already), what the gateway does with a fractional estimate
  under Jackson 3, and which message a REST caller sees for a malformed date.
  All three are unreachable today because the fields are unserved, all three are
  written up as unobserved, and all three are one request each the day they are
  reachable. Nothing else tracks them.
- **`TaskaApi.ts:106` calls a code read "measured"** (`frontend-builder`,
  TAS-189). It describes reading two backend services' source at PR #146's head,
  not a probe. It was not wrong when TAS-188 wrote it — the word was not
  reserved then. TAS-189 narrowed "measured" to mean observation and left every
  other use of it honest, so this is the one straggler, and it is one word.
  (`TaskaApi.ts:62`, `:542` and `:561` also say "measured" and are correct:
  those are live probes against the deployed gateway.)
- **`RestTaskaApi.ts:438`'s comment carries the same staleness TAS-191 corrected
  in the documents** (`release-reviewer`, TAS-191): it justifies the per-issue
  hydration by saying the list DTO omits fields the board needs, and on the
  vendored contract `ListIssuesResponseDto.items` is now `IssueResponseDto`,
  which carries them. **Both halves closed by TAS-195**: the measurement was
  taken on 2026-09-08, the gateway agreed with its own contract, and the
  hydration came out with the comment that justified it.
- **A third intermittent test signature, on `AdminScreen.test.tsx`**
  (`release-reviewer`, TAS-190): "lands on the last page when the address names
  one past the end" failed once in four `npm run check` runs with
  `expected 999 to be 2`, and was green in the other three and in isolation.
  Unrelated to attachments by subject; TAS-190 adds roughly 1.9k lines of tests
  to the same parallel run and can only have raised contention rather than
  caused it. Recorded beside the two Playwright flakes already here — three
  signatures is the point at which the run's parallelism is worth looking at
  rather than each test.
- **A failed list read can turn a failed confirm into a false reassurance**
  (`release-reviewer`, TAS-190). `BoardScreen` counts same-named attachments
  from `queryClient.getQueryData`, which is `undefined` when the list read
  failed. A failed read plus a failed confirm plus a pre-existing file of the
  same name yields "it was attached after all" when it was not.
- **Two attachment states ship having been rendered only under jsdom**
  (`release-reviewer`, TAS-190): `.attachment-note`, the info tone, has no mock
  trigger because the confirm-fails path throws before recording one; and a
  successful upload announces nothing — the live region stays empty and only the
  row appears.
- **`IssueEventType` carries `PRIORITY`, which the backend enum does not have**
  (`api-contract-guard`, TAS-190). A priority change is `UPDATED` on the server.
  The mock emits `PRIORITY` and `historyText` gives it its own sentence, so that
  sentence exists only in mock mode. Belongs with the four-missing-members line
  below — and that line says "nine members", which was true when it was written
  and is eleven now.
- **`CreateAttachmentUploadUrlInput`'s comment says the gateway forwards
  `fileName`** (`api-contract-guard`, TAS-190). It does not:
  `GrpcIssueAttachmentServiceClient.createAttachmentUploadUrl` builds the body
  from `contentType`, `sizeBytes`, `actorUserId` and `issueId`, and the field
  dies at the gRPC boundary. The comment's conclusion — that it decides nothing
  at leg one — is unaffected, only its reason.
- **Every attachment failure surface drops the request id**
  (`api-contract-guard`, TAS-190): the read error and the notice both print the
  message alone, where `ApiNotice` and `AdminError` render `RequestId`. Matches
  the comments, links and labels sections beside it, so it is panel-wide and
  pre-existing rather than this story's — and it is the half of the toast gap
  already recorded above that is actually cheap to close.
- **`attachmentEmptyRefusalMessage` is called the server's own words and is not**
  (`api-contract-guard`, TAS-190). For this route the gateway's `@Min(1)` answers
  `"Invalid request parameters"` and `validateFileParams`'s
  `"File size must be positive, got: N"` is unreachable. Message-only, and the
  panel writes its own sentence anyway — but the comment claims a provenance it
  does not have, which is the class this story spent a round correcting.
- ~~**`.form-error` measures 3.17:1 in light, and every caller but one still
  uses it.**~~ Graduated to
  [TAS-192](https://jira.ozero.dev/browse/TAS-192) on 2026-09-06, on
  `art-director`'s recommendation that it should not wait: it is a §7 contrast
  failure in **ten** callers — eight in `BoardScreen`, plus login and projects,
  and **five of the ten inside the issue panel alone** — which survives entirely
  on its own and disappears with no mock or compensation, which is this
  repository's test for a story over a line here. TAS-190 gave the attachments
  section the §5.6 recipe and measured it at 17.88:1 light and 15.73:1 dark, so
  the follow-up is mostly deletion. The reason not to wait is that two recipes
  now coexist in one panel, and the longer they do the likelier the next feature
  copies the wrong one.
- **`RestTaskaApi` and the mock disagree on the code for an over-size file**
  (`frontend-builder`, TAS-190): `refuseAttachment` throws `INVALID_ARGUMENT`
  for all three arms while the mock throws `OUT_OF_RANGE` for the ceiling. Both
  are 400 and the picker refuses before either is reached, so nothing observable
  depends on it — but it is the parity class this series has treated as
  blocking everywhere else, and one of the two is wrong against the server.
- **Four issue history event types the backend already emits fall into
  `historyText`'s catch-all** (`frontend-builder`, TAS-190). Our
  `IssueEventType` is nine members; the backend enum is fourteen.
  `LINK_CREATED`, `LINK_DELETED`, `LABEL_ADDED` and `LABEL_REMOVED` are emitted
  today and every one of them renders as "updated this issue" in the activity
  feed. TAS-190 added only the two attachment members it needed. This is a
  feed-accuracy gap that predates it and wants doing as one pass over the union
  and `historyText` together.
- **Three attachment controls sit below §7's 44px touch target**
  (`frontend-builder`, TAS-190): "Attach a file" at 109×29 and each delete at
  32×32, at 390. They match their shipped neighbours exactly — `Link` is 47.9×29
  and "Remove link" is 32×32 — so this is three more instances of a gap §7
  already records rather than a new one, and fixing them alone would put a 44
  control immediately above a 32 one, which is the paired mismatch §7 warns
  about. Wants a pass over the panel's small controls together.
- **A presigned download opens a tab rather than saving a file**
  (`frontend-builder`, TAS-190). MinIO's presigned GET carries no
  `Content-Disposition` and the `download` attribute is ignored cross-origin, so
  images and PDFs render inline. `window.open` returning `null` is caught and the
  row then offers the link directly, but that fallback has been exercised only
  against a stub, never against a real popup blocker.
- **A no-op update bumps `version` and `updatedAt` in the mock and not on the
  server** (`frontend-builder`, TAS-189). `IssueServiceImpl.updateIssue` returns
  early without saving when the computed payload is empty; the mock always
  writes. Pre-existing and identical for summary-only edits before this story,
  so not introduced here — but it is a real mock/server divergence and the
  interchangeability rule says it should either be closed or written up. This is
  the writing-up.
- **A planning edit writes the mock's generic history event, not the server's
  per-field payload** (`frontend-builder`, TAS-189). Wants doing with the UI
  half, where the activity feed will actually show one.
- **`JSON.stringify({x: NaN})` emits `null`, and `null` means "clear the field"**
  (`frontend-builder`, TAS-189). `Number("")` from an emptied numeric input
  would therefore erase a value rather than fail. Guarded with `Number.isFinite`
  in the API layer and tested on both implementations — the line is here because
  the UI half will build the inputs that can produce it, and the guard must not
  be read as belt-and-braces.
- **A `LOCKED` account keeps full product access on a token minted before the
  lock** (`api-contract-guard`, TAS-188). Broader than the profile-menu line
  below it: `AuthServiceImpl.validateUserStatus` rejects `BLOCKED` and
  `INVITED` and does not reject `LOCKED`, and `AuthServiceImpl.refresh` does
  not call it at all — so a locked account is stopped at the sign-in form and
  nowhere else. A backend ask, and one for after PR #146 merges rather than a
  change to it. **Filed 2026-09-08 as
  [TAS-198](https://jira.ozero.dev/browse/TAS-198)** — the branch stopped moving
  when PR #146 merged on 2026-09-07.
- **`reset-lockout` declares no `default` response in its openapi block**
  (`api-contract-guard`, TAS-188), so the 500 the status round trip currently
  produces is an undeclared status on that route. Minor beside the 500 itself,
  which is on TAS-107 and TAS-108.
- **The gateway disagrees with itself about the user status vocabulary**
  (found on the TAS-188 contract read, 2026-09-05). At backend PR #146's head
  `UserStatusDto` has four values including `LOCKED`, while the same service's
  `GatewayUserStatus` — the enum behind `GET /users/me` — has only three plus
  `UNSPECIFIED`, so `AuthMapper.toGatewayUserStatus` sends a locked account
  through `default -> UNSPECIFIED`. A pre-lock token still works
  (`validateUserStatus` rejects `BLOCKED` and `INVITED`, not `LOCKED`), so the
  profile menu can be opened by an account whose status the gateway will not
  name. The frontend guards the render; it cannot fix a value it is not sent.
  A backend ask, and one for after PR #146 merges rather than a change to it —
  filing it against an open PR would land on a moving branch. **Filed 2026-09-08
  as [TAS-197](https://jira.ozero.dev/browse/TAS-197)**, with the vocabulary
  re-read off the deployed gateway rather than off the PR head: its
  `UserStatusResponseDto` carries all four values and its `GatewayUserContext.status`
  still carries three plus `UNSPECIFIED`, so the merge made the disagreement
  permanent instead of resolving it.
- **Two status pills now exist for one enum.** The profile menu's
  `.user-status` (§4.16) colours `ACTIVE` green and `INVITED` amber from four
  literal hexes that are in no §2 palette; the admin Users pill keeps colour
  for `BLOCKED` alone, per §1. The admin one is the reading DESIGN.md supports
  and the profile one predates it, so this is not a defect introduced by
  TAS-186 — but one enum wearing two visual languages in one product is worth
  one pass, together with getting those four hexes out of `styles.css`.
- **`Modal`'s `footer` prop has no caller and `.modal-footer` has no §4.11
  fill.** §4.11 puts a modal's buttons in a footer on `--surface-2` with a top
  border; every modal in the product instead ends its form with
  `.modal-actions`, and TAS-186's dialog follows them rather than being the one
  modal that looks different. Either implement the footer everywhere or write
  the actual pattern into §4.11 — the current state is a spec no caller obeys.
- **Answered during the TAS-186 review, kept because the answer is worth
  keeping:** the admin user writes do **not** share one status.
  `Cannot block/unblock user with current status: X` is `ABORTED` → 409, and
  `Cannot block the last active global admin` is `FAILED_PRECONDITION` → **400**
  (`RestErrorMapper.mapGrpcCodeToHttpStatus`, `GatewayErrorHandler`,
  `DomainStatus` on `feature/TAS-107`, read by `release-reviewer`). The body
  carries the gRPC code's own name, so `isConflict` reads both codes and the
  status, and the code arms are load-bearing rather than a mock accommodation.
  What is left is one probe on the day TAS-107 deploys, to confirm the table
  against the running gateway rather than against the branch's source.
- **`role="status"` on the Users section's announcement is never cleared.**
  After a change is announced, the sentence stays in the accessibility tree for
  as long as the section is mounted — harmless to a screen reader, which
  announces the *change*, but it means a reader browsing the page later meets a
  stale statement about an account. The fix is a timer like the copy
  confirmation's, or clearing it when the list catches up; neither is obviously
  right, which is why it is here rather than in the change.
- **The 550-character ceiling is enforced in the mock and not in REST.** It is
  the one place the three modes are not interchangeable, and it is deliberate:
  the field carries `maxLength`, so the UI cannot produce an over-long reason,
  and a second client-side length check would be a weaker copy of a rule the
  server states. The mock has it because the mock is the reference
  implementation and a hand-made call has to hit the same wall. Recorded so the
  asymmetry reads as a decision rather than an oversight.
- **The section holds one status override at a time.** A second write started
  while a failed refetch is still holding the first drops the first: the state
  is a single slot keyed by the last write. Bounded — the next successful list
  read makes both moot — and it degrades to ordinary staleness rather than to a
  contradiction, since what is dropped is a *correction* to a stale row, not a
  claim of its own. A map keyed by user id would close it; not worth the second
  data structure until somebody is blocking accounts two at a time through a
  broken connection. (`release-reviewer`)
- **The mock writes neither the audit row nor the outbox row a block does.**
  The backend writes an `admin.audit_log` row and an `auth.outbox_events` row
  (`USER_BLOCKED` / `USER_UNBLOCKED`) in the same transaction as the status
  change; `MockTaskaStore.changeUserStatus` writes only the status. So after a
  write in mock mode the Events journal and the future Audit section show
  nothing, and against the gateway they will show two rows — the one place this
  feature's mock is thinner than the server rather than merely different. It
  costs nothing today because neither section is read after a write, and it will
  cost something the moment Audit exists. (`api-contract-guard`)
- **`TAS-108` is no longer recorded anywhere.** It was one of the two stories
  the Users placeholder advertised; TAS-186 removed the placeholder and with it
  the `stories: ["TAS-107", "TAS-108"]` line in `sections.ts`, and nothing in
  this repository now says what TAS-108 was going to add to the section. Read
  the story and either fold what it covers into a note here or let it speak for
  itself in Jira — but the current state is a dropped reference, not a closed
  one. (`api-contract-guard`)
- **`.modal-layer` is `position: fixed` with no `overflow: auto`.** A modal
  taller than roughly 89vh (the layer's `padding-top: 11vh` plus its own height)
  has no scroll path at all and its footer is simply unreachable. Not triggered
  today — the Users confirmation measures 559px at 1440 and 579px at 390 — but
  it is now the tallest confirmation in the product, and the thing that would
  push it over is a long gateway message in the failure block, which is the one
  state where the buttons matter most. The fix is `overflow: auto` on the layer
  plus `align-items: safe center` reasoning from §5.1's login card, and it is a
  change to the shared component. (`art-director`)
- **There is no global `.secondary-button:focus-visible`, so most of them have
  no focus style at all.** The only two rules are scoped to `.issue-link-form`
  and `.issue-label-form`; every other secondary button in the product falls
  back to Chrome's `outline: auto` — the ring §7 already rejects by name for
  `.icon-button`, because Chrome derives it from the reader's *system* accent
  colour and it is therefore not a §2 value at all. Sharpest in the admin Users
  section, where the pager's Previous/Next sit eight pixels below a control that
  does draw `2px var(--accent)`: two buttons in one plane differing in exactly
  one thing, and it is that one of them cannot be seen to have focus. TAS-186
  kept a local rule on `.admin-user-action` for precisely this reason. Belongs
  on §7's TAS-142 list as a named line rather than an implied one, together with
  the `.segmented button` entry in the TAS-185 block below — the same gap in a
  different control, and worth closing in one pass rather than two.
  (`art-director`)
- **The profile menu colours all three statuses; the admin section colours
  one.** §4.16's `.user-status` gives `ACTIVE` a green pill and `INVITED` an
  amber one from four literal hexes that are in no §2 palette, while §5.8's
  Users pill keeps colour for `BLOCKED` alone per §1. One enum, two policies,
  and the §5.8 one is the reading DESIGN.md supports. Deliberately out of
  TAS-186's scope — it is §4.16 debt and predates the section — but it is now
  visible in two places at once. Fold it in with getting those four hexes out of
  `styles.css`. (`art-director`, raised again on the TAS-186 review)
- **The Playwright suite times out under CPU contention, and it is not
  understood.** Two occurrences, same signature, on `e2e/admin-console.spec.ts`
  — the Data section's own pre-existing tests, untouched by TAS-186. First:
  `frontend-builder`'s `npm run check` came back with 9 failures in a run that
  took 2.9m against the usual 1.5m. Second: the orchestrator's post-fix run came
  back with 6 failures, all on the `laptop` project, all 30-second timeouts on
  `page.goto` / `click` / `fill`, in a 2.3m run — while other agents were
  driving browsers. The file then passed 17/17 in isolation on both `laptop` and
  `mobile`, and full re-runs were green each time. `release-reviewer` ruled out
  the new seed as the cause: the orchestrator's own green pre-fix run already
  contained both new accounts and the new spec. What is *not* established is
  whether this is Playwright's own worker contention, the dev server the suite
  starts, or the machine. Recorded as unexplained rather than as "flaky,
  ignore", because the two runs that failed are the only evidence anyone has and
  discarding them is how a real timing bug survives. Worth one deliberate
  experiment — the same commit run with `--workers=1` under load — before
  anybody adds a retry.

- **The Users table's action column sits past the right edge at 390.** Same
  shape as the Data table's open-row link, which §5.8 already accepts, and it
  is reachable by scrolling the labelled, focusable region. Worth revisiting
  with the rest of the area's phone story rather than on its own — §5.8 names
  the real fix there (a collapsible catalog, and by extension a narrower
  layout), and a one-off sticky column here would be a second pattern.

### Left over from the TAS-185 reviews (2026-08-24)

- **`.issue-link-form .segmented button:focus-visible` loses 3.56px of its ring**
  to `.issue-panel-body`'s clip at 390 — measured by `release-reviewer` by real
  keyboard traversal, not by reading. Same shape as the notification-row defect
  TAS-185 fixed, and the same `-2px` answer applies. Pre-existing since TAS-179
  and deliberately left out of that story, which covered only the controls it
  touched. Two other positive cuts turned up in the same sweep and are also
  pre-existing: `issue-card` (0.73) and `panel-backdrop` (1.0).
- **`.segmented button` still has no focus style at all** — TAS-185 closed the
  `.icon-button` half of §7's entry and left this one open. Recorded so the
  half-closed register is not read as a closed one.
- **The empty and loading inbox is a bare 45.8px strip**, with "Mark all read"
  enabled over nothing (§5.6 wants four distinguishable states; §4.1 has a
  `disabled` recipe). Unchanged by TAS-185, but its exposure changed in kind
  rather than degree: on a board an empty inbox was something you reached after
  opening a project, and on `/projects` it is what a new account meets on its
  first screen. (`art-director`)
- **The bell is 32×32 at every width** against §7's 44 touch floor, and its
  accessible name still carries no unread count. Both pre-existing and both now
  on three screens rather than one. The touch half folds into the pseudo-element
  remedy §7 already commits to for the primary button and the search field —
  worth doing as one pass over all of them rather than four entries.
- **At 320 and 340 the search placeholder is still clipped** (needs 75.05, gets
  54 and 74). Knowingly exempted from the spec's placeholder assertion below
  375, and accepted by both reviewers: the defect TAS-185 fixed was "cannot see
  your own query", which is gone. Recorded because the exemption is a decision,
  not an oversight.

### Left over from the TAS-183 reviews (2026-08-24)

- **`.primary-button` has no `:hover`, `:active` or `:focus-visible` rule
  anywhere**, so §4.1's interaction recipe is missing entirely — and the focus
  half fails light/dark parity rather than merely being weak: Chromium's UA ring
  is `#005FCC` on `--accent #4f46e5`, **1.04:1 and invisible**, while dark gets
  `#99C8FF` and reads fine. Sharpest on `/projects` now that the field beside it
  matches in height, radius and centre line and shows a proper
  `2px var(--accent)` outline on focus: two adjacent controls differing in
  exactly one thing, and it is that the primary one is the one you cannot see
  focus on. TAS-183 did not make it worse — identical ring at 34 — it removed
  the last excuse for the pair looking different. (`art-director`)
- **`markRead.mutate` fires before the notification's target resolves**, so a
  notification whose issue read then fails is marked read and drops out of the
  unread filter: the one thing the reader could not act on becomes the one they
  cannot find again. Left as is on purpose — deferring mark-read until after the
  navigation would make every successful click feel slower to protect a rare
  failure — but the trade is real and worth revisiting if the read gets slower.
  (`api-contract-guard`)
- **A notification row's timestamp measures 2.76:1 on hover, in light only.**
  At rest it is 3.14 light / 3.05 dark and clears §7's 3:1 meta floor; on
  `--surface-2` the light value drops under it, and hover is exactly the state a
  reader is in while deciding whether to press. TAS-183 promoted the *inert*
  row's line to `--fg-2` (6.38 / 7.03) because that node became the only signal
  an inert row carries — the ordinary rows were left as they were, which is why
  this stays open rather than closed. Dark hover measures 3.18 and is fine, so
  this is a single-theme gap. (`art-director` found it, `frontend-builder`
  reproduced the figures independently.)
- **Probe `GET /api/v1/issues/{issueId}` with a non-member token.** One curl
  settles whether the mock's new membership predicate is fidelity or fiction:
  the gateway's siblings (`GET /projects/{id}`, `…/issues`) answer `403` to a
  non-member, the contract declares only `200` and `default` here, and nobody
  has ever asked this route. If it answers `200`, the mock is now the *stricter*
  of the two and the divergence runs the other way. Recorded because
  `API-DIVERGENCE.md` files it with "Removal: none" — which leaves the
  assumption permanent by default rather than pending. Any session holding two
  tokens closes it in thirty seconds. (`api-contract-guard`)
- **The body-UUID fallback takes the *first* UUID in the body**, so a body that
  led with a user or project id would 404 rather than resolve. Degrades to the
  `ApiNotice`, never to a wrong destination, and no current wire data does it.
  (`release-reviewer`)

### The webfont is a measurement hazard, not just a load-time one (TAS-181, 2026-08-24)

Graduated to [TAS-182](https://jira.ozero.dev/browse/TAS-182) the moment it was
understood; recorded here because the *method* outlives the fix.

A green local gate and a red CI on the same commit were both honest. The suite
runs against `localhost`, but the **product** links Hanken Grotesk from
`fonts.googleapis.com` with `display=swap`, so a run without that request
measures the fallback stack — a different product. Blocking the request
reproduced the CI failure verbatim, first try.

Two things fell out that are worth more than the fix:

- **A test can pass on 1.5px of slack and read as robust.** The rewrap staging
  had 100.52px of row for text that measures 99.03 with the webfont and 104.24
  without. Six pixels of font decided it. The staging is now built to leave
  ~91px, and every height in that test is measured from the page rather than
  written as a constant.
- **`document.fonts.check("13px 'Hanken Grotesk'")` returns `true` with the
  stylesheet blocked.** It answers "can this text be rendered", and a family
  nothing ever defined renders fine in the fallback — so the first gate written
  against it passed while the assertion it guarded failed. The honest detector
  asks the font set: `[...document.fonts].some(f => f.family.includes(…) &&
  f.status === "loaded")`, which is false for absent *and* for still-loading and
  therefore covers the block and the race with one poll.

### Found while fixing the panels' presentation (TAS-181, 2026-08-24)

- **The last `.notification-item` has no focus style of its own**, so it takes
  Chromium's `auto` ring — and its bottom edge is exactly the panel's clip
  boundary (measured 320.39 = 320.39, radius 13, `overflow: hidden`), so that
  ring is cut off at the bottom and squared at the corners. Two defects in one
  row, and the second is the same family as the one TAS-181 just fixed on the
  search panel: a square-cornered child sitting on a rounded clip. Left out
  deliberately — the story was about the two the owner reported, and the
  notifications rows want their own focus recipe rather than a corner patch.
- **A notification body breaks an issue key across lines at its hyphen** — at 390
  the narrowed panel splits `TAS-` from `103`. The width floor does not reach it
  (at 375 the same string wraps cleanly, so it is not a width problem), and it
  wants a non-breaking span around the key rather than more room.
- **`scroll-padding-top` biases keyboard scrolling, not pointer scrolling.** A
  wheel-scrolled list that stops at an exact row boundary, with the pointer then
  hovering that top row, still puts a square ring corner in the panel's arc.
  Unreachable from the keyboard path, and not fixable in CSS without giving up
  full-bleed rows.
- ~~**The trigger's position is republished on `window.resize` only.** … Fonts
  load long before the first click, so a `ResizeObserver` on the bar was judged
  not worth the wiring.~~ **The judgement was wrong and the reasoning names the
  wrong cause.** `art-director` measured it: the board bar grows **97 → 141** at
  390 when the project data lands, which fires no resize event, so the published
  `--trigger-bottom` stays at 42 while the bell moves to 86 — the clamp then
  overstates the room by 44px and a full inbox runs 32px past the fold at
  390×560. Not a webfont, and not hypothetical: it is the ordinary board-load
  path. It was also a regression, because the CSS percentage it replaced
  self-corrected on rewrap. Fixed inside TAS-181 with a `ResizeObserver` on the
  bar and on `documentElement`. Kept struck through rather than deleted, because
  the interesting part is not the defect but that a risk was recorded with a
  plausible cause, and the plausible cause was the wrong one — which is what made
  the judgement look safe.

### Found while clamping the panels (TAS-179, 2026-08-23)

- **The notifications popover overflows a short desktop viewport.** At
  **1440×420** with a full inbox it runs 13.3px past the bottom. Untouched by
  TAS-179 — the vertical clamp added there is scoped to ≤820, and above the
  breakpoint the popover keeps its original bell-relative top of 47.5 — so this
  is a pre-existing defect of the desktop anchor rather than one that story
  created. Measured while sweeping the same question the story fixed below the
  breakpoint; recorded rather than widened into the diff.

### Left over from the TAS-179 design pass (`art-director`, 2026-08-23)

Past the report's cap. Its four blocking findings were fixed in the story; these
were not.

- **The global search shows a 420×46 `--shadow-pop` panel to say "Type at least
  three characters"** on keystrokes 1 and 2 of every single search. A popover
  with the weight of a result list, carrying an instruction the reader is one
  keystroke from not needing.
- **`role="status"` regions in `GlobalSearch` are mounted and unmounted rather
  than updated in place.** Screen readers announce it today, measured, but the
  robust pattern is one persistent region whose text changes — a region that
  appears at the same moment its text does is at the mercy of the reader's
  timing.
- **`SearchHitsGroup`'s head is a `<strong>`,** so the group cannot be reached
  by heading navigation. It is a landmark in everything but markup.
- **A last keystroke that kills every local match moves cards out of the columns
  and into the hits band for about 200ms** before the debounce catches up. The
  cards are never wrong, but they travel.
- **The `aria-disabled` unopenable row carries none of §4.1's disabled recipe** —
  it is visually identical to a live row apart from a 10.5px `--fg-3` note.
  Unreachable against the mock, where search is already scoped to visible
  projects, so it was reviewed from code only.

Two states in this change could not be exercised at runtime at all, and that is
worth keeping: **the mock has no failing path for `searchIssues`**, so the error
branch of both new reads is reviewed from source; and `VIEWER` is unreachable
while `VITE_TASKA_ASSUME_PROJECT_ADMIN` is set. Neither is a defect. Both are
places where "verified" would be the wrong word.

### Left over from the TAS-179 contract pass (`api-contract-guard`, 2026-08-23)

Measured against the deployed gateway without a token, which is what made the
first two visible at all. Past the report's cap, so recorded rather than
triaged.

- **The gateway edge rejects `page < 0` and `pageSize` outside `1..100`
  pre-auth; the mock validates neither**, and `page: -1` there silently yields
  an empty slice. Unreachable today — the callers pass fixed sizes — but it is
  the reference implementation being laxer than the thing it models, same class
  as the membership scoping bug the same pass found and fixed.
- **The mock trims a query before measuring its length; the gateway counts raw
  characters.** Verified: `?query=%20%20` passes the edge. So `"ab "` is
  refused locally and would be accepted-and-empty remotely. Deliberate, and in
  a code comment, but not in `API-DIVERGENCE.md`.
- **`BoardScreen.tsx:616` falls back from the server total to `issues.length`.**
  Both implementations always set `totalCount`, so the branch is unreachable —
  and if it were ever reached it would print a page size where a project total
  belongs, which is the exact lie the story was written to remove. Worth
  deleting rather than documenting.
- The locally reproduced too-short message is the *service's* wording. For an
  empty or one-character query the edge answers `"Invalid request parameters"`
  instead, so `SEARCH_QUERY_TOO_SHORT_MESSAGE` is verbatim for one of the three
  lengths it covers. Only a developer reading a thrown error sees it.

### Left over from the TAS-179 review (`release-reviewer`, 2026-08-23)

Beyond the report's three-item cap, so recorded rather than triaged. None of
them blocks the story.

- **`GlobalSearch` sets `aria-expanded` from `listboxOpen` alone**, so it reads
  `false` while the too-short, searching and no-match panels are on screen.
  Deliberate and documented in the component — those panels are not a listbox —
  but a strict ARIA 1.2 reading wants either a popup role on the panel or the
  expanded state to follow the panel rather than the list.
- **An unlinkable hit can be arrowed onto and does nothing when opened.** A hit
  whose `issueKey` prefix matches no known project is `aria-disabled`, which is
  right, but Enter on it is silent — no message, no reason. Rare by
  construction; loud enough to be confusing when it happens.
- **Two search fields with different scopes now share `/projects`** — "Search
  issues" in the bar searches every project's issues, "Filter projects" in the
  heading narrows the cards. Both are correct and they are not the same
  question. Whether that reads as two fields or as one confusing one is
  `art-director`'s call, not a defect.
- **Case-colliding project keys would collapse in `projectIdByKey`** and route a
  hit to the wrong project. Unreachable in the mock seed; the gateway has never
  been asked whether it treats `TAS` and `tas` as one key. Worth a probe before
  it is worth a fix.
- **`summaryByProject`'s memo never memoises.** It depends on the `useQueries`
  result array, whose identity changes every render. Harmless — the body is
  cheap — but the memo is decoration, and a reader will assume it is doing
  something.

## Frontend stories already filed

Filed 2026-08-04 from the owner's own list, not from a review verdict. Each
frontend story is blocked by its backend half and ships mock-first meanwhile.

- [TAS-148](https://jira.ozero.dev/browse/TAS-148) — edit a project (name,
  description, **colour**) with the key shown read-only. Blocked by TAS-145.
  Takes over the Description-textarea item that used to sit above: the field
  stops being a silent no-op once the backend has somewhere to put it, and the
  same pass makes the create form send it. **Widened 2026-08-21** (owner's
  call, in Jira) to include a chosen project colour and a colour swatch in both
  the edit dialog and the create form; TAS-171 already draws every badge from a
  colour computed off `projectKey`, so what this story adds is the deliberate
  override on top, not the colour itself.
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

The 2026-08-23 refresh (backend `4241be2ec144`) brought two changes. The
search endpoint is claimed; the other is not:

- ~~**Issue search.** `GET /api/v1/issues/search`, the gateway half of
  TAS-110.~~ Claimed by [TAS-179](https://jira.ozero.dev/browse/TAS-179), with
  its runtime divergences filed as
  [TAS-180](https://jira.ozero.dev/browse/TAS-180) and written up in
  `API-DIVERGENCE.md`.
- **`notificationType` stopped being an enum.** The same refresh deleted
  `NotificationTypeDto` — a closed list of eleven values — and replaced the
  field with a bare `type: string` carrying `example: ISSUE_ASSIGNED,
  MEMBER_REMOVED etc.`. `src/domain/types.ts` still models `NotificationType`
  as a closed union of twelve, so the UI is now narrower than the contract, and
  a type the gateway invents next lands in a union that does not admit it.
  Exactly the family of the "status keys are open, and the UI's are closed"
  entry in `API-DIVERGENCE.md`, and it wants the same answer: narrow at the
  mapper rather than at the type. Found on 2026-08-23 while refreshing the
  snapshot for TAS-179; deliberately not fixed there, because a notification
  type has nothing to do with issue search and widening a story at snapshot
  time is how a reviewable diff stops being one. Note the twelfth value —
  `MEMBER_ROLE_CHANGED` was never in the enum the contract just deleted, so the
  union and the contract already disagreed before this.

The 2026-09-05 refresh (backend `8b8b3c5aca21`) brought seven endpoints and one
schema change. None was on the four open PRs this refresh was done for — they
landed on `develop` while this repository was looking elsewhere. **Three of the
five items below were claimed on 2026-09-08**, after the snapshot was refreshed
again to `96408229c1e4` and the deployed gateway was measured directly:

- ~~**Issue watchers, five routes.**~~ Claimed by
  [TAS-193](https://jira.ozero.dev/browse/TAS-193), which builds the `me` pair
  and the list and defers the two project-`ADMIN` routes: a watcher row carries
  only `userId`, and with no member read (TAS-137) there is nobody to name in a
  picker. Measured 2026-09-08 — `GET .../watchers` answers `200`
  `{totalCount, watchers[]}`, so the route is real and the array key is
  `watchers`, not `items`. `GET`/`POST
  /projects/{projectId}/issues/{issueId}/watchers`, `PUT`/`DELETE` on
  `.../watchers/me`, and `DELETE .../watchers/{userId}`. The `me` pair takes the
  user from the JWT and needs no body; the other two are project-`ADMIN` only.
  This is a real feature with a real UI (a watch toggle on the issue panel and a
  watcher list beside the assignee), not a mapping job, so it wants its own
  story rather than a corner of someone else's.
- ~~**`POST /admin/outbox/{service}/{eventId}/retry`.**~~ Claimed by
  [TAS-194](https://jira.ozero.dev/browse/TAS-194); the backend half merged
  2026-09-03 (PR #143) and the route is in the deployed gateway's own spec. The
  narrowing this item worried about is carried into the story rather than left
  here. The write half of TAS-106,
  which the Events section has never had. `service` is a closed enum of `auth`,
  `project`, `issue` — narrower than the service list the catalog returns, which
  is itself worth noticing before a retry button is drawn next to a row the
  endpoint cannot accept.
- **`GET /readonly/outbox/problematic-summary` is real now — and the
  measurement has been taken.** `TaskaApi.ts` documents it as existing "only in
  the TAS-105 branch", and the Problems view reads
  `OUTBOX_SUMMARY_UNSERVED_MESSAGE` off the deployed gateway to say so. **Probed
  2026-09-08** with a `GLOBAL_ADMIN` token: `200`, `{counts, events,
  notAllShown}`, two real `FAILED` events on `project` with
  `lastErrorMessage: "Failed to construct kafka producer"` and `attempts: 5`.
  The compensation is now describing a gateway that answers, so it can come out
  — worth folding into [TAS-194](https://jira.ozero.dev/browse/TAS-194), which
  opens that view anyway, rather than a story of its own.

  One thing that probe settles for TAS-194: `counts` names exactly `project`,
  `issue` and `auth` — the same three the retry route's `service` enum accepts.
  The Events section can therefore only ever draw a row whose service the retry
  endpoint takes, so the "narrower than the catalog" worry above is about the
  Data section's service list, not this one.
- ~~**`ListIssuesResponseDto.items` changed from `IssueShortResponseDto` to
  `IssueResponseDto`.**~~ **Measured 2026-09-08, and the answer is yes.** Against
  the deployed gateway with a `GLOBAL_ADMIN` token,
  `GET /projects/{id}/issues?page=0&pageSize=3` returns items carrying `status`
  (`"IN_PROGRESS"`), `description`, `createdAt` and a **populated** `labels`
  array — 1, 2 and 1 label across the three rows. Claimed by
  [TAS-195](https://jira.ozero.dev/browse/TAS-195). The same probe read the
  detail endpoint and got a non-empty `labels` back, which is the bug
  [TAS-178](https://jira.ozero.dev/browse/TAS-178) is about; that wants its own
  confirmation before the Jira story is closed.
  `RestTaskaApi.listIssues` hydrated every row from the detail endpoint because
  the short DTO carried no labels. The measurement was taken on 2026-09-08, the
  gateway agreed with its own contract, and the N+1 came out — a story of its
  own rather than a question in TAS-189's margin.
- **`NotificationTypeDto` is back in the vendored contract, and nothing
  references it.** It reappeared as a definition on two then-open PRs (#146,
  #118); #146 merged 2026-09-07, so the schema is now on `develop` and in the
  snapshot at `docs/contract/openapi.yml` — eleven values, `$ref`'d by nothing. The `notificationType` field is still a
  bare `type: string` with an `example`, so the entry above about the closed
  union stands unchanged; the schema coming back is not the enum coming back.

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
  as a duplicate of TAS-124/125 — which turned out not to cover it either;
  see the struck line below.)
- ~~[TAS-124](https://jira.ozero.dev/browse/TAS-124) /
  [TAS-125](https://jira.ozero.dev/browse/TAS-125) — Board API; removes the
  N+1 hydration.~~ **Withdrawn (TAS-191)** — it does not remove it. See
  `API-DIVERGENCE.md`, "The board hydration outlived its contract reason".
  The third place this promise was written and the last to be struck; the
  other two are that entry and `JIRA-WORKFLOW.md`'s dependency table.
- [TAS-145](https://jira.ozero.dev/browse/TAS-145) — `PATCH /projects/{id}`;
  `UpdateProject` does not exist and `taska.projects` has no `description`
  column, so the field the create form shows has nowhere to land yet. The
  project key stays immutable — it is part of every `issueKey`.
  **Widened 2026-08-21** (owner's call, in Jira): a nullable `color` column and
  DTO field, `description` accepted on create, and `{name?, description?,
  color?}` on the PATCH. No backfill and no server-side default — TAS-171
  computes the colour on the client, so `color` stays null until somebody
  chooses one. This is what makes the project half of the colour compensation
  in `API-DIVERGENCE.md` removable.
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
