# Gateway divergence record

`docs/contract/openapi.yml` — vendored from the backend repository — states
what the API Gateway is *meant* to do. `api.taska.ozero.dev` states what it
*does*. This file records every place the frontend compensates for a gap
between the two, and every place the contract is silent on something the UI
needs. The frontend adapts to the backend, never the other way around.

An undocumented workaround is a blocking finding for `api-contract-guard`. The
point of the file is that compensations stay visible and removable instead of
dissolving into component code where nobody can find them again.

> **Re-baselined 2026-08-03.** The first version of this file audited against
> `design_handoff_taska/api-gateway-rest-draft.md`, which predates the
> gateway's existence. Most "divergences" found on that baseline were the
> draft being stale: the deployed issue routes (`/api/v1/issues/{issueId}`),
> full-object `PUT` update, `PUT …/transition/{transitionId}`, the flat
> `{code, message}` error body, and the comment endpoints with their
> `pageSize` cap of 50 **are the contract**, and `RestTaskaApi` conforms to
> it. Withdrawn entries are in `HARNESS.md`'s record, not silently deleted.

## Format

Each entry names the endpoint, the observed behaviour, what the UI does
instead, how the compensation is switched off, and the Jira key that removes
it. Entries are deleted only when the compensating code is deleted.

---

## Runtime differs from the contract

Headings starting with "Closed by" are settled and kept for their history;
everything else here is live. A closed entry may still carry a live sub-fact —
it says so in its own first paragraph when it does, because closing a heading
is cheaper than splitting an entry and the reader has to be told which.


### Closed by TAS-154: `GET /projects/{projectId}` answers 200

- **Endpoint:** `GET /api/v1/projects/{projectId}`
- **Contract:** `200` with `ProjectResponseDto`.
- **Observed 2026-08-12**, signed in as `admin` (`GLOBAL_ADMIN`), against the
  deployed gateway: **500** `{"code":"INTERNAL","message":"Internal error"}` for
  all seven real project ids, without exception. Request ids
  `fe1d39e6-b34c-45d6-9fd3-5c4ddee7dd73` and
  `9a5533b2-7d21-4c8f-bf1b-4c814b021ce7`.
  - `GET /projects` (the list) answers `200` with all seven projects, so the
    data is readable — it is the single-project read that fails.
  - A **nonexistent** id answers a clean `404 NOT_FOUND: "Project not found"`.
    A valid id 500s and an invalid one 404s, which places the fault *after* the
    project row is resolved — in mapping or serialising the found record, not in
    the lookup. Same diagnostic shape used to localise the admin-service 500
    below.
  - `…/issues`, `…/workflow` and `GET /issues/{id}` all answer `200`.
- **Compensation:** none, and none is appropriate — the frontend does not work
  around a server fault.
- **User-visible effect as first observed on 2026-08-12, before the same day's
  fixes.** Kept in the past tense on purpose: this is what the 500 did to the
  shipped build, and it is why TAS-163 exists. What it does *now* is the bullet
  below. This single 500 disabled the product's core gesture. Because the
  contract has no membership endpoint (see TAS-137 below),
  `HybridTaskaApi.getMembership` synthesised the caller's role from
  `getProject` + `getCurrentUser`. The 500 rejected that query,
  `membershipQuery.data` was `undefined`, `canEdit` was `false`, and every
  column was a `useDroppable({disabled: true})` — so **no card could be dragged
  to any status, on desktop or on touch**. Verified in the browser: the card
  lifted and followed the cursor, no column ever reported `is-over`, nothing
  moved, and nothing was said. `VITE_TASKA_ASSUME_PROJECT_ADMIN` did not rescue
  it, because the flag was read *inside* `getMembership`, which rejected earlier
  on its `Promise.all`. On the projects screen the same rejection travelled
  through `listMembers` and collapsed the whole `Promise.all`, so every card
  read "0 issues / 0 members" while the issue lists themselves loaded fine.
- **The frontend half is a real defect of ours, not just fallout:** a failed
  role read must not be indistinguishable from `VIEWER`, and an unknown count
  must not render as `0`. Tracked as
  [TAS-163](https://jira.ozero.dev/browse/TAS-163) and fixed on
  `fix/TAS-163-board-resilience`; this entry stays open until the gateway is
  fixed regardless.
- **Drag came back on 2026-08-12, six days before the 500 did.**
  `getMembership` stopped reading the project when
  `VITE_TASKA_ASSUME_PROJECT_ADMIN` is on (see the membership entry below), so
  this endpoint stopped deciding whether anyone may write. Everything else the
  500 broke it went on breaking until the fix below: no project name, no key,
  no member list, no assignee row. The lesson outlives the bug — a working
  board was never evidence that this endpoint worked.
- **Fixed on the stand, verified 2026-08-18** with a `GLOBAL_ADMIN` token
  against `api.taska.ozero.dev`, on backend `7fb303b53ba6`: **200** with a full
  `ProjectResponseDto` for three ids spanning the range that used to fail —
  `c9594240…` (`API`, created 2026-07-30, one of the seven originally observed),
  `9e6ee639…` (`TEST_154`) and `c2ed3fd0…` (`TAS`). Not one 500. The fix is
  [TAS-154](https://jira.ozero.dev/browse/TAS-154), which added a membership
  check to `project-service`'s read path — the mapping fault this entry
  localised was in the code that check replaced.
- **The non-member case, observed 2026-08-18** with a second token
  (`defaultUser`, `globalRole: USER`, a member of exactly one project):

  | Request | Answer |
  | --- | --- |
  | `GET /projects/{a project they are a member of}` | **200** with the full DTO |
  | `GET /projects/{an existing project they are not in}` | **403** `PERMISSION_DENIED` "You don't have access to this project" |
  | `GET /projects/{a well-formed id that does not exist}` | **404** `NOT_FOUND` "Project not found" |

  So the refusal is a clean 403 with a domain code, not a 500 and not a
  disguised 404. `isMissingOrForbidden` already covers both the code and the
  status, and `BoardScreen` answers with the Not-found screen — verified end to
  end against the real gateway through the dev proxy: the board URL of a project
  this user is not in draws "This page doesn't exist, or you don't have access
  to it." — the screen's own words — and their own board draws normally. No frontend change needed; the
  compensation written for the 500 turns out to be the right shape for the 403.
- **What is still owed here:** only
  [TAS-137](https://jira.ozero.dev/browse/TAS-137), which removes the coupling
  that turned this endpoint into a permissions outage.
  [TAS-162](https://jira.ozero.dev/browse/TAS-162) is answered, and the
  non-member case this entry used to wait on is the bullet directly above.

### A failed workflow read is silently replaced by the mock's workflow

- **Endpoint:** `GET /api/v1/projects/{projectId}/workflow`
- **Found by `api-contract-guard`, 2026-08-12.** Pre-existing; recorded now
  because it stopped being unreachable on the stand that day.
- **Compensation:** `BoardScreen`'s `fallbackStatuses` / `fallbackTransitions`
  are used whenever `workflowQuery.data` is undefined — including when the read
  *failed*, not only before it has answered. Their transition ids are
  byte-for-byte the mock's seeded UUIDs (`MockTaskaApi`), so a board whose
  workflow could not be read presents three invented columns as this project's
  workflow, with nothing said, and a drop posts
  `transitionId: "55555555-5555-5555-5555-555555555555"` to a gateway that has
  never heard of it.
- **Why it is newly reachable:** until `getMembership` stopped depending on the
  project read (see the membership entry), a gateway sick enough to fail the
  workflow read was also failing the membership read, so `canEdit` was false and
  every droppable disabled — nothing could be dropped and the fabricated
  workflow was inert. With the flag on, `canEdit` is now unconditionally true on
  the stand, so the fabricated workflow is live.
- **The shape of the bug is this file's whole subject:** the fallback is a
  reasonable *loading* default and a lie as a *failure* default, and one
  `undefined` check cannot tell those apart. Note the notice gate on the board
  covers project, role, issues, transition and drag — but not the workflow.
- **Fix:** treat the failure separately from the wait (`useUnanswered`, as the
  other four queries now do), say so, and refuse a drop whose transition came
  from the fallback rather than posting an id the server cannot know.
- **Removal:** the fix above; there is no backend ask here. The endpoint answers
  `200` on the stand today.

### The contract's status keys are open, and the UI's are closed

- **Endpoint:** `GET /api/v1/projects/{projectId}/workflow`
- **Contract:** `statusKey` and `category` are deliberately unconstrained
  strings — the description says the enum is omitted "для расширяемости".
- **UI:** both are modelled as the closed `IssueStatus` union, and
  `statusLabels` / `statusColors` (`src/lib/format.ts`) are keyed off it.
- **Consequence:** a fourth status key renders a column with no colour and no
  label, and its issues appear in no column at all — the board filters cards by
  `issue.status === status.statusKey`.
- **Compensation:** none. Recorded so the next person to add a status knows the
  frontend will not simply follow.
- **Removal:** narrow at the mapper the way TAS-151 did for `globalRole`, or
  have the contract state the enum. Filed 2026-09-11: the source is
  [TAS-217](https://jira.ozero.dev/browse/TAS-217) (`GET /meta`), the mapper
  defence is [TAS-173](https://jira.ozero.dev/browse/TAS-173), the contract
  `$ref` is [TAS-206](https://jira.ozero.dev/browse/TAS-206).

### Closed by measurement (TAS-195 pass): `GET /issues/{issueId}` no longer 500s on a commented issue

- **Endpoint:** `GET /api/v1/issues/{issueId}`
- **Contract:** returns the issue with its history (`IssueWithHistoryResponseDto`).
- **Observed:** 500 `"Unknown event type: ISSUE_EVENT_TYPE_COMMENT_CREATED"` —
  the gateway's `IssueMapper.toRestIssueEventType` does not map the comment
  event types that `TAS-109` introduced.
- **Compensation:** none. The frontend does not work around this.
- **User-visible effect (both halves have since changed):** while the N+1
  hydration existed, one commented issue anywhere in a project made the whole
  board fail to load, and the projects screen lost every card's issue count and
  member row with it. TAS-195 removed that multiplier — the board no longer
  reads the detail route — so the blast radius is now the issue panel and the notifications bell's single
  lookup, rather than a board.
  And the fault itself no longer reproduces: **measured 2026-09-08**, three
  issues carrying 1, 1 and 4 comments each answered `200` from
  `GET /issues/{issueId}`, one of them carrying a label as well.

  **A `200` alone would not have closed this, and the reviewer was right to say
  so.** The gateway could have "fixed" the unknown-event `500` by dropping
  events it cannot name, which reads as success and silently empties the
  panel's history. It did not: the returned histories carry `COMMENT_CREATED`,
  and one of them `COMMENT_UPDATED` and `COMMENT_DELETED` as well. `CRM-2`
  settles both families at once — four comments and a label, `LABEL_ADDED` and
  three comment event types in one history, answering `200`.
- **Not observed on 2026-08-12, but that is not an all-clear.** Hydrating every
  issue in all seven projects — 19 `GET /issues/{id}` calls, the exact path that
  used to fail — returned `200` every time. What was *not* established is
  whether any of those 19 issues carries a comment, and without that the run
  says nothing about the failing condition. Treat this as "the bug did not
  appear in a sample of unknown relevance", not as "the bug is fixed". Closing
  it needs a deliberate probe: add a comment to an issue, then read that issue.
- **Removal:** [TAS-139](https://jira.ozero.dev/browse/TAS-139).

### `GET /projects` reports an empty collection as 404

- **Endpoint:** `GET /api/v1/projects`
- **Contract:** `200` with a project list.
- **Observed:** project-service surfaces "no projects" as `NOT_FOUND`.
- **Compensation:** `RestTaskaApi.listProjects` maps **any** 404 to `[]`, so a
  misrouted base URL or a renamed path after a gateway deploy renders as "you
  have no projects" with no error anywhere.
- **Removal:** [TAS-207](https://jira.ozero.dev/browse/TAS-207), re-filed from
  TAS-141 which closed without it; [TAS-211](https://jira.ozero.dev/browse/TAS-211)
  restates it for the enriched list. Until then
  the catch should at least be narrowed to the specific error `code`.

### Closed by TAS-147: `globalRole` is on the wire, with both values seen

- **Endpoint:** `GET /api/v1/users/me`
- **Contract:** since backend `25d0cf7000e5` (TAS-147), the response carries
  `globalRole` as `enum [GLOBAL_ADMIN, USER, UNSPECIFIED]`. The DTO has no
  `required` block, so the field is formally optional.
- **Observed 2026-08-18**, on backend `7fb303b53ba6`, with two real tokens:
  `GET /users/me` answers `"globalRole": "GLOBAL_ADMIN"` for `admin` and
  `"globalRole": "USER"` for `defaultUser`. The field is present, spelled as the
  enum spells it, and both live values have now been seen — so the Administration
  entry appears for one account and not the other from the wire's own answer
  rather than from a default. `UNSPECIFIED` has still never arrived.
- **Compensation:** `RestTaskaApi.getCurrentUser` normalises a missing field,
  `UNSPECIFIED`, and any unrecognised value to `undefined`, and the UI reads
  that as "no role stated". Confirmed against the gateway's own `AuthMapper`,
  where `UNSPECIFIED` is the sink for the proto zero value — so this is a
  faithful reading, not a guess.
- **User-visible effect while the deployment lags:** the Role row is simply
  absent, and — from TAS-152 — the Administration entry is absent with it. A
  real `GLOBAL_ADMIN` on an older gateway sees the app exactly as a plain user
  does, with nothing anywhere saying why.
- **The part that matters:** "the server said UNSPECIFIED" and "this gateway is
  too old to say" are deliberately indistinguishable in the UI. That is the
  right call for a display-only row and a knowingly lossy one once the value
  decides whether a menu entry exists. Hiding the entry is safe in the
  direction that counts: `/api/v1/readonly/*` is `GLOBAL_ADMIN`-only and
  enumerates `401`/`403`, so the server refuses regardless of what the menu
  shows. The `/admin` screen must therefore still render a real 403 rather
  than treat it as unreachable.
- **What is still owed here:** nothing on the gateway's side — TAS-147 is Done
  at contract level and the runtime was observed on 2026-08-18. The normaliser
  in `RestTaskaApi.getCurrentUser` stays until `UNSPECIFIED` is either seen on
  the wire or dropped from the enum, since it is the only enum member no live
  response has produced.

---

### Closed by TAS-194: `jsonb` values arrived as `JsonByteArrayInput{…}`, and now arrive as JSON

**Closed on the probe this entry insisted on, not on the merge date.** Backend
PR #141 landed 2026-08-27; the entry refused to close on that and asked for one
`issue.outbox_events` row to be read. **Measured 2026-09-08** with a
`GLOBAL_ADMIN` token: twenty rows, every `payload` a clean JSON string, and the
substring `JsonByteArrayInput` absent from the whole response. The first row
reads `{"issueId": "df53f9b1-…", "projectId": "eedc3a5b-…", "actorUserId": …}`.

The mock's malformed seed and the assertion pinning it came out with it. What
did **not** come out is the card's rule — parse as JSON and pretty-print,
otherwise print verbatim — because that was never a compensation: it is
TAS-167's instruction to escalate rather than repair, and it is what makes the
*next* malformed payload visible. The seed was replaced by direct unit tests on
the rule itself, built on values that are simply not JSON rather than on a Java
`toString` this gateway no longer emits. Worth noting why that matters: the old
assertion pinned the *seed*, not the rule, so the rule had no coverage at all
until it was removed and replaced.

The entry as it stood:


- **Endpoints:** `GET /readonly/{service}/{table}` and
  `GET /readonly/{service}/{table}/{id}` — every `jsonb` column,
  `outbox_events.payload` most visibly.
- **Observed:** admin-service's `ListTableRowsMapper.toGrpcValue` has no
  branch for `io.r2dbc.postgresql.codec.Json`, so a jsonb value falls through
  to `value.toString()` and reaches the client as `JsonByteArrayInput{{…}}`.
  Verified twice on 2026-08-25: in the develop source (the fall-through
  branch) and live (a probed `issue.outbox_events` payload begins
  `JsonByteArrayInput{{"issue`). The fix — an `instanceof Json →
  asString()` branch — is in
  [backend PR #141](https://github.com/VladislavYurin/taska-backend/pull/141)
  (TAS-105), **merged 2026-08-27** — the fall-through branch is gone on
  `develop`, replaced by an `instanceof Json → asString()` branch ahead of it.
  **Deployment is established, and the doubt is about the mechanism instead.**
  The summary route out of the same PR answers with real rows, and those rows
  come from admin-service's gRPC rather than from the gateway, so the deployed
  admin-service carries this branch in the same artifact — and so does the
  gateway half of that PR, proven by the same 200. **The residual is smaller
  than it looks, and this entry overstated it once already.** Whether the value
  reaches the mapper as `io.r2dbc.postgresql.codec.Json` is already answered by
  this entry's own 2026-08-25 probe: `JsonByteArrayInput` *is* that class's
  nested `JsonInput` subtype, and the observed prefix is its `toString()`. The
  value that produced `JsonByteArrayInput{{"issue` was an `instanceof Json` by
  construction, so it takes the new branch. What is missing is only that nobody
  has read a payload since the deploy. Probe one `issue.outbox_events` row
  before closing this — as confirmation, not as an open question.
- **The UI instead:** prints it verbatim, never repaired. The card's jsonb
  rule (`src/screens/admin/columns.ts`) is parse-as-JSON → pretty-print,
  anything else → verbatim, so the broken format stays *visible* by design —
  TAS-167's own instruction is to escalate, not to strip the java prefix
  client-side. The mock deliberately seeds one such payload
  (`src/api/mock/MockTaskaApi.ts`), with a test holding the case reachable,
  so the verbatim branch is exercised locally. The fix landed on 2026-08-27; what
  remains here is the seed, which TAS-194 drops.
- **Switch-off:** nothing to switch — the backend fix deployed, and real JSON
  flows into the same rule's pretty-print branch on its own. Note what that does
  *not* switch off: the mock's seed, and the comments naming this a live gap.
  Those are the parts that need a story, which is the difference this whole
  entry is about.
- **Removal:** [TAS-194](https://jira.ozero.dev/browse/TAS-194), same as the
  summary entry below — close the two together. The trigger the old wording
  named, "TAS-105 merging and deploying", happened on 2026-08-27 and closed
  nothing. The reason here is not the summary entry's — this compensation is not
  a quiet note but verbatim text on an event card, and it went unnoticed because
  nobody reads a payload closely and the mock still seeds the broken form
  locally, so the product looks the same either way. Same conclusion by a
  different road: a probe is what closes this, not a merge date. When closing this one, also drop the
  mock's malformed `JsonByteArrayInput` seed and the assertion that pins it
  (`MockTaskaApi.test.ts`): after the fix they model a state the gateway can
  no longer produce.

---

## The contract is silent or lacks what the UI needs

Same rule as above: "Closed by" is settled, the rest is live.


### No membership or member-read endpoints

- **Missing:** `GET /projects/{id}/membership`, `GET /projects/{id}/members`
  (the contract has only `POST /members` and `PATCH/DELETE /members/{userId}`).
- **Compensation:** `HybridTaskaApi` (`src/api/HybridTaskaApi.ts`) synthesises
  both from `GET /projects/{id}` and `GET /users/me`. `getMembership` returns
  `ADMIN` when `VITE_TASKA_ASSUME_PROJECT_ADMIN=true` or the caller created the
  project, and `VIEWER` otherwise. `listMembers` returns a single-element list
  containing only the current user.
- **Narrowed 2026-08-12 (owner's call).** With the flag on, `getMembership` no
  longer reads the project at all. It never used the value on that path — the
  role is the flag, and `isMember`/`projectExists` are hardcoded — so the call
  contributed nothing but a way to fail, and TAS-162's 500 was reaching through
  it to revoke write access on the deployed stand. With the flag **off** the
  behaviour is unchanged, failure included, because `createdBy` is genuinely
  needed there. `listMembers` still reads the project (it needs `addedAt` and
  `addedBy`) and still fails honestly while the gateway is broken: the assignee
  row stays empty and the member count reads as unknown.
- **What this costs, stated plainly:** with the flag on, `getMembership` can no
  longer reject, so the "your role could not be determined" state added by
  [TAS-163](https://jira.ozero.dev/browse/TAS-163) is unreachable in the
  deployed configuration. It stays reachable in `rest` mode, with the flag off,
  and in unit tests — which is where it is proven, deliberately, rather than by
  a configuration nobody runs. This is the trade: the stand gets its board back
  today, and the honesty path it just gained is exercised everywhere except the
  stand.
- **What it is not:** a workaround for the 500. The board still reports that the
  project details failed, still shows no name or key, and still has no member
  list. The only thing that changed is that a read the flag does not consult
  stopped deciding whether the user may write.
- **User-visible effect:** a project appears to have exactly one member; the
  assignee filter and chips can only ever offer the current user.
- **A third consumer, and the first that turns the synthesis into an assertion**
  (`api-contract-guard`, 2026-09-09, TAS-193). The watcher picker draws from the
  same list, which is the right reuse — but where the assignee chips merely
  *offer fewer people*, the watcher section wanted to say "everyone on this
  project is already watching" when the picker came back empty. Under the
  synthesis that sentence is **false on the stand**, for the reader most likely
  to act on it: the list succeeds with one element, so the §5.6 boundary — only
  a successful read may claim there is nobody — cannot tell it from a real
  answer. The boundary holds against a failed read and not against a
  synthesised one, and no UI can close that, because the two are the same
  response.

  TAS-193 answered by narrowing the claim to what the client can see rather
  than to the project. Worth carrying here because the lesson generalises past
  watchers: **a synthesised read is safe to draw from and unsafe to conclude
  from.** Anything built on this list may offer, and may not assert.

  **And the nameless member is the contract's default, not its edge case**
  (`frontend-builder`, 2026-09-09, TAS-193). `ProjectMemberResponseDto` states
  `projectId`, `userId` and `role` and carries **no user summary at all**, and
  there is no `GET /projects/{projectId}/members` in the contract whatsoever —
  the client's member read is against a route the contract does not describe. So
  if that read ever ships as the DTO is written, every name this map resolves
  goes at once: every watcher row, every picker option, every assignee chip.
  What today reads as a rare "Unknown" beside a real name would become the whole
  column. Worth knowing before anyone treats the nameless case as an edge worth
  little wording effort.

  **The picker is the surface that fails first**, and it fails differently from
  the rest: N identical "Unknown" options with only source order to tell them
  apart, where a row at least sits beside a date and a control. The section
  already owns the device for that state — `shortKey` (§5.8), which labels the
  ✕ — so if this ever becomes the common case the answer is on hand rather than
  to be invented. Recorded beside the prediction rather than in the backlog,
  because it is a consequence of the contract's shape and not work anyone should
  start today.
- **Two further consequences** (found by `api-contract-guard`, 2026-08-03):
  `isMember: true` and `projectExists: true` are hardcoded, so a non-member or
  a deleted project reads as a healthy membership; and with the flag off, a
  real `MEMBER` or a co-`ADMIN` who did not create the project is silently
  demoted to `VIEWER`. The synthesis both over- and under-grants.
- **Removal:** [TAS-137](https://jira.ozero.dev/browse/TAS-137), and on top of
  it [TAS-212](https://jira.ozero.dev/browse/TAS-212), which puts the same
  members with names into the project read so the board needs no separate
  member call. When it
  ships, delete `HybridTaskaApi`, drop `VITE_TASKA_ASSUME_PROJECT_ADMIN`, and
  default `VITE_TASKA_API_MODE` to `rest`. The flag lives in five places, and
  deleting only the first is what makes a removal look finished when it is
  not: `src/api/client.ts`, `.github/workflows/deploy-pages.yml`,
  `.env.example`, `README.md`, and the GitHub repository variable itself
  (`gh variable list`).
- **Risk while open:** with the flag on, every caller gets an `ADMIN` view of
  the UI; role gating is unverifiable in this mode and a passing permission
  check proves nothing.
- **A 401 here signs the reader out, and nothing states when a 401 is the right
  answer.** Moved from the project-read entry when that one closed, because this
  risk did not close with it. Since TAS-150 the client treats **every** 401 on a
  bearer route as a dead session: tokens cleared, cache dropped, back to
  `/login`. `isMissingOrForbidden` covers 403/404 only, so the two answers do
  not overlap today — but the contract's `code` is a free-form string with
  nothing else to key on, and `GET /projects/{id}/membership` and
  `GET /projects/{id}/members` have no contract at all. If either ever answers
  401 for "not yours" rather than "not authenticated", a member browsing
  somebody else's project is signed out instead of shown the Not-found screen.
  Re-check before `rest` becomes the default mode. Neither was probed for this
  question on 2026-08-18: a `GET` to `…/members` answered **405**, since the
  contract gives that path a `POST` only, and `…/membership` was never
  requested. So the live half of this risk is `…/membership` plus whatever
  TAS-137 adds — a path that answers 405 unconditionally can never answer a 401
  for "not yours".

### Accepting an invitation does not produce a session

- **Endpoint:** `POST /api/v1/auth/invitations/accept` (`setPasswordByToken`).
- **Contract:** `204 No Content` — no body, no tokens. Nothing anywhere states
  how a user who has just activated their account gets a session, and the
  invite form never collects the email that `POST /auth/login` would need to
  sign them in afterwards.
- **Compensation:** none, deliberately. `MockTaskaApi.acceptInvitation` briefly
  persisted a session of its own during TAS-150; that was removed, because
  `rest` cannot do the same from a 204 and the two modes would have disagreed
  about whether an activated user is signed in. The mock now leaves the visitor
  signed out, so the route guard returns them to `/login` — which says nothing
  at all about what just happened. In `rest` the screen calls `GET /users/me`
  right after the 204, with no bearer token, and the gateway's raw 401 message
  lands in `.form-error`.
- **User-visible effect:** activation appears to fail, or at best to end
  nowhere: in both modes the user is left at a sign-in form with no statement
  that their password was in fact set.
- **Removal:** [TAS-204](https://jira.ozero.dev/browse/TAS-204), re-filed
  2026-09-11 from TAS-141 which closed without it; the frontend half is
  [TAS-208](https://jira.ozero.dev/browse/TAS-208) — either return
  tokens from the accept call, or state in the contract that the client must
  sign in afterwards (in which case the UI should collect the email and do it).

### The mock has a session flag but no session enforcement

- **Where:** `src/api/mock/MockTaskaApi.ts`.
- **What exists since TAS-150:** `hasSession()` / `login()` / `logout()` keep a
  user id in `localStorage`, which is enough for the route guard and for a
  reload to behave as it does against the gateway.
- **What does not:** `MockTaskaStore`'s data methods still answer without a
  session — the mock doubles as the unit-test fixture and as the seed the UI is
  developed against, so making them throw is a larger change than the guard
  needed. `logout()` clears the flag but leaves `currentUserId` pointing at the
  last user, and `onSessionExpired` is implemented as a no-op subscription: the
  mock has no server, so nothing can ever reject a token.
- **Consequence:** the expiry half of TAS-150 — a 401 the refresh cannot
  repair, the cleared query cache, the redirect to `/login` with "Your session
  expired." — is structurally unreachable from the mock-backed Playwright
  suite, which is the only e2e suite this repository has. It is covered instead
  by `src/api/rest/RestTaskaApi.test.ts` (the announcement) and
  `src/screens/App.test.tsx` (the redirect, the cache clear, the notice and its
  focus) against a fake `TaskaApi`. That closes the behaviour, not the gap: no
  test in this repository drives the real path end to end.
- **Removal:** nothing schedules it. It disappears when `rest` becomes the
  default mode (after [TAS-137](https://jira.ozero.dev/browse/TAS-137)) and the
  e2e suite can run against a gateway that rejects tokens.

### Closed by TAS-195: the board hydration outlived its contract reason, and then its runtime one

**The measurement this entry asked for was taken on 2026-09-08 and the answer
was yes.** Against the deployed gateway with a `GLOBAL_ADMIN` token,
`GET /api/v1/projects/{id}/issues?page=0&pageSize=3` returned items carrying
`status` (`"IN_PROGRESS"`), `description`, `createdAt` and a **populated**
`labels` array — 1, 2 and 1 label across the three rows. Re-checked across three
more projects the same day: list label counts matched the detail read on every
row compared. The hydration came out in TAS-195; `listIssues` maps the page
directly and the board load is one request instead of up to 101.

The two response types stopped sharing an interface in the same change, which is
the part worth remembering: `ListIssuesResponseDto.items` is `IssueResponseDto`
and `SearchIssuesResponseDto.items` is still `IssueShortResponseDto`. A comment
in `RestTaskaApi.ts` had warned that one name for two contract schemas would
hide the day either grew a field. That day was this one.

Everything below is the entry as it stood, in the past tense.


- **Endpoint:** `GET /api/v1/projects/{projectId}/issues`
- **Contract:** *this bullet is out of date and the compensation now stands on
  runtime grounds rather than contract ones.* When it was written,
  `ListIssuesResponseDto.items` was `IssueShortResponseDto` — `id`, `issueKey`,
  `summary`, `issueType`, `priority`, `assigneeId`, with no `status`, no dates
  and no description — and a kanban board cannot place a card in a column
  without `status`. On the vendored contract today (`develop 8b8b3c5`) that
  `$ref` is **`IssueResponseDto`**, which carries `status`, `description` and
  `createdAt`; `IssueShortResponseDto` survives only under
  `SearchIssuesResponseDto`. So the contract no longer mandates the hydration.
  What keeps it is that nobody has yet asked the deployed gateway whether it
  agrees with its own contract — see the Removal note below.
- **Compensation (removed by TAS-195):** `RestTaskaApi.listIssues` followed the
  list call with `GET /issues/{issueId}` per item at concurrency 6; the first
  rejection failed the whole page. 4 projects × 100 issues was 400+ requests on
  the projects screen, and this was the multiplier that turned TAS-139 into a
  board-wide failure. That multiplier is gone: the board no longer reads the
  detail route at all, so a detail-route fault can now cost the issue panel and
  not the board.

  The heading used to read "The issue list DTO cannot render a board" — the
  premise this entry now disowns. Renamed under TAS-191, so the most quotable
  string in it is not the half that stopped being true.
- **Removal:** ~~[TAS-124](https://jira.ozero.dev/browse/TAS-124) /
  [TAS-125](https://jira.ozero.dev/browse/TAS-125) (Board API)~~ — **that promise
  was wrong and is withdrawn (TAS-191, 2026-09-06).** The board API does not
  remove this compensation. Its `BoardIssueDto` carries id, issueKey, summary,
  storyPoints, an assignee id and name, and label *names*; the card also draws
  issueType, priority, description and createdAt, and drag-and-drop needs
  `status` and `issueType` as values rather than as a column position. The
  hydration existed because the list DTO had no `status`, no `description` and no
  `createdAt`, and the board DTO is missing two of those three as well — so the
  detail read would still be needed, for the panel and for the lower half of the
  card. Dropped from TAS-141 as a duplicate at the 2026-08-04 dedup pass.

  What **did** remove it is unrelated to the board API and was noted in the
  2026-09-05 backlog entry: `ListIssuesResponseDto.items` changed on `develop`
  from `IssueShortResponseDto` to `IssueResponseDto`, which carries all three.
  That needed one measurement against the deployed gateway rather than a
  contract reading — and this entry is the one place in the repository that said
  so before it was taken. It was right to insist: the measurement is what closed
  this, not the `$ref`.

- **What is still owed here.** The detail read stays for the issue panel and for
  the lower half of the card, exactly as the withdrawn TAS-124/125 promise
  above says. Nothing in TAS-195 touches it.

### No `read-all` for notifications

- **Missing:** `PATCH /api/v1/notifications/read-all` (the contract has only
  per-notification `…/{notificationId}/read`).
- **Compensation:** `RestTaskaApi.markAllNotificationsRead` loops pages of
  unread notifications and marks them one by one. The loop is unbounded: it
  terminates only if the gateway honours `unreadOnly` and durably flips
  `readAt` — if either breaks with ≥100 unread, the tab hangs in a request
  storm. Its `updatedCount` counts attempts, not confirmed changes.
- **Removal:** [TAS-216](https://jira.ozero.dev/browse/TAS-216), re-filed
  2026-09-11 from TAS-141 which closed without it. Until then
  the loop should be capped (TAS-202's interim half).

### An assignee cannot be cleared — by contract

- **Endpoint:** `PUT /api/v1/issues/{issueId}/assignee`
- **Contract:** `AssignIssueRequestDto.assigneeId` is a required,
  non-nullable string. Unassignment does not exist in the API.
- **Compensation:** `RestTaskaApi.assignIssue(null)` throws a client-fabricated
  `UNSUPPORTED_OPERATION` error, and the board renders the "None" chip
  permanently `disabled` — an issue assigned by mistake can never be
  unassigned. The mock unassigns happily, so the modes visibly disagree.
- **Removal:** [TAS-215](https://jira.ozero.dev/browse/TAS-215), re-filed
  2026-09-11 from TAS-141 (nullable
  `assigneeId` or an explicit unassign route).

### Comment ordering is unspecified

- **Endpoint:** `GET /projects/{id}/issues/{id}/comments`
- **Contract:** defines pagination (`pageSize` ≤ 50) and a required
  `totalCount`, but says nothing about sort order.
- **Compensation:** the UI and the mock assume newest-first; `RestTaskaApi`
  passes the gateway's order through unsorted. If the gateway emits
  oldest-first, the thread renders inverted between modes with nothing
  failing. Unverifiable end-to-end while TAS-139 is open.
- **Removal:** [TAS-206](https://jira.ozero.dev/browse/TAS-206), re-filed
  2026-09-11 from TAS-141, specifies the
  order in the contract; `RestTaskaApi` should sort explicitly meanwhile.

### `requestId` lives only in a response header

- **Contract:** `RestErrorResponse` is `{code, message}`; the request id is
  the `X-Request-Id` **header** on every response.
- **Confirmed 2026-09-09, and the answer is the opposite of what this entry
  assumed.** It said the header was readable cross-origin "only if" the gateway
  exposes it, and called that unconfirmed. It does. With
  `Origin: https://taska.ozero.dev`, a simple request and a `PUT` preflight both
  return `access-control-expose-headers: X-Request-Id` alongside a real
  `x-request-id`. So `response.headers.get("X-Request-Id")` works from the
  deployed origin and `ApiError.requestId` is populated in a browser today
  (`api-contract-guard`, TAS-193 verdict).
- **What that changes.** The id was never the thing missing — the surfaces that
  drop it were. `ApiNotice` and `AdminError` render it; several panel sections
  print `error.message` alone and discard it, which was a cheap omission while
  the value was thought unavailable and is a real one now. That is the backlog
  line about the panel's failure surfaces, and it wants re-reading in this
  light rather than staying filed as cosmetic.
- **Removal:** the CORS half of [TAS-141](https://jira.ozero.dev/browse/TAS-141)
  is **done** — narrow that story to whatever else it still carries. The UI half
  is ours and is what the backlog line names.

### The create-project form shows a field the contract does not have

- **Endpoint:** `POST /api/v1/projects`
- **Contract:** `CreateProjectRequestDto` is `{projectKey, name}` — there is
  no `description`.
- **Compensation:** the UI renders a Description textarea; `RestTaskaApi`
  correctly does not send it. The field works in mock and is a silent no-op
  against the gateway.
- **Removal:** [TAS-145](https://jira.ozero.dev/browse/TAS-145), which was
  widened on 2026-08-21 to accept `description` on create, and
  [TAS-148](https://jira.ozero.dev/browse/TAS-148), whose same pass makes the
  form actually send it. This used to point at TAS-141 and no longer does: the
  field is landing in the project itself rather than in a contract cleanup.
  Until then the textarea stays and stays a no-op — removing it would take the
  field away twice.

### Neither a project nor a user carries a colour, and the UI draws one anyway

- **Endpoint:** `GET /api/v1/projects`, `GET /api/v1/projects/{projectId}`,
  `GET /api/v1/users/me`.
- **Missing:** a colour on the project and on the current user.
  `ProjectResponseDto` is `{id, projectKey, name, createdBy, createdAt,
  updatedAt, archivedAt}` and `ValidateAccessTokenResponseDto` is `{id, login,
  email, displayName, status, globalRole}`. In `docs/contract/openapi.yml`,
  `color` exists on a label and nowhere else.
- **What it looked like before TAS-171.** `Project.color` and `User.color` were
  read as optional fields (`src/domain/types.ts`) and the mock seeds both, so
  mock mode was colourful and the gateway was not: every project key badge and
  every avatar fell back to `var(--accent)`, which is the same colour for
  everyone. Ten projects in a list were one colour — that half is observed on
  the stand. The avatar half is narrower than it looks: against the gateway a
  *stack* of members is not reachable at all, because there is no member read
  (see `No membership or member-read endpoints` above), so what this fixes
  today is the current user's own circle — the profile menu, the assignee chip,
  a reporter who is the reader. The stack symptom is real in `rest` mode only
  once TAS-137 lands. DESIGN.md §2.2 had promised "детерминированно по userId"
  the whole time; nothing computed it.
- **Compensation:** the colour is computed on the client — deterministically
  from `projectKey` for the key badge and from `userId` for the avatar
  (`src/lib/format.ts`, DESIGN.md §2.2). A colour the server *does* send still
  wins, so the mock's seeded values are unchanged and a future stored colour
  needs no client change to take effect.
- **How it is switched off:** it is not. There is no flag and no mode in which
  the computation is skipped — it is the fallback arm of an expression, and it
  stops being reached for a given project the moment a stored colour arrives.
- **Removal:** partial, and only for the project half.
  [TAS-145](https://jira.ozero.dev/browse/TAS-145) and
  [TAS-148](https://jira.ozero.dev/browse/TAS-148) were **widened on
  2026-08-21** (owner's call) to carry a project colour: TAS-145 adds the
  nullable `color` column, DTO field and `PATCH` body, TAS-148 the swatch an
  ADMIN picks from. Neither backfills and neither defaults server-side, so the
  computed value stays the default for every project whose colour nobody chose
  — this compensation narrows rather than disappears, and that is deliberate.
  The avatar half has no removing story and is not meant to have one: the
  coloured circle is the fallback *under* an uploaded avatar
  ([TAS-129](https://jira.ozero.dev/browse/TAS-129), listed in
  `JIRA-WORKFLOW.md` so the citation is checkable), not a gap waiting for a
  contract field.

### Closed by TAS-154: "not yours" is a 403, and the gateway tells it apart from "not there"

- **Endpoint:** `GET /api/v1/projects/{projectId}`
- **Contract:** declares only `200` and a `default` error whose `code` is a
  free-form string — no enum, no 403/404 semantics. So nothing states what a
  non-member or a deleted project actually gets back, and that half is still
  true: the shapes below are observed, not promised.
- **Compensation:** `isMissingOrForbidden` (`src/api/errors.ts`) treats
  `NOT_FOUND` / `PERMISSION_DENIED` / 404 / 403 as one answer and
  `BoardScreen` renders the Not found screen (`DESIGN.md` §4.18).
- **The "no access" half is now exercised against the running gateway.** It used
  to be reachable only in the mock, because `hybrid` hardcoded a healthy
  membership (see the `VITE_TASKA_ASSUME_PROJECT_ADMIN` entry above) and
  project-service had no membership concept. TAS-154 gave it one, and a
  non-admin token walked the path on 2026-08-18: 403 for someone else's project,
  and the Not-found screen drawn from a real refusal for the first time.
- **A 401 answered for "not yours" would sign the reader out** rather than show
  the Not-found screen. That risk is live and does not belong to this closed
  entry; it moved to `No membership or member-read endpoints`, which already
  owns the two uncontracted endpoints it turns on.
- **What is still owed here:** only the contract naming the codes —
  [TAS-141](https://jira.ozero.dev/browse/TAS-141). The reachability half is
  spent: TAS-154 made the no-access case reachable and it has been walked.
- **Answered 2026-08-18**, see the table in the TAS-154 entry above: a
  non-member gets `403 PERMISSION_DENIED`, a nonexistent id gets `404
  NOT_FOUND`. The contract enumerates neither — it declares `200` and `default`
  and nothing else, exactly as the Contract bullet above says. The gateway
  distinguishes them anyway, which is why this is an observation and not a
  promise, and why TAS-141 still has a reason to exist.
- **The gateway therefore discloses which projects exist** to anyone with a
  session: 403 and 404 are different answers, so a signed-in user can confirm an
  id they already hold without being able to read anything behind it. Not
  enumeration — a v4 uuid space cannot be walked. Worth naming; not obviously
  wrong for a tracker whose ids travel in shared links anyway. The larger
  disclosure on this stand is the workflow read below.
- **The console does not pass that distinction on.** `isMissingOrForbidden`
  collapses 403 and 404 into one screen on purpose (DESIGN.md §4.18), so the UI
  answers "This page doesn't exist, or you don't have access to it." for both —
  quoted from `NotFoundScreen.tsx`, not paraphrased. That was a design decision
  taken before the shapes were observed, and the observation does not disturb
  it.

### The workflow read is not membership-checked, unlike every endpoint beside it

- **Endpoint:** `GET /api/v1/projects/{projectId}/workflow?issueType=…`
- **Contract:** declares `400`, `401`, **`403`**, `404` and `default` for this
  path — unlike the project read beside it, which enumerates nothing. So this is
  not merely a backend-authorization opinion: the contract already anticipated a
  403 here, and the runtime does not produce one.
- **Observed 2026-08-18** as `defaultUser`, against a project they are not a
  member of: `GET /projects/{id}` is **403**, `…/issues` is **403**, and
  `…/workflow` is **200** for `TASK`, `BUG` and `STORY` alike. Visible in the
  board's own traffic, not just by curl — the board fires all three while the
  project read beside them is refused.
- **Re-measured 2026-09-10, as `defaultUser` again, and it still reproduces.**
  Against the same foreign project: `GET /projects/{id}` → `403
  PERMISSION_DENIED "You don't have access to this project"`, and `…/issues`,
  `…/board`, `…/labels`, `…/issues/{id}`, `…/issues/{id}/comments`,
  `…/issues/{id}/labels`, `…/issues/{id}/watchers` and `…/links` → `403
  PERMISSION_DENIED "Access denied"`. Every neighbour refuses. `…/workflow`
  answers `200` with all three statuses. Twenty-three days on, this is the only
  project-scoped read on the gateway that does not enforce membership, which
  makes it an oversight rather than a policy. **"Only" is checked, not assumed:**
  the list above is every `GET` the contract defines beneath
  `/projects/{projectId}` and `/issues/{issueId}`, run against the same foreign
  project in the same session. The two that answer neither `200` nor `403` —
  `…/members` and `…/members/{userId}` — do so because `GET` is unmapped there at
  all, which is TAS-137's gap and not a membership question.
- **What it discloses:** that the project exists, and its workflow
  configuration — status keys, transition names, sort order. On this stand every
  project shares one "Default workflow", so today it discloses nothing a member
  could not already guess. That is a property of the seed, not of the endpoint.
- **Compensation:** none needed, but not for the reason it first looks like.
  The gate at `BoardScreen.tsx:315` reads the project query **alone**, so no
  workflow answer can keep the board up. Nothing is refused "first": the five
  project-scoped reads fire concurrently, and until the refusal lands the shell can
  draw its columns from the workflow that just answered 200 — a second of
  plausible chrome for a project the viewer must not see, which
  `BoardScreen.tsx:64-73` already documents as its own window.
- **Removal:** a backend fix — the membership check TAS-154 added to the project
  read belongs on its siblings too. Not filed, and deliberately: AGENTS.md lets
  this harness file a contract-**design** problem directly, and this is a runtime
  defect against a contract that is already correct, so it is the owner's call.
  Surfaced to the owner in the working session that found it, on 2026-08-18,
  rather than left here to be found later — filed 2026-09-09 as [TAS-207](https://jira.ozero.dev/browse/TAS-207), together
  with the empty-projects clause that TAS-141 closed without fixing. It was left
  unfiled by design until then, which is why TAS-207 is its first key rather than
  a re-filing.

### `sortableColumns` and `filterableColumns` are always empty

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** `TableCapabilitiesDto` — renamed from `MetaInfoDto` by
  `b22a2e020574`, same shape, still delivered under `meta` — carries `columns`,
  `sortableColumns` and `filterableColumns`, and the console is meant to read
  the latter two rather than assume every column can be ordered or filtered.
- **Observed** (found by `api-contract-guard`, 2026-08-05, by reading the
  backend at `25d0cf7000e5`): `admin-service`'s `ListTableRowsMapper` builds
  `MetaInfo` with both lists left as literal `//TODO:` lines. It is the only
  code path that builds `MetaInfo`, so no deployed build can populate them.
  **Still true at `b22a2e020574`** — TAS-103 rewrote most of this file and left
  both TODOs exactly where they were.
- **Compensation:** the Data section falls back to `meta.columns` when a list
  comes back empty. Without it, the filter form would never render and no column
  would ever be sortable against a real gateway — while both work fully against
  the mock, which advertises every column. When the gateway starts stating the
  lists, they win and the fallback stops applying on its own.
- **The fallback got riskier with TAS-103.** It used to be safe on the grounds
  that the gateway "accepts a filter on any column it has"; it now validates the
  column against the table's real columns *and* the operator against that
  column's type, answering 400 for either. Falling back to `meta.columns` — the
  table's actual columns — still cannot name a column that does not exist, so
  the fallback stands, but it is now one assumption closer to producing a 400
  than it was when it was written.
- **User-visible effect while open:** none, by design — that is the point of the
  fallback. Without it the console would silently lose two of its three
  controls in production only.
- **Removal:** the backend TODOs. Worth its own backend story;
  [TAS-103](https://jira.ozero.dev/browse/TAS-103) is the umbrella.

### Closed by TAS-103: the read-only rows endpoint answers 200

- **Resolved 2026-08-18** on backend `7fb303b53ba6`. Everything below is the
  history of a fault that no longer reproduces: reads answer **200** with rows,
  and the failure travelled through two further shapes on the way out — first
  the parameter-independent 500 recorded here, then the filter-map 400 and the
  missing primary key recorded in the two entries above. Kept because the
  sequence is the record of how the endpoint was actually debugged, and because
  TAS-156 was filed against the first shape and needs closing against the last.

- **Endpoints:** `GET /api/v1/readonly/catalog` — named
  `GET /api/v1/readonly/metadata` when this entry was written, and renamed by
  backend `b22a2e020574` — and `GET /api/v1/readonly/{service}/{table}`.
- **Contract:** both arrived with backend `25d0cf7000e5`. `GLOBAL_ADMIN` only,
  and the first endpoints here to enumerate `401`, `403` and `404` separately
  instead of collapsing everything into `default`.
- **Observed 2026-08-06, signed in as a real `GLOBAL_ADMIN`** — the first time
  either endpoint has answered this frontend:
  - `GET /readonly/metadata` (as it was then called) → **200**, and a much
    richer catalog than the mock
    seeds: `workflow` (statuses, transitions, validator_rules,
    workflow_bindings, workflows), `project` (outbox_events, project_members,
    project_settings, projects), `notification` (email_delivery_attempts,
    notification_preferences, notifications, processed_events), `issue`
    (idempotency_keys, issue_attachments, issue_comments, issue_history,
    issue_links, issues, outbox_events, project_counters), `admin`
    (admin_audit_log), `auth` (credentials, invite_tokens, outbox_events,
    refresh_tokens, user_avatars, users). It parses and renders correctly.
  - `GET /readonly/{service}/{table}?page=1&pageSize=20` → **500**
    `"Internal error"` for **every table tried**, across services. First
    captured on `workflow.statuses`, request id
    `c85c0694-7909-4a8a-b9be-a8c603cea2da`. No sort, no filter, no unusual
    parameter — the simplest read the console can issue.
  - **So the console can list the catalog and never read a row.** Against the
    deployed gateway the feature TAS-155 delivers is, today, non-functional
    beyond its table picker. It works fully in `mock`.
  - Probed directly with an admin token (2026-08-06): the 500 is
    parameter-independent — no query at all, `page=1`, `pageSize=1`,
    `pageSize=100` and `sort=id&order=asc` all give the identical body. Validation
    upstream of it works (`page=0` → `400 INVALID_ARGUMENT`) and so does the
    service lookup (`nosuchsvc/users` → `404 NOT_FOUND: Service not found`). But
    a **valid** table and a **nonexistent** one fail identically
    (`auth/no_such_table` → the same 500), which places the fault after the
    service is resolved and before any table-specific work — the admin-service
    call or the per-service datasource, not query building or column mapping.
  > An earlier version of this entry claimed the endpoints were probably not
  > deployed and had the UI say so. That was wrong twice over: they are
  > deployed, and the failure that actually arrives is a 5xx, which the copy
  > was calling "could not be reached".
- **Compensation:** none that alters behaviour. `MockTaskaStore` seeds a catalog
  and rows so the console is clickable without a gateway — this repository's
  normal mock-first mode, not a workaround — and `rest` calls the real endpoints
  and surfaces whatever they answer, request id included.
- **Verified then, and since overtaken by TAS-103:** `style: form, explode: true`
  genuinely means top-level query keys, so flattening them is the contract's
  reading rather than a guess — that half still holds. The rest of what this
  bullet used to say does not: the spelling it verified was the bare key with
  `column.contains` / `.from` / `.to` beside it, a bare key meant `equals`, and
  an unrecognised operator was silently skipped. Backend `b22a2e020574` requires
  an explicit operator on every key, spells equality `.equals`, and answers 400
  for both a bare key and an unknown operator. See the three entries at the end
  of this file.
  > Note what this cost: a spelling recorded here as **verified against the live
  > gateway** was wrong five days later, and nothing in the repository would have
  > said so until a request failed. "Verified" is a statement about a moment, not
  > a property, and entries in this file need re-reading against the contract
  > whenever the pinned backend commit moves.
- **Settled by that observation:** `X-Request-Id` **is** exposed cross-origin on
  a 5xx, not only on the 401 — the console displays it, which is how the id
  above was captured. And the catalog's shape matches what the code expects.
- **Both of the questions this bullet used to hold open were answered on
  2026-08-18**, by the same session that closed the 500. They needed a table
  that returns rows, and rows now come back:
  - **Timestamps are ISO strings with an offset, not epoch numbers.**
    `auth.credentials` returned `"updated_at": "2026-08-14T16:14:33Z"` and
    `"created_at": "2026-07-13T15:27:11Z"`. Jackson emits ISO. So `formatCell`
    prints a date rather than a bare integer, and the `from`/`to` datetime
    control's ISO value is the same spelling the column holds. Sub-second
    precision is absent from the wire, which matters to nothing the console
    draws.
  - **`meta.service` and `meta.table` echo the catalog's own spelling exactly.**
    `GET /readonly/auth/users` answered `"meta": {"service": "auth", "table":
    "users", …}`, matching the catalog's `name` fields character for character.
    That is the join `maskingIsKnown` fails closed on, and it holds — see the
    fail-closed entry below, which stays open only because one observation is
    not a guarantee from two schemas that constrain each other in no way.
- **Compensation for the 500:** none, and none is appropriate — the frontend
  does not work around a server fault. The console scopes the error to the
  result area, so the table picker stays usable and another table can be tried,
  and the copy now says plainly that this is the gateway's fault and not the
  reader's network, with the request id to quote.
- **Removal:** a backend fix. The request id above identifies the failure in the
  gateway log.

### Closed by TAS-104: the catalog flags the columns that really hold secrets

- **Endpoint:** `GET /api/v1/readonly/catalog` (`/readonly/metadata` when
  observed)
- **Observed 2026-08-06** against the deployed gateway, with an admin token:
  **zero** of the 28 tables' columns come back `sensitive: true`. Not one, in
  any service.
- **Why that is not merely cosmetic:** `admin-service`'s masking is driven by
  the same config that sets this flag, and that config (read from backend source
  at `25d0cf7000e5`) names `users.password_hash`, `users.token_hash`,
  `users.secret_hash`, `users.refresh_token`, `users.access_token`. The real
  schema has none of those: `users` holds no secret column at all, and the
  secrets live one table over —
  - `auth.credentials.secret_hash`
  - `auth.invite_tokens.token_hash`
  - `auth.refresh_tokens.token_hash`

  So the allow-list points at columns that do not exist, and the columns that do
  hold hashes are named nowhere.
- **User-visible effect:** none *today*, only because every table read 500s
  (entry above). The moment that 500 is fixed, the console will render those
  hashes in clear, because it masks exactly what the catalog flags and the
  catalog flags nothing.
- **Compensation:** none is possible from the frontend. The UI cannot know a
  column is a secret if the server does not say so, and guessing from column
  names is exactly the kind of hidden rule this file exists to prevent. The
  console's masking is correct and inert.
- **Fixed, verified 2026-08-18** on backend `7fb303b53ba6`. The config no
  longer names columns that do not exist; it names the ones this entry listed,
  and the catalog flags them:

  | Column | Treatment |
  | --- | --- |
  | `auth.credentials.secret_hash` | `HIDE` |
  | `auth.refresh_tokens.token_hash` | `HIDE` |
  | `auth.invite_tokens.token_hash` | `HIDE` |
  | `auth.credentials.algo`, `auth.credentials.meta` | `MASK_FULL` (the default) |
  | `issue.idempotency_keys.request_hash` | `MASK_FULL` |
  | `notification.notification_preferences.email` | `MASK_PARTIAL` |
  | `notification.email_delivery_attempts.to_email` | `MASK_PARTIAL` |

  Read live, not from source: `credentials` rows come back with `meta` and
  `algo` as `"***"` and **no `secret_hash` key at all**, while `id`, `provider`
  and `subject` still carry their real values — including explicit `null`s, so a
  missing key is genuinely a removed column rather than a dropped null.
- **The order-of-operations worry is spent.** TAS-104 landed before the tables
  opened, which is the sequence this entry asked for. The hashes never rendered
  in clear.
- **Note `auth.users.email` is *not* flagged** while `notification…email` is.
  That is the config's decision and the console follows it either way, but it
  means the same address is printed whole on one table and starred on another.

### Closed by TAS-103: `primaryKey` is populated, and rows are addressable

- **Endpoint:** `GET /api/v1/readonly/catalog` (`/readonly/metadata` when
  observed)
- **Contract:** `TableMetadataDto.primaryKey` is a plain `string`.
- **Observed:** null on all 28 tables.
- **Compensation:** the console falls back to an `id` column and then to the row
  index for React keys, so it renders correctly either way.
- **No longer harmless.** The old note here said this "would stop being harmless
  for anything that needs to address a row". TAS-103 added exactly that —
  `GET /readonly/{service}/{table}/{id}` — and TAS-161 built the row card on it.
  A row is made clickable only when the catalog names a primary key, so against
  the deployed gateway **no row in any table is clickable** and the card is
  unreachable outside `mock`. That is the correct behaviour rather than a
  workaround: a link built on a guessed key would address the wrong row, or a
  column that is not unique, and the card would confidently show a stranger's
  data.
- **Fixed, verified 2026-08-18** on backend `7fb303b53ba6`: every table in the
  catalog names one — `id` on most, `project_id` on `project_settings` and
  `project_members`, `user_id` on `notification_preferences`. The row card is no
  longer mock-only. Note that the three non-`id` keys are exactly the tables
  `isAddressableKey` still refuses, and correctly: they are `uuid`, but a
  `project_members` row is keyed by `(project_id, user_id)` in truth, so a card
  addressed by `project_id` alone would show one member and claim to be the
  row.

### The contract says a column is sensitive but never says what that does to the value

- **Endpoints:** `GET /api/v1/readonly/catalog` and
  `GET /api/v1/readonly/{service}/{table}`
- **The gap, as of backend `7fb303b53ba6`:** the word `mask` does not appear
  anywhere in `openapi.yml`. The catalog's `sensitive: true` is the only thing
  stated, and it is a boolean — it does not say *which* of the three treatments
  a column got. Nor does the rows schema mention that `"***"` is a reserved
  value, or that a property the catalog names may be **absent from the row
  object entirely**, which is what `HIDE` does. A reader with only the contract
  would conclude that every declared column is present on every row.
- **Compensation:** `isWithheld` in `src/screens/admin/columns.ts` recovers the
  treatment from the value that arrived, because that is the only place the
  distinction survives: a missing key is `HIDE`, `"***"` is `MASK_FULL`, and
  anything else on a flagged column is a partial mask and is printed. The rule
  is documented at length there rather than inferred at three call sites, and
  `columns.test.ts` pins each branch.
- **The literal is written down in four places, not one**, which is what makes
  this entry's removal wider than it looks: `columns.ts` reads `"***"`,
  `src/api/mock/MockTaskaApi.ts` reproduces both it and admin-service's
  partial-mask algorithm so the mock stays a faithful reference, and
  `columns.test.ts` and `e2e/admin-console.spec.ts` assert against it. Whoever
  removes this compensation edits all four or leaves the mock teaching a shape
  that stopped mattering.
- **A second unstated default, found by `api-contract-guard` on 2026-08-18:**
  `ColumnMetadataDto` has no `required` block, so `sensitive` is optional by
  contract while `AdminColumn.sensitive` asserts a boolean. The deployed catalog
  sends it on every column, but `RestTaskaApi.getAdminCatalog` no longer relies
  on that: a missing flag is read as `true`. Fail closed, because the failure in
  the other direction is a column with no lock, the masking literal printed as
  data, and a secret column that can be sorted on.
- **Why this is worth writing down rather than absorbing:** the compensation
  depends on `"***"` being exactly three asterisks and on `MASK_PARTIAL` always
  producing at least one — both true in `SensitiveColumnMaskService` today, and
  both invisible to anyone reading the contract. If the backend changes the
  masking literal, nothing type-checks and no test fails; the console simply
  starts printing `***` as though it were data.
- **Removal:** [TAS-165](https://jira.ozero.dev/browse/TAS-165) — the contract
  stating the masking treatment per column, either as an enum beside `sensitive`
  in `ColumnMetadataDto` or as prose naming the literal and the missing-key
  case. An enum lets the console stop guessing from values altogether, and
  deletes the guess from all four places it is written. The same ticket carries
  the `PaginationInfoDto.currentPage` basis sentence, since both are contract
  wording rather than behaviour.

### Masking depends on a join the contract does not guarantee

- **Endpoints:** the two above, together.
- **The problem:** which columns are secret comes from the *catalog*, while the
  rows come from the *table* endpoint. Joining them needs `meta.service` and
  `meta.table` to spell the service and table exactly as the catalog does, and
  the two response schemas are independent free-form strings that constrain each
  other in no way.
- **Compensation:** `AdminScreen` fails closed. If a rows response names a table
  the catalog does not describe, the console refuses to render the table at all
  and says why, rather than defaulting to "nothing here is sensitive" — which on
  screen is indistinguishable from a genuinely harmless table. Pinned by a test
  that fails when the guard is removed.
- **Removal:** the *rows* schema stating that `meta.service` and `meta.table`
  are the catalog's own identifiers. Not an observation — one was made on
  2026-08-18 and is recorded above (`auth.users` echoed `"service": "auth"`,
  `"table": "users"`, matching the catalog character for character), and it did
  not close this entry: two schemas that constrain each other in no way can
  agree on every table anyone has looked at and still disagree on the next one.
  Only the contract saying so turns the join from observed into guaranteed.

### The allow-list is the real control, and the client half is defence in depth

- **Good news, established from backend source** (2026-08-05): sensitive values
  are withheld *server-side*. `admin-service`'s `SensitiveColumnMaskService`
  replaces the value with `"***"` before it leaves the service, driven by the
  same `application.yml` config that sets `sensitive` in the catalog — so the
  flag and the masking cannot disagree, and the console's own masking is defence
  in depth rather than the only protection. The earlier open question here is
  answered favourably and closed.
- **The part that remains true anyway:** masking is a config allow-list. A
  secret column not on it is neither flagged nor masked, and the UI cannot do
  better than the flag it is given. A `jsonb` column with a secret nested inside
  it is likewise beyond what a column-level flag can express, and the console
  prints such a cell whole. (The list itself is no longer wrong — see the
  TAS-104 entries above — but it is still a list.)
- **Updated 2026-08-18: "cosmetic" is no longer the right word for the client
  half.** TAS-104 shipped three treatments, not one, and the console now has a
  decision to make rather than a blanket rule to apply. `HIDE` and `MASK_FULL`
  are the same fact to a reader — nothing came back — and both draw the lock.
  `MASK_PARTIAL` is a value, and drawing a lock over `n****a@mail.ru` threw away
  the entire reason the backend was asked for a partial mask, so it is printed
  and the lock moves to the column header. `isWithheld` in
  `src/screens/admin/columns.ts` is where the three are told apart.
- **The defence in depth is now explicit, and it is the reason that function is
  not a one-liner.** A sensitive value is printed only if it carries evidence of
  having been masked — a `*`. A sensitive column that arrives in clear is
  withheld anyway, on the grounds that the catalog said it holds secrets and a
  hash that reaches the screen cannot be recalled. This costs nothing against a
  correct server: `maskPartial` stars every result it produces, returning
  `"***"` for `null` and for any value of two characters or fewer.
- **And:** whatever the server does send is in the response body, the
  react-query cache and devtools regardless of what is drawn. The console
  drawing "hidden" is not a security boundary.
- **Removal:** [TAS-104](https://jira.ozero.dev/browse/TAS-104) is the backend
  half of masking.

### Closed by TAS-103: the operator/type rules are stated and enforced

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Was:** the gateway emitted `"col" >= $n::timestamptz`, so a range filter on
  a text column, or a non-ISO value, was a Postgres cast failure — a 5xx, never
  a 400 the UI could explain. The console compensated by offering `from`/`to`
  only for a date- or time-like catalog `type`.
- **Now** (backend `b22a2e020574`, read from source): `ReadOnlyQueryValidator`
  checks the pairing before building any SQL and answers `INVALID_ARGUMENT`,
  and the contract's own prose names the four operators. The rules are wider
  than the old compensation assumed in one direction and narrower in another:
  - `contains` is **TEXT only** — it was previously offered on every column,
    and on a `uuid` or a timestamp it is now a 400 rather than a wrong-looking
    empty result;
  - `from`/`to` cover **temporal *and* numeric**, not temporal alone;
  - `equals` is valid everywhere, but its *value* is parsed by type: numeric
    columns want a number and boolean columns want exactly `true`/`false`,
    both 400 otherwise.
- **What replaced the compensation:** `classifyColumnType` in
  `src/lib/adminColumnTypes.ts` mirrors the backend's `DbColumnType` map
  exactly, and the filter popover uses it twice — to offer only the operators
  the server will accept, **and** to pick a value control the server's parser
  will accept: a number field for numeric, a `true`/`false` choice for boolean,
  a date picker for temporal, free text only where the server really does take
  an arbitrary string. Both halves are compensation and both come out together.
  This is no longer a workaround for a missing 400 — it is the client half of a
  rule both sides now state.
- **The part that is still a divergence:** the mapping is an *exact* match on
  `information_schema.columns.data_type`, and nothing in the contract publishes
  that list. It was copied from backend source, so a type added on the backend
  (a domain type, an array type, `citext` arriving in a new schema) silently
  falls to `OTHER` here and loses operators the server would have accepted. The
  failure direction is the safe one — fewer operators offered, never a request
  the server refuses — but it is drift the contract cannot warn us about.
- **Removal:** the catalog stating the operators a column accepts, rather than a
  raw Postgres type the client has to classify for itself. `TableCapabilitiesDto`
  is the obvious home; it already carries `filterableColumns`.

### Dates in a range filter must carry an offset, and the contract's example does not

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** shows `?created_at.from=2026-01-01T00:00:00Z` and describes the
  result as `created_at >= '2026-01-01'` — a date, which reads as though a bare
  date were acceptable input.
- **Observed** (backend source): `ReadOnlyQueryBuilder.parseTemporalValue` calls
  `OffsetDateTime.parse`, which accepts **only** a full ISO-8601 timestamp with
  an offset. `2026-01-01` is a 400, and so is `2026-01-01T00:00` — the exact
  string a browser's `datetime-local` input produces.
- **Compensation:** for a temporal column the filter value is entered with a
  date/time picker and serialised with its offset before it is sent (§5.8), so
  the format is the form's job rather than something the admin has to know. A
  free-text field here would have meant guessing the one spelling that works.
- **Removal:** the contract's example spelling out that the offset is required,
  or the gateway accepting a bare date.

### `equals` on a temporal column is offered, untested on both sides, and probably useless

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** `equals` is described as plain equality with no type restriction,
  and the gateway's own validator only constrains `contains` and `from`/`to`. So
  a timestamp column formally accepts `equals`, and the console offers it.
- **Why it is doubtful:** `ReadOnlyQueryBuilder.parseEqualsValue` converts only
  NUMERIC and BOOLEAN; a temporal value stays a Java `String` and is bound
  against a `timestamptz` column, and whether that works depends on the
  parameter type r2dbc-postgresql infers — which this repository cannot settle.
  Neither side tests it: the backend's `shouldAllowEqualsOnAnyColumnType`
  asserts only the SQL text, and its integration test for `equals` uses a text
  column.
- **And on a timestamp column, even where it works it cannot match.** The picker
  this frontend uses has minute resolution and serialises to `…:00Z`, while a
  real `created_at` carries seconds and fractions. Exact equality against a
  timestamp is close to never the question a person means. A `date` column is
  the exception — it is TEMPORAL too, it has day resolution, and there
  `…T00:00:00Z` could genuinely match.
- **Not compensated, deliberately.** Dropping `equals` for temporal columns
  would be this file's usual "fewer operators is the safe direction" move, but
  here it would contradict the contract rather than follow the backend, and the
  cost of being wrong is a control that returns nothing rather than a 400. It
  stays offered and stays recorded.
- **Removal:** an observed answer from the live gateway once TAS-156 lifts —
  either it errors, in which case the operator comes out, or it works, in which
  case only the resolution mismatch remains.

### Closed: the contract fixed its own filter examples

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** states «Формат ключа: column.operator» and then gives
  `?status=active&assignee_id=123 → комбинация фильтров` as an example — bare
  keys, with no operator. The two are not compatible.
- **Observed** (backend source): `FilterParser` splits on the last dot and
  throws `INVALID_ARGUMENT` — "Filter key must contain operator" — for any key
  without one. The example is the broken half.
- **Why it matters beyond tidiness:** an example is what a reader copies, and
  this one describes the *old* behaviour, where a bare key meant equality. Any
  client written from the examples rather than the rule gets a 400 on its first
  filter.
- **Compensation:** `RestTaskaApi` always emits `column.operator`; the spelling
  is pinned by tests so it cannot drift back.
- **Fixed in the contract, verified 2026-08-18** on backend `7fb303b53ba6`. The
  combination example now reads
  `?status.equals=active&email.contains=@test.com`, the duplicate-key example
  was corrected the same way, and a new line states that `page`, `pageSize`,
  `sort` and `order` are not filters. This is the whole of the contract diff
  between `b22a2e020574` and `7fb303b53ba6` — the endpoint set did not change.
- **Nothing to do on this side:** the contract moved to where `RestTaskaApi`
  already was.

### Unknown filter operators are now rejected, not ignored

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Previously recorded here as settled:** "the gateway *silently skips* an
  unrecognised operator, so a misspelling would return unfiltered rows rather
  than an error — which is why the spelling is pinned in `RestTaskaApi.test.ts`".
  That is no longer true, and the entry it sat in is corrected below.
- **Now:** `FilterOperator.fromValue` throws `INVALID_ARGUMENT` for anything
  outside `equals` / `contains` / `from` / `to`, and `.eq` — the spelling this
  frontend used until TAS-161 — is one of the things outside it. A blank value
  is also a 400.
- **Effect:** the failure mode improved. A misspelling used to show unfiltered
  rows under a chip that read as applied; it now says so. The pinning tests stay
  anyway, because they are now guarding against a 400 rather than against a
  silent lie.

### Closed by TAS-103: the declared parameters are no longer read as filters

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Observed 2026-08-11** against `api.taska.ozero.dev` with a real
  `GLOBAL_ADMIN` token, on backend `b22a2e020574`:

  | Request | Answer |
  | --- | --- |
  | `?page=0&pageSize=3` | **400** `Filter key must contain operator (e.g. 'column.equals'), got: page` |
  | `?sort=id&order=asc` | **400** `… got: sort` |
  | no query string at all | **404** `No primary key found for table: statuses` |
  | `?status_key.equals=todo` | 404 — past the filter parser, dies on the same missing key |

- **What that meant:** the `filter` catch-all was capturing **every** query
  parameter, including the four the contract declares as parameters in their own
  right. There was no request the endpoint answered with rows — paging, sorting
  and the plain default read were each a 400, and the one shape that got past
  the parser then hit the missing primary key.
- **The 500 TAS-156 was filed for was already gone by then.** That bug reported
  a parameter-independent `Internal error` on every table; the failure had
  moved, not persisted.
- **Effect on this frontend while it lasted:** `RestTaskaApi.listAdminRows`
  always sends `page` and `pageSize`, so every read against the deployed gateway
  was a 400. TAS-161's 4xx branch rendered it correctly — "The gateway would not
  accept this request", the server's own sentence naming `page`, and the request
  id. That branch has not been exercised by this fault since, and is now only
  reachable through a genuinely bad filter.
- **Compensation:** none was possible, and none was appropriate. The frontend
  cannot stop sending the parameters the contract requires it to send.
- **The contract was never wrong here.** `style: form, explode: true` on a
  free-form object beside four named parameters is a normal OpenAPI
  construction; the binding mis-implemented it. The contract has since gained
  prose saying the four are not filters, which is documentation of the fix
  rather than a change of meaning.
- **Fixed, verified 2026-08-18** on backend `7fb303b53ba6`.
  `AdminReadOnlyController.extractColumnFilters` now takes the query parameters
  off the exchange and removes the four declared ones before the filter map is
  built, and the contract's prose says so in as many words. Every shape in the
  table above answers **200** with rows.
- **The page-basis check this entry demanded, done first, as instructed.**
  `GET /readonly/issue/issues` with `pageSize=3`, over pages 0, 1 and 2:

  | Request | `pagination.currentPage` | First row |
  | --- | --- | --- |
  | `?pageSize=3` (no page) | `0` | `kappa-test-1` |
  | `?page=0&pageSize=3` | `0` | `kappa-test-1` |
  | `?page=1&pageSize=3` | `1` | `API-5` |
  | `?page=2&pageSize=3` | `2` | `PCAI-11` |

  The wire is 0-based in the request *and* in the echo, the default page is 0,
  and the three pages hold different rows. So `RestTaskaApi.listAdminRows`'s
  `page - 1` on the way out and `toPagination`'s `+ 1` on the way back are both
  right, and the footer counts from 1 over the rows it claims. The one
  assumption in this feature that had never met a real answer now has one.

### Closed by TAS-103: the default read works, because the key is there

- **Endpoints:** `GET /api/v1/readonly/catalog` and
  `GET /api/v1/readonly/{service}/{table}`
- **Observed 2026-08-11** with an admin token: `primaryKey` is `null` on **all
  28** tables across all 6 services — unchanged from 2026-08-06, and unchanged
  by TAS-103.
- **Why it is worse than the earlier entry said:** `ReadOnlyQueryBuilder`
  `buildSelectSql` falls back to `ORDER BY "<primaryKey>"` whenever no `sort` is
  given, because Postgres does not guarantee row order without it and pagination
  would otherwise duplicate and drop rows. With no primary key resolvable, that
  fallback cannot be built and the request 404s with
  `No primary key found for table: <table>`. So the missing key does not merely
  disable the row card — it makes the **unsorted** read impossible, which is the
  read the console issues first.
- **Root cause was one query.** `MetadataSchemaRepository.findPrimaryKeys`
  selected from `information_schema.table_constraints` joined to
  `key_column_usage` filtered by `tc.table_schema = :schema`, and returned
  nothing for any of the six schemas while `findColumns` against the same
  schemas returned every column — so the schema value was right and the
  constraint lookup was what came back empty.
- **Fixed, verified 2026-08-18** on backend `7fb303b53ba6`: the catalog names a
  primary key on every table, and the unsorted default read
  (`GET /readonly/issue/issues?pageSize=3`, no `sort`) answers **200** with
  rows. Both halves this entry described are gone. See the sibling `primaryKey`
  entry above for the per-table detail.

### Closed by TAS-104: sensitive columns arrive flagged and already masked

- **Endpoint:** `GET /api/v1/readonly/catalog`
- **Was:** zero of 28 tables flagged a single column, on 2026-08-06 and again
  on 2026-08-11, while rows were still unreachable — so "the moment rows start
  arriving, hashes render in clear" was the standing risk.
- **Observed 2026-08-18:** rows arrive *and* the flags are there, in the same
  deployment. The risk closed without ever being realised. Details and the
  column-by-column treatment are in the entry above.

### The catalog's real column types are all covered by the client's classifier

- **Endpoint:** `GET /api/v1/readonly/catalog`
- **Observed 2026-08-11:** the 28 tables use exactly eight distinct
  `data_type` values — `bigint`, `boolean`, `character varying`, `integer`,
  `jsonb`, `text`, `timestamp with time zone`, `uuid`.
- **Checked against `src/lib/adminColumnTypes.ts`:** six map to a class
  (`bigint`/`integer` → NUMERIC, `boolean` → BOOLEAN, `character varying`/`text`
  → TEXT, `timestamp with time zone` → TEMPORAL) and two fall to `OTHER`
  (`jsonb`, `uuid`), which is what the gateway does with them too. So the
  copied-map divergence recorded above, while still real in principle, has **no
  live instance today**: every type the real catalog contains is classified the
  same way on both sides.
- **Keep watching it anyway.** This is a snapshot of one deployment, and the
  drift risk was never about the types that exist now.

### The page basis flipped, and the contract states it for the request only

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** the `page` **parameter** is now `minimum: 0, default: 0`; it was
  `minimum: 1, default: 1`, and `page=0` was a live 400 as recently as
  2026-08-06 (recorded in the 500 entry above). `PaginationInfoDto.currentPage`,
  however, is a bare `integer` with no minimum and no prose — the contract never
  says which basis the *response* uses.
- **Read from backend source** (`b22a2e020574`): `AdminReadonlyServiceImpl`
  normalises the 0-based `page` and passes that same value into the response
  DTO, and `ListTableRowsMapper` sets `currentPage` from it and derives
  `hasPrev = page > 0`, `hasNext = page < totalPages - 1`. So `currentPage` is
  0-based too.
- **Compensation:** `RestTaskaApi` converts at the wire and nowhere else — it
  sends `page - 1` and returns `currentPage + 1`. The domain, the URL, the pager
  and the mock stay 1-based, so `/admin/data/x/y?page=2` keeps meaning the
  second page for links already shared.
- **Confirmed by the backend, 2026-08-11: the page counter is 0-based, full
  stop.** Stated directly by the team that owns the service, which is a better
  source than either of the two this entry had before it. The `- 1` out and
  `+ 1` back in `RestTaskaApi` are correct as written, and no code changes.
- **How it stood before that,** because the reasoning is worth keeping: the
  request side was established three ways in backend source — `offset = page *
  pageSize`, `default-page: 0` in `application.yml`, and `hasPrev = page > 0`,
  which is only coherent on a 0-based counter. The response echo was the
  unobserved half, and it could not be observed: `?page=0&pageSize=3` no longer
  500s but 400s, because the gateway reads `page` as a filter key (entry above),
  so no request has ever returned a `pagination` object at all.
- **What is left is a sanity check, not an open assumption.** When the endpoint
  starts answering, read `currentPage` on a request for page 2 once. If it ever
  disagrees with the statement above, `RestTaskaApi.toPagination` is the single
  line to change — but the expectation now is that it will not.
- **The contract should still say it.** `PaginationInfoDto.currentPage` is a
  bare `integer` with no minimum and no prose, and a fact that has to be
  established by asking the team is a fact the next client will get wrong. One
  sentence in the schema removes a whole class of off-by-one.
- **Removal:** the contract stating the basis of `currentPage`, which costs one
  sentence and removes a class of off-by-one nobody can test for today.

### A row can only be addressed by a `uuid`, so most tables have no row card

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}/{id}`
- **Contract:** `id` is `type: string, format: uuid`, and the gateway's
  controller takes it as a `java.util.UUID` — a non-uuid key is refused before
  admin-service is called.
- **But admin-service does not need one:** `ReadOnlyQueryBuilder`
  `buildSafeGetByIdQuery` compares `"pk"::text = $1`, which works for a numeric
  id, a short code, anything. The restriction is the gateway's alone.
- **Effect:** a table whose primary key is not a uuid — a lookup keyed by a
  code, a sequence-numbered log — has no reachable row card at all.
- **Compensation:** `isAddressableKey` makes a row clickable only when the
  catalog names a primary key *and* types it `uuid`. A link that is certain to
  be refused is worse than no link, and the reader is not told the row is
  openable when it is not. The same guard also refuses a key the catalog marks
  sensitive: the address contains the key, so linking it would print in the URL
  bar, the accessible name and browser history the exact value the table
  withholds.
- **Removal:** the gateway taking `id` as a string and letting admin-service's
  `::text` comparison do what it already does.

### The single-row response carries no `meta`, and its `data` is optional

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}/{id}`
- **Contract:** `ReadOnlySingleRowResponseDto` has exactly one property, `data`,
  and it is not required. There is no `meta`, so — unlike the rows endpoint —
  the response does not state which service and table it came from.
- **Effect on masking:** the fail-closed join described two entries below cannot
  be done the same way here. The card has only the URL's service and table to
  join the catalog on, so it trusts the address rather than the server's own
  statement. This is weaker, and it is the best available: there is nothing else
  in the response to key on.
- **Effect of an absent `data`:** a 200 with no `data` renders as a card of
  dashes rather than as a missing row — the server has a 404 for the missing
  case and uses it, so an empty 200 means "nothing to say about this row", which
  is what a row of dashes reads as.
- **Removal:** `ReadOnlySingleRowResponseDto` carrying the same `meta` the rows
  response does, and marking `data` required.

### Issue links answer with a different field than they are asked with, and nothing states what it can hold

- **Endpoints:** `GET`/`POST` `/api/v1/issues/{issueId}/links`,
  `DELETE …/links/{linkId}`.
- **Contract:** the request carries `linkType`, typed as `IssueLinkTypeDto` —
  a closed enum, `BLOCKS | RELATES_TO | DUPLICATES`. The response carries
  `viewLinkType`, typed as a bare `string` with **no** enum. Different name,
  different type, no statement anywhere that they are the same value set.
  `IssueLinkResponseDto` also declares no `required` block, so formally every
  field of it is optional.
- **Reading taken (TAS-157):** the asymmetry is deliberate, not a typo. "View"
  is read as *the relation as seen from the issue that was asked about*, which
  makes the response able to carry values the request enum has no name for —
  the inverse of a `BLOCKS` seen from the blocked issue. Renaming it to
  `linkType` on the way in, or narrowing it to the request enum, would throw
  away exactly the values that justify the field.
- **Compensation:** `IssueLinkType` (request) is a closed union;
  `IssueLink.viewLinkType` (response) is an open `string`.
  `RestTaskaApi.toIssueLink` passes any string through untouched — including
  values this build has never heard of — and turns an absent or non-string one
  into `""`. Presentation narrows instead of the mapper
  (`issueLinkTypeLabel`, `src/lib/format.ts`): a known value gets a written
  label, an unknown one is humanised verbatim (`IS_BLOCKED_BY` → "Is blocked
  by"), and an unstated one reads "Linked". Same shape as the `globalRole`
  narrowing above, one level later.
  **The scope of that claim, precisely:** no value of `viewLinkType` can drop a
  row, be coerced into another relation, or crash the panel. It says nothing
  about the *other* optional fields. A link that arrives naming neither of its
  ends leaves `sourceIssueId` and `targetIssueId` as `""`, `otherEndOf` returns
  `""`, and there is no issue to navigate to — such a row renders inert: the
  relation and the words "Unknown issue", with no click target and no route. It
  is still listed, and still removable if it carried an `id`, because a link the
  server reports does exist even when it will not say what it joins.
- **Second consequence in the UI:** because the response is the link as *this*
  issue sees it, `targetIssueId` is not reliably "the other issue" — on the
  receiving end of a `BLOCKS` the issue on screen *is* the target. The panel
  therefore picks the other end by comparing both ids against the issue it is
  showing, and never assumes either field.
- **What the mock asserts, and on what authority:** `MockTaskaStore` stores a
  link once and inverts the view for the far end (`BLOCKS` ↔ `IS_BLOCKED_BY`,
  `DUPLICATES` ↔ `IS_DUPLICATED_BY`, `RELATES_TO` unchanged), so the
  open-string path is reachable without a gateway. That inversion is this
  repository's *reading* of the field name, not something the contract or the
  gateway has confirmed. It also refuses a self-link (`INVALID_ARGUMENT`), a
  duplicate pair in either direction (`ALREADY_EXISTS`) and an unknown issue
  (`NOT_FOUND`) — plausible, but likewise unconfirmed: the contract enumerates
  no error codes for these routes.
- **Unverified:** no request in this repository has ever reached these
  endpoints. Whether the gateway inverts anything, what strings it uses if it
  does, whether it rejects a self-link, and whether `POST` is idempotent are
  all unknown.
- **What it costs if the reading is wrong.** If the gateway turns out to echo
  the *stored* type from both ends, the mock's inversion map is **not** the only
  thing that changes — the UI is wrong on screen, not merely differently
  seeded. `IssueLinksSection` prints `issueLinkTypeLabel(link.viewLinkType)`
  directly (`src/screens/BoardScreen.tsx`), so the blocked issue would read
  "Blocks TAS-101" — the relation stated backwards, with nothing failing. The
  fix would be to derive the label from the *pair* (the value, plus whether the
  viewer is this link's `sourceIssueId`), which means:
  - `issueLinkTypeLabel` gains a second argument and an inverse table, in
    `src/lib/format.ts` — the file's only such signature today;
  - the row in `IssueLinksSection` passes `link.sourceIssueId === issueId`;
  - `MockTaskaStore.linkView` stops inverting, and the `answers each end with
    the relation as that end sees it` case in `src/api/mock/MockTaskaApi.test.ts`
    inverts its expectation;
  - the "Is blocked by" assertions in `e2e/issue-links.spec.ts` and the
    `IS_BLOCKED_BY` cases in `src/lib/format.test.ts` and
    `src/api/rest/RestTaskaApi.test.ts` change with it.

  Three source files and four test files. Not large — but not "nothing in the UI
  has to change", which is what an earlier version of this entry claimed and
  which would have priced the wrong reading at zero.
- **Order is unspecified, exactly as it is for comments.** `ListIssueLinksResponseDto`
  says nothing about sorting. `MockTaskaStore` returns links oldest-first by
  `createdAt`; `RestTaskaApi` passes the gateway's order through untouched. So
  the two modes can render the same links in different orders with nothing
  failing — the same gap as the comment-ordering entry above, and it should be
  closed in the same place ([TAS-141](https://jira.ozero.dev/browse/TAS-141)).
- **The role gating here is a UI courtesy only.** A `VIEWER` is shown no add
  form and no remove control, but the contract states no permissions for these
  three routes at all — no roles, no error codes. Nothing has confirmed the
  gateway refuses a `VIEWER`'s `POST`, and the frontend must not be read as
  evidence that it does.
- **Project scoping is the mock's invention.** `MockTaskaStore` resolves both
  ends within one project, so it cannot produce a cross-project link and no
  test exercises one. The contract scopes these routes to an issue and never
  mentions a project, so a link across projects may well be legal. The UI is
  built for it — a row navigates to `link.projectId || projectId` rather than
  assuming the board it is on — but that path has never run.
- **Removal:** [TAS-157](https://jira.ozero.dev/browse/TAS-157) carries the
  verification against the deployed gateway. This entry closes when a live
  response has been observed and the contract names the value set of
  `viewLinkType` (or states that it is the request enum after all).

---

### Closed by observation: the label routes answer exactly as the contract says — and writing one used to break the issue read, fixed and measured 2026-09-08

- **Endpoints:** the seven `labels` routes added by
  [TAS-120](https://jira.ozero.dev/browse/TAS-120) — project labels
  (`GET`/`POST /projects/{projectId}/labels`,
  `PATCH`/`DELETE /projects/{projectId}/labels/{labelId}`) and issue labels
  (`GET`/`POST /projects/{projectId}/issues/{issueId}/labels`,
  `DELETE …/labels/{labelId}`) — plus the `labelId` query parameter on
  `GET /projects/{projectId}/issues` and `IssueResponseDto.labels`.
- **Contract** (`docs/contract/openapi.yml`, backend `4d1570431d60`): the two
  project-label writes take `{name, color}` (`CreateProjectLabelRequestDto` /
  `UpdateProjectLabelRequestDto`, colour `^#[0-9A-Fa-f]{6}$`, name 1–50), and
  the issue write takes `{labelId}` (`AddIssueLabelRequestDto`).
- **Observed 2026-08-21** in the gateway's *runtime* spec — `GET /v3/api-docs`,
  which is what `swagger-ui` renders and therefore what a reader sees first:
  all three request bodies are `{"type": "string"}` rather than the DTOs the
  contract names. Every response schema matches the contract.
  - Settled by reading the gateway rather than by guessing between the two:
    `LabelsController` takes `Mono<CreateProjectLabelRequestDto>`,
    `Mono<UpdateProjectLabelRequestDto>` and `Mono<AddIssueLabelRequestDto>`,
    so the JSON on the wire is the DTO. The `string` is springdoc failing to
    introspect a reactive request body, not a second contract. `RestTaskaApi`
    sends the DTOs.
  - Worth keeping rather than dismissing as a generator artifact: the next
    person to read the Swagger page will reach the same doubt, and the thing
    that resolves it — the controller signature — is not on that page.
- **Compensation:** none. `RestTaskaApi` follows the contract as written.
- **Observed 2026-08-21** against the deployed gateway, signed in as `admin`
  (`GLOBAL_ADMIN`), on project `kappa-test`
  (`c7f82d29-4207-4278-b5fc-cb16b844264b`). All seven routes answer, and they
  answer exactly as the contract states — this is the paragraph that used to
  say none of them had ever been called.
  - `GET …/labels` → `200 {"items":[],"totalCount":0}` on a project with none.
  - `POST …/labels` with `{"name","color"}` → `201` with the full
    `ProjectLabelResponseDto`: `id`, `projectId`, `name`, `color`, `createdBy`,
    `createdAt`, and `deletedAt: null`. **The DTO is the body, not the bare
    string the runtime spec prints** — the reading taken from
    `LabelsController` above is confirmed on the wire.
  - `PATCH …/labels/{id}` with both fields → `200`, name and colour both
    changed. `DELETE …/labels/{id}` → `204`, and the project list is empty
    afterwards.
  - `POST …/issues/{id}/labels` with `{"labelId"}` → `201` with the join row
    (`issueId`, `labelId`, `createdBy`, `createdAt`) — nothing the caller did
    not already have, which is why `TaskaApi` returns `void`.
  - `GET …/issues/{id}/labels` → `200` with the three-field
    `IssueLabelResponseDto`. `DELETE …/labels/{labelId}` → `204`.
  - ~~`GET /projects/{id}/issues` carries no labels, as the contract says: the
    short DTO holds `id`, `issueKey`, `issueType`, `priority`, `summary`,
    `assigneeId` and nothing else.~~ **Both halves stopped being true.** The
    list DTO is `IssueResponseDto` and carries labels — measured 2026-09-08,
    see the TAS-195 closure below. Left struck rather than deleted because this
    was the most quotable sentence in the repository for "does the list carry
    labels", and a reader who half-remembers it should meet the correction.
- **Still unverified after that pass:** whether `labelId` actually filters
  (the probe project had one issue, so a filter proves nothing there), what
  order either list route returns, and whether `totalCount` can disagree with
  `items.length`. The two mock rules taken from
  [TAS-119](https://jira.ozero.dev/browse/TAS-119) — case-insensitive name
  uniqueness and a soft delete that reaches every issue — were not exercised
  either. And `IssueResponseDto.labels` could not be checked at all, for the
  reason immediately below.
- **Writing a label makes the issue permanently unreadable
  ([TAS-172](https://jira.ozero.dev/browse/TAS-172)) — fixed, measured
  2026-09-08, see the bullet below.** This was the finding that mattered, and
  it was not in the label routes — they are clean. `GET /api/v1/issues/{issueId}`
  **used to answer** `500` for any issue a label had ever touched:
  `{"code":"INTERNAL_SERVER_ERROR","message":"Unknown event type:
  ISSUE_EVENT_TYPE_LABEL_ADDED"}`. TAS-119 taught issue-service to write
  `LABEL_ADDED` and `LABEL_REMOVED` history events; the gateway's history
  mapper did not know them and threw.
  - It did not heal, which is why the fix had to come from the gateway.
    Detaching the label changed the message to `LABEL_REMOVED` and kept the
    `500`; deleting the label from the project entirely left the issue `500`
    still, because the history event was already written and nothing on the
    client could retract it. That is also why the measurement below is
    conclusive: the broken row is still in the database, and it reads.
  - **FIXED. Measured 2026-09-08 on the issue this entry names.**
    `GET /api/v1/issues/09bf59ad-82e6-4650-992a-5d7c0dfadea9` — `kappa-test-1`,
    the live reproduction deliberately left broken by the verification pass —
    answers **`200`**. Its history is four events carrying the types `CREATED`,
    `LABEL_ADDED` and `LABEL_REMOVED` — one of them repeats — and the issue
    carries one label. So the two events are
    **mapped**, not merely tolerated: the gateway did not fix the `500` by
    dropping what it could not name, which was the reading this entry would
    otherwise have had to rule out.

    Read the probe design, because a weaker one would not have closed this. An
    earlier pass the same day read three issues that *already carried* labels
    and got `200`. That is suggestive and not sufficient — it does not perform
    the write sequence this entry blames, and both reviewers said so
    independently. What closes it is the named id: an issue already in the
    broken state, read back, answering `200`.
  - ~~**It takes the whole board with it, not just the panel.**~~ No longer
    true, and it would not be even if the `500` returned: `listIssues` hydrated
    every row through `getIssue` because the list DTO omitted fields the card
    needs, so one labelled issue failed the project's entire issue read —
    measured then as list `200`, row hydration `500`, whole call rejected.
    TAS-195 removed the hydration, so a detail-route fault now costs the issue
    panel and the notification bell's one lookup, not a board.
  - ~~**Compensation: none, and the UI ships the writes anyway**~~ — the
    owner's call, made knowing the above, so the backend team could work the
    bug against a real reproduction. **The hazard that came with it is
    retired**: attaching a label on the deployed stand no longer breaks that
    issue, and `kappa-test-1` is readable again.
  - **What is still owed here.** The Jira story is the backend's to close and
    was left untouched; this entry records the measurement, not the decision.
    And the general shape survives its instance: an unknown event type is still
    fatal by construction unless the gateway was changed to tolerate one, which
    this probe cannot distinguish from "the two known types were added". The
    next event type issue-service invents is the test.
  - Same class as [TAS-139](https://jira.ozero.dev/browse/TAS-139), which was
    this bug on comment events and was closed. It will recur on the next event
    type issue-service adds unless an unknown type stops being fatal, which is
    what TAS-172 asks for.
  - **Role gating is the UI's alone.** TAS-119 says VIEWER reads, MEMBER and
    ADMIN attach and detach on an issue, and only project ADMIN owns the
    project's labels — and the UI splits its controls that way. The *store*
    enforces none of it: no label write in `MockTaskaStore` consults a role, so
    nothing in the mock-backed suite proves the split is even the right one.
    The seven routes each declare a `403` in the contract, which is what the
    UI is deferring to; whether the gateway draws the line in the same place is
    unobserved. Do not read a green e2e run as evidence about permissions.
  - The same caveat covers the `labelId` filter: the board makes it the
    server's job (`["issues", projectId, labelFilter]`) because a client-side
    filter over a 100-issue page would answer a narrower question, so a gateway
    that ignores the parameter would quietly show an unfiltered board.
  - `IssueResponseDto.labels` is defaulted to `[]` by `RestTaskaApi`, so a
    gateway that does not send the field yet draws unlabelled cards instead of
    failing.
  - **Both label list responses carry `totalCount` while neither route
    declares a `page` or `pageSize`** — unlike `GET /projects/{projectId}/issues`
    and the comments route, which declare both. A count with nothing to page by
    is either redundant or the trace of a default page size the contract does
    not state. `RestTaskaApi` discards it, so a truncated list would arrive
    looking complete. The first live call against a project with many labels
    should check whether `items.length === totalCount`.
  - **Neither list route states an order**, and the three implementations do
    not agree by construction: the mock returns project labels in insertion
    order and an issue's labels in *project* order rather than attach order,
    `RestTaskaApi` passes through whatever arrives, and the gateway's order is
    unknown and need not be stable between calls. Both optimistic writes
    append, so a chip can move once the server answers. Nothing sorts, on
    purpose — inventing an order here would hide the fact that the contract has
    none.
- **Removed by:** [TAS-172](https://jira.ozero.dev/browse/TAS-172) closing,
  plus one more live pass covering what the list above still marks unverified
  — the `labelId` filter on a project with several labelled issues, list
  ordering, `totalCount`, and `IssueResponseDto.labels` — the last of which, when
  this was written, could not be seen
  until the issue read stops answering `500`.

### Closed by measurement (TAS-195 pass): `IssueResponseDto.labels` comes back populated

**Measured 2026-09-08** with a `GLOBAL_ADMIN` token, on three projects: for each
one, a list row carrying labels was read back through
`GET /api/v1/issues/{issueId}`, and the detail `labels` matched the list — API-2
1 and 1, PCAI-5 1 and 1, CRM-2 1 and 1, the last of those also carrying four
comments. The field the detail DTO declares is filled.

Backend [TAS-178](https://jira.ozero.dev/browse/TAS-178) carries the same
measurement as a comment; its status is the backend owner's to move, so the
story may still read open while this entry does not. The frontend never
compensated for this — see the compensation line below — so nothing comes out
with the closure. The list route carries labels too, which is a separate fact
and the one [TAS-195](https://jira.ozero.dev/browse/TAS-195) stands on.

The entry as it stood:


- **Endpoint:** `GET /api/v1/issues/{issueId}` — the detail read, and the only
  route the board has for a card's labels. Note the shape: `RestTaskaApi.getIssue`
  calls `/issues/{issueId}`, **not** `/projects/{projectId}/issues/{issueId}`. If
  the two carry different DTOs, that is the first place to look.
- **Contract** (`docs/contract/openapi.yml`): `IssueResponseDto.labels` is an
  array of `IssueLabelResponseDto`, described as «Метки задачи (краткая
  информация)».
- **Observed 2026-08-23** by the owner on the deployed stand, project
  `kappa-test`, issue `kappa-test-2`, with the label `test2` attached. The board
  was filtered to `test2` and the card was returned — so the **gateway knows the
  association**, because that filter is the server's job
  (`["issues", projectId, labelFilter]`). The card then drew no label chip.
- **Why that pins it to the response rather than the UI.** `IssueCardContent`
  renders `{issue.labels.length ? … : null}` (`src/screens/BoardScreen.tsx`, `IssueCardContent`),
  so an empty array draws nothing at all — which is what a reader sees. The board
  gets its cards from `listIssues`, which since TAS-195 maps the list row
  directly and reads `labels: (issue.labels ?? []).map(toLabel)` off it
  (`src/api/rest/RestTaskaApi.ts`, `toIssue`). There is no fallback and no filter in
  between: a populated `labels` on the wire reaches the chip. The same card draws
  labels correctly against the mock, which is the control.
- **This is the first observation of the field.** The label entry above says it
  "could not be checked at all" and "cannot be seen until the issue read stops
  answering `500`" — that was [TAS-172](https://jira.ozero.dev/browse/TAS-172),
  which has since been fixed. The read now answers, and the field is empty.
- **Probed directly on 2026-08-23**, from the owner's browser session against
  the deployed gateway, and the inference above is confirmed. Project
  `kappa-test` (`c7f82d29-4207-4278-b5fc-cb16b844264b`), issue `kappa-test-2`
  (`20a52516-659b-48b5-a9c6-0f4817533541`):
  - `GET /api/v1/issues/20a52516-…` answers `200` with an
    `IssueWithHistoryResponseDto` whose `issue.labels` is `[]`.
  - The `history` of that *same response* carries two `LABEL_ADDED` events,
    `payload.labelName` `test` and `test2`.
  - `GET /api/v1/projects/c7f82d29-…/issues/20a52516-…/labels` answers `200`
    with both — `test` `#8B5CF6`, `test2` `#E3A008`, `totalCount: 2`.

  So the association is held by the same service and served by the neighbouring
  route, while the field the detail DTO declares stays empty. The earlier
  session could not make this request at all: its egress policy rejected
  `CONNECT api.taska.ozero.dev:443` with `403`, before TLS and before any
  `Authorization` header was read.
- **Filed as [TAS-178](https://jira.ozero.dev/browse/TAS-178)**, and it is the
  unmet acceptance criterion of [TAS-119](https://jira.ozero.dev/browse/TAS-119)
  («Issue labels возвращаются в `GetIssue`», «Labels возвращаются в
  `ListIssues`») rather than new backend work. TAS-120 shipped the REST label
  routes and they answer; it is the detail DTO that is not filled.
- **Not closed by TAS-124/TAS-125 either.** The Board API's card DTO does carry
  `labels`, but that is a different route. The detail read outlives it — the
  issue panel uses it, and so does the board until a frontend story migrates the
  board onto the Board API, which is not filed.
- **Compensation: still none, and now by decision rather than while waiting.**
  `GET /projects/{projectId}/issues/{issueId}/labels` is verified working and
  returns the three-field DTO, so the board could hydrate labels per card from
  it — but that is a second per-issue request on top of the N+1 hydration
  `listIssues` already performs, i.e. two round trips per card on a board read.
  The probe says the field the gateway declares is the one to fill, so the fix
  belongs there and the frontend stays as it is. **The owner settled this on
  2026-08-23, after reading the probe: fix the backend, do not hydrate on the
  frontend.** So this is a decision on the record, not a default — revisit it
  only if that changes.
- **Which layer drops the field is not visible from here.** TAS-119 owns
  `IssueResponse` in issue-service and TAS-120 owns the gateway's REST mapping;
  from outside only the gateway's `200` with `labels: []` is observable, and
  either half could be the one that stops carrying it. Whoever takes TAS-178
  reads it from the backend side first.

### `GET /issues/search` rejects the query length its own contract permits, and ignores filter values it does not understand

- **Endpoint:** `GET /api/v1/issues/search`, new in backend `4241be2ec144`
  (TAS-110), connected by [TAS-179](https://jira.ozero.dev/browse/TAS-179).
- **Probed 2026-08-23** against the deployed gateway with a `GLOBAL_ADMIN`
  token supplied by the owner. Every line below is a measurement, not a
  reading of the contract.
- **What the endpoint does well, recorded so the next agent does not re-derive
  it:** it matches a substring, case-insensitively, over `issue_key` OR
  `summary` OR `description`, and Cyrillic works (`мапперы` finds
  `TEST_TEST-1` by its description alone). Filters AND together. `page` and
  `pageSize` behave, and `totalCount` is the size of the whole matching set
  rather than of the page — which is the first honest issue total this
  frontend has ever been able to print.

**Re-measured 2026-09-10 as `defaultUser`, and all three still reproduce** — the
first time with a control that separates "the filter matched nothing" from "the
filter was ignored". Baseline with no filters: `200`, one item. Then
`?priority=NOT_A_PRIORITY` → `200` with **the same one item**, and
`?issueType=EPIC` → `200` with the same one item, while `?priority=LOW` against
a `MEDIUM` issue correctly answers zero and `?priority=MEDIUM` answers one. So
the unknown value is *dropped*, not applied, and the earlier reading of this was
right. `?statusKey=NOT_A_STATUS` answers `200` with zero, which is the third
behaviour for the same class of mistake. `?query=ka` → `400 "Search query must
be at least 3 characters"`, `?query=` → `400`, no `query` at all → `200`.
`?projectId={foreign}` → `403`, `?projectId={nonexistent}` → `404 "Project not
found"`.

**Three divergences, one of them a defect.**

- **The minimum query length is 2 in the contract and 3 in the runtime.** A
  two-character `query` answers `400 INVALID_ARGUMENT` with
  `"Search query must be at least 3 characters"`, while the contract declares
  `minLength: 2`. They differ by exactly one character, so a client written
  against the contract meets a `400` at the boundary and nowhere else — the
  worst kind of gap to find in production.
  - **There are two validators, not one, and they disagree.** Found by
    `api-contract-guard` on 2026-08-23 by probing *without* a token, which
    separates them: `?query=a` and `?query=` answer `400 "Invalid request
    parameters"` **before authentication**, while `?query=ab` reaches `401`.
    So the gateway edge enforces the contract's own `minLength: 2` and the
    service behind auth enforces 3 — the edge is faithful to the document and
    the service is not, which is why the disagreement is invisible until you
    hold a token. The same probe shows the edge enforcing `page >= 0` and
    `pageSize` in `1..100` pre-auth, and *not* validating `priority`,
    `issueType`, `statusKey` or `projectId` at all, which is independent
    corroboration of the silently-ignored enum below.
  - Consequence for `SEARCH_QUERY_TOO_SHORT_MESSAGE`, which the code calls the
    gateway's wording reproduced verbatim: it is verbatim for a two-character
    query and not for an empty or one-character one, where the edge answers
    `"Invalid request parameters"` instead. Only a developer reading a thrown
    error ever sees the difference — the UI never sends either.
- **An empty `query` is a `400`; an absent `query` is a `200`.** This one has a
  real trap in it: the obvious implementation sets the parameter on every
  keystroke and therefore sends `query=` the moment the field is cleared,
  turning "show me everything" into a `400`.
  - **Which spec says what, because the two do not agree and the difference is
    the whole point of this bullet.** The handwritten contract vendored at
    `docs/contract/openapi.yml` gives the parameter `type: string` and
    `minLength: 2` and no default at all. The gateway's *generated* spec at
    `https://api.taska.ozero.dev/v3/api-docs` gives it
    `{"type":"string","default":"","minLength":2}` — so the springdoc
    description of the running service documents as its default precisely the
    value that same service answers `400` for. Corrected here on 2026-08-23
    after `release-reviewer` checked the claim against the vendored file and
    found it absent; the original entry attributed the default to the
    handwritten contract, which never carried it. The runtime behaviour the
    compensation is built on was measured directly either way and did not
    depend on either document.
- **An unrecognised `priority` or `issueType` is silently ignored.**
  `priority=URGENT` and `issueType=EPIC` both answer `200` with the *entire*
  set of 18 issues rather than `400`. A filter whose value the server did not
  understand answers with a wider result than the one asked for, and the
  answer is indistinguishable from an honest "the filter applied and matched
  everything". The neighbouring `statusKey` behaves better — an unknown key
  yields an empty result, not a full one — and `projectId` behaves best of
  all, answering `400` on a non-UUID and `404 Project not found` on a UUID it
  does not know. Three parameters on one endpoint, three different answers to
  the same question.

- **Compensation:** the API layer never sends a `query` below the runtime
  minimum and never sends an empty one — the parameter is omitted rather than
  emptied — and only ever sends enum values the contract names. The minimum
  lives in one exported constant so the mock, the REST mapper and the UI
  cannot drift apart on it; the mock rejects a short query the same way the
  gateway does, so the mock-backed e2e suite cannot pass a case the deployed
  gateway would `400`.
- **User-visible effect:** none of the three reaches a reader, which is the
  point of the compensation. The cost is that the UI cannot offer a
  two-character search — a real limitation for short keys, and the reason the
  minimum is worth settling rather than absorbing.
- **Removal:** [TAS-180](https://jira.ozero.dev/browse/TAS-180). The
  silently-ignored enum is the half that is a defect; the other two are the
  contract and the runtime disagreeing, and either side may be the one that
  moves. When it closes, the constant and the enum guard come out together.
- **Decided 2026-09-11 with the owner; TAS-180 stays `Done`.** The minimum of
  three is deliberate and set through the environment, so the contract moves to
  it — `minLength: 3`, no `default` — under
  [TAS-206](https://jira.ozero.dev/browse/TAS-206). The ignored enum becomes an
  empty result rather than a `400`, under
  [TAS-218](https://jira.ozero.dev/browse/TAS-218). The length constant stays
  for good; the enum guard comes out with TAS-218.

### The search DTO carries no `status` and no `projectId`

- **Endpoint:** `GET /api/v1/issues/search`.
- **Observed 2026-08-23:** every hit is an `IssueShortResponseDto` —
  `{id, issueKey, issueType, priority, summary, assigneeId}` — the same short
  shape `GET /projects/{projectId}/issues` returns, and for the same reason.
- **Re-measured 2026-09-10** on a real hit rather than on the schema: the object
  really does arrive without `statusKey` and without `projectId`, so the two
  compensations built on that absence — placing a hit in a column, and deriving
  the project from the issue-key prefix — are still both required. Filed as part
  of [TAS-205](https://jira.ozero.dev/browse/TAS-205), closed 2026-09-11 into
  [TAS-218](https://jira.ozero.dev/browse/TAS-218), which puts `projectId`,
  `projectKey` and `statusKey` on the hit.
  It is not a contract violation: the contract declares exactly this. It is
  recorded because of what it costs the UI.
- **Two things follow, and both shape the feature rather than decorate it.**
  A hit cannot be placed in a board column, because the column is a status and
  the hit has none — so the board renders server hits as their own group and
  never merges them into the columns. And a hit found outside the open project
  cannot be linked, because a link needs a `projectId` the response omits.
- **Compensation:** the `projectId` is resolved from the `issueKey` prefix
  against the projects list the client already holds (`CRM-1` → `CRM`, split
  on the *last* hyphen because project keys contain them: `kappa-test-1` →
  `kappa-test`). Zero extra requests. A prefix matching no known project
  yields a hit rendered without a link rather than a guessed route.
  - **The lookup folds case, and that is a second compensation rather than a
    detail of the first.** Project keys are contract-open strings and the
    deployed gateway holds lower-case ones (`kappa-test`), so a key matched
    exactly would fail to resolve on real data. The cost is that two keys
    differing only in case would collapse into one and route a hit to the
    wrong project; unreachable in the mock seed, and never asked of the
    gateway. Recorded by `api-contract-guard`, 2026-08-23; the collision
    hazard itself is in `docs/ai/BACKLOG.md`.
  - **Ordering was never measured.** `page` and `pageSize` behave, but nothing
    here establishes that the gateway's order is stable across pages — the
    mock imposes `createdAt` ascending and the contract promises nothing. Both
    callers read page 0 only, so this is latent rather than live.
- **Why not hydrate.** The owner settled the general question on 2026-08-23
  while deciding TAS-178: fix the backend, do not hydrate on the frontend.
  `listIssues` used to be the standing exception — it paid an N+1 through
  `getIssue` for exactly this reason — and TAS-195 removed it once the gateway
  started sending whole issues, so the rule now has no exception at all.
  Hydrating search would be that same N+1 on every keystroke, which is the
  version of it that was never affordable.
- **Removal:** none filed, and none should be until the board itself is the
  thing being changed — the short DTO is the contract's own design, and the
  compensation above costs nothing. Recorded so the next agent does not
  discover the missing `projectId` from a broken link.

### `NotificationResponseDto.link` is a gateway API path, and on a real inbox it is empty on every row

- **Endpoint:** `GET /api/v1/notifications`.
- **Probed 2026-08-24** on the deployed gateway with a `GLOBAL_ADMIN` token
  supplied by the owner, after they reported that clicking a notification
  landed on the not-found screen. Connected by
  [TAS-183](https://jira.ozero.dev/browse/TAS-183).
  - `LABEL_ADDED` / `LABEL_REMOVED` → `link: "/issues/{uuid}"`.
  - `ISSUE_ASSIGNED` → `link: ""`.
  - `ISSUE_TRANSITIONED` → `link: ""`.
- **Re-probed 2026-09-10 against a different inbox — `defaultUser`, a plain
  `USER` — and it is worse than the 2026-08-24 sample said.** Twenty
  notifications, five types, and **`link` is empty on every single one**:
  `USER_BLOCKED` ×8, `USER_UNBLOCKED` ×8, `ISSUE_ASSIGNED`, `MEMBER_ADDED`,
  `MEMBER_UPDATED` ×2. So "empty for the two types people read" understates it
  for this population; the earlier sample's `LABEL_ADDED` links are the exception
  rather than the rule. Two side facts from the same read: the page carries **no
  `totalCount`**, and `USER_BLOCKED` / `USER_UNBLOCKED` are **already live** on
  the deployed stand, days after backend PR #151 added them — their bodies read
  "Your account has been blocked. Reason: …" and carry no uuid, so the
  first-uuid-in-body fallback cannot misfire on them.
- **`/issues/{uuid}` is the gateway's own REST path, not a route of this
  application.** Ours is `/projects/{projectId}/issues/{issueId}`, because a
  project board is an issue's context. `navigate()` on the value as sent
  therefore matches nothing and renders the not-found screen — which is what
  the owner saw.
- **The contract is silent rather than violated.** `link` is a nullable string
  with no stated format, so the two sides simply read the field differently.
  That is why this is a gap to be agreed rather than a bug to be fixed on one
  side, and it is filed as [TAS-184](https://jira.ozero.dev/browse/TAS-184).
- **`link` is absent-capable, not merely nullable.** `NotificationResponseDto`'s
  `required` list omits `link`, `readAt` and `userId`. The compensation covers
  absent as well as null, so `link: string | null` must not be "tidied" to
  `link: string` later.
- **Compensation, in two halves.** `notificationTarget()`
  (`src/domain/notifications.ts`) takes an issue id from a `/issues/{uuid}`
  link, and failing that from the first UUID in the notification's `body` —
  every body carries exactly one, because the gateway names issues by raw id.
  The issue is then read to learn its `projectId` and the route is built from
  that. A notification with no resolvable id marks read and does not navigate,
  and stops presenting itself as something that opens.
- **The residual everyone will forget to test.** The failed-read case is the
  obvious one and it behaves: an unresolvable or non-issue UUID ends in an
  honest error rather than a wrong destination. The case that does *not*
  announce itself is a body carrying a UUID that is a **real but different**
  issue — that navigates somewhere plausible and wrong, silently. Nothing in
  the current wire data produces it; nothing prevents it either.
- **The mock seed is part of the compensation.** Until this story the mock
  seeded a real frontend route, which is the entire reason no test ever caught
  this — the mock was reproducing the product we meant rather than the one that
  ships. `MockTaskaApi`'s notification seed now mirrors the gateway, empty links
  and raw UUIDs included. It comes out *together with* `notifications.ts`: a
  revert of one without the other leaves a green suite proving shapes the
  gateway no longer sends.
- **Provenance, and its limits — as they stood on 2026-08-24, and answered
  2026-09-10.** The first sample was eight most recent notifications read as
  `GLOBAL_ADMIN`, an account that sees notifications an ordinary member never
  would, so it was not a sample of a normal inbox; the token expired within the
  session and `api-contract-guard` could not reproduce any of it. Both limits are
  now closed by the re-probe above: a second sample, twenty rows, on a plain
  `USER`'s own inbox, and it reproduced the finding rather than softening it.
  Kept rather than deleted because the heading above it changed on the strength
  of that second sample, and a reader should be able to see which claim rests on
  which population.
- **Removal:** TAS-184, and it has to be all-or-nothing. If the gateway starts
  sending a usable target for *some* types only, the link branch silently takes
  over while the body fallback keeps running for the rest, and the compensation
  looks removed while half of it is still load-bearing.

### The mock refuses an issue/project pair that the gateway answers

- **Endpoint:** `GET /api/v1/issues/{issueId}`.
- Found by `api-contract-guard` on 2026-08-24 while reviewing TAS-183;
  pre-existing and never recorded. `MockTaskaStore.findIssue` matches on
  `projectId && issueId`, so a mismatched pair throws `NOT_FOUND`; the REST
  route is issue-scoped and never sends the project, so the same pair answers
  `200`. The one input on which the two implementations disagree.
- **This is why `getIssueById` exists as its own method** rather than being
  folded into `getIssue`: a caller that has only an issue id — a notification —
  must not go through the signature whose extra argument the two
  implementations treat differently.
- **Not an access check, in either implementation.** The mock's predicate is an
  *issue-belongs-to-named-project* consistency check with no membership in it.
  Access is the server's, as always.
- **The gateway's scoping on this route is inferred, not measured.** Its
  siblings `GET /projects/{id}` and `…/issues` answer `403` to a non-member
  (observed 2026-08-18, above), and the contract declares only `200` and
  `default` here. Nobody has probed this route with a non-member token, and
  TAS-183 is the first feature that can reach a cross-project issue read from
  a click rather than a hand-typed URL — so the mock now applies the membership
  predicate the gateway is *assumed* to apply, and that assumption is stated
  here rather than buried.
- **Removal:** none filed. It is a mock-fidelity note, not a backend ask.

---

### Retry accepts a stuck event five minutes after the summary calls it stuck

- **Endpoint:** `POST /api/v1/admin/outbox/{service}/{eventId}/retry` (backend
  PR #143, TAS-106, merged 2026-09-03), against
  `GET /api/v1/readonly/outbox/problematic-summary` beside it.
- **Observed:** read on `develop` 2026-09-08 from `OutboxRetryServiceImpl` and
  `OutboxRetryRepositoryImpl`. The eligibility *rule* is a source reading and
  not a wire measurement — say so before quoting it. The route's **deployment**
  is measured: `POST /api/v1/admin/outbox/issue/not-a-uuid/retry` answers `400
  INVALID_ARGUMENT` where a control path on the same prefix answers the
  static-resource `404` (`release-reviewer`, unauthenticated, 2026-09-08). And
  the path enum is **not** enforced on the wire — `…/outbox/notification/<uuid>/retry`
  answers `401` rather than `400`, so binding accepts any string and only
  `getDatabaseClient` refuses it. The client's closed list is therefore a strict
  narrowing over what the wire would carry, which is the safe direction. The retry `UPDATE` carries
  `WHERE id = … AND (status = 'FAILED' OR (status = 'PROCESSING' AND processing_started_at < :stuckBefore))`,
  where `stuckBefore` comes from `admin.outbox-retry.stuck-threshold`, default
  **10m**. The summary flags a `PROCESSING` row as stuck after
  `admin.outbox.processing-timeouts`, default **5m**, configured per producing
  service. Both are server configuration the client never sees.
- **So the gateway will list a row as stuck and refuse to retry it**, for about
  five minutes, and nothing on the wire lets a client predict which rows are in
  that window. The refusal is `FAILED_PRECONDITION` → HTTP **400** with
  `"FAILED_PRECONDITION"` in `code`, the same shape as the last-active-admin
  refusal on the user writes.
- **Not the only eligibility rule, and the other one is the bigger trap.**
  `NEW` and `PUBLISHED` are refused outright — and "Overdue NEW" is one of the
  three categories the Problems view exists to show. A retry button drawn from
  "this row is problematic" would therefore fail on a whole category of the
  list. The brief for TAS-194 assumed exactly that and `frontend-builder`
  refused it, reading the service instead.
- **The UI instead:** offers Retry on `FAILED` and `PROCESSING` only, never on
  `NEW` or on a status it does not recognise, and never on a `serviceKey`
  outside the path enum. On a `PROCESSING` row it says before the press that the
  server's own threshold is longer than the list's, and after a refusal it
  prints the server's sentence verbatim and keeps the dialog open. **No
  client-side clock**: hard-coding ten minutes would be a guess about one
  deployment's configuration, and the mock seeds a row inside the gap so the
  refusal is reachable by clicking rather than only by argument.
- **`attempts` is not reset**, which is the most assumable-and-wrong thing about
  this endpoint: the column is absent from the `UPDATE`, so the response
  reports the count the row already had. The dialog says so in the sentence
  before the button.
- **A 5xx can follow a retry that succeeded.** `auditService.logAudit` runs
  after the `UPDATE` commits, so the write and the report of it are not one
  transaction. The `server` and `unreachable` arms say the event may have been
  retried; the `conflict` arm says the opposite, and is exact — eligibility is
  checked before the update and again in the update's own `WHERE`.
- **Removal:** [TAS-200](https://jira.ozero.dev/browse/TAS-200) — a backend
  story. Align the two thresholds, or better, expose eligibility on the summary
  row **and state the rule in the contract**, so the client stops inferring it.
  The second half is the durable ask and the reason the first is not enough: the
  eligibility rule lives only in Java, and the threshold is an environment
  variable, so **the backend can change which events are retryable without
  changing the contract** and this client would silently start drawing wrong
  buttons. A flag moves the rule from Java to a field; describing it makes a
  change to it a contract change, which is the only kind of change this
  repository can notice.

  The client's re-derivation of that rule *is* a compensation, which is why this
  entry has a removal at all. An earlier revision of this line said "none filed"
  while the story was already open — the drift this file exists to prevent,
  committed inside the entry that documents it.

### Closed by TAS-194: the problems summary was TAS-105-only, then the endpoint answered, then the compensation came out

**Closed on the second of the two conditions, twelve days after the first.** The
endpoint deployed on 2026-08-27 and nothing happened here, because the
compensation rendered as a quiet note and matched its signature by exact
equality, so against a live `200` it could not fire — and a compensation that
never fires is one nobody comes to retire. It was found on 2026-09-08 while a
different story was refreshing the snapshot, and removed by TAS-194, which had
to open this view anyway for the retry write. `OUTBOX_SUMMARY_UNSERVED_MESSAGE`,
`isSummaryNotDeployed`, the note branch and the `TAS-105` link are gone from the
tree.

The entry is kept for the sequence rather than the fact. **Deploy and removal
are two events, and only the first announces itself.**

**Measured 2026-09-08** with a GLOBAL_ADMIN token:
`GET /api/v1/readonly/outbox/problematic-summary` answers **200** with
`{counts, events, notAllShown}` — two real `FAILED` events on `project`,
`attempts: 5`, `lastErrorMessage: "Failed to construct kafka producer"`. Backend
[PR #141](https://github.com/VladislavYurin/taska-backend/pull/141) (TAS-105)
merged **2026-08-27**, and the refreshed snapshot carries the path.
`isSummaryNotDeployed` (`src/screens/admin/events.ts`) matches its signature by
exact equality, so against a 200 it is inert rather than wrong — which is why
this was invisible until someone re-read the file.

Everything below was written before that and describes the gateway as it was.
It is kept because the compensation it explains is still in the tree.

- **Endpoint:** `GET /api/v1/readonly/outbox/problematic-summary` — the
  stuck/failed outbox summary the Events section's Problems view is built on
  (TAS-167).
- **Observed (superseded, see above):** the vendored snapshot (develop @
  `4241be2`) had no such path, and the deployed gateway did not serve it: the
  backend change was
  [backend PR #141](https://github.com/VladislavYurin/taska-backend/pull/141)
  (TAS-105), then In Review. **Measured 2026-08-25** with a GLOBAL_ADMIN
  token: the live gateway routes the path into the generic table read — the
  `outbox` segment is taken for a service key — and answers
  `400 INVALID_ARGUMENT` with `"Unknown service: outbox"`. That exact
  signature, not a 404, is what "not deployed yet" looks like on the wire.
  The shape the client is built to is the branch's `openapi.yml` — the path
  above, `ProblematicOutboxEventsSummary` response of `events` + `counts` +
  `notAllShown`, optional `serviceKey` query — plus three semantics read from
  the branch's service code, because the contract does not state them:
  `reason` is a human-readable English sentence, **not an enum** (the
  category is derivable from `status`, which for a problematic row is exactly
  `FAILED` / `PROCESSING` / `NEW`); `counts` always cover every outbox
  service even when `serviceKey` narrows `events`; an unknown `serviceKey` is
  INVALID_ARGUMENT.
- **The UI instead:** `MockTaskaApi` implements the summary fully, derived
  from the same mock `outbox_events` rows the Outbox journal reads, so the
  two views of the section agree with each other. `HybridTaskaApi` passes the
  call to REST like every other admin read — deliberately no mock fallback:
  hybrid holds no mock store, and a synthesized summary beside a journal of
  real rows would put two contradicting answers on one screen. Until the
  backend deploys, the Problems view renders exactly the measured signature
  above — INVALID_ARGUMENT with "Unknown service: outbox" — as "the gateway
  does not serve this yet (TAS-105)": a note, not an error alert. Any other
  error, a genuine NOT_FOUND included, keeps the ordinary error taxonomy
  (`events.test.ts` asserts it is not swallowed). This paragraph ended, when it
  was written, with ~~"the signature disappears on deploy, so the note heals
  itself"~~. **It did not.** The signature disappeared on 2026-08-27 and the note
  is still in the tree, inert; the sentence is kept here struck rather than
  deleted because it is the mechanism this entry now exists to warn about — a
  compensation that promises to retire itself is a compensation nobody schedules
  the removal of.
- **Switch-off:** nothing to switch — the compensation is the honest note
  plus the mock, and `RestTaskaApi` already speaks the final shape.
- **Removal:** [TAS-194](https://jira.ozero.dev/browse/TAS-194), which opens the
  Events section for the retry write and takes the note out with it —
  `OUTBOX_SUMMARY_UNSERVED_MESSAGE`, `isSummaryNotDeployed`, **the branch and
  the rendered `<p>` in `src/screens/admin/AdminEventsProblems.tsx`** — the view
  that actually draws the note, and the one an earlier version of this list
  forgot — plus the comments in `src/screens/admin/sections.ts`,
  `src/api/HybridTaskaApi.ts` and the mock, and the `TAS-105` link pinned by
  `src/screens/admin/AdminScreen.test.tsx`. The present-tense comments left
  standing in `AdminEventsProblems.tsx`, `src/api/mock/MockTaskaApi.ts`,
  `src/api/rest/RestTaskaApi.test.ts` and `AdminScreen.test.tsx` ride with them
  deliberately, so that story removes one coherent thing rather than the
  leftovers of two. The user-facing string is correct as written either way: it
  renders only when an old gateway is on the other end, so it is true whenever
  it is visible. The
  `jsonb` serialisation entry above comes out in the same pass, as it always
  said it would; its own text still calls PR #141 In Review and is corrected
  here only on that point.

  The old wording said "TAS-105 merging and deploying closes it". It merged on
  2026-08-27 and nothing closed, because nothing was looking: the compensation is
  a note rather than an error, and a note that never fires is a note nobody
  reports. That is the argument for re-reading this file on every snapshot
  refresh rather than only when a story touches an entry.

### Closed by TAS-196: the three admin user writes — block, unblock, reset-lockout — are deployed

**Two things under this closed heading are still live, and the file's own rule
would hide them.** "Anything not starting with Closed is open" is a rule about
entries, and this entry closes only its *transport* claim — that the routes were
not served. Everything it records about how they refuse is unaffected by the
deployment and is compensated for today:

- the status/code table below, and with it `isConflict`'s code arms in
  `src/api/errors.ts`. The contract declares `409` for block and unblock while
  the gateway answers **400 `FAILED_PRECONDITION`** for the last-active-admin
  refusal, so reading the status alone drops the refusal this feature is most
  careful about into "the gateway would not accept this request";
- the `reset-lockout` refusal that arrives as `400` where the backend's own test
  asserts `409`, which has its own open entry further down.

The entry itself, in the past tense:

- **Endpoints:** `POST /api/v1/admin/users/{userId}/block`,
  `POST /api/v1/admin/users/{userId}/unblock` and
  `POST /api/v1/admin/users/{userId}/reset-lockout` — the writes the Users
  section of the admin console is built on (TAS-186 for the first two, TAS-188
  for the third). The heading and this list name all three so the entry is
  greppable by any of them; an earlier revision named two, which is how a
  reader looking for `reset-lockout` found only the entry about *its refusal*
  and concluded the route was deployed.
- **Observed, and then closed.** The vendored snapshot had no such paths and
  the deployed gateway did not serve them. The backend change was
  [PR #134](https://github.com/VladislavYurin/taska-backend/pull/134)
  (TAS-107, two routes) when this entry was written; it is now
  [PR #146](https://github.com/VladislavYurin/taska-backend/pull/146)
  (TAS-107 + TAS-108, **three** routes, head `01a5af4`), which supersedes it.
  Both were open when this was written, which is why the older one is named
  rather than deleted — a reader who finds #134 first should learn here that it
  is not the one this client was built against. **Measured
  2026-08-25** with a GLOBAL_ADMIN token:
  `POST /api/v1/admin/users/not-a-uuid/block` answered **404** with
  `{"code":"NOT_FOUND","message":"No static resource
  api/v1/admin/users/not-a-uuid/block for request '…'"}`. That message prefix
  is Spring's static-resource fallback — what an unmapped path falls through to
  — and it is what distinguished "this route is not deployed" from a deployed
  route's own `404 "User not found"`.

  **PR #146 merged 2026-09-07 and deployed, and the same probe now answers
  differently. Measured 2026-09-08**, GLOBAL_ADMIN token, invalid uuid so that
  nothing could be mutated: `POST /api/v1/admin/users/not-a-uuid/block` and
  `POST …/not-a-uuid/reset-lockout` both answer **400**
  `{"code":"INVALID_ARGUMENT","message":"Invalid request parameters"}`. A route
  that validates its path parameter is a route that is mapped, so all three are
  deployed — the count this entry insisted on. The snapshot was refreshed to
  develop `96408229c1e4` in the same pass, and it carries the three paths.

  The shape the client is built to is the branch's `openapi.yml` — **re-read at
  backend PR #146's head `01a5af4` for TAS-188, where two things had moved since
  the draft this paragraph was first written against.** Body
  `{ reason: string }` with `minLength 1, maxLength 550`; `200` with
  `UserStatusResponseDto { userId: uuid, previousStatus, currentStatus,
  changedAt: date-time }` — `changedAt`, not `updatedAt` — where both statuses
  are the domain's `UserStatus`, which now has a fourth value
  (`INVITED | ACTIVE | BLOCKED | LOCKED`); `400` invalid uuid or missing
  reason, `401`, `403` not GLOBAL_ADMIN, `404` user not found, `409` business
  conflict. Plus five semantics read out of
  `auth-service/.../AdminUserManagementServiceImpl.java` on that branch,
  because the contract does not state them: block is legal from `ACTIVE` and
  `INVITED` only (`"Cannot block user with current status: <STATUS>"`);
  unblock only from `BLOCKED` and always to `ACTIVE`
  (`"Cannot unblock user with current status: <STATUS>"`); blocking a
  `GLOBAL_ADMIN` who is `ACTIVE` and the only such account is refused with
  `"Cannot block the last active global admin"`; an unknown user is
  `"User not found"`; a blank reason is rejected. **An `INVITED` account that
  is blocked and then unblocked becomes `ACTIVE`** — the invite state is not
  restored, which is the backend's semantics and not a bug to work around.
- **These refusals do not share a status, and the contract's "409" covers only
  one of them.** Read out of `RestErrorMapper.mapGrpcCodeToHttpStatus`,
  `GatewayErrorHandler` and `DomainStatus`, re-verified at `01a5af4` on the
  TAS-188 pass and unchanged there (found by `release-reviewer` on the TAS-186
  pass, when there were two of them; reset-lockout adds a third, in the entry
  further down that gives it its own table):

  | Refusal | `DomainStatus` | HTTP | body `code` |
  | --- | --- | --- | --- |
  | `Cannot block/unblock user with current status: X` | `ABORTED` | **409** | `"ABORTED"` |
  | `Cannot block the last active global admin` | `FAILED_PRECONDITION` | **400** | `"FAILED_PRECONDITION"` |

  `GatewayErrorHandler` writes the gRPC code's own name into the body, so those
  strings arrive verbatim — the gateway's code is **not** unknown, and an
  earlier revision of this entry saying so was wrong. The consequence is
  load-bearing: the last-active-admin refusal, the one this feature is most
  careful about, is a **400**, and only its `code` tells it apart from a
  genuinely bad request. `isConflict` (`src/api/errors.ts`) therefore reads
  `status === 409 || code === "FAILED_PRECONDITION" || code === "ABORTED"`, and
  the code arms are not a mock accommodation — trimming them to the status
  would drop that refusal into "the gateway would not accept this request".
  `MockTaskaApi` emits the same two codes for the same two refusals, so one
  predicate serves both implementations; `users.test.ts` pins the 400 case.
- **`X-Request-Id` is confirmed on these responses, and so is the CORS half
  that makes it readable.** Measured without a token against the deployed
  gateway: a 404 from `/api/v1/admin/users/…/block` carries `x-request-id` and
  `access-control-expose-headers: X-Request-Id`, and the `OPTIONS` preflight
  answers 200 with the same expose header. Both halves matter. Without the
  expose header `response.headers.get("X-Request-Id")` returns `null` in a
  browser however faithfully the server set it, and the dialog's request-id
  line — the one thing in a failure that identifies it in the gateway log —
  would silently never render.
- **The UI instead:** `MockTaskaApi` implements all three writes fully, with
  every refusal above reproduced word for word, and seeds one `INVITED`, one
  `BLOCKED` and one `LOCKED` account so all four states and all three actions
  are reachable by clicking. `HybridTaskaApi` delegates straight to REST with
  **no** compensation of any kind — these are writes, and a synthesised success
  would report a change to a table this client cannot alter, which is worse
  than the failure it would hide. While the routes were undeployed the
  confirmation dialog stayed open and said so, naming the story the operation
  belonged to — TAS-108 for reset-lockout, TAS-107 for the other two — read from
  the 404 **and** the `No static resource` substring together. **TAS-196 removed
  that sentence, and the `undeployed` arm of `userWriteFailure` with it**, so a
  404 from these three writes now means what it says: there is no such user. The
  predicate survives in `src/api/errors.ts` and `UNDEPLOYED_ROUTE_MESSAGE` in
  `src/api/TaskaApi.ts` beside it, because the attachment routes still need them
  — backend PR #147 is open — which is why TAS-190 moved the predicate out of
  `src/screens/admin/users.ts` in the first place. Every other failure keeps the
  section's ordinary taxonomy.
- **The response timestamp is `changedAt`, and this entry has now been wrong
  about it twice.** The first revision said the backend leaves the field unset,
  so it arrives as the 1970 epoch — taken from PR #134's *Известные проблемы*,
  which was stale. The second said the field is `updatedAt` and is filled from
  backend commit `62c4c675`. At backend PR #146's head `01a5af4` the field is
  **`changedAt`**: `UserStatusResponseDto.required` lists it, and the gateway's
  `AdminUserManagementMapper.toRestUserStatusResponse` calls
  `restDto.setChangedAt(...)`. The client shipped in TAS-186 read `updatedAt`
  and would have produced `undefined` in a field typed `string` on the day this
  deployed — no error, no failing test, because the REST fixture pinned the old
  name and so agreed with the bug. Renamed through the domain type, both
  implementations and every fixture by TAS-188.

  Recorded rather than quietly corrected, twice over, because a divergence file
  whose "Observed" lines have gone stale is the same failure as a component that
  absorbed one — and because the lesson is now measurable: **both wrong
  revisions were read out of a PR body or a superseded branch head.** The right
  one was read out of the mapper at the head the frontend is actually built
  against.

  The behaviour does not change — the field is still drawn nowhere — but the
  *argument* does, because it was also wrong. It said the response times "this
  write" while the `auth.users` row has an `updated_at` of its own: two clocks,
  and the row's is the one worth reading. There are not two clocks.
  `auth-service`'s `AdminUserManagementServiceImpl` builds every one of the
  three responses as `.changedAt(savedUser.getUpdatedAt())` on an entity whose
  column carries `@LastModifiedDate`, so the response timestamp **is** the
  row's `updated_at`, handed back early. The reason to leave it undrawn is
  simpler and survives: the section has one source of values — the refetched
  list — and a timestamp from the write response would be a second one, true
  for the two seconds before the refetch lands. Note what this argument
  deliberately does **not** rest on: whether either column is on screen. The
  Users section draws five
  named columns and `updated_at` is not among them; the Data section's view of
  the same table does draw it. The reasoning has to hold for both, and an
  earlier revision of this paragraph that appealed to "the column the table
  shows" was false of the section it was written about — the same overstatement,
  one layer down, as the epoch claim it replaced.
- **Switch-off:** done by TAS-196. The compensation was the honest sentence
  plus the mock; the sentence is gone, the mock stays, and `RestTaskaApi` spoke
  the final shape before the deployment rather than after it.
- **The uppercase status comparison is safe, and the contract is a trap about
  it.** `actionFor` and `StatusPill` (`src/screens/admin/users.ts`) compare the
  raw table value against `ACTIVE` / `INVITED` / `BLOCKED` exactly, with no case
  folding. The vendored contract's own filter example writes the value
  lowercase — `?status.equals=active`, `docs/contract/openapi.yml:1733` — which
  reads as licence to expect either case. It is not: `develop`'s
  `auth-service/.../0000-init.sql` declares
  `status varchar(32) NOT NULL DEFAULT 'INVITED'` with
  `CHECK (status IN ('INVITED','ACTIVE','BLOCKED'))`, and `global_role_chk`
  constrains the role column the same way. The column cannot hold a lowercase
  value, so the exact comparison is right and the example is simply wrong about
  its own data. Recorded because the next reader will meet the example before
  the DDL, and "make it case-insensitive" would be the wrong repair for two
  reasons, the second stronger than the first. A lowercase `active` is a
  spelling this build cannot tell apart from a state it has never seen, and
  §5.8 already says what to do with one of those: print it verbatim and offer
  no action. And `toUpperCase()` in `actionFor` would be a compensation for
  gateway behaviour **nobody has observed** — added in this file, of all
  files, whose entire job is to stop compensations from being invented for
  problems that were never measured.
- **What is still owed here.** The probe that closed this entry proves the
  routes are *mapped* — a 400 on an invalid uuid is a route validating its own
  path parameter. It does not confirm the refusal table above, because every row
  of that table needs a real account in a real state and a write that actually
  lands. `Cannot block the last active global admin` answering **400** with
  `code: "FAILED_PRECONDITION"`, and the status refusals answering **409** with
  `code: "ABORTED"`, are still read out of the backend's source rather than off
  the wire. `isConflict` depends on both arms, so the measurement is worth
  taking the next time this section is opened — on the stand, against an account
  seeded for it, never against a live admin.

  The old removal instruction said the `UNDEPLOYED_ROUTE_MESSAGE` constant and
  `isUndeployedRoute` came out in the same pass. **They did not, and the
  instruction was already stale when it was followed.** TAS-190 gave both a
  second caller — the attachment routes, whose backend PR #147 is still open —
  so deleting them would have taken a live compensation with it. This is the
  ordinary failure mode of a removal note: it names the code to delete at the
  moment the divergence is found, and code acquires callers afterwards. Read the
  callers, not the note.

  Kept for its history: the count in the old note was load-bearing. That PR
  carried two Jira stories, TAS-107 and TAS-108, and a reader following a
  two-route version of the instruction would have removed the compensation on
  TAS-107's deployment while `reset-lockout` still needed it — the modal then
  answering a merely-undeployed route with the `refused` sentence, which tells
  the reader an account is gone. It merged and deployed as three, so the trap
  never sprang.

### Closed by TAS-196: `UserStatus` grew a fourth value, and it arrived with the writes

`UserStatusDto` at backend PR #146's head `01a5af4` had four values —
`INVITED`, `ACTIVE`, `BLOCKED`, `LOCKED` — against the three the domain modelled.
`LOCKED` is a credential lockout: `AuthServiceImpl.handleFailedAttempt` sets it
after `maxFailedAttempts` failed sign-ins and `resetFailedAttempts` restores
`ACTIVE` on the next successful one. Nobody decides it, and it clears itself.

**It did not exist on `develop` when this was written.** Measured at
`ref=develop` on 2026-09-05: `auth-service`'s `UserStatus` entity declared
exactly `ACTIVE`, `BLOCKED`, `INVITED`; `common.proto`'s `enum UserStatus` had
no `USER_STATUS_LOCKED`; and `develop`'s `handleFailedAttempt(Credential)` took
no `User` and wrote no status. The two-argument version that sets `LOCKED` came
with PR #146, so the whole lifecycle shipped with the same change as the three
writes — which is exactly what happened on 2026-09-07. The refreshed snapshot
(develop `96408229c1e4`) declares `UserStatusDto` with all four values, and the
deployed gateway's own generated spec agrees: `UserStatusResponseDto` there
carries `previousStatus` and `currentStatus` over
`INVITED | ACTIVE | BLOCKED | LOCKED` (read 2026-09-08).

This is recorded because the first version of the TAS-188 brief asserted the
opposite — that `LOCKED` was already arriving in `auth.users` rows the Users
section prints — and the code was written with comments arguing from it. The
claim came from reading the PR head and assuming it described today. An
adversarial pass over the spec caught it by reading `develop`. The rule this
buys: **a fact about what is deployed is read at `develop`, never at a PR head**,
and the two are different sources even when they are the same file.

Compensating UI behaviour: none was needed before the merge — no row could
carry the value — and none is needed after it. The union, the label, the pill
and the third action all name `LOCKED`, shipped ahead of the deployment by
TAS-188 and unchanged by this closure; TAS-196 changed no code here. The
`develop`-versus-head distinction for this value is retired.

**What is still owed here.** A `LOCKED` row has still never been seen on the
wire. The value is reachable only by failing sign-in `maxFailedAttempts` times
against a real account, so nothing in this repository has rendered a real one —
the four-state coverage is the mock's seed. The entry below, about
`GET /users/me` answering `UNSPECIFIED` for a locked account, is the live half
of the same subject and PR #146 did **not** close it.

### Closed by backend PR #149: the admin writes answered with the protobuf constant, and nothing here was reading for it

- **Endpoints:** `POST /api/v1/admin/users/{userId}/block`, `…/unblock`,
  `…/reset-lockout` — the `previousStatus` and `currentStatus` of
  `UserStatusResponseDto` and `UserCredentialStateResponseDto`.
- **What was wrong.** From PR #146 deploying the three writes (2026-09-07) until
  PR #149 merged (2026-09-09), `AdminUserManagementMapper` filled both fields
  with `grpcResponse.getPreviousStatus().name()` — the protobuf constant,
  `USER_STATUS_ACTIVE` and its three siblings — while `openapi.yml` declared the
  bare `UserStatusDto`. PR #149 maps the four values explicitly and raises
  `INVALID_ARGUMENT` on anything else, so an unknown proto value can no longer
  reach the audit trail either.
- **Compensating UI behaviour: none, then and now.** This is recorded for the
  opposite reason to most entries here — the frontend read the field exactly as
  the contract declares it and would have been wrong about the deployed gateway
  for two days without knowing. `UserStatus` is the bare four-value union,
  `RestTaskaApi.toUserStatusChange` copies both fields with no narrowing, no
  fixture anywhere uses a prefixed value, and the string `USER_STATUS_` occurs in
  this repository only in two prose comments describing the proto enum.
- **What the prefixed form would have done, had it been seen.** Not a crash: the
  write response's `currentStatus` is read in exactly two places, the row's
  status override after a `200` and the live-region announcement. `isKnownUserStatus`
  rejects `USER_STATUS_BLOCKED`, so the pill would have printed the raw string in
  the unstyled `.admin-pill` and the announcement would have read "… is now
  user_status_blocked". Silent and cosmetic — which is why nobody found it by
  using the product.
- **Both halves are code readings, not probes.** Neither form was ever observed
  on the wire from here: the deployed writes have only ever been probed with an
  invalid uuid, deliberately, so that nothing mutated. The window this entry
  describes is closed, so the measurement that would have settled it is no longer
  available. Closed by backend PR #149; no frontend change.

### `GET /users/me` answers `UNSPECIFIED` for a locked account, not `LOCKED`

A second-order effect of the entry above, and one the frontend cannot fix. The
gateway's own `GatewayUserStatus` enum — the one behind `GET /users/me` — has
only `UNSPECIFIED/INVITED/ACTIVE/BLOCKED`, and **the merge did not change that.**
Re-read 2026-09-08 off the deployed gateway's generated spec: `GatewayUserContext.status`
still enumerates `UNSPECIFIED, INVITED, ACTIVE, BLOCKED` with no `LOCKED`, while the same
service's `UserStatusDto` on the admin writes has four values. So the gateway
now disagrees with itself about the status vocabulary, and
`AuthMapper.toGatewayUserStatus` sends a locked account through
`default -> UNSPECIFIED`. That account can still reach the profile menu:
`AuthServiceImpl.validateUserStatus` rejects `BLOCKED` and `INVITED` and lets
`LOCKED` through, so a token minted before the lock keeps working.

Compensating UI behaviour: `UserProfileMenu` guards its label lookup so an
unmodelled status prints as itself rather than as an empty badge. Note that
widening the union does **not** cover this case — the value that arrives is
`UNSPECIFIED`, which is not a `UserStatus` at all. Removed by: the gateway
teaching `GatewayUserStatus` about `LOCKED`, filed 2026-09-08 as
[TAS-197](https://jira.ozero.dev/browse/TAS-197).

### `reset-lockout` refuses with 400, and the backend's own test says 409

`POST /admin/users/{userId}/reset-lockout` is legal only from `LOCKED`. Anything
else raises `DomainStatus.FAILED_PRECONDITION("User is not in LOCKED status")`
in `auth-service`'s `AdminUserManagementServiceImpl`, and
`RestErrorMapper.mapGrpcCodeToHttpStatus` maps `FAILED_PRECONDITION` to **400**
with `"FAILED_PRECONDITION"` in the body's `code` — re-verified unchanged at
`01a5af4`, along with `ABORTED -> 409`.

`AdminUserManagementControllerTest` in the same PR has a case named «должен
вернуть 409 если пользователь не в статусе LOCKED» which stubs the gRPC client
with a `ResponseStatusException(CONFLICT)` and then asserts 409. It measures its
own stub. The client is built to 400, and `isConflict` reads the `code` rather
than the status, so it classifies the refusal correctly either way — which is
the same property that already carries the last-active-admin refusal.

Compensating UI behaviour: none; the modal says "conflict" from the code.
Removed by: the backend fixing either the mapping or the test. Raised on the PR
and on TAS-108.

### `mock` refused an over-long reason and `rest` sent it — closed by TAS-188

Not a gateway divergence but an implementation one, and it belongs here because
`AGENTS.md` makes mock/rest/hybrid interchangeability a constraint rather than a
preference. `MockTaskaApi`'s reason guard refused anything past 550 characters;
`RestTaskaApi`'s refused only a blank one, deliberately and with a comment
saying a client-side length check "would be a second, weaker copy of a rule the
server states". So a 600-character reason threw locally in mock mode and went to
the wire in rest mode.

The argument was wrong in its own terms: the 550 is enforced in exactly **one**
place on the server — the gateway's generated DTO, from `maxLength` — because
`auth-service` and `admin-service` validate only non-blank
(`GrpcRequestValidators.requireNonBlank`). A single server-side check is not a
rule the client is duplicating; it is one the client is relying on. Closed by
giving the REST guard the same cap as the mock's, which costs nothing in
practice because the field carries `maxLength={550}`.

### `PUT /issues/{issueId}` is a full replace, and the contract does not say so

The contract marks only `[summary, description, priority]` required on
`UpdateIssueRequestDto` and says nothing about what an absent planning field
means. Every normal reader takes that as "leave unchanged". It is not.

Observed in the Java, on `develop` (TAS-115, already merged — this half is not
waiting on backend PR #148): the proto fields are `optional`, the gateway sets
them through `setIfPresent`, `GrpcIssueService.updateIssue` resolves an unset
optional with `.orElse(null)`, and `IssueServiceImpl.updateIssue` then writes
`updatingIssue.setStoryPoints(storyPoints)` and its four siblings
**unconditionally**. So an omitted field is erased.

Cite the right artifact, because this paragraph has now been wrong twice about
the citation and the second time is the more instructive.

The `develop` evidence is `IssueServiceImpl.updateIssue` itself — five
unconditional setters, read at `develop`, and that is what carries the claim.

The backend test that names the behaviour in words, «Частичное обновление —
непереданные planning fields затираются», is a **unit** test and not
`PlanningFieldsIT`; the first draft called it an integration test. The
correction then overshot: it said the file exists only at backend PR #148's head
and 404s on `develop`. It does not. It is on `develop` as
`issue-service/src/test/java/ru/taska/service/IssuePlaningFieldsTest.java` —
**one `n`** — and PR #148 renames it to the two-`n` spelling. Checking the
two-`n` name against `develop` returns a 404 that means "renamed", and it was
read as "absent".

Worth the space because the mechanism is the one this whole file exists to
resist: a negative result from a lookup was treated as a fact about the world
rather than as a fact about the lookup. Two independent readers made it in
sequence, the second while correcting the first.

`BoardScreen` sends three partial bodies today — `{summary}` on blur,
`{priority}` from the picker, `{description}` on blur. Each one would wipe story
points and both dates the day backend PR #148 makes the fields reachable —
which it did on 2026-09-11, with this preservation already merged.

**The UI instead:** `UpdateIssueInput` gives `undefined` and `null` different
meanings — absent means "leave it", explicit `null` means "clear it" — and both
`RestTaskaApi` and `MockTaskaApi` re-read the issue and re-send the resolved
current value for anything the caller left alone. Components keep the partial
bodies they already write; the preservation lives in the API layer, where it can
be tested, and the full-replace semantics never reach a screen.

Against a gateway whose reads carry no planning fields every resolved value is
`null`, so the request body is byte-identical to the one sent before this change
— pinned by a REST test rather than assumed, which is what made it safe to ship
ahead of the merge. **That is a property of the pre-#148 gateway, not a live
invariant:** the deployed gateway declares the five as of 2026-09-11, so from
the first planning write onwards a summary-only edit carries the stored values
too. The REST test still pins the three-key body for a read that carries none,
and that is what it proves — do not read it as "the body never grows".

**Removed by:** nothing on the client, unless the backend distinguishes "not
sent" from "sent null". Asked on TAS-116, and the merged code answers no
(`api-contract-guard`, read at `develop @ 21a0d9d177a1`, 2026-09-11):
`IssueMapper`'s request-side `setIfPresent` is `if (value != null)` over plain
`Double`/`Integer`/`LocalDate` DTO fields with no `JsonNullable`, so an absent
key and a JSON `null` arrive as the same Java `null`, both leave the proto
optional unset, and both are written as `null` by the unconditional setters.
A client that always sends the
resolved value stays correct either way, which is why the question did not gate
the work. Note the re-read makes update a two-round-trip read-modify-write with
no optimistic concurrency available — `IssueResponseDto` carries `version` but
the update route accepts no `If-Match` and no expected version, so a concurrent
edit between the read and the write is silently clobbered. That was already true
for the three required fields; this widens it from three to eight.

Filed 2026-09-11 as [TAS-215](https://jira.ozero.dev/browse/TAS-215):
`PATCH /issues/{issueId}` taking an expected `version`, answering `409` on a
mismatch and the whole issue on success. Read against `develop` the same day:
the `version` column (`NOT NULL DEFAULT 1`, `CHECK >= 1`), the `+1` in
`IssueServiceImpl.updateIssue` and the `findActiveByIdForUpdate` row lock all
exist, the entity carries no `@Version`, and nothing compares the counter —
`IssueCommentRepository.updateWithVersionCheckAndAuthor` (`WHERE version =
:version … RETURNING *`) is the precedent in the same service. Partial update
needs `optional` on `summary`, `description` and `priority` in
`UpdateIssueRequestBody`, which proto3 does not give them today; the planning
fields already have it.

### `BigDecimal.equals` is scale-sensitive, so re-sending a story-point value looks like a change

A consequence of the preservation above, and one the client cannot fix.

`PayloadSerializer.createIssueUpdatedPayload` on `develop` decides both the
`payload.isEmpty()` early return and every per-field old/new delta with
`Objects.equals(storyPoints, issue.getStoryPoints())` on two `BigDecimal`s.
`BigDecimal.equals` compares scale as well as value. The stored value comes back
from a `numeric(5,2)` column at scale 2 (`3.00`); the incoming one is built by
`BigDecimal.valueOf(double)` in `GrpcRequestValidators`, whose scale follows
`Double.toString` (`3.0`). The two are never `equals` unless the double happens
to print exactly two decimals.

So from the day backend PR #148 merges, a summary-only edit on an issue that has
story points will defeat the no-op early return and write
`oldStoryPoints: 3.00 / newStoryPoints: 3.0` into the issue history and the
`ISSUE_UPDATED` outbox event — a change entry for a value nobody changed.

**The UI instead:** nothing, and nothing is possible — JSON numbers cannot carry
`BigDecimal` scale, so no client can send a value that compares equal. Today the
impact is zero because every resolved planning value is `null` on the wire, and
the activity feed renders `UPDATED` as one sentence rather than per field, so no
wrong sentence is shown. It becomes visible when the UI half lands and the feed
starts naming fields. **Removed by:** the backend comparing with `compareTo` or
normalising with `stripTrailingZeros`. Raised on TAS-116.

### The date cross-check compares against stored values, and refuses the ordinary case

Not in the contract at all. `IssueServiceImpl.updateIssue` compares the
*incoming* `startDate` against the **stored** `dueDate`, and the incoming
`dueDate` against the **stored** `startDate`.

The consequence is not exotic. Moving a whole window later in one request —
`{startDate: 2026-07-01, dueDate: 2026-07-20}` over a stored `(06-15, 06-26)` —
is refused, because the incoming start is past the stored due. That is dragging
a task later, the ordinary edit. Two requests in the right order succeed: due
first when moving later, start first when moving earlier.

The refusal's message also has its two labels swapped — the value printed as
"Due date" is the start date the caller sent — so it must never be shown
verbatim. Both raised on TAS-116.

**The UI instead:** the client validates only the fields the caller actually
supplied and lets the server refuse a resolved pair, rather than refusing on the
user's behalf about values they never typed. The mock reproduces both stored
comparisons before any mutation, so the refusal is reachable without a gateway.
Note `0007-issue-planing-fields.sql` adds `issues_dates_chk (start_date <=
due_date)`, so a *stored* pair can never be inconsistent — which is why
re-sending resolved values can never trip the check by itself.

### Closed by TAS-189 (backend PR #148 merged 2026-09-11): the planning-field declarations left backend PR #148, and the gateway build went red with them

- **Schemas:** `storyPoints`, `startDate`, `dueDate`, `originalEstimateMinutes`
  and `remainingEstimateMinutes` on the issue request and response DTOs — the
  whole of TAS-116's contract half. None of them are on `develop`.
- **Observed 2026-09-09, twice in half an hour**, because the PR moved while this
  session was reading it. At head `79187f94d135` the PR's `openapi.yml` still
  carried the five fields, and this repository re-pinned the extract to it. At
  head `4539137553b4`, force-pushed at 11:49Z, the PR changes **exactly one
  file** — `api-gateway/.../mapper/IssueMapper.java` — and its copy of the spec
  is byte-identical to `develop @ 5941499203ae`.
- **That is not a cosmetic loss.** The gateway's `ru.taska.domain.dto` classes are
  generated from that spec by `openapi-generator-maven-plugin` (`api-gateway/pom.xml`,
  `inputSpec … static/openapi.yml`, `modelPackage ru.taska.domain.dto`), so a mapper
  calling `restDto.setStoryPoints(…)` on a schema that does not declare the field cannot
  compile. `Build & Test — api-gateway` is failing on that head while the other nine
  module jobs pass — **but not for that reason, and the correction matters.** The job
  has exactly two compile errors, both `cannot find symbol` in the PR's own
  `IssueMapper.java`: `CreateIssueRequest` (the proto class) and
  `CreateIssueRequestDto` (which *is* generated from develop's spec). Those are
  missing imports, and javac stops before attributing the method bodies where the
  planning-field setters live. So restoring the declarations alone will not turn
  this head green, and the compile error the missing schema would cause has not
  been observed. Found by `api-contract-guard` reading the CI log after this entry
  had asserted the prediction and the failure were the same thing.
- **What follows for the deployed gateway is a reading, not a probe:** develop's spec
  does not declare the fields, the DTOs are generated from it, so a gateway built from
  develop cannot serialise them. No request was made to check, because a field that is
  absent from a response cannot be told apart from a field the server chose not to send.
- **The UI instead:** TAS-189's API layer (merged here as PR #45) was written against the
  earlier head and stays exactly as it is — it is right about the wire the day the
  declarations come back and wrong about nothing today, since nothing in the UI reads
  these fields yet. `docs/contract/pending/pr-148-TAS-116.yml` kept the extract with its
  header rewritten to say which head it describes (deleted on the close below). Nothing
  further was written against it until the declarations returned.
- **Removed by:** backend PR #148 restoring the declarations and merging. Raised on
  TAS-116.
- **Closed 2026-09-11.** PR #148 merged at 13:09Z from head `87bc8ed64134`, and
  that head changes `openapi.yml` again: the five declarations are back, and
  `develop @ 21a0d9d177a1` differs from the previous snapshot (`5941499203ae`)
  by exactly the blocks the extract at `79187f94d135` carried, plus `required`
  arrays on three of them (`IssueResponseDto`, `IssueShortResponseDto`,
  `UpdateIssueResponseDto`) — diffed, not assumed. Every
  module job on the merged head is green, api-gateway included. The deployed
  gateway was measured the same day rather than inferred from the merge:
  `GET /v3/api-docs` on `api.taska.ozero.dev` declares all five on
  `IssueResponseDto` and `UpdateIssueResponseDto`, and `storyPoints` on
  `IssueShortResponseDto` (`number`/`double`) and `BoardIssueDto`
  (`integer`/`int32`). The snapshot is refreshed to `21a0d9d177a1` and the
  extract is deleted. What is *not* measured: no write carrying a planning
  field has been made against the deployed gateway yet, so every "code read"
  caveat in the three entries above stays as written.

### `storyPoints` is `double` on the issue DTOs and `int32` on `BoardIssueDto`, and the column settles it

Backend PR #148 declares `storyPoints` as `number` / `format: double` on the
issue DTOs, and merged on 2026-09-11. `BoardIssueDto` declares the same field as
`integer` / `format: int32`, and merged on 2026-09-09. **Updated 2026-09-11:**
both readings are now in one contract, `develop @ 21a0d9d177a1`, and the
deployed gateway's `/v3/api-docs` carries both — `double` on the three issue
DTOs, `int32` on the board DTO. The disagreement is no longer between branches;
it is inside the contract, and this entry stays open until the board DTO
widens. **As of 2026-09-09** the text below still read: this is no
longer two open PRs disagreeing with each other, which is a worse place to be
rather than a better one — the narrower of the two readings is now the one in
force, and the wider one is still on a branch.

The database settles it: `0007-issue-planing-fields.sql` adds
`story_points numeric(5, 2)`. Half points are a real value and the board DTO's
`int32` would truncate them. The client models it as a float everywhere and the
board DTO is treated as the narrower of the two, not as the definition.

`numeric(5, 2)` also fixes two bounds the contract states nowhere. The **scale**
does not error — Postgres rounds `1.235` to `1.23` silently — so the client
refuses more than two decimals rather than storing a value the reader did not
type. The **precision** does error: `1000` and above is `22003 numeric field
overflow`. **What status that surfaces as has not been measured**, and this
entry has now guessed at it twice — first `500`, then `503` — so it stops
guessing and states the code read instead, marked as a read.

The chain reads as `500`. `GrpcExceptionHandler` does test `R2dbcException`
before its catch-all, and `RestErrorMapper` does map `UNAVAILABLE` to
`SERVICE_UNAVAILABLE`, which is where the `503` came from — but no
`R2dbcException` reaches that handler from a repository call. `issue-service`
saves through Spring Data R2DBC, whose statements run through **spring-r2dbc**'s
`DefaultDatabaseClient` — the class is in `spring-r2dbc`, not in
`spring-data-r2dbc`, which is where looking for it fails — and every exit there
carries
`.onErrorMap(R2dbcException.class, ex -> ConnectionFactoryUtils.convertR2dbcException(...))`,
which is declared to return a `DataAccessException` and holds the
`R2dbcException` only as a cause. So the first branch does not match, the
catch-all does, and `RestErrorMapper`'s default gives `500`. That branch is
effectively dead for anything a repository raises. Read at `spring-r2dbc`
7.0.5 and `spring-data-r2dbc` 4.0.3, which is what `spring-boot-starter-parent`
4.0.3 resolves — the read goes stale if the backend's Boot version moves.

The one route that could still produce `503` is a rollback that itself fails,
since `TransactionException` surfaces from the commit machinery rather than from
a statement, and `22003` raises at statement execution. Nothing on the expected
path reaches it.

Either way the entry's argument is untouched: a value the client can see and
refuse should not be sent to provoke a server fault, whichever fault it is. Both
guards are the client's own rules and move if the column does.

**Removed by:** the two PRs agreeing and the contract stating the bounds; the
status itself by one probe, once the fields are reachable.

### A fractional estimate is refused by the client and nobody knows what the server does

The two estimates are `format: int32` in the contract (on `develop` since
backend PR #148 merged, 2026-09-11), `int32` in the proto and `integer` in the
column, so a fractional value is not storable. What the gateway does with one is
**not known**: until 2026-09-11 no deployed gateway accepted these fields, and no
fractional estimate has been sent to the one that now does. It can be measured
now, with one probe against a throwaway issue; it has not been.

The gateway is on Jackson 3 — `IssueMapper` imports
`tools.jackson.databind.ObjectMapper`, `api-gateway/pom.xml` declares
`tools.jackson.core:jackson-databind`, and the parent is
`spring-boot-starter-parent` 4.0.3 — and `application.yml` carries no
`spring.jackson` block at all, so the behaviour is Boot 4's default for Jackson 3
and nothing in the backend names it. A remembered Jackson 2 default is not
evidence about it. An earlier version of the client comment asserted truncation
as though it had been observed; it had not.

**The UI instead:** refused client-side, with the client's own wording, because
both possible outcomes make that correct — a truncated `30.5` silently stores a
number the reader did not type, and a refusal is a 400 with a binding message no
reader should see. Also bounded above at `2_147_483_647`: without it the client
would send a value `int32` cannot hold, which the mock stores happily and the
REST path meets as a binding failure — a refusal the mock could not reproduce,
which is the interchangeability rule broken in the one bound nobody had checked.

**Removed by:** the contract stating the bounds, or one measurement once the
fields are reachable.

### `minimum: 0` is enforced as `>= 0` under a message that says "positive"

`GrpcRequestValidators.requireOptionalPositiveZeroOrInvalidArgument` tests
`value < 0` and refuses with `<field> must be positive`. So `0` is accepted —
correctly, a zero-point issue and a zero-minute estimate are both real — and the
message about it is wrong. The client uses its own wording and never shows the
server's for this case; `0` is seeded in the mock precisely so that a mapper
folding it to `null` fails a test rather than a review.

### The board route answers now, and the board screen still does not use it

`GET /api/v1/projects/{projectId}/board` (TAS-125) merged into `develop` on
2026-09-09 and is deployed. `TaskaApi.getBoard` exists in all three
implementations as of TAS-191; **`BoardScreen` does not call it** and still
composes its own board from `getWorkflow` and `listIssues`. This entry is why
that is deliberate, and what would end it.

The previous version of this entry gave four reasons not to build against the
route. Two are dead and are kept below in one paragraph each, because a reason
that dies quietly is a reason someone re-litigates. Two are alive.

**Dead: it could not answer.** The route's `rpc ListIssuesForBoard` was declared
and unimplemented, so a deployed gateway answered `501`. Backend PR #142
(TAS-124) merged 2026-09-07 and implements it end to end —
`IssueServiceImpl.listIssueBoard`, `GrpcIssueServiceAdapter.listIssuesForBoard`,
`IssueRepositoryImpl.findForBoard` and its board indexes. **Measured 2026-09-09**
against `api.taska.ozero.dev` with a signed-in token, project `API`
(`c9594240-…`): `200` with three columns in workflow order — `TODO`/10,
`IN_PROGRESS`/20, `DONE`/30 — carrying 1, 2 and 1 issues. Request id
`98aa1322-9a0a-457d-98fc-ccface9ed01b`. The same probe settled four semantics
the contract leaves open:

| Probe | Answer |
| --- | --- |
| `includeDone` absent or `false` | the `DONE` column is returned **empty** — the flag filters issues, never columns |
| `includeDone=true` | the `DONE` column carries its issues |
| `assigneeId` / `labelId` | filtered server-side; an id nobody holds gives `200` with every column empty |
| `issueType=EPIC`, `issueType=SUBTASK` | `400 INVALID_ARGUMENT` — correct, the contract's `IssueTypeDto` is `TASK`/`BUG`/`STORY` and nothing else |

**Dead: the review was open on an access-control gap.** PR #118 merged, and the
gap it was held for is closed one level below the gateway rather than in it. The
gateway still checks nothing itself — `BoardServiceImpl` zips workflow and
issues — but `IssueServiceImpl.listIssueBoard` opens with
`projectRoleChecker.checkProjectRole(requestId, nodeId, projectId, actorUserId,
listIssueRoles)`, the same call `listIssues` makes, and `workflow-service`
carries its own `ProjectRoleChecker`. **What a non-member sees is read, not
probed** — `release-reviewer` traced the chain that the first version of this
paragraph called an expectation. `ProjectRoleChecker.validateAccess` raises
`DomainStatus.PERMISSION_DENIED, "Access denied"` for a non-member and
`NOT_FOUND, "Project not found"` for a project that does not exist;
`RestErrorMapper` maps those to `403` and `404`. **Probed 2026-09-10** with the
second account the earlier paragraph said this needed: `GET
/projects/{foreign}/board?issueType=TASK` answers `403 PERMISSION_DENIED
"Access denied"`. The reading was right, the route refuses a non-member, and
`isMissingOrForbidden` covers the shape. What is owed here is nothing.

**Alive: it draws less than the board draws.** `BoardIssueDto` carries `id`,
`issueKey`, `summary`, `storyPoints`, an assignee `{id, displayName}` and
`labels`. The card draws `issueType`, `priority`, `description` and `createdAt`
as well, and drag-and-drop needs `status` and `issueType` as values rather than
as a column position. The runtime is narrower again than that list reads:

- `labels` carries label **ids**, not names — every value in the probe was a
  uuid matching a row of `GET /projects/{projectId}/labels`. A chip needs the
  name and the colour, so the label read stays either way. `TaskaApi` names the
  field `labelIds` for what it holds.
- `assignee.displayName` came back `null` for **every** assigned issue, beside
  an `id` that resolves to a named user elsewhere — and, like `storyPoints`, the
  source says it always will: `IssueBoardResponse` carries `assignee_id` and no
  name field of any kind, and `IssueMapper.toRestBoardIssue` builds `BoardUserDto`
  with `setId` alone. An avatar or a name is resolved against members the screen
  already holds, not read off this response.
- `storyPoints` came back `null` on every issue, and the reason is structural
  rather than incidental. `IssueBoardResponse` in `issue-service.proto` has **no
  `story_points` field**, and `IssueMapper.toRestBoardIssue` never sets one: the
  contract declares the field on `BoardIssueDto` and nothing on any branch that
  exists today can fill it. Found by `api-contract-guard` reading the proto after
  the probe had been written up here as the weaker fact — null *because these
  issues are unestimated* — which it is not. The mock therefore sends `null` too,
  so a screen cannot draw an estimate badge that would be blank in production.

**Alive: its failure mode is worse than the one it would replace.**
`BoardServiceImpl` throws `500 "Inconsistent state: issues found with statuses
not present in workflow"` when any issue carries a `statusKey` the workflow does
not list — one bad row blanks the whole board. Composing on the client, an
unknown status simply places no card. That is strictly better, and the merged
code is unchanged on this point.

There is one exception, and it is worth stating because the mock reproduces it:
a stray issue whose status key is the literal `DONE` never reaches that check
while `includeDone` is off, because `issue-service` excludes it in SQL
(`boardFilterConditions`) before the gateway builds columns. That one case
answers `200` with an empty column. Every other unknown status, and every
unknown status at all once `includeDone` is on, blanks the board.

**And the arithmetic does not favour the route even when the fields arrive.**
`issueType` is a **required** query parameter, so the board's own `ALL` filter
needs one call per concrete type: three. The response carries no transitions,
and `findTransition` on the drop path and `resolveTransitions` in the issue
panel both need them, so the three `getWorkflow` reads stay. That is six
requests against today's four — three workflows and one `listIssues` page —
for a card that draws less. The one thing today's shape does worse is the
`pageSize: 100` ceiling on that single page; the gateway passes no
`pageSizePerColumn` to `issue-service`, so the board route returns every issue
in every column, and that is the one measured argument in its favour.

**What this repository has instead:** `getBoard` on the `TaskaApi` interface,
with `rest` mapping the route, `hybrid` delegating to live, and `mock` building
the same board from its own workflow and issues — including the `500` on an
inconsistent status, so the two implementations fail the same way. Nothing calls
it. That is TAS-191's stated shape: be ready on the day the card DTO catches up,
without shipping a visible regression to get there a week early.

**And the ask is cheaper than the missing fields make it look.**
`IssueBoardResponse` — what `issue-service` already sends the gateway — carries
`issue_type`, `status_key`, `priority`, `reporter_id`, `label_ids`,
`watchers_count` and `comments_count`. `IssueMapper.toRestBoardIssue` maps five
of those to nothing. So `issueType`, `priority` and the `status` that
drag-and-drop needs as a value are a gateway mapper plus three schema lines, not
a change through `issue-service`; only `description` and `createdAt` are absent
from the proto as well. `storyPoints` is the odd one out in the other direction:
declared in REST and absent from the proto.

**Removed by:** `BoardIssueDto` gaining what the card draws — `issueType`,
`priority`, `description`, `createdAt` — and `labels` arriving as something a
chip can be drawn from. Not by the route working, which it now does. Raised on
TAS-125; the frontend half is TAS-191, and the mapper asks above are filed as
[TAS-201](https://jira.ozero.dev/browse/TAS-201), closed 2026-09-11 into
[TAS-213](https://jira.ozero.dev/browse/TAS-213). That ticket also records,
from a read of `develop`, what is a mapper change (`issue_type`, `status_key`,
`priority`, `watchers_count`, `comments_count` are already on
`IssueBoardResponse` and dropped by `toRestBoardIssue`) against what needs
proto fields (`description`, `created_at`, `updated_at`, `version`, `due_date`,
`story_points`), that `issue_type` on the request is not `optional`, and that
`displayName` waits on TAS-137's `GetUserDetailsByIds` — auth-service has no
read of users by id at all on `develop`.

### The five attachment routes exist only on an open backend PR

- **Endpoints:** `GET`/`POST` on
  `/api/v1/projects/{projectId}/issues/{issueId}/attachments`, `POST
  .../attachments/upload-url`, `POST .../attachments/confirm`, `GET
  .../attachments/{attachmentId}/download-url` and `DELETE
  .../attachments/{attachmentId}` — the whole of TAS-190.
- **Observed, measured 2026-09-06 rather than read:** the vendored snapshot has
  no such paths and the deployed gateway does not serve them. An unauthenticated
  `GET .../issues/{uuid}/attachments` answers **404** with
  `{"code":"NOT_FOUND","message":"No static resource api/v1/…"}`, while
  `GET .../issues/{uuid}/comments` beside it answers **401**. The 401 is the
  control: it proves the 404 is the route being unmapped rather than the request
  being unauthenticated. The backend change is
  [PR #147](https://github.com/VladislavYurin/taska-backend/pull/147), head
  `f53dca38`, open.
- **The UI instead:** the attachments section reads that pairing — the status
  **and** the `No static resource` substring, never the status alone — through
  `UNDEPLOYED_ROUTE_MESSAGE` in `src/api/TaskaApi.ts` and `isUndeployedRoute` in
  `src/api/errors.ts`, and answers with its own sentence naming TAS-131 instead
  of a failure. The upload control is suppressed in that state, because offering
  a picker for a route that cannot accept a file is worse than offering nothing.
  Any other failure keeps the ordinary taxonomy: a deployed route's own 404 must
  not be swallowed by this.
- **Removal:** PR #147 merging **and deploying** — not merging alone. When it
  does: refresh `docs/contract/openapi.yml` from `develop`, delete
  `docs/contract/pending/pr-147-TAS-131.yml`, delete the section's
  undeployed-route branch, and re-probe once, because the measurement above is
  what this entry rests on. `isUndeployedRoute` itself stays until the admin
  writes deploy too — two features share it now.

### `DELETE …/attachments/{id}` answers 204 for an attachment that is not there, and skips the role check

The contract documents a 404. The implementation does not.
`AttachmentServiceImpl.deleteAttachment` starts at
`issueAttachmentRepository.findByIdAndDeletedAtIsNull(attachmentId)` with **no
`switchIfEmpty`** — unlike the private `findActiveAttachment` two methods down,
which has one and does raise `NOT_FOUND`. An empty result therefore skips both
`flatMap`s, **including the `projectRoleChecker` call**, and
`GrpcAttachmentService.deleteAttachment` closes with
`.thenReturn(Empty.getDefaultInstance())`. So any authenticated caller gets 204
for a missing or already-deleted attachment, and the role gate on that path
never runs.

**The UI instead:** the mock reproduces the 204 rather than the documented 404,
and this entry is the other half of that decision — reproduce **and** flag,
rather than choosing between them. The behavioural argument decided it: with a
stale list, the server answers 204 and the row correctly stays gone, while a
mock answering 404 rolls the optimistic removal back and makes a file that *is*
deleted reappear under an error message. The mock would have been the worse of
the two behaviours, not merely the different one.

Note what is **not** made lenient: `getDownloadUrl` goes through
`findActiveAttachment`, which does carry `switchIfEmpty(NOT_FOUND)`, so the
download route genuinely 404s on a deleted attachment and the mock refuses there
too. The leniency is one method wide.

**Removed by:** the backend adding the `switchIfEmpty` or the contract dropping
the 404 — one or the other, and the role-check gap wants fixing regardless of
which. Raised on TAS-131.

### One third of the attachment flow never touches the gateway, and nothing configures CORS for it

`POST .../attachments/upload-url` answers with a presigned URL; the browser then
PUTs the raw bytes **cross-origin, straight to the object store**; `POST
.../attachments/confirm` persists the row. The middle leg is not a gateway
request, so none of this client's auth, tracing, error mapping or mocking
applies to it, and no frontend code can make it reachable if the store will not
take it.

Two things about that leg are unmeasured and neither is ours to fix:

- **Nothing in the backend repository configures CORS on the bucket.**
  `minio-init` in `docker-compose.yml` runs `mc alias set` and `mc mb` and
  nothing else — no `mc anonymous`, no CORS rules, no
  `MINIO_API_CORS_ALLOW_ORIGIN` in `.env.docker.example`, nothing under
  `infra/`. A cross-origin PUT carrying a `Content-Type` always preflights, so
  if the bucket states no allowed origin the upload cannot work from
  `taska.ozero.dev` no matter what this client does.
- **The host the browser is told to PUT to is a loopback address in every
  checked-in configuration.** `storage.public-url` defaults to
  `http://127.0.0.1:9000` and `.env.docker.example` repeats it;
  `StorageAutoConfiguration.s3Presigner` uses it as `endpointOverride`. The
  deployment's real `.env` is not in the repository, so whether production
  overrides it with a reachable host is unknown.

**The UI instead:** the panel distinguishes a blocked or unreachable PUT from an
HTTP failure the store returned. A preflight refusal surfaces as a `TypeError`
from `fetch` with **no status at all**, which is the signature to read; the
store's own status, when there is one, is carried in a shape of its own and
deliberately kept out of `ApiError.status`, because `src/api/errors.ts` reads
that field and would classify a store 403 as a gateway permission failure. The
mock plays the whole choreography without a network, so the feature is
exercisable before any of this is settled.

**Removed by:** a measurement, once the routes deploy — one upload attempt from
the deployed origin says more than any amount of reading. Raised on TAS-131.

### An over-size attachment answers 500, because `RestErrorMapper` has no `OUT_OF_RANGE` row

The three pre-flight refusals do not share a status, and the one a reader is
most likely to meet is the odd one.

- **disallowed type** — `validateFileParams` raises
  `DomainStatus.INVALID_ARGUMENT`, mapped to **400** with
  `code: "INVALID_ARGUMENT"`.
- **empty file** — never reaches `validateFileParams` at all. The generated DTO
  carries `@Min(1)` from the contract's `minimum: 1` and the gateway answers
  **400** `"Invalid request parameters"` in bean validation; behind it
  `GrpcRequestValidators.requirePositiveOrInvalidArgument` would answer the same
  code. `validateFileParams`'s own `sizeBytes <= 0` arm is dead code for this
  route.
- **over-size** — no `maximum` in the DTO and the value is positive, so both
  earlier guards pass and `validateFileParams` raises
  `DomainStatus.OUT_OF_RANGE`. `GrpcExceptionMapper` has an explicit
  `case OUT_OF_RANGE -> Status.OUT_OF_RANGE`, so the body's `code` is
  `"OUT_OF_RANGE"` — and `RestErrorMapper.mapGrpcCodeToHttpStatus` has **no
  `OUT_OF_RANGE` case**, so it falls to `default -> INTERNAL_SERVER_ERROR`.
  The reader gets **500** for a file that is one byte too large.

`common-lib`'s `DomainStatus` javadoc carries a mapping table that sends
`OUT_OF_RANGE` to 400, and an earlier version of the client comment cited it and
concluded the status was right. That table is documentation of intent in a
library the gateway does not consult; what the gateway executes is
`RestErrorMapper`, and it does not implement that row. A test pinned the false
conclusion. Both are corrected — the citation as much as the number, because
this file is built on the API layer's comments and a false entry in that record
does not age into a style preference.

**The UI instead:** the picker refuses an over-size file before a byte is sent,
so nobody meets the 500 through the product; and both implementations synthesise
the same code and status locally, so a caller cannot tell which one refused. The
same `OUT_OF_RANGE` arrives from leg three's re-measurement
(`validateAndGetUploadedObjectMetadata`), which is the path a file that grew
between the ticket and the upload would take.

**Removed by:** the backend adding the row to `RestErrorMapper`, or a `maximum`
to `sizeBytes` so the refusal happens in bean validation as a 400 like its two
siblings. Raised on TAS-131.

### The attachment limits are pinned from the backend's YAML, not from the contract

The contract states neither. `issue-service/src/main/resources/application.yml`
does: a **2 MB** ceiling exactly (`2097152`), as a YAML literal with **no env
override** unlike every neighbouring storage property, and a **thirteen-entry
MIME allowlist** matched by exact string with no wildcards and no case folding.

The allowlist refuses more than a reader expects: no `.docx` or `.xlsx`, no GIF,
no SVG, no video or audio, nothing extensionless (browsers report
`application/octet-stream`), and a `.zip` that some Windows browsers report as
`application/x-zip-compressed` rather than the allowed `application/zip`.

The presigned URL also carries a **15-minute TTL whose clock starts at the first
leg**, and the `Content-Type` is part of the signed request, so the value sent on
the PUT must be byte-identical to the one sent to `upload-url` — no
normalisation, no added charset, no recomputing it from the extension.

**The UI instead:** all four are client constants with their provenance in the
comment. The picker states the ceiling and the accepted types *before* a file is
chosen rather than refusing one after; the ticket is requested when the file is
chosen rather than when the panel opens; and a 403 on the PUT is read as an
expired window rather than as a permission failure.

**Removed by:** the contract stating the limits. Until then each constant is a
snapshot of a YAML line and says so — the 2 MB becomes a lie the moment that
line changes, and nothing here would notice.

### `projectId` in the attachment paths is not an access check, and the mock is stricter

`IssueAttachmentController` says so in its own comment — *«projectId в пути
используется только для REST-иерархии/читаемости URL и не участвует в
авторизации»* — and forwards only `issueId` and `attachmentId`. The real gate is
a project-role check inside issue-service: upload and confirm are ADMIN+MEMBER,
list and download add VIEWER, and deleting **someone else's** attachment is
ADMIN only.

`MockTaskaStore` does scope by project, so a mismatched `(projectId, issueId)`
pair diverges: the mock answers NOT_FOUND, the gateway answers 200. Exactly the
shape already recorded for `getIssue`, and pinned by a test rather than left to
be rediscovered.

**`DELETE` is the exception, and in the more dangerous direction.** Because the
mock's delete resolves leniently (see the entry above), a mismatched pair there
is a silent 204 no-op rather than a NOT_FOUND — while the gateway, which ignores
the path segment entirely, performs a real delete. So on that one route the mock
does *less* than the server rather than more.

**Two more places the mock is looser than the gateway, both on reads.**
`ProjectRoleChecker.validateAccess` refuses a non-member with
`PERMISSION_DENIED "Access denied"` **before** it maps a role or consults
`allowedRoles` at all — so `listAttachments` and `getAttachmentDownloadUrl`
answer **403** to a non-member no matter that `view-attachment-roles` contains
`VIEWER`. The mock membership-checks neither, following the same convention
`getIssueById` already documents for project-scoped reads. And no seeded member
holds `VIEWER` at all — the seed assigns `ADMIN` to the first member and
`MEMBER` to the rest — so the upload gate is exercised against a *non-member
standing in for* a VIEWER rather than against the role it names.

**Attachment list order is the mock's invention.**
`IssueAttachmentRepository.findAllByIssueIdAndDeletedAtIsNull` is a derived query
with no `ORDER BY` and the contract promises nothing, so the gateway's order is
physical-row order and can change under a `VACUUM`. The mock sorts by
`createdAt` ascending. Same shape as the unmeasured search ordering recorded
above.

**The UI instead:** nothing — no screen constructs a mismatched pair, and a
non-member never reaches the board at all, because the project read refuses
first and lands them on the not-found screen. **Removed by:** nothing for the
path segment; the read gaps by the mock membership-checking these two routes,
which would cost the read-only seed the section currently demonstrates.

### `listAttachments` mints a presigned download URL per row and the gateway throws it away

`AttachmentServiceImpl.listAttachments` builds a presigned URL for every
attachment it returns. `IssueAttachmentMapper.toIssueAttachmentDto` reads eight
of the ten proto fields and discards `url` and `object_key`. So the list read
costs one `headObject` plus one presign per row for a value no client ever sees,
and the separate `download-url` call is required anyway.

**The UI instead:** call `download-url` when the reader asks for the file, which
is what the contract describes. **Removed by:** the backend either surfacing the
URL it already computes or not computing it. Raised on TAS-131; a backend
efficiency defect, not a client compensation.

### `sortableColumns` and `filterableColumns` are empty for `auth.users`, which decides a section's controls

- **Endpoint:** `GET /api/v1/readonly/auth/users`.
- **Observed 2026-08-25**, GLOBAL_ADMIN token, deployed gateway: **200**, with
  `meta.columns = [id, login, global_role, email, display_name, status,
  created_at, updated_at]`, **none of them flagged sensitive**,
  `primaryKey: id (uuid)`, rows under `data` and the usual `pagination` — and
  `meta.filterableColumns` and `meta.sortableColumns` **both empty**.
- **The UI instead:** the Users section (TAS-186) offers no filter chip and no
  sortable header at all. This is not a simplification: the Data section
  already reads both lists and hides what they omit, and offering either
  control here would put a request on the wire the gateway refuses. Page is the
  section's only view state and it stays in the URL.
- **Not a divergence from the contract**, which says nothing about which
  columns a table will serve — it is a measurement that decided a design, and
  it is recorded so the next reader does not add a sort header and wonder why
  it 400s.
- **Removal:** if a future catalog marks columns on this table, the section can
  grow the controls the Data section already has. Nothing has to be removed
  first.

---

## Closed

Entries are closed **in place**, by re-heading them `### Closed by TAS-…` and
rewriting the body in the past tense with the observation that closed them. That
keeps the history next to the compensation it explains, which is the whole point
of the file — a closed entry is how the next agent learns the endpoint's shape
without re-deriving it.

So this section stays empty by design. To find what is still live, read the
headings: anything not starting with "Closed" is open.

A closed entry ends with **What is still owed here** rather than **Removal** —
"removal" names work that has to happen, and under a closed heading that reads
as an instruction to redo what is already done. If nothing is owed, the entry
ends on its last observation and carries neither label.
