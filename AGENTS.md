# Taska UI agent harness

This repository is the frontend of Taska, an issue tracker. It is built by an
orchestrating agent directing four specialised subagents against documents that
outrank the code. This file is the single authority for how much is decided
without asking, who may change what, which source wins a conflict, and what
counts as evidence.

It is written to be handed a task and left alone. `CLAUDE.md` carries the few
rules that have to be in context before the first tool call and points here for
the rest.

## Authority

1. The API Gateway contract: `openapi.yml` in the backend repository,
   [`VladislavYurin/taska-backend`](https://github.com/VladislavYurin/taska-backend/blob/develop/api-gateway/src/main/resources/static/openapi.yml)
   on `develop`. A snapshot is vendored at `docs/contract/openapi.yml` with the
   backend commit recorded in its header; when the two differ, the backend
   wins and the snapshot must be refreshed.
2. `DESIGN.md` — the visual and behavioural system.
3. The assigned Jira `TAS` story — delivery scope and acceptance criteria.
4. `docs/ai/REFERENCE-LOCK.md` — how external design references may influence
   the work.
5. This file — ownership, verification, and safety.

The frontend adapts to the backend, never the other way around — but the
backend moves slower than the frontend needs to, and that is expected, not an
exception. When a feature needs an endpoint the gateway does not have yet, the
frontend ships it against the mock (or a hybrid compensation) so the team can
click through it, and the gap is recorded in `docs/ai/API-DIVERGENCE.md` with
what removes it. Mock-first delivery is the normal mode of this repository,
not a violation of the contract.

When two sources conflict, stop the conflicting work and follow the
higher-ranked source.

### The contract has two truths

The contract states *intended* truth. The deployed gateway at
`api.taska.ozero.dev` is *runtime* truth. When they disagree — or when the
contract is silent on something the UI needs — stop and record it in
`docs/ai/API-DIVERGENCE.md` with the endpoint, the observed behaviour, the
compensating UI behaviour, and the Jira key that will remove it. Do not absorb
the difference into a component and move on.

This has already happened: `VITE_TASKA_ASSUME_PROJECT_ADMIN` exists purely
because the contract has no membership or member-read endpoints (`TAS-137`).

## Autonomy

The point of this harness is that work can be handed over. A task arriving
here — "connect the new endpoints", a Jira key, a Swagger URL, a bug report —
is authorisation to run the whole delivery flow below and come back with a
merged PR. It is not an invitation to negotiate how.

Run it without checking in: read the contract, the story and the code before
deciding anything; find or file the Jira story; brief `frontend-builder`
rather than writing production frontend code yourself; run the gate; capture
evidence; take the verdicts the change's class requires; open the PR, fix the
blockers, merge.

Make the ordinary calls yourself and state them. Which component holds the
state, what a section is called, how an empty state is worded, which of two
reasonable layouts to build — deciding these *is* the work. An orchestrator
that asks about them is not being careful. It is handing back the part of the
job it was given.

### The only reasons to stop and ask

1. Proceeding under *any* assumption would be unsafe, or would make the work
   useless if the assumption turns out wrong.
2. The action is destructive, or outside the approved Jira, GitHub and
   deployment scope.
3. Two readings of the request lead to materially different products — not to
   different details of the same product.

All three are about the *product*. A question about process is not among them:
this file answers those, and where it does not, the answer is a change to this
file proposed alongside the work rather than instead of it.

A blocked role is a fourth reason to stop, and it is deliberately not on that
list, because it is not a question — it is a report followed by a wait. See
*When the harness cannot run a role* below.

Uncertainty that is not one of the three is handled by doing everything that
does not depend on the answer, then stating the assumption and continuing.

### When the harness cannot run a role

Sometimes the runtime will not let you do what this file requires: subagent
delegation switched off, an MCP server down, a tool call refused, no
credentials for the gateway. When that happens:

**Say it in the first sentence of the first reply after you learn it, and
never later than that**, along with what you propose to do instead. Some of
these are knowable before the first tool call — delegation switched off — and
some are only discovered on the call that fails. A mid-run discovery is
reported before the next step that depends on it, not saved for the end. It
goes in the PR body and the Jira comment too, but never *only* there.

The test is not a soft one. If the owner would have said "then stop and tell
me" had they known at the start, then saying it at the end is not disclosure.
It is a fait accompli with a footnote.

Then stop at the step the blocked role gates, and do everything it does not.
With delegation off that means: read the contract, file the story, plan the
change, say exactly what you would build — and write no production frontend
code and merge nothing, because those are the two things the missing roles
exist to gate.

**A general handover is not permission to substitute.** "Connect the new
endpoints" authorises the *work*; it does not authorise one party to take the
place of a role that was supposed to check it. Only a specific answer from the
owner, given after the report and about that report, does that. Until it
arrives, the run stops at the gate and waits — which costs one reply, and is
the entire difference between this rule and the one it replaces.

When the owner does answer and it covers proceeding, proceed — but take the
strongest substitute available, label it for what it is, and never let it be
read as the thing it replaced. A self-review by the agent that wrote the code
is not a verdict, and a PR carrying one says so in those words.

This section exists because of TAS-169. Subagent delegation was disabled by
the session's own configuration; the orchestrator wrote the production code
itself, verified it itself, and disclosed both in the finished PR body. Every
sentence of that disclosure was true and the letter of this file allowed it.
It still left the owner reading about a decision they would have made
differently, at the one moment it had become expensive to change. A rule you
cannot follow is a stop-and-report, not a rule you route around and document
afterwards.

## Roles

| Role | Write access | Responsibility |
| --- | --- | --- |
| Orchestrator (main thread) | Harness, docs and repository configuration, git, Jira, PRs | Scope, sequencing, evidence, external operations |
| `frontend-builder` | Workspace write | The only agent, orchestrator included, that may edit production frontend code |
| `art-director` | Read-only | Design-system conformance, UX craft, states, keyboard, light/dark parity |
| `api-contract-guard` | Read-only | Contract conformance, enums, role gating, mock/rest/hybrid parity |
| `release-reviewer` | Read-only | Independent verdict before any PR |

Never run two production-code writers in parallel. Read-only agents may
research or review concurrently when their scopes do not overlap.

A reviewer that can edit cannot be trusted to report what it would rather
quietly fix; a builder that can approve cannot be trusted to sign off on its own
work. Read-only is expressed as a restricted `tools` list in each agent's
frontmatter — that restriction is the mechanism, not a request.

Subagents live in `.claude/agents/`. All work here runs in Claude Code; if a
second agent runtime is ever added, define the same roles for it with
identical role bodies and keep the two definitions in sync.

## Tooling the harness expects you to use

The four subagents are the machinery this file is mostly about. These are the
rest of it, and each answers to the same rule: reach for it when it is the
right instrument, and report it under *When the harness cannot run a role*
when it is not available.

Report what *this task* needs, not everything that happens to be missing. A
gap with a documented restore path is fixed rather than announced — the skill
symlinks under `.claude/skills/` point into git-ignored `.agents/`, so a fresh
clone and every new worktree start with none of them; run
`npx skills experimental_install` (README) instead of opening with a report
about it.

- **Subagents** (`.claude/agents/`) — the roles above. Not optional.
- **Workflows** — deterministic fan-out across many agents. Worth it when a
  pass is genuinely parallel and its shape is known in advance: reading one
  diff from several angles at once *on a draft that has already passed
  `release-reviewer`*, verifying each finding independently before acting on
  it, sweeping a change across many files. One review by one role is an
  `Agent` call, not a workflow, and a workflow does not license the volley
  *Stage the reviews* forbids — it is a way to *run* a role, never a way to
  skip one, and the verdict table below is unaffected by how a role was
  launched.
- **Skills** — pinned in `skills-lock.json`, symlinked under
  `.claude/skills/`. `design-taste-frontend` for craft, ranked below
  `DESIGN.md` (see below); `find-animation-opportunities`,
  `improve-animations` and `review-animations` for motion. A skill is a source
  of craft, never of direction, and never outranks `DESIGN.md` or the
  contract.
- **Plugins** — the `voltagent-lang`, `voltagent-data-ai` and
  `voltagent-qa-sec` packs enabled at user level are generic: they do not know
  this repository's contract, its design system, or its roles, so the four
  project agents come first for anything touching Taska. Do not read "generic"
  as "irrelevant" — the packs ship `react-specialist`, `typescript-pro`,
  `accessibility-tester`, `ui-ux-tester`, `code-reviewer` and
  `security-auditor`, which are squarely on this repository's surface and are
  the best substitutes available when a project role cannot run.
- **MCP servers** — `refero` (project `.mcp.json`) for design references,
  under `docs/ai/REFERENCE-LOCK.md`'s rules. `mcp-atlassian` for Jira, which
  is registered at user level rather than in this repository, so confirm it is
  in scope before relying on it; `gh` is preferred over the GitHub MCP for
  writes. `context7` for library documentation, in preference to memory or a
  web search. The browser tools are how visual evidence is captured and are
  not optional for UI work.

Credentials for any of these are covered by *Safety* at the end of this file.

## Frontend constraints

- Vite, React 19, and strict TypeScript.
- Colour, spacing, radius, shadow, and motion values come from `DESIGN.md` §2
  and §3 as CSS custom properties. No hardcoded hex in components; new shades
  come from `color-mix(in oklab, <token> N%, transparent)`.
- Theme is `data-theme` on `<html>`. Do not mix a `.dark` class with media
  queries.
- Every server call goes through the `TaskaApi` interface in `src/api/`. The
  three implementations — mock, rest, hybrid — must stay behaviourally
  interchangeable.
- Mutations are optimistic with rollback on failure. A spinner is only for the
  case where there is genuinely nothing to show.
- Role gating (`ADMIN` / `MEMBER` / `VIEWER`) hides UI, and the server remains
  authoritative. Never treat a hidden control as an enforced permission.
- Semantic HTML first. Everything clickable is reachable and operable from the
  keyboard with a visible focus style, and drag-and-drop always has a button
  equivalent.
- Respect `prefers-reduced-motion`. Entrance animations must never hide
  content: no `opacity: 0` starting frame, no `fill-mode` that leaves an
  element invisible when animation is paused or disabled.
- Verify desktop 16:9, laptop 16:10, and phone portrait layouts, in both
  themes.
- Playwright end-to-end tests live in `e2e/` and run as part of
  `npm run check` (`npm run test:e2e` runs them alone). The suite starts its
  own Vite server on port 5183 with `VITE_TASKA_API_MODE=mock`, so it never
  reuses a developer's dev server and never reaches the live gateway. Its
  three projects mirror the viewport matrix above. A green suite proves the
  flows it exercises, not visual or content correctness — browser
  verification through the preview tools still applies to UI work. It runs the
  dev server with browser routing at base `/`, so it cannot catch the
  hash-routing and base-path regressions specific to the Pages build.
- Never commit secrets, build output, or IDE state.

### Skills rank below the design system

`design-taste-frontend` is pinned in `skills-lock.json` and is tuned for
landing pages and portfolios. `DESIGN.md` §1 asks for the opposite — a quiet
interface where colour carries meaning rather than expression. Where the skill's
bias collides with `DESIGN.md`, `DESIGN.md` wins. The skill is a source of
craft, not of direction.

## Delivery flow

Commit subjects start with the relevant Jira key:

```text
TAS-140: add lint and test verification
```

Before a PR:

0. find or file the Jira story, per *Jira discipline* — the commit subject
   needs its key, so this precedes the first commit rather than the PR
1. `git fetch && git rebase origin/main` — **before briefing anyone**, not
   before pushing
2. run `npm run check`, then `npm run build`
3. capture browser evidence when UI changed
4. give the exact diff and evidence to `release-reviewer`
5. fix all blocking findings
6. rerun checks, then get a fresh verdict from every role whose blocking
   findings were fixed
7. push and open the PR
8. the orchestrator may merge once available checks are green and the
   reviewer verdicts have no unresolved blockers — the owner has delegated
   the merge itself; the verdict requirement is what is not delegated
9. **the merge is not done until the story is:** transition the Jira issue to
   `Done` with the PR link in a comment, and update its row in
   `docs/ai/JIRA-WORKFLOW.md` to `merged (PR #N)`. Both are part of step 8,
   not follow-up work — a merged PR under a `To Do` story is how `TAS-134`
   and `TAS-136` came to disagree with themselves, and that table says to
   trust the repository column, which only holds if it is written when the
   PR lands. If part of the story did not ship, the honest status plus a
   comment naming what is left beats `Done`.

Do not fake a same-account GitHub approval. The written reviewer verdict is
the independent evidence.

### A fix is not reviewed by the agent that ordered it

The second half of step 6 is the one that gets skipped, because by then the
orchestrator has read the findings, directed the fixes, and looked at the
result — and that feels like review. It is not: the orchestrator and the
builder are the two parties the finding was about. The role that raised a
blocker re-reads its own findings against the fix diff and says whether they
are closed. That pass is narrow by construction — one small diff and a list of
specific questions, not a second audit — so its cost is nothing like the first
one, and cost is not a reason to skip it.

How much verdict a change needs is decided by its class, never by how small
the diff in front of you looks:

| Change | Verdict before merge |
| --- | --- |
| First submission of a story | Full pass by every role whose zone it touches |
| A bug fix that adds no surface and changes no contract | `release-reviewer`, plus the one role whose zone the bug lives in |
| Fixes to blocking findings | Re-verdict from the role that raised them, scoped to those findings |
| Deletion, documentation, configuration | `release-reviewer` in narrow scope |

Skipping is allowed and is sometimes right. Skipping silently is not: a PR
carrying no verdict says so in its own body, in words, so the owner is
choosing rather than assuming. An orchestrator judging its own work too small
to review is the failure this table exists to prevent.

This paragraph is about *choosing* to skip a role that could have run. A role
that **cannot** run is a different thing and is not covered here — it does not
get skipped with a note, it stops the run at the step it gates. See *When the
harness cannot run a role*.

### Stage the reviews; do not fire them all at the first draft

Where a change needs more than one role, review it in two waves rather than
one volley: `release-reviewer` on the first submission, then the specialist
roles once its blockers are fixed. A first draft is the roughest the code will
ever be, and three simultaneous reviews of it mostly discover the same
roughness three times and are then invalidated together by the first round of
fixes. The exception is a change whose whole risk lives in one specialist's
zone — a contract change, a pure design change — where that role goes first
and `release-reviewer` follows.

This is a sequencing rule, not permission to drop a role. Every role the
verdict table names still reports before merge; they just do not all read the
same draft.

### Ask a reviewer for a verdict, not an inventory

Review prompts cap the non-blocking half: **every blocking finding, and at
most three others.** A read-only role given no limit will report everything it
noticed, because noticing is its job — and the surplus is not free. It is paid
for twice, once in the reviewer's own run and again in the orchestrator
triaging items it will not act on. Anything beyond the cap that is worth
keeping goes to `docs/ai/BACKLOG.md` in one line, which is where it would have
ended up anyway.

### Match the model to the pass, not to the agent

Each agent's frontmatter names a default model; the `Agent` tool's `model`
parameter overrides it per call, and the orchestrator is expected to use that.
Design, a first implementation, and any review keep the strong model. A pass
that applies a list the orchestrator has already decided — "make these four
edits, run the gate" — does not, and a fifteen-line mechanical change on the
strongest model is waste with no upside. When in doubt, keep the strong model:
a second round-trip costs far more than the difference.

There is one environment. The deployed site is the team's own working stand —
no external users yet — so shipping mock-backed features there for the team
to click through is the point, not a risk to be escalated. Note what is
mocked, and move on.

### Jira discipline

Two paths in, and which one a thing takes depends on who raised it.

**Work the owner handed over — file it yourself, and do not ask.** "Connect
the new endpoints" is a decision already made; a story is the bookkeeping of
it, not a second approval. Search `TAS` first, use the existing key if one
covers the work, and create the story yourself when none does. Link it to the
backend story it depends on. Then start.

**Problems you found along the way — `docs/ai/BACKLOG.md` first.** Bugs,
contract gaps, design debt and open questions go there as one line. That file
is the working memory. A `TAS` story is for a problem that survives on its
own, and most do not: a pain caused by a temporary mock or a compensation
disappears with the story that removes it and never deserved a ticket. A
genuine contract-design problem is the clearest case that does, and may be
filed directly.

Before filing anything, on either path, search the existing `TAS` backlog:
is there already a story that covers this or that this duplicates — by
endpoint, by service name, and in both Russian and English keywords. A
duplicate found after filing gets closed with a link, not left to drift.

The survival test applies on both paths too, not only the second. Handed-over
work is usually real by definition, but "fix this" sometimes turns out to name
a mock artifact that disappears with the story removing the mock. When it
does, say so and do not file — the owner asked for the problem gone, not for a
ticket about it.

Graduating a line from `docs/ai/BACKLOG.md` into `TAS` is the orchestrator's
call, made with the same two tests and without asking. Strike the line when it
graduates, record the key beside it, and **name the graduation in the reply
that does it** — `TAS` is shared with the backend team, and a story appearing
there is the kind of autonomous decision this file elsewhere requires you to
state rather than merely to make.

When writing Jira descriptions, use plain text and simple lists. The MCP
converter mangles more Markdown than it renders, and every case below was
found by writing a ticket and then reading it back — so read back anything
you file:

- No `#` headings inside list items: they render as giant bold headers.
- No numbered lists. `1.` is converted to `##`, which turns the first item of
  an ordered list into a heading and leaves the rest as plain text. Write
  "First." / "Second." as prose, or use `*` bullets.
- Underscores in identifiers become emphasis in **comments**
  (`jira_add_comment` takes Markdown): `VITE_TASKA_ASSUME_PROJECT_ADMIN` comes
  out as `VITE*TASKA*ASSUME*PROJECT*ADMIN`. Description fields via
  `jira_update_issue` keep underscores intact. When a comment must name a
  snake_case or SCREAMING_SNAKE identifier, describe it instead, or accept the
  mangling knowingly rather than by surprise.

## Verification evidence

`npm run check` is typecheck, lint at zero warnings, unit tests, and the
mock-backed Playwright end-to-end suite. `npm run build` is the production
build. Neither proves visual, content, or deployment correctness — say so
rather than implying a green build is a verdict.

Evidence proportional to risk:

- exact commands and their outcomes
- changed files and commit SHAs
- browser verification per viewport for visual work
- accessibility, responsive, and reduced-motion checks
- contract conformance for anything touching `src/api/`
- an independent reviewer verdict
- PR and deployment URLs at release

Reviewer verdicts are summarized as comments on the Jira story. Screenshots
and full verdict texts stay local under `docs/ai/evidence/` and
`docs/ai/reviews/` — both are git-ignored working material for the agents,
not repository content.

Report limitations directly. If a check was skipped, say which and why.

## Safety

- Jira writes go only to the personal instance at `jira.ozero.dev`.
- Never print or commit credentials. `.mcp.json` references
  `${REFERO_API_KEY}`; the literal token must never enter the repository, a
  commit message, or a transcript.
- Preserve unrelated user changes. This repository frequently has
  work-in-progress in the tree that belongs to a different story.
- Stage explicit paths. Never `git add -A`.
- Do not use destructive git commands.
- Do not publish external messages or mutate systems outside the approved
  Jira, GitHub, and deployment scope.
