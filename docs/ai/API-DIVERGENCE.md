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

### `sortableColumns` and `filterableColumns` are always empty

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** `MetaInfoDto` carries `columns`, `sortableColumns` and
  `filterableColumns`, and the console is meant to read the latter two rather
  than assume every column can be ordered or filtered.
- **Observed** (found by `api-contract-guard`, 2026-08-05, by reading the
  backend at `25d0cf7000e5`): `admin-service`'s `ListTableRowsMapper` builds
  `MetaInfo` with both lists left as literal `//TODO:` lines. It is the only
  code path that builds `MetaInfo`, and the pinned commit *is* `develop` HEAD,
  so no deployed build can populate them.
- **Compensation:** `AdminScreen` falls back to `meta.columns` when a list comes
  back empty. Without it, the filter form would never render and no column would
  ever be sortable against a real gateway — while both work fully against the
  mock, which advertises every column. The fallback is safe: the gateway does
  not validate `sort` against any catalog, and accepts a filter on any column it
  has. When it starts stating the lists, they win and the fallback stops
  applying on its own.
- **User-visible effect while open:** none, by design — that is the point of the
  fallback. Without it the console would silently lose two of its three
  controls in production only.
- **Removal:** the backend TODOs. Worth its own backend story;
  [TAS-103](https://jira.ozero.dev/browse/TAS-103) is the umbrella.

### The read-only rows endpoint 500s on a plain first-page read

- **Endpoints:** `GET /api/v1/readonly/metadata` and
  `GET /api/v1/readonly/{service}/{table}`.
- **Contract:** both arrived with backend `25d0cf7000e5`. `GLOBAL_ADMIN` only,
  and the first endpoints here to enumerate `401`, `403` and `404` separately
  instead of collapsing everything into `default`.
- **Observed 2026-08-06, signed in as a real `GLOBAL_ADMIN`** — the first time
  either endpoint has answered this frontend:
  - `GET /readonly/metadata` → **200**, and a much richer catalog than the mock
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
- **Verified since, and no longer open:** the filter spelling (`column`,
  `column.contains`, `column.from`, `column.to`) matches the gateway's own
  parser, and `style: form, explode: true` genuinely means top-level query keys,
  so flattening them is the contract's reading rather than a guess. A bare key
  is treated as `equals`. Note the gateway *silently skips* an unrecognised
  operator, so a misspelling would return unfiltered rows rather than an error —
  which is why the spelling is pinned in `RestTaskaApi.test.ts`.
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

### Nothing in the real catalog is marked sensitive, and the columns that hold secrets are not the ones the masking config names

- **Endpoint:** `GET /api/v1/readonly/metadata`
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
- **Removal:** [TAS-104](https://jira.ozero.dev/browse/TAS-104), which owns
  masking and is still To Do. This entry is the concrete column list it needs.
- **Order of operations matters:** TAS-104 should land *before or with*
  [TAS-156](https://jira.ozero.dev/browse/TAS-156). Fixing the 500 first opens
  the tables while nothing is flagged.

### `primaryKey` is null on every table

- **Endpoint:** `GET /api/v1/readonly/metadata`
- **Contract:** `TableMetadataDto.primaryKey` is a plain `string`.
- **Observed:** null on all 28 tables.
- **Compensation:** the console falls back to an `id` column and then to the row
  index for React keys, so it renders correctly either way. Harmless here; it
  would stop being harmless for anything that needs to address a row.
- **Removal:** the backend populating it, or the contract admitting it is
  optional.

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

### Client-side masking is cosmetic, and the allow-list is the real control

- **Good news, established from backend source** (2026-08-05): sensitive values
  are withheld *server-side*. `admin-service`'s `SensitiveColumnMaskService`
  replaces the value with `"***"` before it leaves the service, driven by the
  same `application.yml` config that sets `sensitive` in the catalog — so the
  flag and the masking cannot disagree, and the console's own masking is defence
  in depth rather than the only protection. The earlier open question here is
  answered favourably and closed.
- **The part that remains true anyway:** masking is a config allow-list,
  currently `users.password_hash`, `users.token_hash`, `users.secret_hash`,
  `users.refresh_token`, `users.access_token`. A secret column not on that list
  is neither flagged nor masked, and the UI cannot do better than the flag it is
  given. A `jsonb` column with a secret nested inside it is likewise beyond what
  a column-level flag can express, and the console prints such a cell whole.
- **And:** whatever the server does send is in the response body, the
  react-query cache and devtools regardless of what is drawn. The console
  drawing "hidden" is not a security boundary.
- **Removal:** [TAS-104](https://jira.ozero.dev/browse/TAS-104) is the backend
  half of masking.

### The range filters are timestamp-only, server-side

- **Endpoint:** `GET /api/v1/readonly/{service}/{table}`
- **Contract:** documents `.from` / `.to` as generic bounds, with the examples
  using timestamps but nothing restricting them.
- **Observed** (backend source): the gateway emits
  `"col" >= $n::timestamptz`, so a range filter on a text column, or a
  non-ISO value, is a Postgres cast failure — a 5xx, never a 400 the UI could
  explain.
- **Compensation:** the console offers `from`/`to` only when the catalog states
  a date- or time-like `type` for the selected column, and resets the operator
  when the column changes to one that cannot take it.
- **Removal:** the contract naming the constraint, or the gateway answering 400.

---

## Closed

*(none yet)*
