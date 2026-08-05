# Taska UI agent harness

This repository is the frontend of Taska, an issue tracker. It is built by an
orchestrating agent directing four specialised subagents against documents that
outrank the code. This file is the single authority for who may change what,
which source wins a conflict, and what counts as evidence.

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

## Roles

| Role | Write access | Responsibility |
| --- | --- | --- |
| Orchestrator (main thread) | Repository, git, Jira, PRs | Scope, sequencing, evidence, external operations |
| `frontend-builder` | Workspace write | The only subagent that may edit production frontend code |
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

1. run `npm run check`, then `npm run build`
2. capture browser evidence when UI changed
3. give the exact diff and evidence to `release-reviewer`
4. fix all blocking findings
5. rerun checks, then get a fresh verdict from every role whose blocking
   findings were fixed
6. push and open the PR
7. the orchestrator may merge once available checks are green and the
   reviewer verdicts have no unresolved blockers — the owner has delegated
   the merge itself; the verdict requirement is what is not delegated

Do not fake a same-account GitHub approval. The written reviewer verdict is
the independent evidence.

### A fix is not reviewed by the agent that ordered it

The second half of step 5 is the one that gets skipped, because by then the
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
| Fixes to blocking findings | Re-verdict from the role that raised them, scoped to those findings |
| Deletion, documentation, configuration | `release-reviewer` in narrow scope |

Skipping is allowed and is sometimes right. Skipping silently is not: a PR
carrying no verdict says so in its own body, in words, so the owner is
choosing rather than assuming. An orchestrator judging its own work too small
to review is the failure this table exists to prevent.

There is one environment. The deployed site is the team's own working stand —
no external users yet — so shipping mock-backed features there for the team
to click through is the point, not a risk to be escalated. Note what is
mocked, and move on.

### Jira discipline

Jira stories are created by the owner, or by the orchestrator only after
proposing it to the owner and getting a yes. The one exception: a genuine
contract-design problem (not a temporary mock-era gap) may be filed directly.
Everything else that is worth remembering goes to `docs/ai/BACKLOG.md` first —
that file is the working memory; Jira is for agreed work.

Before proposing or filing anything, search the existing `TAS` backlog for it.
Two checks, both mandatory: is there already a story that covers this or that
this duplicates (search by endpoint, service name, and the Russian and English
keywords); and does the problem even survive — a pain caused by a temporary
mock or compensation disappears with the story that removes the mock, and does
not deserve its own ticket. A duplicate found after filing gets closed with a
link, not left to drift.

When writing Jira descriptions, use plain text and simple lists. Do not use
`#` headings inside list items — the Jira converter renders them as giant
bold headers and the result is unreadable.

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
