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

## Open — runtime differs from the contract

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
- **What is not yet observed:** a **non-member** reading a project. Every id
  above was read by the user who created it, so the new membership check passed
  trivially and its refusal has never been seen. The refusal shape is the open
  question the entry below (`GET /projects/{id}` never says what "not yours"
  looks like) already tracks, and TAS-154 makes it reachable for the first time
  — a second, non-admin token is all it needs.
- **Removal:** this entry stays until
  [TAS-137](https://jira.ozero.dev/browse/TAS-137) removes the coupling that
  turned this endpoint into a permissions outage, and until the non-member case
  above is observed. [TAS-162](https://jira.ozero.dev/browse/TAS-162) is
  answered.

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
  have the contract state the enum.

### `GET /issues/{issueId}` 500s once an issue has a comment

- **Endpoint:** `GET /api/v1/issues/{issueId}`
- **Contract:** returns the issue with its history (`IssueWithHistoryResponseDto`).
- **Observed:** 500 `"Unknown event type: ISSUE_EVENT_TYPE_COMMENT_CREATED"` —
  the gateway's `IssueMapper.toRestIssueEventType` does not map the comment
  event types that `TAS-109` introduced.
- **Compensation:** none. The frontend does not work around this.
- **User-visible effect:** because of the N+1 hydration below, one commented
  issue anywhere in a project makes the whole board fail to load, and the
  projects screen loses every card's issue count and member row with it.
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
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141). Until then
  the catch should at least be narrowed to the specific error `code`.

### `globalRole` is in the contract but has not been seen on the wire

- **Endpoint:** `GET /api/v1/users/me`
- **Contract:** since backend `25d0cf7000e5` (TAS-147), the response carries
  `globalRole` as `enum [GLOBAL_ADMIN, USER, UNSPECIFIED]`. The DTO has no
  `required` block, so the field is formally optional.
- **Observed:** nothing. No request in this repository has been made against a
  gateway known to be at or past that commit — every assertion about the field
  is against the mock or a stubbed `fetch`.
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
- **Removal:** deploy a gateway at or past `25d0cf7000e5`, then confirm the
  field on a live response. [TAS-147](https://jira.ozero.dev/browse/TAS-147) is
  Done at contract level; this entry closes when the runtime is observed, not
  when the story closed.

---

## Open — the contract is silent or lacks what the UI needs

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
- **Two further consequences** (found by `api-contract-guard`, 2026-08-03):
  `isMember: true` and `projectExists: true` are hardcoded, so a non-member or
  a deleted project reads as a healthy membership; and with the flag off, a
  real `MEMBER` or a co-`ADMIN` who did not create the project is silently
  demoted to `VIEWER`. The synthesis both over- and under-grants.
- **Removal:** [TAS-137](https://jira.ozero.dev/browse/TAS-137). When it
  ships, delete `HybridTaskaApi`, drop `VITE_TASKA_ASSUME_PROJECT_ADMIN`, and
  default `VITE_TASKA_API_MODE` to `rest`. The flag lives in five places, and
  deleting only the first is what makes a removal look finished when it is
  not: `src/api/client.ts`, `.github/workflows/deploy-pages.yml`,
  `.env.example`, `README.md`, and the GitHub repository variable itself
  (`gh variable list`).
- **Risk while open:** with the flag on, every caller gets an `ADMIN` view of
  the UI; role gating is unverifiable in this mode and a passing permission
  check proves nothing.

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
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) — either return
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

### The issue list DTO cannot render a board

- **Endpoint:** `GET /api/v1/projects/{projectId}/issues`
- **Contract:** `IssueShortResponseDto` carries only `id`, `issueKey`,
  `summary`, `issueType`, `priority`, `assigneeId` — no `status`, no dates, no
  description. A kanban board cannot place a card in a column without
  `status`.
- **Compensation:** `RestTaskaApi.listIssues` follows the list call with
  `GET /issues/{issueId}` per item at concurrency 6; the first rejection fails
  the whole page. 4 projects × 100 issues is 400+ requests on the projects
  screen, and this is the multiplier that turns TAS-139 into a board-wide
  failure.
- **Removal:** [TAS-124](https://jira.ozero.dev/browse/TAS-124) /
  [TAS-125](https://jira.ozero.dev/browse/TAS-125) (Board API — already in
  review on the backend). Dropped from TAS-141 as a duplicate at the
  2026-08-04 dedup pass.

### No `read-all` for notifications

- **Missing:** `PATCH /api/v1/notifications/read-all` (the contract has only
  per-notification `…/{notificationId}/read`).
- **Compensation:** `RestTaskaApi.markAllNotificationsRead` loops pages of
  unread notifications and marks them one by one. The loop is unbounded: it
  terminates only if the gateway honours `unreadOnly` and durably flips
  `readAt` — if either breaks with ≥100 unread, the tab hangs in a request
  storm. Its `updatedCount` counts attempts, not confirmed changes.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141). Until then
  the loop should be capped.

### An assignee cannot be cleared — by contract

- **Endpoint:** `PUT /api/v1/issues/{issueId}/assignee`
- **Contract:** `AssignIssueRequestDto.assigneeId` is a required,
  non-nullable string. Unassignment does not exist in the API.
- **Compensation:** `RestTaskaApi.assignIssue(null)` throws a client-fabricated
  `UNSUPPORTED_OPERATION` error, and the board renders the "None" chip
  permanently `disabled` — an issue assigned by mistake can never be
  unassigned. The mock unassigns happily, so the modes visibly disagree.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) (nullable
  `assigneeId` or an explicit unassign route).

### Comment ordering is unspecified

- **Endpoint:** `GET /projects/{id}/issues/{id}/comments`
- **Contract:** defines pagination (`pageSize` ≤ 50) and a required
  `totalCount`, but says nothing about sort order.
- **Compensation:** the UI and the mock assume newest-first; `RestTaskaApi`
  passes the gateway's order through unsorted. If the gateway emits
  oldest-first, the thread renders inverted between modes with nothing
  failing. Unverifiable end-to-end while TAS-139 is open.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) specifies the
  order in the contract; `RestTaskaApi` should sort explicitly meanwhile.

### `requestId` lives only in a response header

- **Contract:** `RestErrorResponse` is `{code, message}`; the request id is
  the `X-Request-Id` **header** on every response.
- **Observed/unverified:** cross-origin the header is readable only if the
  gateway sends `Access-Control-Expose-Headers: X-Request-Id` — not confirmed.
  No UI surface displays it either way (`DESIGN.md` §5.6 records the missing
  toast), so no support conversation can be correlated to a gateway log line.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) for the CORS
  expose header; the toast is the UI half.

### The create-project form shows a field the contract does not have

- **Endpoint:** `POST /api/v1/projects`
- **Contract:** `CreateProjectRequestDto` is `{projectKey, name}` — there is
  no `description`.
- **Compensation:** the UI renders a Description textarea; `RestTaskaApi`
  correctly does not send it. The field works in mock and is a silent no-op
  against the gateway.
- **Removal:** frontend follow-up — remove the textarea, or keep it only if
  [TAS-141](https://jira.ozero.dev/browse/TAS-141) adds the field to the
  contract.

### `GET /projects/{id}` never says what "not yours" looks like

- **Endpoint:** `GET /api/v1/projects/{projectId}`
- **Contract:** declares only `200` and a `default` error whose `code` is a
  free-form string — no enum, no 403/404 semantics. So nothing states what a
  non-member or a deleted project actually gets back.
- **Compensation:** `isMissingOrForbidden` (`src/api/errors.ts`) treats
  `NOT_FOUND` / `PERMISSION_DENIED` / 404 / 403 as one answer and
  `BoardScreen` renders the Not found screen (`DESIGN.md` §4.18).
- **Unverified:** only the "missing" half is exercised, and only against the
  mock. The "no access" half was never observed on the running gateway: the
  default `hybrid` mode hardcodes a healthy membership (see the
  `VITE_TASKA_ASSUME_PROJECT_ADMIN` entry above), and project-service has no
  membership concept until TAS-137. If it answers `200` for someone else's
  project, the screen never appears and no current test notices.
- **Since TAS-150, 401 is no longer just another error.** The client now treats
  **every** 401 on a bearer route as a dead session: the tokens are cleared, the
  query cache is dropped, and the user is returned to `/login`.
  `isMissingOrForbidden` (`src/api/errors.ts`) still covers 403/404 only, so the
  two answers do not overlap — but the contract's `code` is a free-form string
  with nothing else to key on, so if the gateway ever answers 401 for "not
  yours" rather than "not authenticated", a member browsing somebody else's
  project would be signed out instead of shown the Not-found screen. This must
  be re-checked when `rest` becomes the default mode, including the two
  endpoints that have no contract at all —
  `GET /projects/{id}/membership` and `GET /projects/{id}/members` (see the
  first entry in this section) — whose 401 would now sign the user out.
- **Removal:** [TAS-137](https://jira.ozero.dev/browse/TAS-137) makes the
  no-access case reachable; [TAS-141](https://jira.ozero.dev/browse/TAS-141)
  is where the contract should name the error codes.

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
- **Still unverified**, because no table has yet returned rows: how a timestamp
  is spelled in JSON (the backend encodes dates as epoch **seconds**, losing
  sub-second precision, and whether Jackson emits ISO or a bare number is
  unconfirmed); whether `meta.service` / `meta.table` echo the catalog's own
  spelling — see the fail-closed entry below. Every one of those needs a table
  that actually returns rows, so they stay open until the 500 is fixed.
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
- **Why this is worth writing down rather than absorbing:** the compensation
  depends on `"***"` being exactly three asterisks and on `MASK_PARTIAL` always
  producing at least one — both true in `SensitiveColumnMaskService` today, and
  both invisible to anyone reading the contract. If the backend changes the
  masking literal, nothing type-checks and no test fails; the console simply
  starts printing `***` as though it were data.
- **Removal:** the contract stating the masking treatment per column — either as
  an enum beside `sensitive` in `ColumnMetadataDto`, or as prose naming the
  literal and the missing-key case. An enum would let the console stop guessing
  from values altogether.

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
- **Removal:** an observed `200` from both endpoints showing the names agree.

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

## Closed

*(none yet)*
