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
| [TAS-148](https://jira.ozero.dev/browse/TAS-148) | Edit a project (name, description, colour), key read-only | Done | merged (PR #66). **Was `Done` in Jira with nothing built** — no `updateProject` in any of the three implementations and no dialog, checked 2026-09-12 — so it was moved back to `In Progress` with the reason on the ticket, which is what this file says to do when a row disagrees with itself. Built against backend PR #155, pinned as `docs/contract/pending/pr-155-TAS-145.yml`; `PATCH` answers 405 until that merges, so the feature runs on the mock and the projects-screen entry point waits on PR #152 as well |
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
| [TAS-189](https://jira.ozero.dev/browse/TAS-189) | Issue planning fields — story points, start and due dates, both estimates (backend PR #148) | Done | merged (PR #45 API layer, PR #64 UI half). Backend PR #148 merged 2026-09-11 with its `openapi.yml` half restored; snapshot refreshed to `21a0d9d177a1` in PR #64 |
| [TAS-190](https://jira.ozero.dev/browse/TAS-190) | Issue attachments over presigned S3 links (backend PR #147) | Done | merged (PR #48) |
| [TAS-192](https://jira.ozero.dev/browse/TAS-192) | `.form-error` measures 3.17:1 in ten places; make the TAS-190 notice the product's error box | To Do | not started |
| [TAS-191](https://jira.ozero.dev/browse/TAS-191) | The gateway's board endpoint in the API layer, without moving the board screen onto it (backend PR #118) | Done | merged (PRs #47, #58) |
| [TAS-201](https://jira.ozero.dev/browse/TAS-201) | ~~`BoardIssueDto` drops `issueType`, `priority` and `statusKey` that `IssueBoardResponse` already carries~~ | Done | **closed 2026-09-11 as a duplicate of TAS-213** (epic TAS-210); nothing was built under this key, every ask moved |
| [TAS-202](https://jira.ozero.dev/browse/TAS-202) | The frontend half of epic TAS-210: move the screens onto the aggregate reads; until they land, `refetchOnWindowFocus` off, honest board paging, a capped read-all loop | To Do | rewritten 2026-09-11 as TAS-210's frontend counterpart; the interim half needs no backend and can start now |
| [TAS-203](https://jira.ozero.dev/browse/TAS-203) | ~~The project list carries no counts, so nine cards cost nine reads~~ | Done | **closed 2026-09-11 as a duplicate of TAS-211** (epic TAS-210) |
| [TAS-204](https://jira.ozero.dev/browse/TAS-204) | Nobody can be invited and nobody can be found by email: `POST /auth/invitations`, `GET /users?query=`, tokens on `accept` | To Do | backend ask, MVP; rewritten 2026-09-11, linked to epic TAS-210 |
| [TAS-205](https://jira.ozero.dev/browse/TAS-205) | ~~Reads do not answer a screen's question: `issueType` required, no transitions on the board, no issue lookup by key~~ | Done | **closed 2026-09-11 as a duplicate of TAS-213 and TAS-214** (epic TAS-210) |
| [TAS-206](https://jira.ozero.dev/browse/TAS-206) | `openapi.yml` hygiene: `$ref` on the enums, one document instead of two (`/v3/api-docs` disagrees), declared collection order, `minLength: 3` and no `default` on the search query | To Do | backend ask; rewritten 2026-09-11 — `PATCH`, `version` and the nullable assignee moved to TAS-215, the search decision came in from TAS-180 |
| [TAS-207](https://jira.ozero.dev/browse/TAS-207) | Two project reads lie: `workflow` enforces no membership, an empty project list is a `404` | To Do | backend ask, MVP, linked to epic TAS-210. The empty-list clause traces to TAS-141 and went into its closure unfixed; the workflow-membership clause was **never filed, deliberately** — see `API-DIVERGENCE.md`, "the workflow read is not membership-checked" — and is filed for the first time here. `WorkflowController` on the gateway calls no role checker at all (read 2026-09-11) |
| [TAS-208](https://jira.ozero.dev/browse/TAS-208) | The invitation path is broken three ways, and one of them reports activating somebody else's account as success | To Do | MVP, not started; absorbs TAS-153, closed 2026-09-11 as its duplicate |
| [TAS-209](https://jira.ozero.dev/browse/TAS-209) | Drop hybrid and default to `rest` — the act that closes the MVP | To Do | MVP, strictly last: after TAS-137, TAS-204, TAS-158, epic TAS-210 and TAS-202 |
| [TAS-210](https://jira.ozero.dev/browse/TAS-210) | **Epic** — API for the screens: one request for the projects screen, the board and the issue panel instead of 30, 9 and 6 | To Do | filed 2026-09-10 as one task, made an epic 2026-09-11 at the owner's asking; priority `Highest` set by the owner. Children TAS-211…218; TAS-202, TAS-137, TAS-204, TAS-184 and TAS-207 linked into it. Harness documents synced to the epic in PR #63 |
| [TAS-211](https://jira.ozero.dev/browse/TAS-211) | `GET /projects` carries `issueCount`, `openIssueCount`, `memberCount`, the first five `members` with names, `myRole`, `description`, `color`; an empty list is `200` | To Do | backend ask, epic TAS-210. Open design point recorded in the ticket's reasoning: project-service knows no issues, so the count is either a new issue-service rpc aggregated by the gateway or a denormalised counter |
| [TAS-212](https://jira.ozero.dev/browse/TAS-212) | `GET /projects/{id}` as the project context: full `members` with names, `labels`, every `workflow` with its transitions, `403` for a non-member | To Do | backend ask, epic TAS-210; stands on TAS-137's `GetProjectMembers` and `GetUserDetailsByIds` (PR #152) |
| [TAS-213](https://jira.ozero.dev/browse/TAS-213) | `GET /projects/{id}/board` as one read: `issueType` optional, the card's fields on `BoardIssueDto`, labels as objects, no `500` on a status outside the workflow | To Do | backend ask, epic TAS-210. Read against `develop` 2026-09-11: `issue_type`, `status_key`, `priority`, `watchers_count`, `comments_count` are already on `IssueBoardResponse` and dropped by `IssueMapper.toRestBoardIssue`; `description`, `created_at`, `updated_at`, `version`, `due_date`, `story_points` need proto fields; `displayName` waits on TAS-137 |
| [TAS-214](https://jira.ozero.dev/browse/TAS-214) | `GET /issues/{id}` as one read: `assignee` and `reporter` as objects, `watchers`, `links` with a resolved target, `attachments`, `commentCount`; lookup by key | To Do | backend ask, epic TAS-210 |
| [TAS-215](https://jira.ozero.dev/browse/TAS-215) | `PATCH /issues/{id}` with an expected `version`: partial update, explicit `null` clears, `409` on a stale version | To Do | backend ask, epic TAS-210. On `develop` the `version` column, the `+1` in `updateIssue` and the `FOR UPDATE` read exist; only the comparison is missing, and `IssueCommentRepository.updateWithVersionCheckAndAuthor` is the in-service precedent. Three proto fields lack `optional`, so partial update needs a proto change too |
| [TAS-216](https://jira.ozero.dev/browse/TAS-216) | `POST /notifications/read-all` and an `unreadCount` | To Do | backend ask, epic TAS-210; re-filed from TAS-141's read-all clause |
| [TAS-217](https://jira.ozero.dev/browse/TAS-217) | `GET /meta`: the enum dictionaries with an `ETag` | To Do | backend ask, epic TAS-210; TAS-173 is the frontend defence that must land with or before it |
| [TAS-218](https://jira.ozero.dev/browse/TAS-218) | Search hits carry `projectId`, `projectKey`, `statusKey`; an unknown filter value answers an empty list, not the full set | To Do | backend ask, epic TAS-210; carries the TAS-180 decision of 2026-09-11 |
| [TAS-196](https://jira.ozero.dev/browse/TAS-196) | The three admin writes are deployed; retire the undeployed-route compensation and refresh the contract snapshot | Done | merged (PR #50) |
| [TAS-193](https://jira.ozero.dev/browse/TAS-193) | Issue watchers — the toggle, the count, the list **and** the two project-`ADMIN` routes the story had deferred | Done | merged (PR #56) |
| [TAS-194](https://jira.ozero.dev/browse/TAS-194) | Retry an outbox event from Events, and retire the TAS-105 summary compensation with it | Done | merged (PR #54) |
| [TAS-200](https://jira.ozero.dev/browse/TAS-200) | The summary calls an event stuck five minutes before retry will accept it | To Do | backend ask, filed from TAS-194 |
| [TAS-195](https://jira.ozero.dev/browse/TAS-195) | Drop the N+1 hydration in `listIssues` — the gateway's list DTO is whole issues now | Done | merged (PR #52) |
| [TAS-173](https://jira.ozero.dev/browse/TAS-173) | An unknown enum value from the backend must not blank the screen | To Do | **was `Done` without being built** — reopened 2026-09-08, see below |
| [TAS-197](https://jira.ozero.dev/browse/TAS-197) | `GET /users/me` answers `UNSPECIFIED` for a locked account | To Do | backend ask, filed from TAS-196 |
| [TAS-198](https://jira.ozero.dev/browse/TAS-198) | A locked account keeps access on a pre-lock token, and `refresh` renews it | To Do | backend ask, filed from TAS-196 |
| [TAS-219](https://jira.ozero.dev/browse/TAS-219) | The member read and `currentUserRole` from the gateway — the frontend half of TAS-137 (backend PR #152) | Done | merged (PR #65). Written against `docs/contract/pending/pr-152-TAS-137.yml` while PR #152 is open, so nothing in it reaches the stand until that merges. `api-contract-guard` found one blocker — the claim that `GET /projects` does not carry the role — and it is corrected in `API-DIVERGENCE.md` rather than quietly fixed |

Two rows disagree with themselves. `TAS-134` and `TAS-136` are `To Do` in Jira
while their code exists — see the record in `HARNESS.md`. Trust the repository
column for what is built and Jira for what was agreed; when they disagree,
the story has drifted and should be transitioned rather than the table edited.

## Blocking dependencies outside this repository

| Key | Blocks | Effect on the UI |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) | full `rest` mode | No project membership or member reads. `hybrid` mode plus `VITE_TASKA_ASSUME_PROJECT_ADMIN` compensates. **Re-probed 2026-09-10 with a second account and still true**: `GET /projects/{id}/members` answers `405` (only `POST` is mapped) and `GET /projects/{id}/membership` answers Spring's static-resource `404`, on the reader's own project as well as on a foreign one. See `API-DIVERGENCE.md`. PR #152 open as of 2026-09-11: it adds `GetProjectMembers` to project-service and `GetUserDetailsByIds` to auth-service, which is the first read of users by id anywhere in the system — TAS-212, TAS-213 and TAS-214 all stand on it. |
| [TAS-139](https://jira.ozero.dev/browse/TAS-139) | nothing any more — measured fixed | Was: `GET /api/v1/issues/{issueId}` returns 500 once an issue has a comment; via the list hydration this made the whole board fail against live data. Probed 2026-09-08: three issues carrying 1, 1 and 4 comments each answered `200` with history, one of them carrying a label as well. The multiplier is gone too — TAS-195 removed the hydration. Backend story; its status is the backend owner's to move. |
| [TAS-141](https://jira.ozero.dev/browse/TAS-141) | several UI affordances | Contract gaps: read-all, nullable assignee, comment ordering, CORS-exposed `X-Request-Id`, 404-on-empty-projects bug. **Closed 2026-09-04 in Jira with these gaps still open.** The empty-projects clause is re-filed as TAS-207; the CORS half is measured done (`API-DIVERGENCE.md`); the rest are unowned and need re-filing before anyone quotes this row as live work. **Re-filed 2026-09-11, so this row stops being the owner of anything:** read-all is TAS-216, the nullable assignee is TAS-215, comment ordering is TAS-206, the empty list is TAS-207 and TAS-211. The `accept`-without-a-session clause is TAS-204 with TAS-208 as its frontend half. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) | nothing any more — measured live | Was: the route's gRPC method was declared and unimplemented, so a deployed gateway would answer `501 UNIMPLEMENTED`, and PR #118 was CHANGES_REQUESTED besides. Both landed — PR #142 on 2026-09-07, PR #118 on 2026-09-09. Probed 2026-09-09 with a signed-in token: `GET /projects/{id}/board?issueType=TASK` answers `200` with columns in workflow order, `includeDone` filters issues and not columns, `assigneeId` and `labelId` filter server-side, and `EPIC` is a correct `400`. `TaskaApi.getBoard` exists in all three implementations (TAS-191); the board screen still composes its own board, for the two reasons that outlived the merge. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) / [TAS-125](https://jira.ozero.dev/browse/TAS-125) | ~~removing the N+1 board hydration~~ — **nothing any more** | **Withdrawn (TAS-191).** The board API does not cover the list-DTO gap: `BoardIssueDto` has no description and no `createdAt` either, and gives status only as a column position, so the detail read stays. What may remove it is `ListIssuesResponseDto.items` becoming `IssueResponseDto`, which it already has on `develop` — that wanted one measurement against the deployed gateway rather than a contract reading — **taken 2026-09-08, and the hydration was removed by [TAS-195](https://jira.ozero.dev/browse/TAS-195)**. |
| [TAS-145](https://jira.ozero.dev/browse/TAS-145) | [TAS-148](https://jira.ozero.dev/browse/TAS-148) | No `PATCH /projects/{id}`, no `description` column and no `color` column. Until it ships, editing a project is mock-only. Widened 2026-08-21 to carry a nullable `color`, which is what makes the project half of TAS-171's compensation removable; the avatar half has no such story and is not meant to. |
| [TAS-129](https://jira.ozero.dev/browse/TAS-129) | nothing here, listed so the citation is checkable | Avatar upload through the gateway (presigned URL to MinIO), on top of TAS-128 which is Done. Referenced by `API-DIVERGENCE.md`'s colour entry only to say what the computed avatar colour is a fallback *under* — it does not gate TAS-171 or anything else in this repository. |
| [TAS-146](https://jira.ozero.dev/browse/TAS-146) | [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Nothing sets `archived_at`, so archiving is mock-only and the read-only board state cannot be exercised against the gateway. |
| [TAS-156](https://jira.ozero.dev/browse/TAS-156) | nothing any more — measured fixed | Was: every table read 500s and the catalog states no `primaryKey`. Measured on the stand 2026-08-25 (TAS-167 pre-flight): rows answer 200 (`issue.outbox_events`, `project.projects`), `primaryKey` is stated, rows are addressable. No longer blocks TAS-155/TAS-161/TAS-167; row kept until the story is closed in Jira. |
| [TAS-162](https://jira.ozero.dev/browse/TAS-162) | nothing any more — measured fixed | Was: `GET /projects/{projectId}` 500s on every existing project, which via the membership synthesis disabled every drop target and zeroed every count on the projects screen. Probed 2026-09-08: `200` on five projects in a row, body carrying `archivedAt, createdAt, createdBy, id, name, projectKey, updatedAt`. Backend story; its status is the backend owner's to move. |
| [TAS-172](https://jira.ozero.dev/browse/TAS-172) | nothing any more — measured fixed | Was: `GET /issues/{issueId}` answers `500` for any issue a label has ever touched, so attaching a label on the stand permanently broke that issue. Probed 2026-09-08 on the id the divergence entry names as its live reproduction — `kappa-test-1`, `09bf59ad-…` — which answers `200` with `LABEL_ADDED` and `LABEL_REMOVED` in its history, so the events are mapped rather than dropped. The "do not attach labels on the stand" hazard is retired. Backend story; its status is the backend owner's to move. |
| [TAS-178](https://jira.ozero.dev/browse/TAS-178) | nothing any more — measured fixed | Was: `GET /issues/{issueId}` answers `labels: []` for an issue that has labels, so no card drew a chip against the gateway. Probed 2026-09-08 on three projects: the detail `labels` matches the list on every row compared. The list route carries labels too, which is what TAS-195 stands on. Backend story; its status is the backend owner's to move. |
| [TAS-107](https://jira.ozero.dev/browse/TAS-107) / [TAS-108](https://jira.ozero.dev/browse/TAS-108) | nothing any more — measured deployed | Was: the three admin writes existed only on an open backend PR and answered Spring's static-resource 404, which the confirmation dialog read as "not deployed yet". Backend PR #146 merged 2026-09-07. Probed 2026-09-08 with an invalid uuid so nothing could be mutated: `block`, `unblock` and `reset-lockout` all answer `400 INVALID_ARGUMENT`, and a control path on the same prefix still answers the static-resource 404, so the 400 is the mapping rather than a uuid filter. The compensation came out in [TAS-196](https://jira.ozero.dev/browse/TAS-196); the divergence entry is closed in place in `API-DIVERGENCE.md`. Row kept until the two Jira stories are closed. |
| [TAS-180](https://jira.ozero.dev/browse/TAS-180) | removing the search compensation, not the search | `GET /issues/search` rejects a two-character query the contract permits, `400`s on the empty `query` its own generated spec offers as the default, and silently ignores a `priority` or `issueType` it does not recognise — answering with the full set instead of an error. The UI compensates on all three, so search ships; the constant and the enum guard come out when this closes. Probed 2026-08-23 and **re-probed 2026-09-08 — all three still reproduce**: `?query=ap` → `400`, `?query=` → `400`, no `query` → `200` with 18 items, and `priority=NOT_A_PRIORITY` → `200` with six results instead of an error. See `API-DIVERGENCE.md`. **Re-probed 2026-09-10 as a plain `USER`, with a control the earlier probes lacked**: against a baseline of one visible issue, an unknown `priority` and an unknown `issueType` each answer `200` with that same one item, so the filter is dropped rather than applied, while a valid-but-different `priority` correctly answers zero. **Decided with the owner 2026-09-11, TAS-180 stays `Done`:** the three-character minimum is deliberate and set through the environment, so the contract moves to it (`minLength: 3`, no `default` — TAS-206); an unknown `priority` or `issueType` must answer an empty list rather than the full set (TAS-218). The compensation stays until TAS-218 ships. |

**Re-measure this table, do not read it.** On 2026-09-08 six rows were probed
in one pass — TAS-137, TAS-139, TAS-162, TAS-172, TAS-178, TAS-180 — and **four
of the six had already been fixed by the backend without anyone noticing**:
TAS-139, TAS-162, TAS-172 and TAS-178, including the row this table described as
disabling the board's core gesture and the one that called an issue permanently
unreadable. TAS-137 and TAS-180 survived every clause and now carry the date
they were re-checked. **TAS-141, TAS-124, TAS-145 and TAS-146 were not covered**
and carry no 2026-09-08 measurement — say so rather than letting "the table was
probed" cover them.

The counts in this paragraph were wrong twice before they were right, which is
its own small lesson: an exact claim about coverage is worth more than a round
one, and both reviewers checked the arithmetic. Prefer naming the keys. A blocker is a claim about a running system
and it decays silently: nothing fires when it stops being true, because a
compensation that is no longer needed is a compensation that never complains.
The same failure, in the same session, cost `API-DIVERGENCE.md` a twelve-day-old
entry — see its TAS-105 record. One authenticated pass over this table costs a
minute; treat it as part of any snapshot refresh.

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

### TAS-189 — planning fields, second half: the block, the form, and the day the backend caught up

- Unblocked by the backend, and measured rather than inferred. Backend PR #148
  merged on 2026-09-11 at 13:09Z with the `openapi.yml` half that its
  force-push had dropped two days earlier; `develop @ 21a0d9d177a1` differs from
  the previous snapshot by exactly the extract's blocks plus `required` arrays on
  three schemas, and the deployed gateway's `/v3/api-docs` declares the five on
  both issue response DTOs. The snapshot moved, the pending extract went, and the
  divergence entry closed on that measurement — not on the merge date.
- The UI states no rule. Every field parses to a value, `null` or `NaN` and hands
  it to the API layer; `planningFieldRefusal` answers, the panel shows the answer
  and rolls the one field back. The consequence `api-contract-guard` liked: the
  stored-date cross-check, which refuses a window move in one request, becomes two
  ordered writes with a message that names the order, because the panel commits
  one field at a time.
- `art-director` blocked the first draft twice and was right both times. An empty
  `<input type="date">` printed the browser's mask at `--fg`, louder than a real
  value; and `disabled` for viewers composited the em-dash to 1.8:1 and took the
  block out of the tab order. `readOnly` plus three `!canEdit` guards, because
  `readOnly` does not suppress `blur`. Their layout call — a 3-column row over a
  2-column row instead of three rows with an orphan cell — replaced the
  orchestrator's, and the two-line hint at 390/320 was ruled ordinary for meta.
- `release-reviewer` found the draft loss the builder's own reseed created: a
  refetch after committing field A replaced all five drafts, so a value being
  typed in field B vanished. Fixed per field, and the same block stopped
  clobbering summary and description on a planning commit. The re-verdict checked
  the regression test by reverting the block in a scratch copy, and the
  `validity.badInput` guard by stubbing it out — a half-typed date then commits a
  clear, which is silent data loss on a tab-out.
- `api-contract-guard` re-ordered the REST refusal so a typo costs no `GET`, and
  proved the two-call order identical to the one-call order over 889,785 input
  combinations rather than by reading. The merged mapper answers TAS-116's
  "not sent vs sent null" question: it cannot tell, so omitting the key stays the
  right spelling of "clear".
- Scope drift, all reported and kept: the shared `Modal` scrolls now (the taller
  form cut off its primary action on a phone); `watchers.spec.ts` scrolls its
  rows into view before pressing raw coordinates; a third fixture had the same
  cast gap as the two the backlog named.
- Deferred to `BACKLOG.md`: a fixed §4.11 modal footer, and the `pr-147` extract
  pin that `contract:pins` reports drifted from PR #147's head.
- Still unmeasured, stated in the PR body rather than implied away: no
  planning-field write has reached the deployed gateway. The three probes the
  backlog names are one request each now.
- Verdicts: `release-reviewer` ship → ship; `art-director` do-not-ship → ship;
  `api-contract-guard` ship → ship. Two one-line follow-ups from the re-verdicts
  carry no verdict, as the table allows for non-blocking fixes.

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

**2026-09-09 — the condition cleared, the criterion was met, and the decline
held where it was about the screen.** The pin did exactly what it was left to
do: `npm run contract:pins` opened this run with `MERGED pr-118-TAS-125.yml` and
a stale snapshot, before anything had been read.

- Two of the four reasons are dead. Backend PR #142 (TAS-124) merged 2026-09-07
  and implements `ListIssuesForBoard` end to end, and PR #118 merged 2026-09-09
  with the access check added in `issue-service` rather than in the gateway.
  Measured, not read: `GET …/board?issueType=TASK` answers `200` with three
  ordered columns against the deployed gateway.
- Two are alive, and both are about the **screen**, not the method:
  `BoardIssueDto` still draws less than the card does — labels arrive as ids and
  `displayName` came back `null` for every assigned row — and one issue in an
  unknown status still 500s the whole board. So the method shipped in all three
  implementations and `BoardScreen` did not move, which is the story as written.
- The arithmetic is now recorded rather than asserted: `issueType` is required,
  so the `ALL` filter needs three board calls, and the response carries no
  transitions, so the three workflow reads stay — six requests against today's
  four, for a card that draws less.
- Found while doing it, and unrelated to the board: backend PR #148 (TAS-116)
  force-pushed away its own `openapi.yml` half at 11:49Z, three hours after this
  repository re-pinned it. Its api-gateway build is red because the gateway's
  DTOs are generated from that spec. Recorded in `API-DIVERGENCE.md` and in the
  extract's header, and raised on TAS-116.
- **What the roles found, and the one lesson worth keeping.**
  `api-contract-guard` blocked on three claims the mock was making about a server
  it had not read: story points copied from the seed onto cards the gateway can
  never fill, an `INTERNAL` code where the gateway sends `INTERNAL_SERVER_ERROR`,
  and an `includeDone` rule keyed on the column's category where `issue-service`
  keys it on the literal `status_key`. The last one is the lesson: **the probe
  could not have settled it**, because on the project measured the category and
  the status key are the same string. A single project cannot distinguish two
  rules that agree on it, and the source can.
- `release-reviewer` approved and then made the same correction in the other
  direction: three sibling claims were still written as measurements —
  `displayName`, the non-member's answer, and the order of cards within a column
  — where the backend source settles all three. A record that says "not measured"
  about something readable is an invitation to re-measure it, and the entries now
  say which kind of evidence each claim rests on.
- Not a finding, but the run's other cost: three tests in `AdminScreen.test.tsx`
  had a race older than this branch, which this branch's added tests exposed by
  making the suite longer. Fixed by awaiting the commit the assertions are about;
  the pattern that produced them is in `BACKLOG.md`.

## The MVP cut

Written 2026-09-09 at the owner's asking, after an audit of what each screen
requests and a four-lens critique of the first draft. It is here rather than in
a story because it decides what several stories are for.

**The definition, and it is one checkable sentence:** the app runs in `rest`
mode with `VITE_TASKA_ASSUME_PROJECT_ADMIN` off, **a second person can reach a
project in the role they were given**, and no screen lies.

The first draft stopped at "rest mode with the flag off". The critique broke it:
`HybridTaskaApi` synthesises exactly the two methods that describe *somebody
else's* membership, so removing the synthesis without a way to create a second
membership removes the compensation and leaves nothing to check under it —
`VIEWER` stays unreachable, and `DESIGN.md`'s own warning about that survives the
deletion. A definition whose acceptance criterion sits in a story ranked below it
is not a definition.

**Core, and why each is in it.**

| Key | What breaks without it | Evidence |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) + the acceptance note added to it | the member read lands carrying ids, and the board draws a column of uuids instead of the occasional "Unknown" | read — the DTO's shape is contract, the column of uuids is what follows from it, and nobody has seen it because the route answers `405` today |
| [TAS-204](https://jira.ozero.dev/browse/TAS-204) | nobody can be invited, so the member form is a uuid field with nowhere to get a uuid | measured 2026-09-09 — `/users`, `/users/{id}` and `/auth/invitations` all answer the static-resource `404` while `/users/me` beside them answers `401`, which is the control that makes the `404` mean unmapped. `/users/batch` answers the same `404` and is TAS-137's evidence, not this row's, since the batch read moved there |
| [TAS-158](https://jira.ozero.dev/browse/TAS-158) | there is no way to put a person in a project, so role gating stays undemonstrable | read |
| [TAS-208](https://jira.ozero.dev/browse/TAS-208) | the flow every new person must walk fails three ways, one of them reporting success for the wrong account | read |
| [TAS-207](https://jira.ozero.dev/browse/TAS-207) | a non-member sees another project's workflow; a missing route reads as "you have no projects" | measured — the workflow half **re-measured 2026-09-10 and still reproducing**, with every neighbouring read refusing `403` beside it; the empty-list half recorded 2026-08-03, not re-probed, and not probeable without an account that owns no projects |
| [TAS-198](https://jira.ozero.dev/browse/TAS-198), then [TAS-197](https://jira.ozero.dev/browse/TAS-197) | admin "block" is decorative for anyone holding a token, and the admin screen says otherwise | read |
| [TAS-173](https://jira.ozero.dev/browse/TAS-173) | one unknown enum value still removes a card from a column while leaving it in the count | read |
| [TAS-202](https://jira.ozero.dev/browse/TAS-202), the request-shape half | the projects screen costs 30 requests and the counters describe one loaded page | measured |
| [TAS-209](https://jira.ozero.dev/browse/TAS-209) | the compensation stays, and with it the flag that makes every permission check meaningless | read |

**What left the first draft.** TAS-141 entirely, because it is `Done` in Jira
while the dependency table earlier in this file still lists five open gaps
against it; its live
empty-projects clause is re-filed as TAS-207. TAS-201, TAS-203 and TAS-205 were
never candidates rather than silently dropped: each makes a screen cheaper or
richer, and none of them stands between a second person and a project.
On 2026-09-11 all three were closed as duplicates of epic TAS-210's children,
and the epic became the route to the MVP rather than a detour around it — see
the direction note at the end of this section.
The `X-Request-Id` ask, because it is measured working and the claim was ours,
not the gateway's. TAS-184, because the click already fails safe. Read-all for
notifications, because it saves clicks rather than removing a lie. The `version`
half of TAS-206, because its window is three fields until TAS-116 merges, which
makes it TAS-116's gate rather than the MVP's. The board's 100-issue ceiling,
because the stand cannot reach it.

**The order optimises for one thing: the earliest date a second account can walk
the stand.** Probes first, and nothing is ordered for the backend until they are
taken. Then the cheap backend fixes that are blocked by nothing, the frontend
work that waits on no one, TAS-137 with its widened acceptance, TAS-204 after its
DTO shape is visible, and last of all TAS-209 — a compensation comes out when
everything it compensated for answers, not when a backend key closes.

**The MVP is declared by a run, not by a build.** Two accounts on the stand: an
admin issues an invitation, the second person activates through the link, gets
`MEMBER`, sees the board and moves a card; the same person as `VIEWER` is refused
a write; an outsider sees neither the project nor its workflow. Until that run
passes, the MVP is not declared, however green `npm run check` is.

### The direction after 2026-09-11: off hybrid, onto an API that answers the screen

Set by the owner on 2026-09-11, after the backlog pass that turned TAS-210 into
an epic. The goal for the coming sprints is the MVP sentence above, and the
route to it now runs through the epic rather than around it: the screens move
onto reads that answer their question, and the hybrid comes out once nothing
needs it.

Order, each step named by what it unblocks:

1. [TAS-137](https://jira.ozero.dev/browse/TAS-137) — PR #152. Brings
   `GetProjectMembers` and `GetUserDetailsByIds`; every "name beside an id" in
   the epic stands on it.
2. [TAS-204](https://jira.ozero.dev/browse/TAS-204) — an invitation can be
   issued and a person found by email. Without it a second account cannot exist
   on the stand.
3. [TAS-211](https://jira.ozero.dev/browse/TAS-211) and
   [TAS-213](https://jira.ozero.dev/browse/TAS-213), then
   [TAS-212](https://jira.ozero.dev/browse/TAS-212) — the projects screen and
   the board become one read each; the three workflow calls and the member
   synthesis lose their reason to exist.
4. [TAS-202](https://jira.ozero.dev/browse/TAS-202) — the screens move onto
   those reads. Its interim half (`refetchOnWindowFocus` off, the read-all cap,
   honest board paging) needs no backend and can start now.
5. [TAS-158](https://jira.ozero.dev/browse/TAS-158) and
   [TAS-208](https://jira.ozero.dev/browse/TAS-208) — members can be managed,
   the invitation path works end to end.
6. [TAS-209](https://jira.ozero.dev/browse/TAS-209) — `rest` becomes the
   default; `HybridTaskaApi` and `VITE_TASKA_ASSUME_PROJECT_ADMIN` are deleted.
   Last, and only when everything above answers.

TAS-214 to TAS-218 make the product better but do not gate the hybrid's
removal; they follow in epic order.

Two conventions the pass settled, so they are not re-argued. Every backend ask
carries an "as is / to be" pair of JSON blocks and a plain list of new and
removed fields, in the ticket, with no colour markup — Jira reads `{word}` in
prose as a macro and `[ {…} ]` as a link, so braces are escaped as `\{id}` and
JSON lives only in `{code}` blocks. And `api-contract-guard` now proposes the
backend change that removes a compensation, checked against the backend
repository and naming the layer it lands in, instead of only recording the
compensation — see its definition in `.claude/agents/`.

### TAS-202 — the request-shape debt, and what was deliberately left out of it

Filed 2026-09-09 as one story rather than six, at the owner's asking, after an
audit measured what each screen actually requests. The measurement method
matters more than the numbers: the real `HybridTaskaApi` over the real
`RestTaskaApi` with a counting `fetch`, not a reading of the code.

- **What it costs today.** Projects screen, nine projects: 27 requests for the
  cards, 30 with the screen's own, and 18 of the 27 exist to print `1 members`,
  which `hybrid` hard-codes. Board: 10 requests, constant in the issue count, of
  which one project read and one profile read are duplicates of reads the screen
  already made. Neither number moves with data — the fan-out is per card and per
  issue type, never per issue. The per-issue hydration TAS-195 removed is
  genuinely gone.
- **What was folded in**, all of it already written down somewhere: the
  `markAllNotificationsRead` cap, the board's 100-issue ceiling and its second
  copy under the links section, the panel's re-read of the issue page, the two
  call sites sharing one cache key, the mock's missing paging validation, the
  `summaryByProject` memo, and the project card's hard-coded `1 members` — that
  last one alone is eighteen of the twenty-seven, which is why it is named here
  rather than left inside "the projects screen". Seven `BACKLOG.md` lines — the
  links-section duplicate is not one of them, because it was **deleted** rather
  than graduated, which this file's own rule at `BACKLOG.md:8` treats as a
  different act. Of the seven,
  **two are struck through and five are annotated in place**: the
  numbers in the bullet above are quoted from those five, and a struck line is a
  worse place to quote from than a live one. `release-reviewer` caught the first
  version of this sentence claiming all seven were struck, which the file's own
  rule at `BACKLOG.md:8` would have led a reader to expect.
- **What stayed out, and why in one sentence each.** A `rest`-mode Playwright
  project is infrastructure with its own review surface. Watchers paging is a
  contract ask, and folding it would give a frontend story a backend dependency.
  The `getMembership` three-mode disagreement is parity, not waste — the flag
  short-circuits it to zero requests. The invite flow's unauthenticated
  `getCurrentUser` is an auth path, and a performance story must not edit one.
  The admin clamp holes belong to another owner, and the attachment
  presign-per-row is the same shape on the far side of the wire —
  `API-DIVERGENCE.md`'s attachment entry, not a `BACKLOG.md` line, which is where
  a reader will otherwise look for it.
- **The backend half is two asks, not one.**
  [TAS-201](https://jira.ozero.dev/browse/TAS-201) is the board DTO;
  [TAS-203](https://jira.ozero.dev/browse/TAS-203) is the missing project counts,
  filed after checking rather than assuming — no `memberCount`, no `issueCount`,
  no batch summary route anywhere in the contract.
  [TAS-137](https://jira.ozero.dev/browse/TAS-137) is the root cause of the
  synthesis and is already in flight, so it got a comment saying its call sites
  will have moved by the time it lands, not a scope change.
- **The rule used to decide.** One story where one diff touches the same files
  and splitting means writing the paging twice; separate stories where the fix
  has a different owner, a different review surface, or a backend dependency.

### TAS-193 — watchers, and the deferral that did not survive being checked

- **The story deferred half the feature for a reason that was wrong twice over,
  and the brief said so instead of restating it.** Removing someone else's
  subscription needs no picker — the route takes a `userId` every row already
  carries. Adding one draws from the pool the assignee picker uses. And the
  asymmetry that settled it: in `rest` the member read is a 405, the assignee
  chips render nothing and Reporter says Unknown, while the ADMIN remove still
  works, because it needs no name. **Watchers degrade less than the assignee
  they were compared to.**
- **What the roles found.** The pressed toggle's label was `--accent` on an
  accent tint — 4.17:1 dark, below §7's floor — while §4.21, written for this
  story, claimed it used the assignee chip's recipe; the chip sets `--fg`. An
  ordinary double-click on a row's ✕ unsubscribed **two people**. The section
  announced the `aria-disabled` rule and broke it twice inside itself. The
  heading made a focus target drew `outline: auto` from the reader's system
  accent — orange, in an indigo product.
- **A sentence that was false and could not be made true.** Hybrid's member read
  returns one element and *succeeds*, so §5.6's boundary — only a successful
  read may claim there is nobody — cannot tell a synthesis from an answer. The
  rule that came out of it is in `API-DIVERGENCE.md` and outlives watchers: **a
  synthesised read is safe to draw from and unsafe to conclude from.** Anything
  built on that list may offer and may not assert.
- **Three guards were correct and held by nothing.** Deleting the toggle's
  in-flight guard, or either `null`-count guard, passed the entire suite. All
  three are pinned now. This is the third story running where a reviewer's
  mutation found a guard nobody tested.
- **The closing question paid a second time.** Asked before merge whether
  anything should have been written differently, the builder found that this
  pass had made a defect *louder*: the row read "You" and its button said
  "Remove yourself from watchers" while the sentence about that person said
  "Unknown is still watching this issue". Row, control and sentence are taught
  together now. **Ask it every time — a reviewer checks what is written, and the
  builder knows where it hesitated.**
- Not fixed and named in the PR rather than implied: the double-click residual
  at 200 and 350ms, which is the server's own latency and shared by four panel
  sections; four touch targets under 44 at 390, now in §7's list with numbers;
  the same "Unassigned" announcement in three more places; and
  `watcherFailureText`'s fallback being unreachable against every
  implementation.

### TAS-194 — the retry, and the six rounds that were not about the retry

- **The brief was wrong about the guard and the builder refused it.** I said the
  rule was about the `service` in the path. It is mostly about **status**: the
  server takes `FAILED` and a long-enough `PROCESSING`, and refuses `NEW` and
  `PUBLISHED` — while "Overdue NEW" is one of the three categories this screen
  exists to show. A button drawn from "this row is problematic" would have
  failed on a whole category of the list. Read out of `OutboxRetryServiceImpl`,
  not out of the contract, which states none of it.
- **Two thresholds disagree** — stuck at five minutes in the summary, retryable
  at ten in the retry, both server config the client never sees. Hence a warning
  before the press, the server's own sentence after it, and no client-side
  clock. [TAS-200](https://jira.ozero.dev/browse/TAS-200), where the durable ask
  is to state the eligibility rule in the contract rather than to align two
  numbers: today the backend can change which events are retryable without
  changing the contract.
- **Two compensations retired on probes rather than on merge dates.** The
  `jsonb` seed is the one to remember: the builder refused to delete it on the
  merge date and asked for the probe first. Twenty rows read, every payload
  clean JSON, then the deletion. The order was measurement → removal, which is
  what the file had asked for twice and not got.
- **Six rounds of verdicts, none about whether retry works.** The overflow band
  the section's only write ended up behind; a dialog closing over a pending
  write, in defiance of its own docblock; then the fix for that stealing focus;
  then the fix for *that* losing focus to `<body>`; then a one-line fix for the
  arm's lifetime silently disarming two mutants, because the dismissal's own
  read spent the arm while the button was still connected. Each fix was correct
  and each created the next finding.
- **A reviewer's own suggestion would have shipped a no-op**, and the builder
  proved it by making that exact version a mutant rather than by arguing. Worth
  keeping: the reviewer had run it green in its own copy. A green run confirmed
  the change was invisible, not that it was right.
- **The defect no verdict could find.** Asked before merge whether anything
  should have been written differently, the builder named the confirmation: two
  rows sharing a service and an event type produced a byte-identical
  announcement, and an unchanged `role="status"` is not re-announced. The
  fixture had no colliding pair, so no test could show it and no reviewer
  reading a diff could see a case the fixture lacked. **Ask the builder what it
  doubted. It is the one question a diff cannot answer.**
- Not fixed and said plainly in the PR body rather than implied: `main.page-shell`
  overflowing with `overflow: hidden` at 844×390, the shared `Modal` having no
  `max-height`, the same announcement defect live in Users, and no e2e on the
  focus rescue.

### TAS-195 — the board stops asking twice, and four blockers turn out to be dead

- The measurement is the story. `ListIssuesResponseDto.items` had been
  `IssueResponseDto` on `develop` since before the 2026-09-05 refresh, and the
  divergence entry refused to close on that, demanding a probe because contract
  and runtime have disagreed here before. Probed 2026-09-08: the list carries
  `status`, `description`, `createdAt` and **populated** `labels`. The entry was
  right to insist — and it is the only place in the repository that did.
- **Two response types had been sharing one interface**, above a comment warning
  that one name would hide the day either schema grew a field. The list grew;
  search did not. Splitting them was the actual work, not deleting the fan-out.
- **Four of the six blocker rows probed the same day were already fixed** —
  TAS-139, TAS-162, TAS-172, TAS-178 — including the one this repository called
  the board's core gesture and the one that called an issue permanently
  unreadable. TAS-137 and TAS-180 survived every clause. Nothing fires when a
  blocker stops being true, which is why the table now says re-measure rather
  than read.
- **TAS-173 was `Done` without existing.** No commit carries the key, the ledger
  has no row, and not one acceptance criterion is met in the code. Found only
  because a duplicate was filed for the same defect and the duplicate check went
  looking. `git log --grep` on a key is the cheap version of that check.
- Two findings were the orchestrator's own errors, both caught by reviewers: an
  all-clear written for TAS-172 from a measurement of a different bug, and
  `description` named as the field that blanks the application when the board's
  filter reads `summary` first. Corrected in the history, not smoothed over.
- The evidence that would settle this best does not exist: a rest-mode network
  trace showing one request where there were 101. The mock never hydrated, so
  mock mode cannot show it, and a real trace needs a sign-in the agent will not
  perform. Said plainly in the PR body rather than covered by a green gate; two
  routes to close it are in `BACKLOG.md`.
- Verdicts: `api-contract-guard` pass then eight findings then five more;
  `release-reviewer` approve twice, with 19 mutants written by hand and all 19
  killed, plus a corroboration of TAS-172 taken from the deployed app rather
  than from the diff.

### TAS-196 — the compensation came out, and two records did not come with it

- The probe first, the edits after, because the divergence entry demanded it in
  writing: "one probe at that point confirms the status/code table above against
  the running gateway rather than against the branch's source". Measured
  2026-09-08 with an invalid uuid so nothing could be mutated — all three admin
  writes answer `400 INVALID_ARGUMENT` where they answered Spring's
  static-resource `404` on 2026-08-25. Two reviewers independently added the
  control probe on the same prefix, which is what makes the reading "mapped"
  rather than "a uuid filter upstream".
- **The entry's own removal note was stale, and following it would have deleted a
  live compensation.** It named `UNDEPLOYED_ROUTE_MESSAGE` and `isUndeployedRoute`
  for deletion; by the time it was followed, TAS-190 had given both a second
  caller in the attachments panel, whose backend PR is still open. The rule this
  buys, now in `docs/contract/pending/README.md`: a removal note names the code
  to delete on the day the divergence is found, and code acquires callers
  afterwards — read the callers, not the note.
- **All three reviewers found the same thing independently:** `DESIGN.md` §5.8
  still specified the sentence the story removed, and `DESIGN.md` outranks the
  story. The only standing instruction left in the repository would have been the
  one to rebuild what this deleted.
- **Two findings were defects the fixes themselves introduced.** Correcting the
  routes table to name TAS-194 left a paragraph twenty-seven lines below naming
  TAS-106; correcting the TAS-105 gap note pointed two files at a record that
  still said the opposite. Both are in the commit history rather than smoothed
  over, because the shape recurs: correcting the place someone pointed at is not
  the same as correcting the fact.
- **A twelve-day-old lie surfaced sideways.** `GET /readonly/outbox/problematic-summary`
  has answered since backend PR #141 merged 2026-08-27; its entry still said the
  gateway does not serve it. The entry stays **open** and moves to TAS-194,
  because the divergence inverted rather than closed — the endpoint answers and
  the compensation is still in the tree. Why nobody noticed is the durable part:
  the compensation renders as a quiet note and compares its signature by exact
  equality, so against a live `200` it cannot fire, and **a compensation that
  never fires is one nobody reports**. Hence the standing instruction to re-read
  `API-DIVERGENCE.md` whole on every snapshot refresh, not only beside the entry
  a story touches.
- The same sentence — "it removes itself on deploy" — turned up at five sites
  across three rounds, the last being the docstring on the constant itself, which
  is where a reader lands by go-to-definition. A promise to retire is what stops
  a removal from ever being scheduled.
- `release-reviewer` and `api-contract-guard` both verified the new predicate
  test by mutation rather than by reading it, in both directions: relaxing the
  message arm failed two existing tests, relaxing the status arm failed none —
  which was the finding.
- Verdicts: `api-contract-guard` pass, then F1–F6, then N1–N3, then N4–N5, each
  round closing its own. `release-reviewer` request-changes on three, then
  approve. `art-director` approve on the UI throughout, blocking twice on the
  record — B1, then B2 which its own fix created.

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
