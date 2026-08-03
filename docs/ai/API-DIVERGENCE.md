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
- **User-visible effect:** opening the slide-over for a commented issue fails
  against live data.
- **Removal:** [TAS-139](https://jira.ozero.dev/browse/TAS-139).
- **Note:** recorded here because it blocks end-to-end verification of
  `TAS-136`, not because the UI compensates for it. A backend bug that stops a
  frontend story being verified belongs in this record even when there is
  nothing to remove later.

---

## Closed

*(none yet)*
