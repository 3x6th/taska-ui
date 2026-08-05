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
- **User-visible effect:** a project appears to have exactly one member; the
  assignee filter and chips can only ever offer the current user.
- **Two further consequences** (found by `api-contract-guard`, 2026-08-03):
  `isMember: true` and `projectExists: true` are hardcoded, so a non-member or
  a deleted project reads as a healthy membership; and with the flag off, a
  real `MEMBER` or a co-`ADMIN` who did not create the project is silently
  demoted to `VIEWER`. The synthesis both over- and under-grants.
- **Removal:** [TAS-137](https://jira.ozero.dev/browse/TAS-137). When it
  ships, delete `HybridTaskaApi`, drop `VITE_TASKA_ASSUME_PROJECT_ADMIN`, and
  default `VITE_TASKA_API_MODE` to `rest`.
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

---

## Closed

*(none yet)*
