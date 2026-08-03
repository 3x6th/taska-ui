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
above all landed under `TAS-140`. No subagent has returned a verdict on
production work. This is not because the reviews were skipped: `.claude/agents/`
and `.mcp.json` are both read when a Claude Code session starts, so agents and
MCP servers created *during* a session are not registered until the next one.
The self-test was attempted, failed with `Agent type 'art-director' not found`,
and is recorded here rather than described as passing. First real verdicts are
owed on the next session, and `TAS-140` cannot be called done until they exist.

The same applies to Refero: the tools are declared but were unreachable this
session, so the claim in `REFERENCE-LOCK.md` that only `art-director` can reach
them is written down but unproven.

**2026-08-03 — a null byte shipped into `BoardScreen.tsx` and the typecheck did
not care.** While removing a `set-state-in-effect` finding, the replacement
used `\0` as a string separator and wrote a literal NUL into the source. The
file became binary: `grep` silently returned nothing for every query against
it, and Vite's transform broke badly enough that posting a comment did nothing
in the browser. `tsc`, `eslint` and `vitest` all passed throughout — a NUL is
valid inside a TypeScript template literal, so nothing in `npm run check` had
any reason to object.

It was caught by trying to use the app, then noticing that `grep` had gone
quiet. Worth recording for two reasons: the green gate proved nothing about
the defect, exactly as `AGENTS.md` warns; and the symptom that led to it
(a UI action doing nothing) looked at first like a bug in the feature code
under review rather than in the tooling.

**2026-08-03 — a reported theme-toggle bug was not one.** The toggle appeared
dead across three attempted clicks. Two used a selector matching an
`aria-label` the button did not have, and the third read `data-theme` in the
same tick as the click, before React's effect had run. Re-tested with a delay,
it worked. The finding was dropped instead of filed. The button did turn out
to be missing the `aria-label` that `DESIGN.md` §7 requires, which is what the
bad selector had accidentally demonstrated, and that was fixed.

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
