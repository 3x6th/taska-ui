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
| [TAS-140](https://jira.ozero.dev/browse/TAS-140) | Agent harness, skill pins, DESIGN.md reconciliation | To Do | merged (PR #7); review fixes in PR #8 |
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
| [TAS-171](https://jira.ozero.dev/browse/TAS-171) | Deterministic colour for avatars and project key badges | To Do | `feature/TAS-171` |

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
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) / [TAS-125](https://jira.ozero.dev/browse/TAS-125) | removing the N+1 board hydration | Board API (TAS-125 in review). Covers the list-DTO gap that was dropped from TAS-141 as a duplicate. |
| [TAS-145](https://jira.ozero.dev/browse/TAS-145) | [TAS-148](https://jira.ozero.dev/browse/TAS-148) | No `PATCH /projects/{id}` and no `description` column. Until it ships, editing a project is mock-only. |
| [TAS-146](https://jira.ozero.dev/browse/TAS-146) | [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Nothing sets `archived_at`, so archiving is mock-only and the read-only board state cannot be exercised against the gateway. |
| [TAS-156](https://jira.ozero.dev/browse/TAS-156) | [TAS-155](https://jira.ozero.dev/browse/TAS-155) / [TAS-161](https://jira.ozero.dev/browse/TAS-161) | The `/api/v1/readonly/*` endpoints are deployed and TAS-103 landed on 2026-08-11, but every table read answers 500 and the catalog states no `primaryKey`, so the admin console still ships mock-first — for those two reasons now, not for a missing gateway half. See `API-DIVERGENCE.md`. |
| [TAS-162](https://jira.ozero.dev/browse/TAS-162) | the board's core gesture | `GET /projects/{projectId}` 500s on every existing project. Via the membership synthesis this disables every drop target, so no card can be moved at all, and it zeroes every count on the projects screen. See `API-DIVERGENCE.md`. |

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
