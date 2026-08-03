# The harness

This repository is a working frontend. It is also meant to be a record of how
it was built: an orchestrating agent directing four specialised subagents
against documents that outrank the code.

Read `AGENTS.md` for the rules. This file is the account of whether they held.

## The shape

| Role | Writes | Owns |
| --- | --- | --- |
| Orchestrator | Repository, git, Jira, releases | Scope, sequencing, evidence |
| `frontend-builder` | Production frontend | The only agent that may edit `src/` |
| `art-director` | Nothing | Design-system conformance, UX craft, states, keyboard |
| `api-contract-guard` | Nothing | Contract fidelity, enums, roles, mock/rest/hybrid parity |
| `release-reviewer` | Nothing | The independent verdict before a merge |

**Three read-only roles against one writer.** A reviewer that cannot edit
cannot quietly fix what it should be reporting; a builder that cannot approve
cannot sign off on its own work. Read-only agents run concurrently; two
production writers never do.

The split is enforced by the `tools` list in each agent's frontmatter, not by
asking politely.

## Authority

`design_handoff_taska/api-gateway-rest-draft.md` → `DESIGN.md` → the Jira story
→ `docs/ai/REFERENCE-LOCK.md` → `AGENTS.md`. A conflict stops the conflicting
work and defers upward.

The contract sits at the top because Taska's product truth is its data model,
not its positioning. The ranking's one nuance is that the contract itself has
two truths — the draft states intent, the deployed gateway states behaviour —
and `docs/ai/API-DIVERGENCE.md` exists to keep the gap visible instead of
letting it dissolve into component code.

## Adapted, not copied

The harness shape comes from the `lake-landing` repository, where it was built
for a bilingual marketing site. Two roles did not survive the move intact:

- `product-strategist` guarded positioning claims and EN/RU content parity.
  Taska has no marketing claims to overstate, so the slot went to
  `api-contract-guard`, which guards the thing that can actually be wrong here:
  the UI's model of the backend.
- `art-director` guarded a cinematic art direction. Here it guards a quiet
  product interface — the same read-only shape, an inverted aesthetic brief.

`lake-landing` also defines every subagent twice, once for Codex and once for
Claude Code. This repository does not: all work here runs in Claude Code, and
`AGENTS.md` records what adding the mirror would take rather than leaving an
empty directory implying it exists.

## What this record is for

The interesting entries are not the successes. Findings that overruled the
orchestrator, defects that shipped past a complete evidence matrix, owner
decisions that overrode a blocking finding, and gaps the method could not see
belong here — recorded as what they were, not softened into agreement.

### Record

**2026-08-03 — the harness was installed, and has not yet reviewed anything.**
The four agents, the pinned skills, the verification gate, and the documents
above all landed under `TAS-140`. At the time of writing no subagent has
returned a verdict on production work, so this section contains no findings.
It is empty because nothing has run, not because nothing went wrong.

**2026-08-03 — Jira status lags the code by two stories.** `TAS-134` (current
user profile) and `TAS-136` (issue endpoints) are both `To Do` in Jira while
their code is written and, in TAS-136's case, committed across three commits.
A reviewer auditing either story against its acceptance criteria would be
auditing a story the board says has not started. Recorded rather than corrected
silently, because it is the same failure mode `lake-landing` hit with `LOD-9`:
work outrunning the issue that is supposed to define it.

## Verification

`npm run check` is typecheck, lint at zero warnings, and unit tests.
`npm run build` is the production build.

Neither proves visual, content, or deployment correctness, and the harness says
so in as many words. The test suite is new as of `TAS-140` and covers the API
boundary, not the screens — treat a green `check` as evidence that the contract
layer holds, and nothing more.

CI runs `npm run check` on pull requests and pushes to `main`
(`.github/workflows/frontend.yml`). Deployment to GitHub Pages fires separately
on push to `main`.
