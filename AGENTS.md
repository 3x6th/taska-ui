# Taska UI agent harness

This repository is the frontend of Taska, an issue tracker. It is built by an
orchestrating agent directing four specialised subagents against documents that
outrank the code. This file is the single authority for who may change what,
which source wins a conflict, and what counts as evidence.

## Authority

1. `design_handoff_taska/api-gateway-rest-draft.md` — the REST contract: enums,
   endpoint shapes, pagination, error codes.
2. `DESIGN.md` — the visual and behavioural system.
3. The assigned Jira `TAS` story — delivery scope and acceptance criteria.
4. `docs/ai/REFERENCE-LOCK.md` — how external design references may influence
   the work.
5. This file — ownership, verification, and safety.

When two sources conflict, stop the conflicting work and follow the
higher-ranked source.

### The contract has two truths

The draft is *intended* truth. The deployed gateway at `api.taska.ozero.dev` is
*runtime* truth. They are not the same thing today and pretending otherwise is
how a frontend accumulates silent workarounds.

When the gateway disagrees with the draft, stop and record the divergence in
`docs/ai/API-DIVERGENCE.md` with the endpoint, the observed behaviour, the
compensating UI behaviour, and the Jira key that will remove it. Do not absorb
the difference into a component and move on.

This has already happened once: `VITE_TASKA_ASSUME_PROJECT_ADMIN` exists purely
because `TAS-137` has not shipped project membership reads.

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

Subagents live in `.claude/agents/`. There is no Codex mirror in this
repository: all work here runs in Claude Code. If Codex is ever used, add
`.codex/agents/*.toml` with identical role bodies and only the frontmatter
differing, and keep the two in sync — that is the arrangement `lake-landing`
uses.

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
- Do not install or use Playwright.
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
5. rerun checks
6. push and open the PR
7. merge only when available checks are green and the reviewer verdict has no
   blockers

Do not fake a same-account GitHub approval. Record the reviewer verdict in the
PR instead.

## Verification evidence

`npm run check` is typecheck, lint at zero warnings, and unit tests.
`npm run build` is the production build. Neither proves visual, content, or
deployment correctness — say so rather than implying a green build is a
verdict.

Evidence proportional to risk:

- exact commands and their outcomes
- changed files and commit SHAs
- browser screenshots per viewport for visual work, stored under
  `docs/ai/evidence/<story>/`
- accessibility, responsive, and reduced-motion checks
- contract conformance for anything touching `src/api/`
- an independent reviewer verdict
- PR and deployment URLs at release

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
