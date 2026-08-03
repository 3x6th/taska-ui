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
  [TAS-125](https://jira.ozero.dev/browse/TAS-125) (Board API), or `status` +
  `createdAt` added to the short DTO ([TAS-141](https://jira.ozero.dev/browse/TAS-141)).

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

---

## Closed

*(none yet)*
