# Jira delivery map

Personal Jira project: [TAS — АС Taska](https://jira.ozero.dev/projects/TAS/issues)

`TAS` covers the whole product — backend services, the API gateway, infra, and
this frontend. Only the taska-ui slice is mapped here. Issue types are in
Russian (`Задача`, `Ошибка`, `Новая функциональность`); keys and workflow
states are not.

## Frontend stories

| Key | Story | Jira status | In this repo |
| --- | --- | --- | --- |
| [TAS-114](https://jira.ozero.dev/browse/TAS-114) | Connect the frontend to gateway auth endpoints | Done | shipped |
| [TAS-134](https://jira.ozero.dev/browse/TAS-134) | Connect the current-user profile | To Do | shipped (`UserProfileMenu.tsx`) |
| [TAS-135](https://jira.ozero.dev/browse/TAS-135) | Add logout | Done | shipped |
| [TAS-136](https://jira.ozero.dev/browse/TAS-136) | Connect the frontend to gateway issue endpoints | To Do | merged (PR #6) |
| [TAS-140](https://jira.ozero.dev/browse/TAS-140) | Agent harness, skill pins, DESIGN.md reconciliation | Done | merged (PR #7); review fixes in PR #8 |
| [TAS-142](https://jira.ozero.dev/browse/TAS-142) | Overlay accessibility, focus-visible, review gaps | To Do | recorded in `DESIGN.md`, not started |
| [TAS-144](https://jira.ozero.dev/browse/TAS-144) | Page not found screen for an unknown or forbidden URL | To Do | merged (PR #11) |
| [TAS-148](https://jira.ozero.dev/browse/TAS-148) | Edit a project (name, description), key read-only | To Do | not started |
| [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Archive a project from the UI | To Do | not started |
| [TAS-150](https://jira.ozero.dev/browse/TAS-150) | Route guard: send a signed-out visitor to `/login` | Done | merged (PRs #12, #13, #15) |
| [TAS-151](https://jira.ozero.dev/browse/TAS-151) | Show the global role in the profile menu | Done | merged (PR #16) |
| [TAS-152](https://jira.ozero.dev/browse/TAS-152) | Admin entry in the profile menu, `/admin` route | Done | merged (PR #17) |
| [TAS-155](https://jira.ozero.dev/browse/TAS-155) | Read-only admin console over the gateway's `/readonly` endpoints | To Do | in review (PR #18) |
| [TAS-163](https://jira.ozero.dev/browse/TAS-163) | A failed `getProject` must not silently disable drag-and-drop or render unknown counts as `0` | To Do | `fix/TAS-163-board-resilience` |
| [TAS-164](https://jira.ozero.dev/browse/TAS-164) | Drag-and-drop does not work on touch devices | To Do | `fix/TAS-163-board-resilience` |
| [TAS-171](https://jira.ozero.dev/browse/TAS-171) | Deterministic colour for avatars and project key badges | Done | merged (PR #29) |
| [TAS-174](https://jira.ozero.dev/browse/TAS-174) | Assignee filter buttons announce no accessible name (WCAG 4.1.2) | To Do | filed from the TAS-171 reviews, not started |
| [TAS-175](https://jira.ozero.dev/browse/TAS-175) | Bright avatar palette restored, glyph computed from the fill | Done | merged (PR #32) |
| [TAS-177](https://jira.ozero.dev/browse/TAS-177) | Phone portrait: the projects list is clipped by the browser's own toolbar, and the board's "X of Y" counter stacks into a column | Done | merged (PR #34) |
| [TAS-179](https://jira.ozero.dev/browse/TAS-179) | Connect `GET /issues/search`: description in the board's local filter, a server search under it, global issue search in the shared top bar, and a client-side project filter | Done | merged (PR #36) |
| [TAS-181](https://jira.ozero.dev/browse/TAS-181) | The selection ring broke on the search panel's rounded corner, and the inbox left the bell when the bar wraps | Done | merged (PR #37) |
| [TAS-182](https://jira.ozero.dev/browse/TAS-182) | Self-host Hanken Grotesk instead of linking Google Fonts with `display=swap` | To Do | filed from the TAS-181 CI failure, not started |
| [TAS-183](https://jira.ozero.dev/browse/TAS-183) | A notification click landed on not-found; the projects filter field was shorter than the button beside it | Done | merged (PR #38) |
| [TAS-184](https://jira.ozero.dev/browse/TAS-184) | `notification.link` is a gateway API path, and empty for `ISSUE_ASSIGNED` / `ISSUE_TRANSITIONED` | To Do | backend ask; TAS-183 compensates |
| [TAS-185](https://jira.ozero.dev/browse/TAS-185) | The notifications bell reached only from a project board, though the inbox is the user's; now in the shared bar too | Done | merged (PR #39) |
| [TAS-167](https://jira.ozero.dev/browse/TAS-167) | Admin Events section: problems summary over the TAS-105 endpoint, outbox journal on the generic readonly grid, event card with the jsonb rule | Done | merged (PR #40) |
| [TAS-186](https://jira.ozero.dev/browse/TAS-186) | Admin Users section: the accounts list over `auth.users`, block and unblock behind a confirmation with a required reason | Done | merged (PR #41) |
| [TAS-187](https://jira.ozero.dev/browse/TAS-187) | Disable the `voltagent` plugin packs for this repository so their 60 generic agents stay out of every session's context | Done | merged (PR #42) |
| [TAS-188](https://jira.ozero.dev/browse/TAS-188) | Bring the admin user-status writes to backend PR #146's contract — `changedAt`, `LOCKED`, and the new reset-lockout write | Done | merged (PR #43) |
| [TAS-189](https://jira.ozero.dev/browse/TAS-189) | Issue planning fields — story points, start and due dates, both estimates (backend PR #148) | In Progress | API layer merged (PR #45); UI half open |
| [TAS-190](https://jira.ozero.dev/browse/TAS-190) | Issue attachments over presigned S3 links (backend PR #147) | Done | merged (PR #48) |
| [TAS-192](https://jira.ozero.dev/browse/TAS-192) | `.form-error` measures 3.17:1 in ten places; make the TAS-190 notice the product's error box | To Do | not started |
| [TAS-191](https://jira.ozero.dev/browse/TAS-191) | The gateway's board endpoint in the API layer, without moving the board screen onto it (backend PR #118) | In Progress | decided not to build a method yet, and why — `API-DIVERGENCE.md`, "The board route is declared, unimplemented, and narrower than the board it is named for" (PR #47) |

Two rows disagree with themselves. `TAS-134` and `TAS-136` are `To Do` in Jira
while their code exists — see the record in `HARNESS.md`. Trust the repository
column for what is built and Jira for what was agreed; when they disagree,
the story has drifted and should be transitioned rather than the table edited.

## Blocking dependencies outside this repository

| Key | Blocks | Effect on the UI |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) | full `rest` mode | No project membership or member reads. `hybrid` mode plus `VITE_TASKA_ASSUME_PROJECT_ADMIN` compensates. See `API-DIVERGENCE.md`. |
| [TAS-139](https://jira.ozero.dev/browse/TAS-139) | verifying `TAS-136` | `GET /api/v1/issues/{issueId}` returns 500 once an issue has a comment; via the list hydration this makes the whole board fail against live data. |
| [TAS-141](https://jira.ozero.dev/browse/TAS-141) | several UI affordances | Contract gaps: read-all, nullable assignee, comment ordering, CORS-exposed `X-Request-Id`, 404-on-empty-projects bug. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) | any client use of the board route | The route's gRPC method is declared and unimplemented, so a merged and deployed gateway answers `501 UNIMPLEMENTED`. The implementation is on backend PR #142, itself open and CONFLICTING, and PR #118 is CHANGES_REQUESTED besides. Nothing is built against the route until both land — see TAS-191. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) / [TAS-125](https://jira.ozero.dev/browse/TAS-125) | ~~removing the N+1 board hydration~~ — **nothing any more** | **Withdrawn (TAS-191).** The board API does not cover the list-DTO gap: `BoardIssueDto` has no description and no `createdAt` either, and gives status only as a column position, so the detail read stays. What may remove it is `ListIssuesResponseDto.items` becoming `IssueResponseDto`, which it already has on `develop` — that wants one measurement against the deployed gateway, not a contract reading. |
| [TAS-145](https://jira.ozero.dev/browse/TAS-145) | [TAS-148](https://jira.ozero.dev/browse/TAS-148) | No `PATCH /projects/{id}`, no `description` column and no `color` column. Until it ships, editing a project is mock-only. Widened 2026-08-21 to carry a nullable `color`, which is what makes the project half of TAS-171's compensation removable; the avatar half has no such story and is not meant to. |
| [TAS-129](https://jira.ozero.dev/browse/TAS-129) | nothing here, listed so the citation is checkable | Avatar upload through the gateway (presigned URL to MinIO), on top of TAS-128 which is Done. Referenced by `API-DIVERGENCE.md`'s colour entry only to say what the computed avatar colour is a fallback *under* — it does not gate TAS-171 or anything else in this repository. |
| [TAS-146](https://jira.ozero.dev/browse/TAS-146) | [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Nothing sets `archived_at`, so archiving is mock-only and the read-only board state cannot be exercised against the gateway. |
| [TAS-156](https://jira.ozero.dev/browse/TAS-156) | nothing any more — measured fixed | Was: every table read 500s and the catalog states no `primaryKey`. Measured on the stand 2026-08-25 (TAS-167 pre-flight): rows answer 200 (`issue.outbox_events`, `project.projects`), `primaryKey` is stated, rows are addressable. No longer blocks TAS-155/TAS-161/TAS-167; row kept until the story is closed in Jira. |
| [TAS-162](https://jira.ozero.dev/browse/TAS-162) | the board's core gesture | `GET /projects/{projectId}` 500s on every existing project. Via the membership synthesis this disables every drop target, so no card can be moved at all, and it zeroes every count on the projects screen. See `API-DIVERGENCE.md`. |
| [TAS-178](https://jira.ozero.dev/browse/TAS-178) | label chips on board cards | `GET /issues/{issueId}` answers `labels: []` for an issue that has labels, so no card draws a chip against the gateway. The association exists — the issue-labels route returns both — so this is the detail DTO going unfilled, not missing data. Probed 2026-08-23. See `API-DIVERGENCE.md`. |
| [TAS-107](https://jira.ozero.dev/browse/TAS-107) | the Users section's two buttons, not the section | `POST /admin/users/{userId}/block` and `…/unblock` exist only in backend PR #134 (`feature/TAS-107`, open). The list reads fine on the deployed gateway; the writes answer Spring's static-resource 404, which the confirmation dialog reads as "not deployed yet" rather than "no such user". Measured 2026-08-25. See `API-DIVERGENCE.md`. |
| [TAS-180](https://jira.ozero.dev/browse/TAS-180) | removing the search compensation, not the search | `GET /issues/search` rejects a two-character query the contract permits, `400`s on the empty `query` its own generated spec offers as the default, and silently ignores a `priority` or `issueType` it does not recognise — answering with the full set instead of an error. The UI compensates on all three, so search ships; the constant and the enum guard come out when this closes. Probed 2026-08-23. See `API-DIVERGENCE.md`. |

`TAS-147` was on this list until 2026-08-05 and is now Done: `globalRole` is in
the contract as of backend `25d0cf7000e5`, which is what unblocked `TAS-151`.
It is contract-level only — the field has not been seen on the deployed
gateway, and that half is tracked in `API-DIVERGENCE.md` rather than here,
because it is a runtime-versus-contract gap and not an unfiled backend ask.

## Branch and commit policy

- One branch per story: `feature/TAS-<n>`.
- Every commit subject starts with one Jira key: `TAS-140: add lint and test
  verification`.
- Commits may be smaller than stories. One PR aggregates a story's commits.
- `feature/TAS-140` was branched from `feature/TAS-136` rather than `main`,
  because the DESIGN.md reconciliation documents the comments UI that only
  existed on that branch. Both are merged.

## Mirroring acceptance criteria

Jira remains authoritative. Criteria are mirrored below so a read-only reviewer
without Jira access can audit. If this section drifts from Jira, Jira wins.

### TAS-140 — agent harness

- `AGENTS.md` defines the source ranking, four-role ownership, safety rules,
  and the evidence protocol.
- `art-director`, `api-contract-guard`, and `release-reviewer` are read-only;
  `frontend-builder` is the only subagent that writes production code.
- Refero MCP is reachable only by `art-director` and is constrained by
  `REFERENCE-LOCK.md`. The committed `.mcp.json` contains no literal token.
- `.agents/skills/` restores from `skills-lock.json` on a clean checkout and is
  absent from history.
- Clean `npm ci`, `npm run check`, and `npm run build` pass, and `npm run
  check` runs in `.github/workflows/frontend.yml`.
- `DESIGN.md` describes no structure that does not exist in the code; comments,
  the profile menu, and the API modes are documented.
- Divergences deliberately left unfixed — notably the missing toast component
  required by `DESIGN.md` §5.6 — are recorded as explicit gaps rather than
  deleted from the document.
- `art-director` returns a verdict on login and board at 1440×900, 1280×800,
  and 390×844 in both themes, citing `DESIGN.md` sections.

### TAS-179 — connect `GET /issues/search`

- The board's search finds an issue by a word that appears only in its
  `description`.
- The board reports an honest match count for the project rather than a count
  of the loaded page, which silently under-reports past 100 issues.
- The global search finds an issue in a project that is not currently open, and
  following the result opens it.
- The projects filter narrows the card list by project name and by project key.
- A query below the runtime's three-character minimum, and an empty query,
  never reach the wire — the parameter is omitted, never sent empty.
- `mock`, `rest` and `hybrid` remain behaviourally interchangeable, including
  on the rejection of a short query.
- A server hit is never rendered inside a status column: the search DTO carries
  no `status`, so a column placement would be a claim the gateway never made.
- `npm run check` and `npm run build` pass, with browser evidence across the
  three viewports in both themes.

Scope added by the owner mid-flight, folded into this story rather than filed
separately:

- The profile avatar is the last control on the top bar and is flush right at
  every width, including on a row the bar has wrapped onto.
- No anchored popover — profile, notifications, or the new search dropdown —
  crosses either edge of the viewport. The board bar wraps under 820px and
  packs the wrapped row at `flex-start`, which moved the avatar away from the
  right edge and sent its `right: 0` popover off the left of the screen.
- Verified at 390 and at the 760–820 band where the wrap begins, in both
  themes.
- Every popover in the bar closes on a click outside it and on `Escape`, not
  only on a second press of its own trigger. `DESIGN.md` §4.12 has required
  both of the notifications popover since before it shipped;
  `UserProfileMenu` was the only implementation of the pattern, so the three
  call sites share one hook rather than three copies of the same effect.

### TAS-186 — the admin Users section

- `/admin/users` lists every account of the instance with named columns —
  person, login, global role, status — read from `auth.users` through the
  existing read-only endpoint, replacing the §4.19 placeholder.
- Status and role read as §4.5 pills, with colour reserved for `BLOCKED`; a
  status this build does not recognise prints verbatim and offers no action.
- Each row offers exactly one button: Block for `ACTIVE` and `INVITED`, Unblock
  for `BLOCKED`, nothing otherwise.
- The button opens a §4.11 confirmation naming the person and the transition
  (`ACTIVE → BLOCKED`), with a required reason of at most 550 characters. A
  blank or whitespace-only reason never reaches the wire: the submit stays
  disabled and says why.
- The confirmation says two things when they are true and only then: blocking
  an `INVITED` account will not restore the invitation when it is unblocked,
  and the target is the account the reader is signed in as. Neither is a
  client-side prohibition — the server decides.
- No optimistic update, deliberately and recorded in `DESIGN.md` §5.8: the
  client cannot predict the last-active-admin count or the transition guard, so
  the button waits and the row takes the status the *server* named.
- On success the dialog closes, focus returns to the button, the row's pill
  changes, the row is marked briefly and a visually-hidden live region says so
  in words; the list is then refetched. The response's timestamp is never drawn
  — and it is `changedAt`, not `updatedAt`; TAS-188 renamed it after reading the
  mapper at backend PR #146's head.
- On failure the dialog stays open with the §5.8 taxonomy — refusal, rejected
  request, conflict, server fault, unreachable — the server's own sentence and
  `X-Request-Id` beside it. An undeployed route gets its own sentence naming
  TAS-107 rather than "user not found".
- No filter and no sortable header, because the gateway states neither for this
  table (measured 2026-08-25).
- `mock`, `rest` and `hybrid` stay behaviourally interchangeable; the mock
  reproduces every one of the server's refusals, and hybrid delegates the
  writes with no compensation.
- `npm run check` and `npm run build` pass, with browser evidence across the
  three viewports in both themes.

### TAS-188 — the admin user writes, brought to a contract that has not merged

- Backend PR #146 (TAS-107 + TAS-108) changes a contract TAS-186 already
  shipped against, from the draft in PR #134. Two changes, both silent:
  `updatedAt` became `changedAt`, and `UserStatus` grew `LOCKED`. The shipped
  REST mapper read the old name and the fixture pinned it, so the test agreed
  with the bug — this is why it needed finding by reading the backend rather
  than by running the app.
- `LOCKED` arrives **with** that PR, not before it. `develop` has three values
  in the entity, no `USER_STATUS_LOCKED` in the proto, and a
  `handleFailedAttempt` that takes no `User`. The first brief said otherwise and
  an adversarial pass over the contract caught it by reading `develop` where the
  spec had read the PR head. The rule that buys — a fact about what is deployed
  is read at `develop`, never at a PR head — is in `API-DIVERGENCE.md`.
- Third write, `reset-lockout`: legal only from `LOCKED`, refusing everything
  else with 400 carrying `FAILED_PRECONDITION`, not the 409 the backend's own
  controller test asserts against its own stub.
- `docs/contract/pending/` is new: one extract per open backend PR, pinned by
  head commit, so read-only reviewers can audit work written ahead of a merge.
  `npm run contract:pins` fails on a stale pin and is deliberately outside
  `npm run check`, which has to stay offline.
- Closes an interchangeability break inherited from TAS-186: the mock refused an
  over-long reason and REST sent it.
- Raised on the backend rather than absorbed: all three writes appear to answer
  500 on success (a protobuf `.name()` round trip), on TAS-107 and TAS-108.
- Found while measuring, older than this story: `BLOCKED` on the 22px scroll
  wash with the row flash reads 2.82:1, under §7's floor. In `BACKLOG.md`.
- Verdicts: `release-reviewer` ship; `api-contract-guard` do-not-ship on one
  documentation finding, then ship; `art-director` ship the design with changes
  to the measurement comment, then ship. `art-director` settled a contrast
  dispute between the first two passes — the figures were right and the other
  reviewer had measured against a plane the pill is never drawn on.
- Nothing here has met a real gateway. All three routes stay undeployed until
  PR #146 merges, so only the mock exercises the happy path.

### TAS-189 — planning fields, first half: the preservation, without the UI

- Split deliberately, and the split is the point. `PUT /issues/{issueId}` is a
  full replace and the contract does not say so: it marks three fields required
  and is silent about the five planning ones, which reads as "leave unchanged".
  The proto fields are optional, the gateway sets them with `setIfPresent`,
  `GrpcIssueService` resolves an unset optional with `.orElse(null)`, and
  `IssueServiceImpl` writes all five setters unconditionally. That code is on
  `develop` through TAS-115 — it is not waiting on backend PR #148.
- `BoardScreen` sends three partial bodies. Each erases story points and both
  dates the day #148 makes the fields reachable, with no error shown. So the
  API layer had to land **before** that merge, and it costs nothing to land
  early: every resolved value is `null` against today's gateway and the request
  body is byte-identical, pinned by an exact-body test rather than claimed.
- `UpdateIssueInput` gives `undefined` and `null` different meanings — absent
  leaves a field alone, explicit `null` clears it — so components keep the
  partial bodies they already write and full-replace never reaches a screen.
- Validation refuses only what the caller supplied. Validating the resolved
  pair would refuse a summary edit over stored dates the user never typed.
- `src/api/planningFields.ts` is shared by mock and rest, with
  `api-contract-guard`'s precedent for the stories after it: **share the
  decision, never the throw, never the test, and cite every rule to a backend
  artifact.**
- Five corrections from the builder, two of which would have shipped as
  defects: `JSON.stringify` turns `NaN` into `null`, which here means "clear the
  field"; and the stored-date cross-check refuses moving a whole window later in
  one request, which is the ordinary edit rather than an edge case.
- Three inference-stated-as-observation defects in the documents, one of them a
  correction that itself needed correcting: a 404 from the two-`n` spelling of a
  renamed backend test was read as the file being absent, by two readers in
  sequence. Both the module and `API-DIVERGENCE.md` now reserve "measured" for
  observation and mark every code read as a read.
- Verdicts: `release-reviewer` ship; `api-contract-guard` ship, then do-not-ship
  on one documentation paragraph, then closed. No `art-director` pass, because
  there is nothing visual in it.
- Left for the second half: the planning block on the issue panel, editing, the
  create form, and two test fixtures that omit the five behind a cast.

### TAS-191 — the board route, and the criterion this story declines to meet

Mirrored here **because** it declines one, not despite it: the section exists so
a reviewer without Jira can audit, and a story that did not meet its own
criteria is the one that most needs the record.

- The criterion was "the method exists in all three implementations and they are
  interchangeable". Not met, deliberately. Four independent reasons, each
  sufficient: the route's gRPC method is declared and unimplemented, so it
  answers `501` (the implementation is on backend PR #142, open and
  `CONFLICTING`); `BoardIssueDto` carries six of the nine fields the card draws,
  and drag-and-drop needs `status` and `issueType` as values rather than as a
  column position; `BoardServiceImpl` fails the whole board with a 500 on a
  `statusKey` the workflow lacks, where today an unknown status silently places
  no card; and `CHANGES_REQUESTED` stands on the access-control gap, so the fix
  adds 403 and 404 cases the contract does not have.
- The authority order settles it. The contract outranks the story, and a
  criterion written when the route looked usable does not survive the route not
  being usable. Writing the method anyway would put a `getBoard` on the
  interface that a later contributor could wire the board onto — turning a
  silent per-card degradation into a whole-board 500 while dropping six fields.
- What shipped instead: the analysis, three document corrections, and four
  findings on TAS-125, three of which its reviewers had not raised.
- The story stays open with the blocking condition named, and
  `npm run contract:pins` goes loud when PR #118 moves or merges.

### TAS-190 — issue attachments, and the leg that is not a gateway request

- Five routes, but the flow is three-legged and the middle leg is a cross-origin
  PUT straight to the object store. A third of the feature is a request this
  client's auth, tracing, error mapping and mock deliberately do not apply to.
  The PUT bypasses `request()` entirely and carries its failures in a shape
  outside the `ApiError` hierarchy, so a store's 403 cannot be classified as a
  gateway permission failure.
- Nothing in the backend repository configures CORS on the bucket and the host
  the browser is told to PUT to is loopback in every checked-in config, so the
  upload may not work from the deployed origin at all. The panel distinguishes
  "the store said no" from "we could not reach the store" — the second arrives
  as a `TypeError` with no status — and one upload attempt settles it.
- Confirm is never retried (no unique key on `object_key`, unconditional
  insert), and after any confirm failure the list is refetched before the reader
  is told anything, because a confirm can succeed on the server and fail in
  transit.
- Three backend findings on TAS-131: delete answers 204 for a missing
  attachment **and skips the role check**; the list mints a presigned URL per row
  that the gateway discards; and an over-size file answers **500**, because
  `RestErrorMapper` has no `OUT_OF_RANGE` row.
- Three of our own comments claimed that last status was 400, citing a mapping
  table in a library the gateway does not consult, with a test pinning it. One
  was on the interface doc governing all three implementations.
- Two rules came out of it and are now in `AGENTS.md`: when a mock/rest
  divergence may wait, and when a non-gateway call may live on `TaskaApi`.
- Verdicts: `release-reviewer` do-not-ship on two, then ship — it verified the
  new tests by mutation rather than by reading them, five mutants all killed.
  `art-director` do-not-ship on two measured findings in the failure notice,
  then ship. `api-contract-guard` ship, then a separate fix-now ruling.
- `.form-error`'s 3.17:1 graduated to TAS-192 rather than widening this story.
- Nothing here has met a real gateway: all five routes answer the
  undeployed-route 404, measured against a 401 control on the comment route.

### TAS-187 — the voltagent packs, off for this repository

- `.claude/settings.json` is new and tracked: `enabledPlugins: false` for
  `voltagent-lang`, `voltagent-data-ai` and `voltagent-qa-sec`, written by
  `claude plugin disable -s project`. Project scope, so the rule travels with
  the checkout rather than living on one machine.
- The user-level install is untouched — the packs stay enabled in every other
  project — and the merge is per-key, so `codex@openai-codex` survives here.
- Measured on the live agent registry, not on the settings report: a session
  opened in this checkout lists no `voltagent-*` type, one opened from the home
  directory lists 60. A `git archive` of the commit into a bare directory
  behaves the same, which is what "travels with the checkout" means.
- 60, not the 63 first written into the story: the `agents` arrays in each
  pack's `plugin.json` hold 30 + 13 + 17, and counting `*.md` on disk swept in
  three `README.md` files that never load. The story summary is corrected; its
  description still carries the wrong figure and the closing comment says so.
- Worktrees pick the rule up only once their checkout carries the commit —
  project settings are read from the session's own root and do not inherit from
  a parent directory, so the worktrees that predate it keep the packs.
- `AGENTS.md`'s *Plugins* bullet called these packs the best substitute for a
  project role that cannot run. With them off that is false, and it read past
  `CLAUDE.md`: such a role stops the run, and the substitute is the owner's
  call after that report.
- Residual, and not closed here: `.claude/settings.local.json` is git-ignored
  and outranks the tracked file, so a later `claude plugin enable` without
  `-s project` could re-enable the packs with no diff to review.
- `npm run check` and `npm run build` pass. Neither says anything about the
  plugin claims above; those rest on the registry probes.
