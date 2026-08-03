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
| [TAS-136](https://jira.ozero.dev/browse/TAS-136) | Connect the frontend to gateway issue endpoints | To Do | committed on `feature/TAS-136`, unmerged |
| [TAS-140](https://jira.ozero.dev/browse/TAS-140) | Agent harness, skill pins, DESIGN.md reconciliation | To Do | in progress |

Two rows disagree with themselves. `TAS-134` and `TAS-136` are `To Do` in Jira
while their code exists — see the record in `HARNESS.md`. Trust the repository
column for what is built and Jira for what was agreed; when they disagree,
the story has drifted and should be transitioned rather than the table edited.

## Blocking dependencies outside this repository

| Key | Blocks | Effect on the UI |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) | full `rest` mode | No project membership or member reads. `hybrid` mode plus `VITE_TASKA_ASSUME_PROJECT_ADMIN` compensates. See `API-DIVERGENCE.md`. |
| [TAS-139](https://jira.ozero.dev/browse/TAS-139) | verifying `TAS-136` | `GET /api/v1/issues/{issueId}` returns 500 once an issue has a comment, so the slide-over cannot be verified against live data end to end. |

## Branch and commit policy

- One branch per story: `feature/TAS-<n>`.
- Every commit subject starts with one Jira key: `TAS-140: add lint and test
  verification`.
- Commits may be smaller than stories. One PR aggregates a story's commits.
- `feature/TAS-140` is branched from `feature/TAS-136` rather than `main`,
  because the DESIGN.md reconciliation documents the comments UI that only
  exists on that branch. It merges after TAS-136.

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
