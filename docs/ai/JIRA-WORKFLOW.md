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
| [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Archive a project from the UI and the read-only board of an archived one; widened 2026-10-20 with the frontend half of backend PR #155 (explicit `null` clears colour and description) | Done | taken 2026-10-20 on the owner's «подготовь пр под бековые ручки, которые на ревью» — one branch for both open backend PRs, #155 (TAS-145) and #159 (TAS-146). First version written against #159 @ `97464fe` (archived project listed, every read refused) and approved by all three roles on `51c51a2`. **Both merged on 2026-10-23** (#155 `ed064ade`, #159 `fcbbaac8` at head `919c1d6d`) the other way round — an archived project leaves `GET /projects` and stays readable, writes answer 400 `details.reason` `PROJECT_ARCHIVED` — which answered the reads question asked on TAS-146 since 2026-09-17. Reworked the same day on the owner's «следи когда наша не влитая ветка с фронта сможет влиться»: rebased onto main after TAS-389, new pre-build rulings (`api-contract-guard` CHANGES REQUIRED on `bd132f7`: the mock contradicting the merged server, a synthesised list row, the dialog copy stating the opposite; `art-director` REQUEST CHANGES: no pill, stay on a read-only board, refusal by `details.reason`, no 405 notes), DESIGN.md §4.11/§4.12/§5.7 on the ruling, snapshot to develop `562d84de`, both extracts deleted; the read-only archived board built in this PR. Stand probed 14:40Z: `DELETE`/`PATCH /projects/{uuid}` 401 without a token (were 405). **Merged** (PR [#95](https://github.com/3x6th/taska-ui/pull/95)) on 2026-10-23. Verdicts on the rework: `release-reviewer` APPROVE WITH NOTES on `ff04ae5`; `api-contract-guard` APPROVE WITH NOTES on `ff04ae5` (L1–L3 fixed in `647f5cc`); `art-director` REQUEST CHANGES on `ff04ae5` (focus leaving an open modal, the /projects Save race, modals offering writes after the archive, Esc over kept text) → REQUEST CHANGES on `647f5cc` (Tab escaping from focus targets, focus on `<body>` after the refused Save, any refusal hiding the line) → APPROVE WITH NOTES on `39a9d55`. Left: BACKLOG «Left by TAS-149»; nothing archived on the stand yet |
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
| [TAS-184](https://jira.ozero.dev/browse/TAS-184) | `notification.link` is a gateway API path, and empty for `ISSUE_ASSIGNED` / `ISSUE_TRANSITIONED` | Done | backend ask; merged as backend PR #164 and deployed 2026-09-28 — `link` gone, `issueId`/`issueKey`/`projectId` in its place, no backfill for older rows. The TAS-183 compensation came out in TAS-243. It missed the two attachment payloads — TAS-245 |
| [TAS-185](https://jira.ozero.dev/browse/TAS-185) | The notifications bell reached only from a project board, though the inbox is the user's; now in the shared bar too | Done | merged (PR #39) |
| [TAS-167](https://jira.ozero.dev/browse/TAS-167) | Admin Events section: problems summary over the TAS-105 endpoint, outbox journal on the generic readonly grid, event card with the jsonb rule | Done | merged (PR #40) |
| [TAS-186](https://jira.ozero.dev/browse/TAS-186) | Admin Users section: the accounts list over `auth.users`, block and unblock behind a confirmation with a required reason | Done | merged (PR #41) |
| [TAS-187](https://jira.ozero.dev/browse/TAS-187) | Disable the `voltagent` plugin packs for this repository so their 60 generic agents stay out of every session's context | Done | merged (PR #42) |
| [TAS-188](https://jira.ozero.dev/browse/TAS-188) | Bring the admin user-status writes to backend PR #146's contract — `changedAt`, `LOCKED`, and the new reset-lockout write | Done | merged (PR #43) |
| [TAS-189](https://jira.ozero.dev/browse/TAS-189) | Issue planning fields — story points, start and due dates, both estimates (backend PR #148) | Done | merged (PR #45 API layer, PR #64 UI half). Backend PR #148 merged 2026-09-11 with its `openapi.yml` half restored; snapshot refreshed to `21a0d9d177a1` in PR #64 |
| [TAS-190](https://jira.ozero.dev/browse/TAS-190) | Issue attachments over presigned S3 links (backend PR #147) | Done | merged (PR #48) |
| [TAS-192](https://jira.ozero.dev/browse/TAS-192) | `.form-error` measures 3.17:1 in ten places; make the TAS-190 notice the product's error box | Done | not started. **Merged** (PR [#90](https://github.com/3x6th/taska-ui/pull/90), merge `69c4380`) on 2026-10-19 with TAS-236, TAS-259 and TAS-192 together. Verdicts: `art-director` CHANGES_REQUIRED (DESIGN.md text described behaviour the code does not have) → APPROVE WITH NON-BLOCKING NOTES on `4b794aa`; `release-reviewer` and `api-contract-guard` APPROVE_WITH_NOTES; CI green |
| [TAS-191](https://jira.ozero.dev/browse/TAS-191) | The gateway's board endpoint in the API layer, without moving the board screen onto it (backend PR #118) | Done | merged (PRs #47, #58) |
| [TAS-201](https://jira.ozero.dev/browse/TAS-201) | ~~`BoardIssueDto` drops `issueType`, `priority` and `statusKey` that `IssueBoardResponse` already carries~~ | Done | **closed 2026-09-11 as a duplicate of TAS-213** (epic TAS-210); nothing was built under this key, every ask moved |
| [TAS-202](https://jira.ozero.dev/browse/TAS-202) | The frontend half of epic TAS-210: move the screens onto the aggregate reads; until they land, `refetchOnWindowFocus` off, honest board paging, a capped read-all loop | Done | rewritten 2026-09-11 as TAS-210's frontend counterpart; the interim half needs no backend and can start now. **The issue panel's slice is [TAS-246](https://jira.ozero.dev/browse/TAS-246)** (2026-10-07): the panel's one read and the issue writes close there, and this story stays open for the rest. `/meta` enums taken in TAS-173 (2026-10-19). **The projects screen and the board** taken 2026-10-23 on the owner's word («догоняй фронт под #205 (TAS-213) и /project-stats одной задачей») after backend #205 and #209 deployed (probed 401 without a token): projects from `GET /project-stats`, the board from `GET /projects/{id}/board?includeDone=true` beside `/context`, focus return re-reads only failed queries, a request-count test in `npm run check`; the notification switch resized to 32×18 in the same PR on the owner's remark. **Merged** (PR [#103](https://github.com/3x6th/taska-ui/pull/103)) on 2026-10-24; request multisets pinned in `src/screens/ScreenRequests.test.tsx` (projects and board each 2 screen reads + `/users/me`, `/notifications`, `/meta`; filters, focus return and an opened panel's board re-read 0). Verdicts: `api-contract-guard` pre-build design → APPROVE WITH NOTES on `7aa188b`; `art-director` pre-build REQUEST CHANGES (card order comparator, «Outside their workflow», bell re-read on open) and the switch ruling → APPROVE WITH NOTES on `7aa188b`; `release-reviewer` CHANGES_REQUIRED (the yml-vs-Java `unplacedIssues` rule unrecorded; the mock's unplaced order) → APPROVE on `7aa188b`. CI on mobile then exposed a focus race latent since TAS-149 (Labels' refusal replacing its archive line) and an admin e2e test race; fixed in `ea858ec`, `art-director` and `release-reviewer` APPROVE on `2530e96`. Backend asks on TAS-213 (order, enrichment, paging, yml wording); A4 waits on TAS-386. Left: BACKLOG «Left by TAS-202» |
| [TAS-203](https://jira.ozero.dev/browse/TAS-203) | ~~The project list carries no counts, so nine cards cost nine reads~~ | Done | **closed 2026-09-11 as a duplicate of TAS-211** (epic TAS-210) |
| [TAS-204](https://jira.ozero.dev/browse/TAS-204) | Nobody can be invited and nobody can be found by email: `POST /auth/invitations`, `GET /users?query=`, tokens on `accept` | Done | backend ask, MVP; rewritten 2026-09-11, linked to epic TAS-210. **Merged** as backend PR #204 (`0f7a937`) and deployed 2026-10-19; probed: `GET /users?query=adm` 200 with `{items, hasMore}` (`4745a06f-ccad-487f-869f-1976f9656ce7`). Invitation emails need stand config (`NOTIFICATION_INVITATION_ACCEPT_URL`, the SMTP secret) and the leaked Gmail app password rotated — comment on TAS-204. Frontend: TAS-297 with TAS-208 |
| [TAS-205](https://jira.ozero.dev/browse/TAS-205) | ~~Reads do not answer a screen's question: `issueType` required, no transitions on the board, no issue lookup by key~~ | Done | **closed 2026-09-11 as a duplicate of TAS-213 and TAS-214** (epic TAS-210) |
| [TAS-206](https://jira.ozero.dev/browse/TAS-206) | `openapi.yml` hygiene: `$ref` on the enums, one document instead of two (`/v3/api-docs` disagrees), declared collection order, `minLength: 3` and no `default` on the search query | Done | backend ask; rewritten 2026-09-11 — `PATCH`, `version` and the nullable assignee moved to TAS-215, the search decision came in from TAS-180. **Merged** as backend PR #200 (`9f09f31`) on 2026-10-19 and deployed; probed: the served `/openapi.yml` is byte-identical to develop `398285c` (sha1 `f81c9763`); collection order in live answers not probed, checked at the snapshot and mock refresh in TAS-265. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переведи … в Done с комментарием о мерже и замере, как делал с предыдущими тринадцатью»), with a comment naming the merge and what was probed. Also probed: `/meta` lists 23 notification types and 5 user statuses (`f2739711-8300-4418-938c-146716a67cf8`). Review remarks R1/R3/R4 on TAS-206 not taken — left as asks. Frontend: TAS-265 |
| [TAS-207](https://jira.ozero.dev/browse/TAS-207) | Two project reads lie: `workflow` enforces no membership, an empty project list is a `404` | Done | backend ask, MVP, linked to epic TAS-210. The empty-list clause traces to TAS-141 and went into its closure unfixed; the workflow-membership clause was **never filed, deliberately** — see `API-DIVERGENCE.md`, "the workflow read is not membership-checked" — and is filed for the first time here. `WorkflowController` on the gateway calls no role checker at all (read 2026-09-11). **Merged** as backend PR #190 (`f34e504`) on 2026-10-19 and deployed: `WorkflowController` reads the project first, so a non-member gets 403 (probed on the stand 2026-10-24 in TAS-209's MVP run, `a04e0c60-…`). The empty-list half already held on develop (`listMyProjects` 200 `[]`; the client's catch removed in TAS-263). No client surface left: `getWorkflow` deleted in TAS-263. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-208](https://jira.ozero.dev/browse/TAS-208) | The invitation path is broken three ways, and one of them reports activating somebody else's account as success | Done | MVP, not started; absorbs TAS-153, closed 2026-09-11 as its duplicate. Taken 2026-10-19 inside TAS-297 (same PR) on `api-contract-guard`'s read of develop and `art-director`'s rulings (DESIGN.md §4.27). Code **merged** in PR #91 (`9a14564`) on 2026-10-19; left In Review on purpose — the last acceptance item, a stand run with a second account, waits for the stand's accept URL (exactly `https://taska.ozero.dev/`) and SMTP secret and the leaked Gmail app password rotated (TAS-204). **Closed on the owner's word on 2026-10-24** without the two-account run on the stand; the code merged 2026-10-19 20:28 UTC (PR #91) |
| [TAS-209](https://jira.ozero.dev/browse/TAS-209) | Drop hybrid and default to `rest` — the act that closes the MVP | Done | MVP, strictly last: after TAS-137, TAS-204, TAS-158, epic TAS-210 and TAS-202. Since TAS-224 the class compensates for nothing and the flag is gone. What was left then was deleting `HybridTaskaApi`, the default mode, and the two-account run. Taken 2026-10-24 on the owner's word («закрываем 209», «в рамках 209 и хвосты доделать которые можешь сейчас без бека») together with the frontend tails TAS-396 and TAS-397, one PR; branch `feature/TAS-209-rest-and-tails`. **Merged** (PR [#104](https://github.com/3x6th/taska-ui/pull/104)) on 2026-10-24: `HybridTaskaApi` deleted, `rest` by default, a config-time mode guard, the repo variable set to `rest`, a PERMISSION_DENIED refusal re-reads the role. It stayed In Review until the two-account MVP run on the stand. Verdicts: `api-contract-guard` pre-build design → APPROVE WITH NOTES on `85a14a4`; `art-director` pre-build rulings → REQUEST CHANGES on `85a14a4` (Esc from a non-text control dropped unsent text; a demoted reader lost the comment draft) → APPROVE WITH NOTES on `9f2641c`; `release-reviewer` APPROVE WITH NOTES on `85a14a4`. **The two-account MVP stand run passed on 2026-10-24** (project `MVPRUN`; invitation and activation not re-run — covered by the owner's earlier activation of the same account; MEMBER moved a card, VIEWER refused with the role re-read, a removed member got 403 and never 401 on all nine project-scoped reads probed; request ids in API-DIVERGENCE, the TAS-224/209 entry) — Done |
| [TAS-210](https://jira.ozero.dev/browse/TAS-210) | **Epic** — API for the screens: every screen complete in one round of requests instead of 30, 9 and 6 requests over two rounds | To Do | filed 2026-09-10 as one task, made an epic 2026-09-11 at the owner's asking; priority `Highest` set by the owner. Children TAS-211…218, TAS-240, TAS-241, TAS-242; TAS-202, TAS-137, TAS-204, TAS-184 and TAS-207 linked into it. **Rewritten 2026-09-23** after the owner asked about `/v2`: no version prefix, the expand-contract rule is written into the epic, and the target became one round per screen rather than one request — see the direction note below |
| [TAS-211](https://jira.ozero.dev/browse/TAS-211) | New `GET /project-stats`: counts and the first five members of every project in one batched read; `GET /projects` stays lean (`description` and `color` from PR #155, the existing `currentUserRole`) | In Progress | backend ask, epic TAS-210. **Rewritten 2026-09-23 at the owner's decision**: counts moved off the list so the cards paint from the lean read and the counts fill the skeletons already on them; `myRole` dropped as a duplicate of `currentUserRole`. Fixed internal call count, `/project-stats` rather than `/projects/stats` (the latter is captured by `GET /projects/{projectId}`) |
| [TAS-212](https://jira.ozero.dev/browse/TAS-212) | New `GET /projects/{id}/context`: an envelope of existing DTOs — `project`, `members` (+`addedAt`), `labels`, `workflows`; `GET /projects/{id}` unchanged | In Progress | backend ask, epic TAS-210. **Rewritten 2026-09-23 at the owner's decision**: the live bundle reads `GET /projects/{id}` twice per board visit, so making it a six-part all-or-nothing composite would put the header and role gating at the mercy of any label, workflow or avatar failure. No counts in the context; GLOBAL_ADMIN read-through optional and priced (a flag through three rpcs in two services) |
| [TAS-213](https://jira.ozero.dev/browse/TAS-213) | `GET /projects/{id}/board` as one read: `issueType` optional, the card's fields on `BoardIssueDto`, labels as objects, no `500` on a status outside the workflow | To Do | backend ask, epic TAS-210. Read against `develop` 2026-09-11: `issue_type`, `status_key`, `priority`, `watchers_count`, `comments_count` are already on `IssueBoardResponse` and dropped by `IssueMapper.toRestBoardIssue`; `description`, `created_at`, `updated_at`, `version`, `due_date`, `story_points` need proto fields; `displayName` waits on TAS-137 |
| [TAS-214](https://jira.ozero.dev/browse/TAS-214) | `GET /issues/{id}` as one read on new schemas (`IssueDetailsResponseDto` in a new wrapper): `assignee`/`reporter` objects beside the kept ids, embedded existing watcher/link/attachment DTOs grown additively, `isWatching`, `commentCount`; lookup by key | In Review | backend ask, epic TAS-210. **Rewritten 2026-09-23**: the first draft retyped the live `/links`, `/attachments`, `/watchers` routes and removed `assigneeId` that board cards read through the shared DTO. **Merged** as backend PR #170 (`develop` `60d62ee`, 13:07 UTC 2026-10-07) and **deployed** the same day: the stage deploy succeeded, and without a token `GET /issues/by-key/API-1` answered the static-resource 404 before it and `401` after. Still `In Review` in Jira — the backend's ticket, not moved from here. Frontend: TAS-246. A part that fails does not fail the panel, but it reaches the wire as `[]`, not `null` (the generated DTO starts lists empty), so it reads as empty; candidate asks A1–A5 in `BACKLOG.md`, meant for this ticket as one comment |
| [TAS-215](https://jira.ozero.dev/browse/TAS-215) | `PATCH /issues/{id}` with an expected `version`: partial update, explicit `null` clears, `409` on a stale version; `PUT` kept, deprecated | Done | backend ask, epic TAS-210. **Merged** as backend PR #166 (`f6525ce`) and **deployed** 2026-10-02: `PATCH` takes the version in `If-Match` (bare or quoted), answers `409` with the current issue on a mismatch, and clears a field on an explicit `null`. **2026-09-23**: `PUT` and `PUT /assignee` stay, now `deprecated: true`, until the backend removes them (candidate ask C2 in `BACKLOG.md`). `If-Match` is allowed by the CORS preflight from `taska.ozero.dev` (measured 2026-10-07). Frontend: TAS-246 |
| [TAS-246](https://jira.ozero.dev/browse/TAS-246) | The issue panel from one `GET /issues/{id}`, `/browse/:issueKey` through by-key, and issue writes through `PATCH` with `If-Match` | Done | **merged (PR [#77](https://github.com/3x6th/taska-ui/pull/77))** on 2026-10-07 at the owner's word after a live GET probe. Opened as a draft at `ae12659` so CI ran beside the reviews (a deviation from the PR-after-verdicts order, stated in the PR). Slice of TAS-202 (its panel and issue-write bullets close here; TAS-202 stays open); stands on TAS-214 and TAS-215, takes in TAS-222 and TAS-197, all deployed. Pass 1 `f35a490`: the panel from one details read plus comments (6 → 2 requests, pinned by `IssuePanelRequests.test.tsx`), `/browse/:issueKey` via by-key (404/403 both §4.18), prefix guessing gone. Pass 2 `ae12659` and fixes `f26e2eb`: `PATCH` with quoted `If-Match`, 409 → the server's issue plus a conflict sentence, a write made before a conflict is not sent, `None` unassigns and keeps focus, mock parity incl. auto-watch, no watcher count pill (ask A3), 2 MB avatar, LOCKED, `viewLinkType` prefix. Verdicts: `release-reviewer` approved r1, r2, r3; `api-contract-guard` blocked r1 (records, client-counted pill) and closed both on r2 with approval; `art-director` blocked r1 (focus ring, retry blanking, two recipes) and r2 (None focus, chip ring), closed all on r2/r3 with approval and ruled DESIGN.md §4.18/§4.20/§4.21/§5.1/§5.5/§5.6/§7. Gate on `f26e2eb`: check exit 0 (1152 unit, 535 e2e), build exit 0. **Measured with the owner's session at 20:03 UTC (GET only)**: details shape, by-key 200/404 and its case rule, `viewLinkType` prefix, watcher `displayName: null` — all as code-read (`API-DIVERGENCE.md`). Not measured: `PATCH`/409 on the stand, the by-key 403, a failed part. Candidate backend asks left on TAS-214 as one comment (2026-10-07) Follow-up in PR [#80](https://github.com/3x6th/taska-ui/pull/80) (2026-10-08): one issue re-read per write instead of two (measured live on API-5 after #77), the live `PATCH` test recorded, `assigneeId: ""` recorded as contract-conforming; `release-reviewer` and `api-contract-guard` approved |
| [TAS-248](https://jira.ozero.dev/browse/TAS-248) | Share on an issue: copy the short `/browse/{KEY}` link and the full link | Done | **merged (PR [#80](https://github.com/3x6th/taska-ui/pull/80))** on 2026-10-08 at the owner's word, beside the TAS-246 follow-up. Filed 2026-10-08 from the owner's request. Icon button before Delete for every role; popover anchored to the panel head with two read-only links and Copy each; links from one helper `appUrl` (`src/lib/appLinks.ts`) that reads the router mode `main.tsx` routes by — hash on Pages, path on dev. `release-reviewer` and `art-director` approved the first submission (r1, no blockers); DESIGN.md §4.10, §4.23 and the §7 row written on `art-director`'s ruling. Non-blocking notes in `BACKLOG.md`: the short field hides the key on the Pages host at 390, long keys wrap the head at 320, the popover jumps on copy, one Esc must not close overlay and panel together |
| [TAS-251](https://jira.ozero.dev/browse/TAS-251) | Frontend for the open backend PRs, by readiness: the board from `GET /projects/{id}/context` (#169, TAS-212), Work log in the issue panel (#178, TAS-118), Audit in the admin console (#172, TAS-160); plus TAS-218 search fields | Done | **merged (PR [#82](https://github.com/3x6th/taska-ui/pull/82))** on 2026-10-12 at the owner's word for a demo, with [TAS-256](https://jira.ozero.dev/browse/TAS-256) still open: measured that evening, `/context` and `/members` answer 200 on all 12 projects with avatars, but `workflows` is `[]` everywhere (no `project_settings` rows), so until the backfill the board offers no issue types and no transitions. Filed 2026-10-10 from the owner's "фронт для задач на PR, по готовности". Slice of TAS-202 (its context bullet). Built mock-first against pinned extracts `docs/contract/pending/pr-169/178/172`; **merge waits for #169 on the stand** (`/context` answered the static 404 on 2026-10-10), because rest mode reads the board only from it. Board 11 → 5 requests (pinned by test); a context 403/404 goes to NotFound as the server says — the confirming `getProject` read was removed on 2026-10-12 under the no-compensation rule (TAS-253). **#169 merged 2026-10-12 (`fa90b51`) and deployed, but `/context` answers 500 on every project**: an NPE in project-service `ProjectMapper.toProjectMemberResponse` on a member without an avatar, and since TAS-225 every member row has `avatar: null` — filed as [TAS-254](https://jira.ozero.dev/browse/TAS-254), which blocks this merge. Worklog writes queue with issue writes and await the issue re-read (each bumps `version`). Audit: route unwired at #172 head (501), paging ignored — both on TAS-160; mock-only until fixed. Verdicts: `release-reviewer` blocked pass 1 (avatar → NotFound), closed on cb97af1, approved passes 2–3; `api-contract-guard` blocked twice (a GLOBAL_ADMIN claim it then withdrew on the evidence; issue-type doc claim and 501-by-status), closed on b99e6f3; `art-director` blocked on 28px work-log actions, fixed 5dc4478; DESIGN.md §4.20/§4.22/§4.24/§5.3/§5.6/§5.8 written on its ruling |
| [TAS-257](https://jira.ozero.dev/browse/TAS-257) | The Activity feed in the issue panel folds from its heading, and the choice is kept in the browser | Done | **merged (PR [#84](https://github.com/3x6th/taska-ui/pull/84))** on 2026-10-12. Filed that day from the owner's «сделай чтобы можно было свернуть активити у задачи». Frontend only: the section's `h3` holds one disclosure button (chevron · Activity · count-pill) with `aria-expanded` and `aria-controls`; a folded feed is not rendered; the choice is one for every issue in `localStorage` (`taska.activityCollapsed`), like the theme; "No activity yet" on an empty history; no animation. `art-director` approved r1 (815fac3) with non-blocking notes — two taken in 6a2e06c (the 28px hit area as a `::after`, the empty line), the clamp on collapsing at the bottom of the panel ruled uncompensated — and DESIGN.md §4.26, the §4.15 cross-reference and a §7 open entry (28px target at 390, count-pill 2.76:1) written on its ruling. `release-reviewer` approved 6a2e06c with non-blocking notes: comment Delete without a confirmation graduated to TAS-259; the PR body and three DESIGN.md numbers fixed in the last commit. Gate on 6a2e06c: check exit 0 (1307 unit, 595 e2e), build exit 0; CI run 38278954205 green. Draft PR opened before the verdicts so CI ran beside them (the TAS-246 precedent, stated in the PR). Evidence mock-only, under `docs/ai/evidence/TAS-257/` |
| [TAS-258](https://jira.ozero.dev/browse/TAS-258) | Front-end suggestions from Ivan Lukin: fold the issue's Activity; the board on a 2K monitor | Done | point 1 merged as [TAS-257](https://jira.ozero.dev/browse/TAS-257) (PR #84); point 2 as [TAS-380](https://jira.ozero.dev/browse/TAS-380) (PR [#96](https://github.com/3x6th/taska-ui/pull/96)). The scale half of point 2 was declined on 2026-10-21 — browser zoom does it; answered on the ticket |
| [TAS-259](https://jira.ozero.dev/browse/TAS-259) | Comment Delete in the issue panel has no confirmation strip: one click deletes the comment | Done | filed 2026-10-12 from the TAS-257 reviews, graduated from `BACKLOG.md`; not started. Pre-existing; TAS-257's collapse at the bottom of the panel made it reachable by a second click in the same spot. **Merged** (PR [#90](https://github.com/3x6th/taska-ui/pull/90), merge `69c4380`) on 2026-10-19 with TAS-236, TAS-259 and TAS-192 together. Verdicts: `art-director` CHANGES_REQUIRED (DESIGN.md text described behaviour the code does not have) → APPROVE WITH NON-BLOCKING NOTES on `4b794aa`; `release-reviewer` and `api-contract-guard` APPROVE_WITH_NOTES; CI green |
| [TAS-261](https://jira.ozero.dev/browse/TAS-261) | `GET /projects/{id}/context` sends every workflow with empty `statuses` and `transitions`, so the board finds no transition and never sends `PUT …/transition` | Done | backend ask, filed 2026-10-15 from the owner's «не можем сдвинуть задачу по статусу, говорят мы не дергаем ручку транзишн». Measured with a token: context empty, `…/workflow?issueType=TASK` three statuses and three transitions for the same workflow, `PUT …/transition` 200 both ways on kappa-test-2 (status restored, version 2 → 4). Cause in project-service `ProjectMapper.toWorkflowDataResponse` (MapStruct does not fill protobuf repeated fields; `unmappedTargetPolicy = IGNORE`), confirmed in the generated `ProjectMapperImpl` at develop `3a0a1cb`; came in with TAS-212, noted in a comment on TAS-256, which closed without it. Fix opened by the orchestrator at the owner's word: [backend PR #183](https://github.com/VladislavYurin/taska-backend/pull/183) (`@AfterMapping`, a mapper test red without it; project-service 65/65 locally), **merged** as backend PR #183 (`4277199`) on **2026-10-16** and deployed; probed 2026-10-19: three statuses per type (`00f7c880-d17a-4b44-82f5-ceeffc1c0216`). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-262](https://jira.ozero.dev/browse/TAS-262) | The board and the issue panel do not say that the context's workflow came without statuses: the panel shows nothing beside the status, the drop claims "no transition … in this workflow" | Done | **merged (PR [#85](https://github.com/3x6th/taska-ui/pull/85))** on 2026-10-16 on `art-director` and `release-reviewer` approvals (no blockers) and green CI on 22fe4d8; backend #183 (TAS-261) merged the same day. `fix/TAS-262-empty-workflow`. Filed 2026-10-15 with TAS-261; the owner chose the honest state over a `getWorkflow` compensation. Frontend only, no compensation |
| [TAS-263](https://jira.ozero.dev/browse/TAS-263) | Frontend for backend PRs #184–#195 (opened 2026-10-16) and their follow-ups on #186/#193/#194: avatar from `GET /users/me` with `avatarUnavailable`, Retry from `retryable`, UUID filter class, mock check order, `getWorkflow` and `getUserAvatarUrl` deleted, `listProjects` 404 catch removed | Done | **merged (PR [#87](https://github.com/3x6th/taska-ui/pull/87))** on 2026-10-19, at the owner's «что подготовили, ты льешь», after the merge gate was met and probed (below); branch `feature/TAS-263-backend-prs-catchup`. Filed 2026-10-16 from the owner's «влад выставил кучу пул реквестов… начни готовить фикс»; one story for all twelve per the one-pass rule. **Merge gate: #193 and #195 merged, deployed and probed** — before that the reader's photo turns to initials and every Retry button disappears. **Met 2026-10-19** — all of #184–#195 merged and deployed (`7d4f739`), probed: `/users/me` carries `avatar` and `avatarUnavailable` (`0f9c038b…`), the problematic summary carries `retryable` (`c28ef6d3…`), context lists, uuid filter, `Max-Age` 7200. Backend follow-ups asked on #186 (owner: 403 for a non-member of any global role), #193 (`avatarUnavailable`) and #194 (assign roles on `/assignee`); all three closed at `cc03c0d`/`3bd33ca`/`a33ed5d`, checked by `api-contract-guard` with two skeptics each. Verdicts on `dee393b`: contract and art APPROVE WITH NOTES, release BLOCK on the merge gate only; notes taken in `6973103`, `DESIGN.md` §4.4/§4.12/§4.16/§5.8 on art-director's rulings in `6fe81ac`. Undocumented find: the login lock is 401 on the stand since #174 (2026-10-13), uncompensated, #187 restores it; #187 merged as `42bf5e5` and deployed 2026-10-19, read in code, not probed (a wrong-password probe would change a real account's lock state). Jira MCP was down this session; Jira written through the browser session's REST |
| [TAS-216](https://jira.ozero.dev/browse/TAS-216) | `POST /notifications/read-all` and an `unreadCount` | Done | backend ask, epic TAS-210; re-filed from TAS-141's read-all clause. Backend PR #165, additive; merged and deployed 2026-09-27, connected in TAS-243 |
| [TAS-243](https://jira.ozero.dev/browse/TAS-243) | Notifications on the gateway's new fields: one `POST` read-all, the bell's dot and name from `unreadCount`, a row routes from `projectId` + `issueId` with no issue read | Done | merged (PR #76). Filed 2026-09-28 from the owner's "the backend changed a lot around notifications, connect everything"; epic TAS-210, blocked by TAS-216 and TAS-184, both deployed. Removes the TAS-183 compensation and `getIssueById`. Rows stored before the TAS-184 migration carry no ids and now open nothing — decided, stated to the owner. `release-reviewer` approved the first submission. `api-contract-guard` blocked on the records, not the code: the two attachment kinds arrive with `issueId` only (TAS-245), and the docs claimed otherwise — closed on its re-verdict. `art-director` approved, took the `Mark all read` hit target (80.5×18.7 → 92.5×28.7) into the round, then blocked on what the sixth seed row exposed — a focus ring cut by the panel's corner on a scrolled row, live on any inbox of six or more — closed by `scroll-padding-bottom` and a green e2e. DESIGN.md §7's two bell gaps struck on its ruling |
| [TAS-245](https://jira.ozero.dev/browse/TAS-245) | issue-service writes the two attachment notification payloads without `projectId` and `issueKey`, so every attachment notification opens nothing | Done | backend ask, filed 2026-09-28 from `api-contract-guard`'s TAS-243 blocker; the missed part of TAS-184 (`putIssueFields` never called by the attachment builders), epic TAS-210. Frontend makes no compensation. **Merged** as backend PR #191 (`d46c192`) on 2026-10-19, deployed with develop `7d4f739`; read in code, not probed (no attachment notification since the deploy). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-217](https://jira.ozero.dev/browse/TAS-217) | `GET /meta`: the enum dictionaries with an `ETag` | Done | backend ask, epic TAS-210; TAS-173 is the frontend defence that must land with or before it. **Merged** as backend PR #196 (`f453171`) on 2026-10-19 and deployed; probed: 200 with five dictionaries and `ETag`, 304 on a matching `If-None-Match` (`66c3e9d7-1a3f-422e-bece-b196cd61b60d`, `8341eb03-e262-4115-b5e6-eb2ccecbd131`), 401 without a token. Names Russian (follow-up [TAS-264](https://jira.ozero.dev/browse/TAS-264)); `notificationTypes` 11 of 22 (fixed on PR #200, TAS-206). Frontend: TAS-173 |
| [TAS-264](https://jira.ozero.dev/browse/TAS-264) | `GET /meta` names its values in Russian and lists link types in one direction only | Done | backend ask, filed 2026-10-19 from TAS-173 (owner: «сделаешь обратно на инглиш и сразу заложишь мапинг для будущего исправленного инглиша»), epic TAS-210. Gateway only (`MetaServiceImpl`, `MetaResponseDto` + `linkViewTypes`). Removes the Cyrillic check in `src/lib/enumLabel.ts`. **Merged** as backend PR #201 (`9aea7e3`) and deployed 2026-10-19 17:47 UTC; probed: English names, `selectable`, seven `linkViewTypes`, no Cyrillic (`b8cc7a79-8bfe-46d1-892d-5e51f098b666`). Moved to `Done` the same day. The client's Cyrillic check stays (owner). Frontend for `selectable` and `linkViewTypes`: TAS-297 |
| [TAS-265](https://jira.ozero.dev/browse/TAS-265) | The frontend for backend PRs #197–#200 (merged and deployed 2026-10-19): the audit entry's `id`, `details` on the error envelope, the mock's collection order and `/meta` seed, avatar ownership on confirm | Done | filed 2026-10-19 from `api-contract-guard`'s read of the four PR heads (`3eafb22`, `f7ca7d5`, `c99ff19`, `7cdcf28`); none blocks the frontend. After TAS-173 (same files). Merge gate **met 2026-10-19**: #197–#200 all merged and deployed (develop `398285c`), so the pr-197 extract is no longer needed and the snapshot moves instead; the four backend stories were moved to `Done` the same day. Review remarks on the PRs went as comments on TAS-160, TAS-221, TAS-239, TAS-206. **Merged** (PR [#89](https://github.com/3x6th/taska-ui/pull/89), merge `057fc95`) on 2026-10-19: snapshot to develop `398285cde074`; audit rows keyed by `id`, the 501 arm gone; `ApiError.details` with the lock deadline read from `details` first (sentence fallback until probed); the mock follows the deployed avatar confirm, the contract order and `/meta`. Verdicts: `api-contract-guard` and `art-director` APPROVE_WITH_NOTES; `release-reviewer` CHANGES_REQUIRED (stale search-length claims) → APPROVE_WITH_NOTES on `680bf73`. Found on the way: TAS-296 (High). CI green |
| [TAS-296](https://jira.ozero.dev/browse/TAS-296) | An outbox retry writes the event snapshot — a `USER_INVITED` payload's `rawInviteToken` and email included — into `admin_audit_log`, and the Data read returns it unmasked | To Do | backend ask, **High**, filed 2026-10-19 from `api-contract-guard`'s TAS-265 verdict; read in code at develop `398285c` and checked by the orchestrator (`OutboxRetryServiceImpl` `valueToTree(snapshot)`, `UserInvitedPayload`, the `admin` catalog with no sensitive fields); not on the stand yet. Ask: mask at write time, and/or HIDE the documents in the Data catalog. Also carries `actor_roles`' two shapes. The client does not mask |
| [TAS-298](https://jira.ozero.dev/browse/TAS-298) | A deleted comment's text stays in the issue's history payload — every project member, a VIEWER included, reads it over the API | Done | backend ask, filed 2026-10-19 from `api-contract-guard`'s TAS-259 verdict; read in code at develop `9aea7e3` (`CommentServiceImpl` payload builders, `IssueMapper` pass-through), not probed. The UI never renders payload bodies. **Merged** as backend PR #207 (`f38839b`) on 2026-10-22 and deployed with the stack at `594f637`; comment events carry no text, old rows stripped on read and by migration 0009, the comment notification body has no preview. Moved to `Done` by the backend's Jira sync; API-DIVERGENCE entry closed in TAS-382. Nothing for the frontend. |
| [TAS-297](https://jira.ozero.dev/browse/TAS-297) | The frontend for merged backend #201, #202, #204: `selectable` and `linkViewTypes` from `/meta`, people search in the members dialog, invitations from Administration › Users, the board mock excluding by DONE category; TAS-208 in the same PR | Done | filed 2026-10-19 by a parallel session; taken the same day after PR #90 merged. Snapshot to develop `e8a8d316b326` (15 blocks, each identical to a merged head); `pr-155` re-extracted at `28f5fe1`, so every pin is current. **Merged** (PR [#91](https://github.com/3x6th/taska-ui/pull/91), merge `9a14564`) on 2026-10-19 with TAS-208. Verdicts: `api-contract-guard` (prose-keyed password refusal undocumented) and `art-director` (results box a Tab stop; Send invitation looked enabled) CHANGES_REQUIRED → APPROVE WITH NOTES on `1ffa084`; `release-reviewer` APPROVE_WITH_NOTES. CI green (unit 1550, e2e 679) |
| [TAS-299](https://jira.ozero.dev/browse/TAS-299) | The tails after TAS-297: one focus ring product-wide (≈45 Tab stops drew the system `outline: auto`), issue delete asks first with the §4.22 strip (owner: «полоса везде»), a VIEWER's summary and description readOnly, the filter-bar error, the resend 409, sign-in toggle and `aria-disabled` | Done | filed and taken 2026-10-20 on the owner's «закрываем хвосты»; `art-director` pre-build ruling, DESIGN.md §4.1/§4.3/§4.10/§4.13/§4.22/§4.27/§5.7/§5.8/§7. **Merged** (PR [#92](https://github.com/3x6th/taska-ui/pull/92), merge `931e895`) on 2026-10-20. Verdicts: `art-director` (the calendar-button ring never removed) and `api-contract-guard` (the password-refusal entry described the old workaround) CHANGES_REQUIRED → APPROVE WITH NOTES on `b1afcc3`; `release-reviewer` APPROVE_WITH_NOTES. CI green (unit 1580, e2e 709). Follow-up for art-director's two notes (New project focuses Key; modals return focus to their trigger) **merged** (PR [#93](https://github.com/3x6th/taska-ui/pull/93), merge `e56f540`) on 2026-10-20, with N1 of its own round fixed in it (Key and Name open empty — the caret after the pre-filled "API" made "WEB" into "APIWEB"). Verdicts on `4b48ce6`: `art-director` APPROVE WITH NOTES, `release-reviewer` APPROVE. CI green (unit 1585, e2e 709) |
| [TAS-300](https://jira.ozero.dev/browse/TAS-300) | issue-service soft-deletes an issue before checking the caller's role, so any signed-in user deletes another's issue and gets 403 | Done | backend ask, **High**, filed 2026-10-20 from `art-director`'s TAS-299 ruling and verified by the orchestrator in code (`IssueServiceImpl.deleteIssue` at develop `e8a8d316`); not probed — the probe would delete a real issue. **Merged** as backend PR #206 (`c01e08d`) on 2026-10-22 and deployed with the stack at `594f637`; the role is checked before the soft delete in one transaction. Moved to `Done` by the backend's Jira sync; API-DIVERGENCE entry closed in TAS-382, the board's re-read after a failed delete kept as policy. |
| [TAS-380](https://jira.ozero.dev/browse/TAS-380) | A Settings page (`/settings`): My profile takes the photo band out of the profile menu, Appearance chooses the issue panel's shape (side panel or centred window), the board columns' alignment (left or centred) and the theme; the issue panel gets Esc, a focus trap and focus return in both shapes | Done | filed and taken 2026-10-21 from point 2 of [TAS-258](https://jira.ozero.dev/browse/TAS-258) (2560 px monitor: columns in the left third, panel at the right edge) on the owner's design; owner chose a page over a modal, no scale setting, and the profile menu unchanged except the photo band → Settings. `art-director` pre-build ruling, DESIGN.md §2.6/§2.7/§3/§4.2/§4.10/§4.11/§4.12/§4.13/§4.16/§4.17/§5.1/§5.2/§5.8/§5.9 (new)/§6/§7. **Merged** (PR [#96](https://github.com/3x6th/taska-ui/pull/96), merge `1a58a6d`) on 2026-10-21. Verdicts: `art-director` CHANGES_REQUIRED (loading dialog name, DESIGN.md errors, stale BACKLOG) → APPROVE on `7411819`, §4.10 Esc-list addition APPROVE on `8c5942e`; `release-reviewer` CHANGES_REQUIRED (Esc lost a typed work log entry; VIEWER absence checks ran on the loading skeleton) → APPROVE on `8c5942e`; `api-contract-guard` not run — `src/api`, `src/domain` and the contract untouched, confirmed by `release-reviewer`. CI green (unit 1634, e2e 725) |
| [TAS-382](https://jira.ozero.dev/browse/TAS-382) | The frontend for backend PR [#208](https://github.com/VladislavYurin/taska-backend/pull/208) (TAS-381): a project Workflows dialog — every workflow the project runs on, the shared default read-only, an ADMIN creates the project's own workflow as a copy and adds statuses and transitions — and a read-only diagram of each workflow's transitions; issue-panel move buttons named by their target; the mock's default workflow carries migration 0001's six transitions | Done | filed and taken 2026-10-21 on the owner's word («начинай готовить пр, под бековую задачу от меня же»), linked as blocked by TAS-381; the diagram added 2026-10-22 on the owner's word. Written ahead against the pending extract at `9a04e99`; #208 merged unchanged as `594f637` and deployed 2026-10-22 08:04Z, and in the same pass #206 (TAS-300) and #207 (TAS-298) — snapshot refreshed to `594f63791565`, extract deleted, three API-DIVERGENCE entries closed with probes. Verdicts: `api-contract-guard` pre-build ruling → APPROVE WITH NOTES on `c3cdfa3`, merge-day blockers (comments calling #208 open; the TAS-300/TAS-298 closures) → closed on `aa1f058`; `art-director` pre-build REQUEST CHANGES (placement, sortOrder, irreversible writes, read-only scrolling) → APPROVE WITH NOTES on `c3cdfa3`, diagram APPROVE WITH NOTES on `6556607`; `release-reviewer` CHANGES_REQUIRED (a missing TODO claimed to 404 the context) → APPROVE WITH NOTES on `c3cdfa3`, diagram APPROVE WITH NOTES on `3582d9d`, merge-day narrow pass on `aa1f058`. **Merged** (PR [#98](https://github.com/3x6th/taska-ui/pull/98)) on 2026-10-22. Left: BACKLOG «Left by TAS-382» (four places the code lags §4.28 among them); on TAS-381 the empty-workflow 404 and the transition named «Close» |
| [TAS-383](https://jira.ozero.dev/browse/TAS-383) | The project context fails whole when one type's workflow cannot be read: the validator checks no minimum (no status, no TODO, no visible transition), `GetWorkflowForProject` answers NOT_FOUND on empty lists, project-service zips every type so one refusal 404s `/context`; concurrent adds with one sortOrder brick a workflow | To Do | backend ask, **High**, filed 2026-10-22 on the owner's word («заведи задачи … на закрытие тех дыр, чтобы контекст проекта не падал»); read at develop `594f637` (`WorkflowServiceImpl.java:42-51`, `WorkflowCreationValidator.java:35`, `ProjectServiceImpl.java:155-163`, `:255-274`, no unique `(workflow_id, sort_order)`). Graduates BACKLOG «The context reads a workflow NOT_FOUND…» and is the Removal of API-DIVERGENCE «A workflow with no status or no visible transition…». Not probed — a write probe would break a shared project. Blocks TAS-384. No frontend change needed |
| [TAS-384](https://jira.ozero.dev/browse/TAS-384) | Edit and delete in a project's own workflow: rename and reorder statuses and transitions, toggle hidden, delete them (a status with issues refused with a count or moved to a target status through issue-service), delete the own workflow back to the shared default; every write answers the whole `ProjectWorkflowDto` | Done | backend ask, filed 2026-10-22 on the owner's word («заведи задачи на воркфлоу, на редактирование и удаление»); the operations the read-only diagram and a future graph editor need. Blocked by TAS-383 (shared minimums). Merged as backend PR [#225](https://github.com/VladislavYurin/taska-backend/pull/225) (`6ba4ed6`, 2026-10-26) with the minimums inside it; deployed — probed 2026-10-26 without a token, all six routes answer 400 `INVALID_ARGUMENT` on a non-UUID path, not 404. Frontend story TAS-416 |
| [TAS-385](https://jira.ozero.dev/browse/TAS-385) | A project's own issue types: a registry in project-service (code, name, colour, icon from fixed sets, sort order), CRUD routes for an ADMIN, the context serving `issueTypes`; built-ins renamable («Bug» → «Инцидент»); replaces `allowedIssueTypes` in the settings JSON | Done | backend ask, filed 2026-10-22 on the owner's word («заведи задачи на добавление новых своих типов помимо бага ишью стори»); project-level by the orchestrator's decision (no companies yet; moves with TAS-284/TAS-287). Blocks TAS-386. **Merged** as backend PR #212, `Done` in Jira (seen 2026-10-26). No frontend story yet: the four `/issue-types` routes and `ProjectContextDto.issueTypes` are unused, and custom types cannot hold issues until TAS-386 (backend PR #226, open on 2026-10-26) |
| [TAS-386](https://jira.ozero.dev/browse/TAS-386) | The issue type becomes an open key from the project's registry instead of the closed TASK/BUG/STORY enum — proto (expand-contract), issue-service CHECK and validation, workflow resolver falling back to the default workflow, gateway `IssueTypeDto` as a string in seven schemas and three filters | To Do | backend ask, filed 2026-10-22 with TAS-385; read at develop `594f637` (both proto enums, `issues_type_chk`, gateway mappers, `WorkflowResolver.java:23-26`). Graduates two BACKLOG lines (issue of a disallowed type; workflow list ignoring `allowedIssueTypes`). Blocked by TAS-385 and TAS-383. The frontend already treats types as an open set (TAS-173, TAS-199) |
| [TAS-387](https://jira.ozero.dev/browse/TAS-387) | Independent Email/Telegram notification channels and confirmed bot connection in My profile | Done | merged (PR [#101](https://github.com/3x6th/taska-ui/pull/101)), 2026-10-23, on the owner's word; written by the backend developer's Codex run, reviewed from scratch by this repository's three roles (round 2: all APPROVE WITH NOTES on `3b375fa`). Backend [#215](https://github.com/VladislavYurin/taska-backend/pull/215) merged as `9a735db` and deployed, followed by #218 and #222 (TAS-391). Kept In Review on the owner's word until the smoke on a test bot; **moved to `Done` on 2026-10-26** when the owner reported «Уведомления работают» on the stand. The orchestrator did not watch that run: the record is the owner's word, with no request ids. Tails in BACKLOG «Left by TAS-387» |
| [TAS-389](https://jira.ozero.dev/browse/TAS-389) | The user's `login` leaves the UI with backend TAS-388: no login column in Administration → Users, no `@login` in the confirmation, profile menu or My profile; the audit actor shows the stored name and email (`actorDisplayName`, `actorEmail`) with the actor UUID for identification | Done | filed by the backend developer 2026-10-23, linked as blocked by [TAS-388](https://jira.ozero.dev/browse/TAS-388); taken the same day on the owner's word («параллельно начинай делать фронтовую»). Started against the two stories' text; backend PR #219 opened within the hour and was pinned as `pr-219-TAS-388.yml`, then merged unchanged as `ce189843` and deployed 13:57Z the same afternoon — extract deleted, snapshot refreshed, stand probed. **Merged** (PR [#102](https://github.com/3x6th/taska-ui/pull/102)) on 2026-10-23. Verdicts: `art-director` pre-build ruling → REQUEST CHANGES (the Users status line left at 860 under a 720 table) → APPROVE WITH NOTES on `bf45ff1`; `api-contract-guard` pre-build design (two revisions, the second on #219's Java) → APPROVE WITH NOTES on `cefcb1f`; `release-reviewer` APPROVE WITH NOTES on `93104d8`. Left: BACKLOG «Left by TAS-389» |
| [TAS-392](https://jira.ozero.dev/browse/TAS-392) | api-gateway + issue-service: the board after TAS-213 — card order, a visible enrichment failure, per-column paging, the yml wording for `unplacedIssues`, label order | To Do | backend ask, filed 2026-10-24 on the owner's word («если закрыл задачи, но остались хвосты, заведи их на джире») from TAS-202's reviews; carries the comments left on TAS-213 (Done). No frontend compensation |
| [TAS-393](https://jira.ozero.dev/browse/TAS-393) | api-gateway: the board's issue types from the project registry, not the TASK/BUG/STORY constant | To Do | backend ask, filed 2026-10-24 (A4 from TAS-202); blocked by TAS-386 |
| [TAS-394](https://jira.ozero.dev/browse/TAS-394) | project-service: a reason on the last-ADMIN refusal, a stable project order, `reason` values in the error contract | To Do | backend ask, filed 2026-10-24 from TAS-149's and TAS-202's guard notes |
| [TAS-395](https://jira.ozero.dev/browse/TAS-395) | admin-service: one masking policy for emails in Data | To Do | backend ask, filed 2026-10-24 from TAS-389; the owner chooses the policy |
| [TAS-396](https://jira.ozero.dev/browse/TAS-396) | Admin tails after TAS-389 and TAS-202: «Only this actor» in the audit, the Users person column at 375, the rail race during the catalog load, tests | Done | filed 2026-10-24 from the reviews; taken with TAS-209. **Merged** with TAS-209 (PR #104) on 2026-10-24: «Filter by this actor», the frozen Users person column ≤720, `useTransitions={false}` against the rail race, the page-999 flake, e2e for the audit actor column and the profile email line |
| [TAS-397](https://jira.ozero.dev/browse/TAS-397) | Board and dialog tails after TAS-149 and TAS-202: Esc and focus in modals, request id on refusals, a half-typed date after archive, the project card footer, the archive smoke on the stand | Done | filed 2026-10-24 from the reviews; taken with TAS-209; the stand smoke needs the owner's word. **Merged** with TAS-209 (PR #104) on 2026-10-24: Esc in every Modal (holds while any unsent text is in the dialog), request id on every write refusal, Add label focus, the half-typed date reset, the card footer, one lost-focus helper. The archive smoke on the stand passed on 2026-10-24 on the owner's word (project `MVPRUN`; ids in API-DIVERGENCE) — Done |
| [TAS-398](https://jira.ozero.dev/browse/TAS-398) | issue-service + api-gateway: name the actor of each history event on `GET /issues/{issueId}` | To Do | backend ask, filed 2026-10-24 from TAS-209's guard design (N1); the panel joins history actors against `/context` members meanwhile (API-DIVERGENCE) |
| [TAS-412](https://jira.ozero.dev/browse/TAS-412) | Settings → Access tokens (epic TAS-399, MCP phase 1): issue a personal access token with read or read-and-write and an expiry, show the secret once, revoke; Claude Code and Cursor snippets for the MCP server; «via MCP» / «via API token» on history and comments | In Review | **merged (PR [#107](https://github.com/3x6th/taska-ui/pull/107))** on 2026-10-25, **against the mock** — stays In Review until TAS-402 and TAS-411 land and the stand probes in the API-DIVERGENCE «TAS-412» removal pass (the TAS-387/TAS-209 precedent). Started 2026-10-24 from the owner's «начни делать будущие разделы для mcp на фронте»; branch `feature/TAS-412-access-tokens`. Backend develop `92a00dbc` has no PAT, routes or channel field; the shape is the frontend's proposal on TAS-402, the stand shows «not on this gateway yet» (measured, `102d66a8-…`). Verdicts: release-reviewer BLOCK → APPROVE WITH NOTES (repeat revoke idempotent per TAS-401), api-contract-guard APPROVE WITH NOTES (backend asks posted on TAS-402/411/400), art-director REQUEST CHANGES → APPROVE WITH NOTES (snippet font, Esc hold, unseen create, Activity mark). TAS-414 (OAuth consent) not started: waits for ADR TAS-400 — GitHub Pages cannot send `frame-ancestors` (comment on TAS-414). Left: BACKLOG «Left by TAS-412» |
| [TAS-415](https://jira.ozero.dev/browse/TAS-415) | notification-service: «added to a project» and «role changed» notifications carry `projectId` | To Do | backend ask, filed 2026-10-24 from TAS-397's stand smoke: those rows read «Nothing to open» while «Project archived» does not (it carries `projectId`); no frontend change needed (§4.12) |
| [TAS-416](https://jira.ozero.dev/browse/TAS-416) | The frontend for backend PR [#225](https://github.com/VladislavYurin/taska-backend/pull/225) (TAS-384): edit and delete in the Workflows dialog — rename a workflow, a status and a transition, move a status or a transition, hide a transition, delete them and the own workflow (a status with issues moved to a chosen status, a workflow's off-default statuses mapped); the three existing writes parsed as the `ProjectWorkflowDto` they now answer; snapshot to `6ba4ed6` | Done | merged (PR [#108](https://github.com/3x6th/taska-ui/pull/108)), 2026-10-26, against the mock; filed the same day on the owner's word («заведи фронтовую задачу под TAS-384 и доведи до влитого PR»). Verdicts: release-reviewer and art-director APPROVE WITH NOTES, api-contract-guard NOT BLOCKED, all on `9178621`. Not run on the stand with a token: the move and mapping steps need the refusal's `details` to reach the gateway (TAS-427). Out of scope: editing from the diagram; no route changes the issue types of an existing workflow (BACKLOG) |
| [TAS-427](https://jira.ozero.dev/browse/TAS-427) | workflow-service + api-gateway after TAS-384: an identifiable «issues would be left» refusal (`details.reason`, `targetStatusKeys`, decoded by workflow-service so the keys take one hop), the six routes' refusals in the contract, the edit DTOs' bounds enforced at the gateway, `issueTypes` in list order; questions on the 5000-issue 429 and on issues already outside the workflow blocking a status delete | To Do | backend ask, filed 2026-10-26 from `api-contract-guard`'s TAS-416 review; read at develop `6ba4ed6`, not probed (no token). Removal of API-DIVERGENCE «Workflow deletes: the "issues would be left" refusal…» and «The gateway does not enforce the workflow edit DTOs' bounds…». Not blocking TAS-416: without the keys the UI shows the plain refusal |
| [TAS-417](https://jira.ozero.dev/browse/TAS-417) | The frontend for backend PRs [#212](https://github.com/VladislavYurin/taska-backend/pull/212) and [#226](https://github.com/VladislavYurin/taska-backend/pull/226) (TAS-385, TAS-386): an Issue types dialog (ADMIN adds, renames, recolours, reorders, deletes an unused type), a type's name, colour and icon from the project's registry everywhere, registry order, changing an issue's type in the panel; widened on 2026-10-26 to the rest of develop `af41c322` in one pass — board columns with `totalCount`/`hasMore` (TAS-392), history authors from `actor` (TAS-398), `LAST_ADMIN` and the stable project order (TAS-394) — and the TAS-387 Telegram tail; snapshot to `af41c322` | In Progress | filed 2026-10-26 on the owner's word («как другая сессия доделает воркфлоу, начинай делать что уже сейчас есть, 386 только что влили»); blocked by TAS-385, TAS-386 and TAS-416 (merged as PR #108). Pre-build: `api-contract-guard` design and `art-director` ruling (APPROVE WITH NOTES), reconciled by the orchestrator; DESIGN.md amended first (§4.30 new). Started after TAS-416 merged Built in two builder rounds (`65242e3`, `1c75409`); `npm run check` and `npm run build` green; one review round on `1c75409`: api-contract-guard, art-director and release-reviewer all APPROVE WITH NOTES, no blockers; DESIGN.md §5.9 / §4.28 and API-DIVERGENCE / BACKLOG updated from their notes. Next: the stand run with the owner (registry write path on a throwaway project, the three PAT probes), then the PR |
| [TAS-418](https://jira.ozero.dev/browse/TAS-418) | project-service + issue-service + api-gateway after TAS-385/386: an atomic reorder route, `details.reason` on the two delete refusals, a usage count of live issues only, deleting a type unbinds its workflows, type name/colour/icon on search hits, and four smaller contract points | To Do | backend ask, filed 2026-10-26 from `api-contract-guard`'s TAS-417 design (A1–A9); relates to TAS-417. No frontend compensation: the dialog limits honestly where these are missing |
| [TAS-432](https://jira.ozero.dev/browse/TAS-432) | project-service + api-gateway: an issue type gets a `shape` (square, circle, diamond) and an optional `icon`; built-ins back to the plain look (TASK and STORY square, BUG circle, no icon) | In Progress | filed 2026-10-27 from the owner's stand look at TAS-417 («стало хуже и грязнее … верни как было»), diamond added on his word; **built in this session on the owner's word** («на беке можешь просто в этой сессии сделать»), branch `feature/TAS-432-issue-type-shape` in taska-backend |
| [TAS-433](https://jira.ozero.dev/browse/TAS-433) | Delete an issue type that has issues by moving them to another type (with a status mapping), one operation | To Do | backend ask, filed 2026-10-27 on the owner's word («с переносом пока ладно, заведи только задачу»); deleting the issues with the type is not asked for |
| [TAS-434](https://jira.ozero.dev/browse/TAS-434) | The frontend for TAS-432: the 14 px type chip again — a filled square, circle or diamond, or the type's icon instead of the shape; Shape and «No icon» in the Issue types form | In Progress | filed 2026-10-27; art-director's ruling applied to DESIGN.md first (§2.2, §2.5, §2.7, §4.6, §4.30, §5.5, §9); merges after TAS-432 is deployed |
| [TAS-160](https://jira.ozero.dev/browse/TAS-160) | admin-service + api-gateway: the admin audit log read, `GLOBAL_ADMIN` only | Done | backend ask, filed 2026-08-10; the frontend's Audit section came in TAS-251 against PR #172, which closed unmerged. **Merged** as backend PR #197 (`398285c`, head `3eafb22`) on 2026-10-19 and deployed 13:50 UTC; probed the same day: 401 without a token (`9d6a0516-cf73-4df9-af9f-800742e9899d`), a non-UUID `actorUserId` 400 at the edge (`f36a35a8-c11e-4c16-8eb9-837e29646ce1`), with a `GLOBAL_ADMIN` token 200 with 21 entries, honest paging (`pageSize=2` → 11 pages), `id` on every entry, `oldValue`/`newValue` as JSON text (`cce232bf-4373-4b9b-84e3-d51c9c188262`); the deployed Audit section shows pages 1 of 2 and 2 of 2 without a change. Tail in TAS-265: `id` as the row key, the pr-172 extract deleted, the divergence entry re-rooted, snapshot refreshed. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переведи … в Done с комментарием о мерже и замере, как делал с предыдущими тринадцатью»), with a comment naming the merge and what was probed |
| [TAS-255](https://jira.ozero.dev/browse/TAS-255) | `GET /projects/{id}/context`: a non-member gets 403 whatever the global role, never empty lists in place of a refusal | Done | backend ask; rewritten 2026-10-19 to the owner's 403 rule. **Merged** as backend PR #186 (`055d01b`) on 2026-10-19 and deployed; the mock followed in TAS-263. Not probed (the probing account is a member of every project). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-232](https://jira.ozero.dev/browse/TAS-232) | admin-service: an equals filter on a UUID column answers INTERNAL | Done | backend ask. **Merged** as backend PR #184 (`a7beea5`) on 2026-10-19 and deployed; probed: canonical id 200, `1-1-1-1-1` 400, `contains` 400 with the mock's exact sentences (`aa900e4a…`, `9d5d2fea…`, `3bff2518…`). Frontend: TAS-263. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-234](https://jira.ozero.dev/browse/TAS-234) | issue-service: unwatch removes the watcher but answers `removed=false` | Done | backend ask. **Merged** as backend PR #188 (`0330028`) on 2026-10-19 and deployed; no frontend change needed. Not probed (needs a write). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-235](https://jira.ozero.dev/browse/TAS-235) | observability: stage logs in Grafana are labelled `environment=local` | Done | backend, infra only. **Merged** as backend PR #192 (`19d5d25`) on 2026-10-19; nothing for the frontend. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-218](https://jira.ozero.dev/browse/TAS-218) | Search hits carry `projectId`, `projectKey`, `statusKey`; an unknown filter value answers an empty list | To Do | backend ask, epic TAS-210; carries the TAS-180 decision of 2026-09-11. **Measured 2026-09-23**: since TAS-168 an unknown `priority` answers `400 INVALID_ARGUMENT` before authentication, contradicting that decision; the ticket's "as is" now says so |
| [TAS-240](https://jira.ozero.dev/browse/TAS-240) | The gateway answers CORS preflight without `Access-Control-Max-Age`, so every sequential round of reads costs two exchanges | Done | backend ask, filed 2026-09-23 from the TAS-210 loading analysis, epic TAS-210. Measured: `OPTIONS` from `taska.ozero.dev` returns no max-age; `CorsConfig` never calls `setMaxAge`. One property, default 7200 (Chromium's cap). **Merged** as backend PR #189 (`7d4f739`) and **deployed** 2026-10-19; probed the same day: `OPTIONS /api/v1/users/me` with `Origin: https://taska.ozero.dev` answers 200 with `access-control-max-age: 7200`, and `ETag` joined `X-Request-Id` in `access-control-expose-headers`. The browser keys its preflight cache per origin and per URL, so first paint still preflights every route it reads; the saving is on later rounds to a URL already preflighted within two hours. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-241](https://jira.ozero.dev/browse/TAS-241) | issue-service drops finished issues from the board by the literal status key `DONE`, not by status category | Done | backend ask, filed 2026-09-23, epic TAS-210. `IssueRepositoryImpl.java:373`; the gateway already reads the workflow for the columns and can pass the DONE-category keys. The hard-coded-status pain surviving on the server. **Merged** as backend PR #202 (`a864b50`) and deployed 2026-10-19 17:56 UTC; not probed. Frontend (mock board by category): TAS-297 |
| [TAS-242](https://jira.ozero.dev/browse/TAS-242) | The issue panel's five sections start their reads with the issue instead of after it; a skeleton replaces the "Loading issue" line | Done | merged (PR #75) on 2026-09-23. Filed from the TAS-210 loading analysis the owner's `/v2` question started; epic TAS-210, no backend dependency. The second round was self-inflicted by the `if (!issue)` guard: each section's query options moved into one factory and `IssuePanel` prefetches all five beside the issue read. The part nobody asked for was measured, not guessed: react-query re-asks an errored read for every observer that mounts on it, so a section that failed before the issue answered went out twice until `retryOnMount: !prefetched` — and `release-reviewer` showed the first test only bound that for watchers, so it now runs over all five. `art-director` blocked on the one thing the screenshots made easy to miss: `--surface-2` on the panel's `--surface` is a step *down* in dark, 1.04:1, so the loading panel looked empty where `main` had shown words; the fill is `--surface-3` and `DESIGN.md` §2.1, §5.6 and §4.10 now say why. `api-contract-guard` approved on its third run (two stalled). Deliberately out: the board's duplicate project read, left for TAS-212/TAS-202. Found on the way and pre-existing: a mock deep-link reload that never settles, and a panel with no `Esc` or focus trap — both in `BACKLOG.md` |
| [TAS-196](https://jira.ozero.dev/browse/TAS-196) | The three admin writes are deployed; retire the undeployed-route compensation and refresh the contract snapshot | Done | merged (PR #50) |
| [TAS-193](https://jira.ozero.dev/browse/TAS-193) | Issue watchers — the toggle, the count, the list **and** the two project-`ADMIN` routes the story had deferred | Done | merged (PR #56) |
| [TAS-194](https://jira.ozero.dev/browse/TAS-194) | Retry an outbox event from Events, and retire the TAS-105 summary compensation with it | Done | merged (PR #54) |
| [TAS-200](https://jira.ozero.dev/browse/TAS-200) | The summary calls an event stuck five minutes before retry will accept it | Done | backend ask, filed from TAS-194. **Merged** as backend PR #195 (`447a7ed`) on 2026-10-19 and deployed; probed: the summary carries `retryable` (`c28ef6d3-83df-48fb-a4af-821cdc731ea9`). Frontend: TAS-263. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-195](https://jira.ozero.dev/browse/TAS-195) | Drop the N+1 hydration in `listIssues` — the gateway's list DTO is whole issues now | Done | merged (PR #52) |
| [TAS-173](https://jira.ozero.dev/browse/TAS-173) | An unknown enum value from the backend must not blank the screen | Done | **was `Done` without being built** — reopened 2026-09-08, see below. Taken 2026-10-19 together with `GET /meta` (TAS-217): open codes, one label helper, "Other statuses", error boundaries; branch `feature/TAS-173-meta-dictionaries`. **Merged** (PR [#88](https://github.com/3x6th/taska-ui/pull/88), merge `bf5aa3d`) on 2026-10-19 together with `GET /meta` (TAS-217): open codes, one label helper (English only; `/meta` name for an unknown code only when it has no Cyrillic — removal TAS-264), "Other statuses", error boundaries on the app, panel, card and search hit. Verdicts: `api-contract-guard` CHANGES_REQUIRED (two compensations without an entry) → APPROVE_WITH_NOTES on `73a3f04`; `art-director` and `release-reviewer` APPROVE_WITH_NOTES. CI green (unit 1426, e2e 631) |
| [TAS-197](https://jira.ozero.dev/browse/TAS-197) | `GET /users/me` answers `UNSPECIFIED` for a locked account | Done | backend ask, filed from TAS-196. Merged as `04546f1` through `c7ff2a3`; its own stage deploy failed in Dokploy at 08:28 UTC on 2026-10-07, and it reached the stand with the `60d62ee` deploy that afternoon. Not observed with a locked account's token. Frontend: comments only, in TAS-246; the `LOCKED` pill is still a `BACKLOG.md` line |
| [TAS-198](https://jira.ozero.dev/browse/TAS-198) | A locked account keeps access on a pre-lock token, and `refresh` renews it | In Progress | backend ask, filed from TAS-196. Backend PR #174 open (2026-10-07) |
| [TAS-221](https://jira.ozero.dev/browse/TAS-221) | Avatar confirm trusts any `objectKey`: one user can delete another's avatar, and a same-key re-confirm destroys one's own | Done | backend ask, High, filed from TAS-220 on 2026-09-14 from a read of `develop` `368ae77` — it was to be fixed before PR #150 deployed, and PR #150 deployed first (13:53 UTC measurement). **Merged** as backend PR #198 (`b3677a0`) on 2026-10-19 and deployed (deploy-stage green 13:11 UTC); not probed — a write route, and a probe would mutate a real avatar. Frontend: TAS-265 (the mock's ownership rule). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переведи … в Done с комментарием о мерже и замере, как делал с предыдущими тринадцатью»), with a comment naming the merge and what was probed |
| [TAS-222](https://jira.ozero.dev/browse/TAS-222) | An avatar over 2 MB answers 500 while the schema promises 5 MB; `upload-url` declares 200 and answers 201 | Done | backend ask, filed from TAS-220 on 2026-09-14; first raised on TAS-129 on 2026-09-12 and unanswered. Merged as `be6ea7f` and deployed 2026-09-30: the schema says 2097152, so the gateway refuses an over-2 MB avatar with `400 INVALID_ARGUMENT` before auth-service's avatar call, and `upload-url` answers `200`. Frontend: TAS-246 deleted the declared 5 MB constant |
| [TAS-223](https://jira.ozero.dev/browse/TAS-223) | `GET /users/me` carries the current user's avatar | Done | backend ask under epic TAS-210, filed from TAS-220 on 2026-09-14 — TAS-129's own unmet acceptance criterion. **Merged** as backend PR #193 (`b88150f`; follow-up `3bd33ca`) on 2026-10-19 and deployed; probed: `/users/me` carries `avatar` and `avatarUnavailable` (`0f9c038b-d0d5-458f-98b0-adb3af15d13f`). Frontend: TAS-263. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-220](https://jira.ozero.dev/browse/TAS-220) | The current user's avatar — upload, replace, delete, and drawing it wherever initials are today (backend PR #150) | Done | merged (PR #67) on 2026-09-14 at the owner's word. Written against backend PR #150's head `12e909d42dcc`, which merged unchanged into `develop` (`368ae77`) and deployed the same afternoon (404 at 11:14 UTC, 400/405 at 13:53 UTC). `api-contract-guard` (two blockers) and `art-director` (three) were fixed and re-verdicted closed; `release-reviewer` approved both passes. One reproduced race is accepted for speed and first in line: an avatar write drops member/summary refreshes already in flight (`BACKLOG.md`). Backend defects filed as TAS-221, TAS-222 and TAS-223, and PR #152's missing member avatar raised on TAS-137. No real upload from taska.ozero.dev has been made yet |
| [TAS-219](https://jira.ozero.dev/browse/TAS-219) | The member read and `currentUserRole` from the gateway — the frontend half of TAS-137 (backend PR #152) | Done | merged (PR #65). Written against `docs/contract/pending/pr-152-TAS-137.yml` while PR #152 is open, so nothing in it reaches the stand until that merges. `api-contract-guard` found one blocker — the claim that `GET /projects` does not carry the role — and it is corrected in `API-DIVERGENCE.md` rather than quietly fixed |
| [TAS-224](https://jira.ozero.dev/browse/TAS-224) | TAS-137 deployed: `HybridTaskaApi` stops synthesising the members and the role, `VITE_TASKA_ASSUME_PROJECT_ADMIN` goes, and the snapshot moves to develop `1cfe4d7` (PR #152 and PR #147) | Done | merged (PR #68) on 2026-09-16. Measured without a token at 12:34 UTC: `…/members` 401 (405 on 2026-09-12), `…/attachments` 401, `/users/me` 401. The flag is removed from all five places, the repository variable included. `api-contract-guard` did a research pass, then gave one blocker (that variable, closed by it) and three notes, all closed. `release-reviewer` approved with notes, which went to `BACKLOG.md`. The member avatar that PR #152 declares and never fills, and the whole-read failure one bad avatar object causes, are filed as TAS-225. Nothing was verified on the stand with a session |
| [TAS-226](https://jira.ozero.dev/browse/TAS-226) | The issue panel offered a VIEWER two writes issue-service refuses — Watch, and being chosen as assignee — and a `200` with no `currentUserRole` silently became VIEWER | Done | merged (PR #69) on 2026-09-17. Filed 2026-09-16 from three `release-reviewer` notes on TAS-224, which graduated out of `BACKLOG.md`. Server rules read at `develop` `1cfe4d7`, as environment-variable defaults: `watch-issue-roles` and `assign-issue-roles` are both `ADMIN,MEMBER`, the second checked for the assignee too unless actors assign themselves. `release-reviewer` raised one blocker: two false claims about the server, one of them from the orchestrator's own brief. `api-contract-guard` raised two: the DELETE watcher route reads its target from the path, and the divergence entry had no removal key, which is how [TAS-228](https://jira.ozero.dev/browse/TAS-228) was filed. `art-director` raised none in the UI and accepted `DESIGN.md` with four replacements. All three closed their own findings and approved with notes, which went to `BACKLOG.md`. Evidence is from the mock; nothing was verified on the stand with a session |
| [TAS-228](https://jira.ozero.dev/browse/TAS-228) | `openapi.yml` states the roles on the `…/watchers/me` pair, on the assignee route, and on the two ADMIN watcher routes, where issue-service lets a MEMBER add or remove themselves although the contract says ADMIN only | Done | backend ask, filed 2026-09-17 from `api-contract-guard`'s TAS-226 verdict; removes the divergence entry TAS-226 added. Read at `develop` `1cfe4d7`, not probed. **Merged** as backend PR #194 (`95b1f35`; head `a33ed5d`) on 2026-10-19; contract text only, checked against the snapshot in TAS-263. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-158](https://jira.ozero.dev/browse/TAS-158) | Project members from the board: a Members dialog where a project ADMIN adds a person by exact user ID, changes a role and removes a member; everyone else reads the list | Done | merged (PR #70) on 2026-09-17. By the owner's decision on 2026-09-16 the add takes an exact user ID until [TAS-204](https://jira.ozero.dev/browse/TAS-204) brings search, and the same field becomes that search. Measured without a token on 2026-09-16 at 21:37 UTC: POST, PATCH and DELETE on the member routes answer 401, PUT 405. Built in a worktree beside TAS-226's session and rebased onto it. `release-reviewer` raised one blocker: an admin row under an ID nobody holds let the only real admin step down. `api-contract-guard` raised three, all false statements (the role 400's source, the no-account row's wire shape, the removal plan), which produced [TAS-229](https://jira.ozero.dev/browse/TAS-229) and an amended TAS-227. `art-director` raised two (the strip's edge in dark, a notice out of view) and adopted §4.22 with changes. Each role closed its own findings and approved with notes, which went to `BACKLOG.md`. Evidence is from the mock; nothing was verified on the stand with a session |
| [TAS-227](https://jira.ozero.dev/browse/TAS-227) | Adding a member accepts an ID no account holds: 201, and the member read then carries an empty name and email | To Do | backend ask, filed 2026-09-16 from TAS-158 and amended 2026-09-17 to ask for `400 INVALID_ARGUMENT` rather than a 404 the dialog would read as a missing project. Read at `develop` `1cfe4d7`, not probed. Removes the TAS-158 divergence entry, but the dialog's stricter last-admin count stays until no ADMIN row without an account remains |
| [TAS-229](https://jira.ozero.dev/browse/TAS-229) | Member role change and removal check the target before the actor, so 404 against 403 tells anyone signed in whether a person is on a project | Done | backend ask, filed 2026-09-17 from `api-contract-guard`'s TAS-158 verdict. The mock mirrors the current order; the swap changes the mock, `TaskaApi.ts` and one test. Read at `develop` `1cfe4d7`, not probed. **Merged** as backend PR #185 (`ace2484`) on 2026-10-19 and deployed; the mock's check order followed in TAS-263. Not probed (needs a write). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-233](https://jira.ozero.dev/browse/TAS-233) | A comment showed `edited` the second it was posted, because the badge read any non-null `updatedAt` as an edit and the server stamps one on insert | Done | merged (PR #71) on 2026-09-22. Filed 2026-09-18 by the backend from run `E2E-20260918-CODEX02`, one of six that day and one of two on this repository. Root cause read at `develop` `1cfe4d7`, which is the stand's own `GIT_COMMIT`: `createdAt` is `@CreatedDate` and `updatedAt` is `@LastModifiedDate` under `@EnableR2dbcAuditing`, so one `touch()` writes both on insert and an untouched comment carries equal stamps, not an empty one. The badge now needs `updatedAt` strictly later than `createdAt`; `version` stays out of the predicate and appears in the tests as an independent witness. **The mock was the reason this was invisible here** — its comment factory set `updatedAt: null`, a shape the gateway never sends, and no test touched the badge at all. `release-reviewer` raised one blocker, and it was the orchestrator's: `DESIGN.md` still specified the deleted predicate in two places, which under CLAUDE.md's authority order outranks the story and is very likely where the defect came from. `api-contract-guard` raised none and verified every citation against the backend. Two of its notes were taken — the entry overstated `updated_at > created_at` as a guarantee when it is two clocks wide, and "observed on the stand" described a database row, not the gateway's JSON. Five deferred notes went to `BACKLOG.md`, each with why. Carried one unrelated configuration commit: lint and Vitest could not run in a checkout that had hosted a review. Evidence is from the mock; **the badge has never met the real gateway** |
| [TAS-236](https://jira.ozero.dev/browse/TAS-236) | A VIEWER gets `New`, the transition buttons and `Delete` rendered and disabled, where `DESIGN.md` §5.7 says to hide them — while the comment composer on the same screen hides correctly | Done | frontend, filed 2026-09-22 from `art-director`'s TAS-231 verdict, where it was explicitly out of scope. Confirmed on `origin/main` by reading the three call sites, not only from the review: `BoardScreen.tsx:532`, `:1461` and `:1427` all gate with `disabled={!canEdit}`, while `:3671` gates the composer with a ternary. So the technique is already in the file and applied inconsistently. Not a TAS-226 regression — that story closed a different §5.7 clause, the watch toggle and the response with no role, and never touched this one. **Merged** (PR [#90](https://github.com/3x6th/taska-ui/pull/90), merge `69c4380`) on 2026-10-19 with TAS-236, TAS-259 and TAS-192 together. Verdicts: `art-director` CHANGES_REQUIRED (DESIGN.md text described behaviour the code does not have) → APPROVE WITH NON-BLOCKING NOTES on `4b794aa`; `release-reviewer` and `api-contract-guard` APPROVE_WITH_NOTES; CI green |
| [TAS-231](https://jira.ozero.dev/browse/TAS-231) | Reported as "the start and due dates never reach the create request"; the dates serialize correctly at every layer, and what was real is that two surfaces discarded a date the reader had entered and said nothing about it | Done | merged (PR #73) on 2026-09-22. Filed 2026-09-18 by the backend from run `E2E-20260918-CODEX02`, the second of two on this repository that day. **The story's diagnosis is wrong and the branch deliberately does not act on it**: `api-contract-guard` read all five hops at the stand's own commit (contract create schema, the generated DTO from the single spec, `IssueController`, `IssueMapper:424-428` line-for-line identical to the update mapping, the proto's `optional string start_date`, `IssueServiceImpl`), and `release-reviewer` found `RestTaskaApi.test.ts:2935` already pinning `startDate` on the create wire body. The stand was not running an old UI either — the Pages CNAME is `taska.ozero.dev` itself and the live build during the run post-dated TAS-189 by six days. The real defect: the panel reverted a half-typed date on blur with zero `.form-error` and zero `[role=alert]`, and the create modal had no `badInput` guard at all, so the browser blocked its own submit with a native tooltip and the app stayed silent. One rule now answers both surfaces in the app's own voice. **Three rounds of blocking findings, each a further instance of one class — a message made invisible or wrong.** `art-director` found the first two: the new notice outranked three of the four write errors, so a refused transition, assign or delete became silent; and the create sentence was false whenever the other date was filled. `release-reviewer` found the third, which two prior passes had cleared: the notice sits above `.modal-actions`, so blur mutated the slot on `mousedown` and the row moved between press and release — the corrective press was swallowed **and** the notice removed in the same frame, which is this story's own headline symptom one interaction later. The orchestrator's fix for it (blur may raise, never withdraw) then created a fourth, found by `art-director`: a stale imperative standing over a field that had become valid, with `aria-invalid` on it, and the mark landing on the one date that was fine. Closed by `relaxDates` — typing lowers, blur raises — with the mark carried separately from the line. Every blocker was closed by the role that raised it, each on evidence it produced itself rather than on the builder's account; `release-reviewer` measured that no fourth swallow exists by holding a key down across a press and showing `keyup` never reaches the date box. Two BACKLOG entries correct claims this session got wrong, one of them the orchestrator's: the swallowed Cancel press is **introduced** by this story, not inherited. Accepted and shipped: the first press after a half-typed date is still lost, the reload criterion is untestable on the mock by construction, and **nothing here has met the real gateway** |
| [TAS-237](https://jira.ozero.dev/browse/TAS-237) | The sign-in screen showed a locked account a raw UTC `Instant` with microseconds, in one run-on line | Done | merged (PR #74) on 2026-09-22. Handed over by the owner mid-session. The sentence is built by string concatenation at `AuthServiceImpl.java:235-238`, and `api-contract-guard` established the fact that shapes the whole story: a search across **every production source in the backend** for `withDetails`, `ErrorInfo`, `com.google.rpc` and `Metadata.Key` returns nothing — every error in the system is a `Status.withDescription(String)` and `RestErrorResponse` is `{code, message}` in both the handwritten contract and `/v3/api-docs`. So parsing the prose was the only route, and the parser keys on the ISO substring rather than on the words, with the fraction optional because `Instant.toString()` emits 0/3/6/9 digits. The branch is chosen on `403 PERMISSION_DENIED`, which the guard proved means nothing but "locked" on this PUBLIC route by exhausting every other refusal in the method. **The mock could not produce the shape**, so the branch would have shipped unexercised exactly as TAS-233 did; it now refuses a `LOCKED` user the gateway's way. `release-reviewer` approved with no blockers and caught that the unit tests written to catch a hard-coded `+3` **cannot fail in a `+3` timezone** — only the `America/New_York` e2e held the line. `art-director` blocked on the deeper half of the same class: `Intl.DateTimeFormat(undefined, …)` hands over not the zone but the whole locale, and `fa-IR` printed a **Solar Hijri** date inside an English sentence in an `<html lang="en">` document. Pinned to `en-US` with the zone left to the runtime, which changed no recorded string — the entire evidence set had been captured in an `en-US` browser and so never exercised the departure. Two backend asks filed: [TAS-238](https://jira.ozero.dev/browse/TAS-238) and [TAS-239](https://jira.ozero.dev/browse/TAS-239). **Nothing here has met a real gateway 403** |
| [TAS-238](https://jira.ozero.dev/browse/TAS-238) | The attempt that locks an account answers `UNAUTHENTICATED "Invalid credentials"`, so the lock is announced one attempt later | Done | backend ask, filed 2026-09-22 from `api-contract-guard`'s TAS-237 reading. `AuthServiceImpl.handleFailedAttempt:284-315` sets `LOCKED` and `lockedUntil`, then errors as a plain bad password at `:314`. The client cannot compensate: that response is byte-identical to a wrong password. Service layer, `auth-service` only — no contract, no proto, no gateway — and the cheaper of the two asks. **Merged** as backend PR #187 (`42bf5e5`) on 2026-10-19 and deployed; read in code, not probed (a wrong-password probe would change a real account's lock state). Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переводи статус, да»), each with a comment naming the merge and what was probed |
| [TAS-239](https://jira.ozero.dev/browse/TAS-239) | The error envelope carries no machine-readable detail, so a deadline exists only inside an English sentence | Done | backend ask, filed 2026-09-22; the removal key for TAS-237's divergence entry. Three priced shapes; the one that decides the cost is that **no `.proto` changes** — gRPC trailers are not declared in proto, while `google.rpc.ErrorInfo` would drag in `StatusProto` and its descriptors. Deliberately **not** filed under epic TAS-210: that epic collapses per-screen reads, and this is the envelope every service shares — `FAILED_PRECONDITION` and `ABORTED` lose their structure the same way. **Merged** as backend PR #199 (`e82ed6b`) on 2026-10-19 and deployed with `b3677a0`; probed: the envelope carries `details` on 401 and 400 (`9d6a0516-cf73-4df9-af9f-800742e9899d`); `lockedUntil` in `details` not probed (needs a throwaway account). Frontend: TAS-265. Moved to `Done` by the orchestrator on 2026-10-19 at the owner's word («переведи … в Done с комментарием о мерже и замере, как делал с предыдущими тринадцатью»), with a comment naming the merge and what was probed |
| [TAS-247](https://jira.ozero.dev/browse/TAS-247) | CI in about five minutes: typecheck, lint, unit tests and build beside a four-shard e2e matrix, one `check` gate that always reports, docs-only PRs skip e2e; and the `labels.spec.ts:242` flake | Done | **merged (PR [#78](https://github.com/3x6th/taska-ui/pull/78))** on 2026-10-08. Handed over by the owner with the measurement already taken: 16.5 min, 13.6 of it e2e on two workers. First sharded run 3m24s to `check` (run 37684446678), 535 executed and 41 skipped as before. `npm run check` unchanged; `check` is not a required status yet — that is a ruleset change for the owner. See the section below |
| [TAS-249](https://jira.ozero.dev/browse/TAS-249) | The e2e shards run in Playwright's own image at the lockfile's version — no apt, no browser download per run | Done | **merged (PR [#81](https://github.com/3x6th/taska-ui/pull/81))** on 2026-10-08, at the owner's word, graduated from TAS-247's BACKLOG line. Five runs, twenty shards: container start 25–39s, `check` at 205–211s every time, against apt's 17–403s and 194–522s on the same count. Not faster on a good run — the gain is the tail. See the section below |
| [TAS-253](https://jira.ozero.dev/browse/TAS-253) | Attachments: Open and Download as two explicit actions instead of the false "browser blocked" notice (`window.open` with `noopener` always returns `null`), drag-and-drop to attach | Done | **merged (PR [#83](https://github.com/3x6th/taska-ui/pull/83))** on 2026-10-11. Filed that day from the team's feedback after TAS-244 merged. Measured with admin's session, GET only: object-store GET passes CORS from `taska.ozero.dev` with no `Content-Disposition`; `/users/{id}/avatar` has a photo while every member row has `avatar: null` (comment on TAS-225). Avatars dropped from scope by the owner: no frontend compensation, TAS-225 fixes it, and `AGENTS.md` gained *No compensations for the backend*. `TaskaApi.getAttachmentBytes` is a non-gateway leg with `ObjectStoreError`. `DESIGN.md` §4.25 (4.24 is TAS-251's). Verdicts: `release-reviewer`, `api-contract-guard`, `art-director` approved with notes, no blockers; notes taken in `8750596`/`2d594fd` or in `BACKLOG.md` under *Left by TAS-253*. Not measured: Safari, Firefox, a real OS drag |

Two rows disagree with themselves. `TAS-134` and `TAS-136` are `To Do` in Jira
while their code exists — see the record in `HARNESS.md`. Trust the repository
column for what is built and Jira for what was agreed; when they disagree,
the story has drifted and should be transitioned rather than the table edited.

## Blocking dependencies outside this repository

| Key | Blocks | Effect on the UI |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) | nothing any more — deployed 2026-09-16 | Was: no project membership or member reads, compensated by `hybrid` plus `VITE_TASKA_ASSUME_PROJECT_ADMIN`; on 2026-09-10 `GET /projects/{id}/members` answered `405` and `…/membership` the static-resource `404`, on the reader's own project and on a foreign one. **Merged** as backend PR #152 (`develop` `1cfe4d7`, 2026-09-16) and **deployed the same day**: without a token `GET …/members` answers `401`, with `GET /users/me` beside it as the control. `…/membership` still answers `404` and is not coming, because the role is `currentUserRole` on the project read. The compensation and the flag come out in TAS-224. `GetUserDetailsByIds` is the first read of users by id anywhere in the system, and TAS-212, TAS-213 and TAS-214 stand on it. |
| [TAS-139](https://jira.ozero.dev/browse/TAS-139) | nothing any more — measured fixed | Was: `GET /api/v1/issues/{issueId}` returns 500 once an issue has a comment; via the list hydration this made the whole board fail against live data. Probed 2026-09-08: three issues carrying 1, 1 and 4 comments each answered `200` with history, one of them carrying a label as well. The multiplier is gone too — TAS-195 removed the hydration. Backend story; its status is the backend owner's to move. |
| [TAS-141](https://jira.ozero.dev/browse/TAS-141) | several UI affordances | Contract gaps: read-all, nullable assignee, comment ordering, CORS-exposed `X-Request-Id`, 404-on-empty-projects bug. **Closed 2026-09-04 in Jira with these gaps still open.** The empty-projects clause is re-filed as TAS-207; the CORS half is measured done (`API-DIVERGENCE.md`); the rest are unowned and need re-filing before anyone quotes this row as live work. **Re-filed 2026-09-11, so this row stops being the owner of anything:** read-all is TAS-216, the nullable assignee is TAS-215, comment ordering is TAS-206, the empty list is TAS-207 and TAS-211. The `accept`-without-a-session clause is TAS-204 with TAS-208 as its frontend half. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) | nothing any more — measured live | Was: the route's gRPC method was declared and unimplemented, so a deployed gateway would answer `501 UNIMPLEMENTED`, and PR #118 was CHANGES_REQUESTED besides. Both landed — PR #142 on 2026-09-07, PR #118 on 2026-09-09. Probed 2026-09-09 with a signed-in token: `GET /projects/{id}/board?issueType=TASK` answers `200` with columns in workflow order, `includeDone` filters issues and not columns, `assigneeId` and `labelId` filter server-side, and `EPIC` is a correct `400`. `TaskaApi.getBoard` exists in all three implementations (TAS-191); the board screen still composes its own board, for the two reasons that outlived the merge. |
| [TAS-124](https://jira.ozero.dev/browse/TAS-124) / [TAS-125](https://jira.ozero.dev/browse/TAS-125) | ~~removing the N+1 board hydration~~ — **nothing any more** | **Withdrawn (TAS-191).** The board API does not cover the list-DTO gap: `BoardIssueDto` has no description and no `createdAt` either, and gives status only as a column position, so the detail read stays. What may remove it is `ListIssuesResponseDto.items` becoming `IssueResponseDto`, which it already has on `develop` — that wanted one measurement against the deployed gateway rather than a contract reading — **taken 2026-09-08, and the hydration was removed by [TAS-195](https://jira.ozero.dev/browse/TAS-195)**. |
| [TAS-145](https://jira.ozero.dev/browse/TAS-145) | [TAS-148](https://jira.ozero.dev/browse/TAS-148) | No `PATCH /projects/{id}`, no `description` column and no `color` column. Until it ships, editing a project is mock-only. Widened 2026-08-21 to carry a nullable `color`, which is what makes the project half of TAS-171's compensation removable; the avatar half has no such story and is not meant to. |
| [TAS-129](https://jira.ozero.dev/browse/TAS-129) | nothing any more — deployed 2026-09-14 | Avatar upload through the gateway (presigned URL to MinIO), on top of TAS-128. **Done in Jira and merged** (backend PR #150, `develop` `368ae77`, 2026-09-14), and **deployed the same afternoon**: the routes answered the static-resource 404 at 11:14 UTC and 400/405 at 13:53 UTC, while both runs of the backend's new stage-deploy workflow failed on empty Dokploy secrets. It merged with three defects filed as their own tickets — [TAS-221](https://jira.ozero.dev/browse/TAS-221) (confirm trusts any `objectKey`, High — now live on the stand), [TAS-222](https://jira.ozero.dev/browse/TAS-222) (5 MB declared, 2 MB enforced, 3 MB answers 500) and [TAS-223](https://jira.ozero.dev/browse/TAS-223) (its own acceptance criterion: no avatar on `GET /users/me`). Still the base under the computed avatar colour in `API-DIVERGENCE.md`'s colour entry. |
| [TAS-146](https://jira.ozero.dev/browse/TAS-146) | [TAS-149](https://jira.ozero.dev/browse/TAS-149) | Nothing sets `archived_at`, so archiving is mock-only and the read-only board state cannot be exercised against the gateway. |
| [TAS-381](https://jira.ozero.dev/browse/TAS-381) | nothing any more — deployed 2026-10-22 | Was: no route listed a project's workflows or wrote one. Backend PR #208 merged as `594f637` and deployed 08:04Z; probed: list 200 with the shared default's six transitions, context 200 (`1c2edc96-…`, `185be0ce-…`). Two remarks not taken in #208 stay open on TAS-381: an empty workflow 404s the context, and the default TODO→DONE transition is named «Close», now visible beside the issue panel's close icon. |
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
- `mock` and `rest` remain behaviourally interchangeable, including on the
  rejection of a short query.
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
- `mock` and `rest` stay behaviourally interchangeable; the mock reproduces
  every one of the server's refusals.
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
`HybridTaskaApi` synthesised exactly the two methods that describe *somebody
else's* membership, so removing the synthesis without a way to create a second
membership would remove the compensation and leave nothing to check under it —
`VIEWER` would stay unreachable, and `DESIGN.md`'s own warning about that would
survive the deletion. A definition whose acceptance criterion sits in a story
ranked below it is not a definition.

**Core, and why each is in it.**

| Key | What breaks without it | Evidence |
| --- | --- | --- |
| [TAS-137](https://jira.ozero.dev/browse/TAS-137) + the acceptance note added to it | the member read lands carrying ids, and the board draws a column of uuids instead of the occasional "Unknown" | read — the DTO's shape is contract, the column of uuids is what follows from it, and nobody has seen it because the route answers `405` today. **Superseded 2026-09-12 and landed 2026-09-16:** the read answers with `ProjectMemberDetailsDto`, which carries `displayName` and `email` (TAS-219). It is deployed (`401` without a token), and the stand reads it since TAS-224 |
| [TAS-204](https://jira.ozero.dev/browse/TAS-204) | nobody can be invited, so the member form is a uuid field with nowhere to get a uuid | measured 2026-09-09 — `/users`, `/users/{id}` and `/auth/invitations` all answer the static-resource `404` while `/users/me` beside them answers `401`, which is the control that makes the `404` mean unmapped. `/users/batch` answers the same `404` and is TAS-137's evidence, not this row's, since the batch read moved there |
| [TAS-158](https://jira.ozero.dev/browse/TAS-158) | there is no way to put a person in a project, so role gating stays undemonstrable | read. **Landed 2026-09-17 (PR #70):** a project ADMIN adds a person by exact user ID, changes a role and removes a member from the board. Finding the ID still needs a `GLOBAL_ADMIN` until TAS-204 brings search |
| [TAS-208](https://jira.ozero.dev/browse/TAS-208) | the flow every new person must walk fails three ways, one of them reporting success for the wrong account | read |
| [TAS-207](https://jira.ozero.dev/browse/TAS-207) | a non-member sees another project's workflow; a missing route reads as "you have no projects" | measured — the workflow half **re-measured 2026-09-10 and still reproducing**, with every neighbouring read refusing `403` beside it; the empty-list half recorded 2026-08-03, not re-probed, and not probeable without an account that owns no projects |
| [TAS-198](https://jira.ozero.dev/browse/TAS-198), then [TAS-197](https://jira.ozero.dev/browse/TAS-197) | admin "block" is decorative for anyone holding a token, and the admin screen says otherwise | read. **TAS-197 landed 2026-10-07** (`/users/me` names `LOCKED`); TAS-198 is In Progress with PR #174 open, so a pre-lock token still works |
| [TAS-173](https://jira.ozero.dev/browse/TAS-173) | one unknown enum value still removes a card from a column while leaving it in the count | read |
| [TAS-202](https://jira.ozero.dev/browse/TAS-202), the request-shape half | the projects screen costs 30 requests and the counters describe one loaded page | measured |
| [TAS-209](https://jira.ozero.dev/browse/TAS-209) | the compensation stays, and with it the flag that makes every permission check meaningless | read. The compensation and the flag came out in TAS-224 when TAS-137 deployed; the default mode and the two-account run closed with TAS-209 on 2026-10-24 |

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
   default; `HybridTaskaApi` is deleted. `VITE_TASKA_ASSUME_PROJECT_ADMIN` and the
   member synthesis already came out in TAS-224, on the day TAS-137 answered on
   the stand, because a compensation comes out when what it compensated for
   answers.
   Last, and only when everything above answers.

TAS-214 to TAS-218 make the product better but do not gate the hybrid's
removal; they follow in epic order.

**Amended 2026-09-23: no `/v2`, and one round per screen rather than one
request.** The owner asked whether the epic's reads should go under `/api/v2`.
They do not. There is one client, one environment and a backend that deploys
from one commit, so "add beside, switch the frontend, then remove" inside v1
reaches the same end state without a second DTO and mapper per route. And a
prefix would not have prevented a single break seen so far: TAS-103, TAS-168
and PR #164 all changed existing v1 routes. The expand-contract rule is written
into TAS-210 itself. The owner's own instinct set the second half: several reads
per screen are fine, and what hurt was hardcoded statuses, client-side hydration
and N+1. The analysis behind it measured that the gateway speaks HTTP/2, so
parallel reads cost the client little; that each sequential round costs about
two RTT because preflight carries no max-age (TAS-240 — since 2026-10-19 it
carries `Access-Control-Max-Age: 7200`, probed, but the preflight cache is per
origin and per URL, so first paint still preflights); and that the gateway's
aggregates fail whole, with no `onErrorResume` anywhere. So TAS-211 became a
separate `/project-stats` and TAS-212 a separate `/context`, and a screen is
judged by waterfall depth and by whether its request count grows with data, not
by how many requests it makes. TAS-242 applies the same test to the issue
panel's self-inflicted second round.

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
  returned one element and *succeeded*, so §5.6's boundary — only a successful
  read may claim there is nobody — could not tell a synthesis from an answer. The
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

### TAS-247 — CI in four shards, and what a docs-only PR is allowed to skip

The decision, and the measurements it rests on.

- **Where the 16.5 minutes went** (run 37648512272, 2026-10-07, one job on a
  4-vCPU runner): e2e 13.6 min at "using 2 workers" — Playwright's default of
  half the vCPUs — with `retries: 2`; vitest 2m06s; typecheck 7s; lint 10s;
  build 8s; `npm ci` and Chromium 30s together. Setup was never the problem,
  so caching was not pursued; the suite was.
- **The shape**: `static` (typecheck, lint, unit, build, the `100dvh`
  assertion) beside `e2e (i/4)`, four runners each running
  `npm run test:e2e -- --shard=i/4` at `workers: "100%"`; a `report` job
  merging the four blob reports into one HTML report, on green runs too; a
  `changes` job; and `check`, the one status for all of it. Sharded by
  `--shard`, not by `--project`: `fullyParallel` splits tests evenly
  (144 per shard), where three viewport jobs would fix the count at three.
- **First run on the new shape** (37684446678, this PR): `changes` 6s,
  `static` 2m32s, shards 3m07s / 2m56s / 3m01s / 2m31s, `report` 15s, `check`
  3s — **3m24s from run creation to `check`**, 3m37s with the report. Shards
  summed: 534 passed + 1 flaky = 535 executed, 41 skipped, 576 total — the
  same as the unsharded run, and `release-reviewer` checked that the union of
  the four shards' `--list` equals the unsharded list test for test.
- **`npm run check` stays the local gate, unchanged.** CI no longer runs it as
  one command, so `static` asserts that `check` in `package.json` is still
  exactly `typecheck && lint && test && test:e2e`; a fifth part added there
  fails CI until it gets a step. Its blind spots are in `BACKLOG.md`.
- **Docs-only.** A `pull_request` run diffs the PR's merge commit against its
  first parent (`fetch-depth: 2`, `--no-renames`), which is exactly what the
  merge would add to `main`. If every path is under `docs/` or ends in `.md`,
  the e2e matrix is skipped; `static` always runs, and every push to `main`
  runs everything. Chosen over `paths-ignore` because a workflow that does not
  run reports nothing, and a required check that never reports blocks the PR
  forever. Replayed over the last 40 merges on `main`: the 14 docs-only ones —
  every "record the merge" PR — would have skipped; every PR touching code
  would have run, `.claude/settings.json` included. Nothing in `src/`, `e2e/`
  or the configs reads `docs/` or Markdown at runtime. Not yet seen live: the
  first docs-only PR after this one is its first real run.
- **`check` uses `if: always()`, not `!cancelled()`.** A skipped job satisfies a
  required check, so a cancelled run has to end with `check` red rather than
  skipped. `release-reviewer` ran the gate script over eleven result
  combinations: green only for static ✓ + e2e ✓ when e2e was wanted, and
  static ✓ + e2e skipped when it was not.
- **`check` is not required yet.** `main` has no branch protection and its
  ruleset carries only deletion and non-fast-forward. Requiring `check` is a
  repository-settings change, left to the owner.
- **`workers: "100%"` goes against `BACKLOG.md`'s CPU-contention note**, on
  purpose: the old runs' flakes were all `labels.spec.ts:242`, a test defect.
  The first sharded run had one flake of a different test,
  `notifications.spec.ts:66`; the fallback, if that becomes a pattern, is
  `workers: 3` under CI.
- **The flake** (`frontend-builder`, reproduced independently by
  `release-reviewer`): the sweep's `elementFromPoint` returned null because the
  chip row was below the fold, after a retried first Add press scrolled with
  `block: "end"`. 8/40 → 0/40 on laptop; the spec now scrolls the row into view
  and asserts the band is on screen before asserting anything was hit. Still
  red on a 6px row gap, 9 of 9.
- Smaller decisions: `checkout`/`setup-node` v4 → v6 to match
  `deploy-pages.yml` (clears the Node 20 warning; v7 exists, and both files
  move together); `upload-artifact@v7`, `download-artifact@v8`; Chromium as
  `--only-shell`; superseded PR runs cancel, `main` runs never do; per-job
  `timeout-minutes`, which the old workflow lacked — the last push run on the
  old shape (37680443742, for `2d48901`) sat in "Install Playwright browsers"
  for over 45 minutes and was cancelled by hand.
- **The second run was 6m03s, and not because of the tests** (37686501951, the
  merged head): every shard's tests took 1.8–2.3 min again, but "Install
  Playwright browsers" took 18s / 35s / 1m48s / 3m44s. The slow part is apt —
  `--with-deps` fetching ~21 MB of font packages from the Azure Ubuntu mirror
  at 24 MB/s, 1.9 MB/s, 246 kB/s and 104 kB/s — while the browser download
  itself took 4s. So ~3.5 min is what the suite costs and the rest is mirror
  luck; the follow-up is in `BACKLOG.md` under *Left by TAS-247*.
- Verdict: `release-reviewer`, narrow scope (configuration class), APPROVE
  WITH NON-BLOCKING NOTES, no blockers. One note taken (a workflow comment
  overstated what the merged report holds — reworded); the rest are in
  `BACKLOG.md` under *Left by TAS-247*.
- `npm run check` (535 passed, 41 skipped, e2e 3.0m) and `npm run build` pass
  locally. Neither says anything about CI wall-clock; that rests on the run
  above.

### TAS-249 — the e2e shards in Playwright's image, and what the image does not buy

TAS-247's own second run showed what was left: the suite takes a steady
~2 minutes per shard, and `playwright install --with-deps chromium` took
whatever the runner's Ubuntu mirror felt like for the same ~21 MB of fonts.

- **The change.** The four `e2e (i/4)` jobs run in
  `mcr.microsoft.com/playwright:v<version>-noble` with `--user 1001`, as in
  Playwright's own GitHub Actions example; the install step is gone. The image
  is Ubuntu 24.04 with Node 24, Chromium and its headless shell, and the system
  libraries and fonts from the same `install-deps` list `--with-deps` used.
  `setup-node` inside it still takes the runner's tool-cache Node 24.21.0, the
  same as the `static` job.
- **The version comes from the lockfile**, read in `changes` and fed into the
  image tag, so a Playwright bump moves both in one diff. The drift check the
  BACKLOG line proposed was not built, because there is nothing to drift. The
  cost it leaves: MCR publishes the image hours after npm publishes the
  package — on 2026-10-08 `@playwright/test` 1.64.0 had been on npm for 12
  hours with no amd64 `v1.64.0-noble` — so a bump made too early fails red at
  "Initialize containers" with "manifest unknown". The workflow comment says
  so.
- **No `--ipc=host`.** Docker's advice for Chromium is about `/dev/shm`, and
  Playwright 1.62.1 already launches Chromium with `--disable-dev-shm-usage`.
- **Measured, same method both sides** (from each attempt's start to `check`
  completing; per-job step times from the jobs API):

  | | apt (5 runs, 20 shards) | image (5 runs, 20 shards) |
  | --- | --- | --- |
  | browser + deps / container start, median | 22s | 27s |
  | … slowest shard | 403s | 39s |
  | shards over 60s | 3 (108s, 224s, 403s) | 0 |
  | run start → `check` | 194s, 199s, 204s, 363s, 522s | 205s, 206s, 208s, 211s, 211s |

  apt runs: 37684446678, 37686501951, 37740930973, 37746673180, 37748056775.
  Image runs: 37751438440, and 37752757673 attempts 1–4. The pull itself is
  1.5–2.9s on 18 of 20 shards and ~9s on the other two (905 MB from MCR); the
  rest of container start is
  unpacking on the runner's disk, which is the new, small variance (25–39s).
  The old workflow's run 37680443742 sat 2931s in the same install step before
  it was cancelled, so the 45-minute figure in TAS-247 is a measurement now.
- **What it does not buy, stated so nobody reads it as a speed-up**: on a run
  where apt is quick, the image is ~5s slower per shard and `check` lands
  ~10s later (208s against the 199s median of apt's three quick runs). The
  whole gain is the tail. At apt's observed rate a clean sample this size
  would turn up 4–8% of the time — 4% counting shards as independent (3 slow
  in 20), 8% counting runs (2 of 5 had a slow shard), and the slow shards did
  bunch. All five image runs started inside 82 minutes, three of them inside
  8. That is the strength of the evidence: one afternoon's sample, not a
  guarantee about MCR.
- **Same suite, same results.** Every image run executed 544 and skipped 41,
  shard for shard identical to `main`'s apt run on `caa78f8`. (544, not 535:
  TAS-248 added `issue-share.spec.ts`.) Two flakes in twenty shards, both
  passed on retry, and neither failed on a layout assertion (text and
  visibility):
  `notifications.spec.ts:66` again and `admin-users.spec.ts:31` — in
  `BACKLOG.md`. The npm cache misses once in the container (its HOME is a
  different path) and has hit on every shard since.
- **Fonts.** Same packages, but on a bare Ubuntu rather than the runner image,
  so a generic family can resolve to a different system font. Only the two
  specs a font is known to move (`topbar-popovers`' board case,
  `projects-heading`) wait for the webfont; the other geometry specs do not,
  and `labels.spec.ts:242` passed first time on all three viewports in all
  five runs.
- Verdict: `release-reviewer`, narrow scope, APPROVE WITH NON-BLOCKING NOTES,
  no blockers. Its one medium — "no long tail" was not shown by one run — is
  what the five runs above are for; its re-verdict on them closed it, along
  with the comment on a premature bump. The fonts comment closed on a second
  rewording — the first one swapped "the fonts do not change" for "the layout
  specs wait for the webfonts", which was true of two specs, not all. The
  rest in `BACKLOG.md` under *Left by TAS-249*.
- Local gate not run: the diff is the workflow and three docs, none of which
  `npm run check` or `npm run build` reads; CI ran all of it at every head.
