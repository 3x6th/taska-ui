# Gateway divergence record

`design_handoff_taska/api-gateway-rest-draft.md` states what the API Gateway is
*meant* to do. `api.taska.ozero.dev` states what it *does*. This file records
every place the frontend compensates for the difference.

An undocumented workaround is a blocking finding for `api-contract-guard`. The
point of the file is that compensations stay visible and removable instead of
dissolving into component code where nobody can find them again.

## Format

Each entry names the endpoint, the observed behaviour, what the UI does
instead, how the compensation is switched off, and the Jira key that removes
it. Entries are deleted only when the compensating code is deleted.

---

## Open

### Project membership and member reads are not implemented

- **Endpoints:** `GET /api/v1/projects/{projectId}/membership`,
  `GET /api/v1/projects/{projectId}/members`
- **Draft:** both are specified — membership returns the caller's
  `ProjectRole`, `isMember`, and `projectExists`; members returns the project's
  member list with roles.
- **Observed:** neither is available on the deployed gateway.
- **Compensation:** `HybridTaskaApi` (`src/api/HybridTaskaApi.ts`) synthesises
  both from `GET /projects/{id}` and `GET /users/me`. `getMembership` returns
  `ADMIN` when `VITE_TASKA_ASSUME_PROJECT_ADMIN=true` or the caller created the
  project, and `VIEWER` otherwise. `listMembers` returns a single-element list
  containing only the current user.
- **User-visible effect:** a project appears to have exactly one member. The
  board's assignee filter and the issue panel's assignee chips can therefore
  only ever offer the current user, regardless of who is really on the project.
  This is the most misleading consequence and is not obvious from the UI.
- **Two further consequences** (found by `api-contract-guard`, 2026-08-03):
  `isMember: true` and `projectExists: true` are hardcoded, so a non-member or
  a deleted project reads as a healthy membership; and with the flag off, a
  real `MEMBER` or a co-`ADMIN` who did not create the project is silently
  demoted to `VIEWER`. The synthesis both over- and under-grants.
- **Removal:** [TAS-137](https://jira.ozero.dev/browse/TAS-137). When it ships,
  delete `HybridTaskaApi`, drop `VITE_TASKA_ASSUME_PROJECT_ADMIN` from
  `.env.example`, `README.md`, and `.github/workflows/deploy-pages.yml`, and
  default `VITE_TASKA_API_MODE` to `rest`.
- **Risk while open:** `VITE_TASKA_ASSUME_PROJECT_ADMIN=true` grants every
  caller an `ADMIN` view of the UI. Authorization still lives on the server, so
  this exposes controls rather than capabilities — but it means the UI's role
  gating is currently unverifiable, and no reviewer should read a passing
  permission check in this mode as evidence that gating works.

### `GET /issues/{issueId}` fails once an issue has a comment

- **Endpoint:** `GET /api/v1/issues/{issueId}`
- **Draft:** returns the issue with its history.
- **Observed:** returns 500 after a comment has been added to the issue.
- **Compensation:** none. The frontend does not work around this.
- **User-visible effect:** materially worse than "the slide-over fails".
  Because of the N+1 hydration below, one commented issue anywhere in a
  project makes the whole board fail to load, and the projects screen loses
  every card's issue count and member row with it.
- **Removal:** [TAS-139](https://jira.ozero.dev/browse/TAS-139).
- **Note:** recorded here because it blocks end-to-end verification of
  `TAS-136`, not because the UI compensates for it. A backend bug that stops a
  frontend story being verified belongs in this record even when there is
  nothing to remove later.

### The issue list is hydrated N+1 through the detail endpoint

- **Endpoint:** `GET /api/v1/projects/{projectId}/issues`
- **Draft:** the list response carries full issues, including `status`.
- **Observed:** the deployed list DTO omits `status`, which the board cannot
  render without.
- **Compensation:** `RestTaskaApi.listIssues` follows the list call with
  `GET /issues/{issueId}` per item at concurrency 6; the first rejection fails
  the whole page. 4 projects × 100 issues is 400+ requests on the projects
  screen, and this is the multiplier that turns TAS-139 into a board-wide
  failure.
- **Removal:** [TAS-125](https://jira.ozero.dev/browse/TAS-125) (Board API) or
  a list DTO carrying `status`.

### The issue endpoint family diverges in path, verb and semantics

- **Endpoints:** everything under `/projects/{projectId}/issues/{issueId}`
- **Draft:** project-scoped paths, `PATCH` for partial update,
  `POST …/transitions` with a body.
- **Observed:** routes are mounted at `/api/v1/issues/{issueId}` (`projectId`
  is accepted by the interface and discarded); there is no `PATCH`, so update
  is a client-side GET + `PUT` of all fields; transitions are
  `PUT /issues/{id}/transition/{transitionId}`.
- **Compensation:** `RestTaskaApi` rewrites paths and emulates `PATCH` by
  read-modify-write. Consequences: a concurrent edit inside the GET→PUT window
  is silently overwritten (no `If-Match`/`version` precondition), inline
  editing of a commented issue inherits the TAS-139 500 at the read step, and
  the returned `updatedAt`/`version` are not the server's.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141).

### `GET /projects` reports an empty collection as 404

- **Endpoint:** `GET /api/v1/projects`
- **Draft:** `200` with an empty array.
- **Observed:** project-service surfaces "no projects" as `NOT_FOUND`.
- **Compensation:** `RestTaskaApi.listProjects` maps **any** 404 to `[]`, so a
  misrouted base URL or a renamed path after a gateway deploy renders as "you
  have no projects" with no error anywhere.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141). Until then
  the catch should at least be narrowed to the specific error `code`.

### The error body is flat, and `requestId` does not survive

- **Endpoints:** all
- **Draft:** errors are `{error: {code, message, requestId}}`.
- **Observed:** the gateway sends a flat `{code, message, requestId}`.
- **Compensation:** `RestTaskaApi` parses the flat shape for `code`/`message`,
  but reads `requestId` only from the `X-Request-Id` header (not exposed
  cross-origin without `Access-Control-Expose-Headers`, unverified) or from
  the *nested* body shape — so in practice `requestId` is `undefined`, and no
  display site renders it anyway (`DESIGN.md` §5.6 records the missing toast).
  No support conversation can be correlated to a gateway log line.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) fixes the
  contract side; reading flat `requestId` + logging it to the console is a
  four-line frontend follow-up that need not wait.

### An assignee cannot be cleared

- **Endpoint:** `PUT /api/v1/projects/{projectId}/issues/{issueId}/assignee`
- **Draft:** `assigneeId: null` unassigns.
- **Observed:** the gateway does not support clearing.
- **Compensation:** `RestTaskaApi.assignIssue(null)` throws a client-fabricated
  `UNSUPPORTED_OPERATION` error, and the board renders the "None" chip
  permanently `disabled` — the capability gap is hidden rather than explained.
  An issue assigned by mistake can never be unassigned. Mock unassigns
  happily, so the modes visibly disagree.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141).

### Comments are implemented ahead of any contract

- **Endpoints:** `GET/POST /projects/{id}/issues/{id}/comments`,
  `PATCH/DELETE …/comments/{commentId}`
- **Draft:** silent — the word "comment" does not occur in it.
- **Observed/assumed by the UI:** newest-first ordering, a `pageSize` cap of
  50, a `totalCount` field driving "Load more" (if the gateway omits it, the
  thread silently truncates), author-only edit/delete, and
  `PATCH /notifications/read-all` emulated as a client-side loop over
  `markNotificationRead` (unbounded if `unreadOnly` filtering ever breaks).
- **Compensation:** the mock encodes these assumptions as reference behaviour;
  none of them can be verified end-to-end while TAS-139 is open.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141) folds the
  endpoints into the draft.

### `POST /projects` drops the description

- **Endpoint:** `POST /api/v1/projects`
- **Draft/UI:** the create form has a Description field and sends it.
- **Observed:** the gateway model has no such field; `RestTaskaApi` does not
  send it. The field works in mock and is a silent no-op against the gateway.
- **Removal:** [TAS-141](https://jira.ozero.dev/browse/TAS-141), or remove the
  textarea until the contract has the field.

---

## Closed

*(none yet)*
