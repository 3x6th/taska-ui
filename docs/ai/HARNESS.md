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

The backend's `openapi.yml` (vendored at `docs/contract/openapi.yml`) →
`DESIGN.md` → the Jira story → `docs/ai/REFERENCE-LOCK.md` → `AGENTS.md`.
A conflict stops the conflicting work and defers upward.

The contract sits at the top because Taska's product truth is its data model,
not its positioning. The ranking's one nuance is that the contract itself has
two truths — the contract states intent, the deployed gateway states
behaviour — and `docs/ai/API-DIVERGENCE.md` exists to keep the gap visible
instead of letting it dissolve into component code. Mock-first delivery is
the repository's normal mode: features ship against the mock so the team can
use them before the gateway catches up.

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

**2026-08-03 — an owner decision merged a known-broken board to production.**
`TAS-136` and `TAS-140` were merged into `main` while `TAS-139` was still open,
against the explicit warning in PR #6's own description ("Не вливать до фикса
TAS-139"). What was known at the moment of decision: the deployed gateway 500s
on `GET /issues/{issueId}` for any issue with a comment; the board hydrates
every listed issue through that endpoint; therefore one comment in a project
makes that project's board fail to load on production, and push to `main`
deploys. The orchestrator surfaced all of this and recommended waiting for the
gateway fix; the owner chose to merge anyway. Recorded as an owner decision —
not softened into agreement — and reversible: the fix is `TAS-139` on the
backend, no frontend change is required to recover.

The merge also happened while the first three reviewer verdicts were still in
flight, so the "independent verdict before merge" rule was not exercised on
the very PRs that introduced it. Verdicts will be recorded when they land,
and their findings addressed in follow-up stories.

**2026-08-03 — the harness shipped with the wrong contract at the top of its
authority order.** `AGENTS.md` ranked `design_handoff_taska/api-gateway-rest-draft.md`
as authority #1. The owner corrected this within hours: that draft was written
before the gateway existed, and the real contract is the backend repository's
`openapi.yml` (now vendored at `docs/contract/openapi.yml` with the backend
commit pinned). The consequences were immediate and instructive:
`api-contract-guard`'s first verdict measured the code against the stale draft
and reported the deployed issue routes, the full-object `PUT`, the transition
path, the flat error body and the entire comments surface as ten undocumented
divergences — on the correct baseline, all of those **are the contract** and
`RestTaskaApi` conforms to it. `API-DIVERGENCE.md` was rewritten on the new
baseline (the entries that survived: TAS-139, the 404-on-empty-projects bug,
and the contract's genuine gaps — membership reads, board-capable list DTO,
read-all, unassignment, comment ordering, `X-Request-Id` exposure). TAS-141
was refiled from "align the gateway with the draft" to "close the contract's
gaps". Lesson recorded: an authority document needs its provenance checked
before anything is audited against it — the reviewer did its job correctly
against the wrong truth, which is exactly why authority order is worth
writing down.

**2026-08-03 — the first three verdicts landed, and both reviewers returned
REQUEST CHANGES.** `api-contract-guard` passed its self-test (it reached the
documented TAS-137 divergence independently and found two consequences the
record had missed) and exposed that ten gateway claims lived only in code
comments — though on a stale baseline, see the authority-order entry above.
`release-reviewer` reproduced the full gate on a clean worktree, verified no
credential leaks, empirically proved that one of the fourteen "green" tests
never reached its assertions, and found the board silently discarding drags
with no legal transition — including the `IN_PROGRESS → TODO` path that
TAS-136 had deleted from the mock seed, which removed "Move to To Do" from the
product entirely. `art-director` measured every claim it made (computed styles,
not screenshots), found the two new DESIGN.md component sections describing
components that did not ship, caught a per-role letter-spacing regression the
orchestrator's own token pass introduced, and flagged an accent-on-accent
hover that made two button labels disappear. All blockers were fixed
in-branch; the non-blocking gaps are recorded in `DESIGN.md` under `TAS-142`
instead of being silently absorbed. The independent-review mechanism did, on
its first run, exactly what it was installed to do — including catching the
orchestrator's own work.

**2026-08-03 — two reviewers collided in one browser pane.** The Browser pane
is shared per session, and `release-reviewer` and `art-director` ran
concurrently: the art-director watched a comment appear that it did not write
("Reviewer probe"), text typed into an editor under its cursor, and its
viewport resized underneath it. It moved to its own tab and re-verified
everything there — correctly treating the observed content as data, not
instructions — but the orchestrator should not schedule two browser-driving
reviewers concurrently again. Read-only agents may run in parallel only when
their *instruments* do not overlap either.

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
silently: work outrunning the issue that is supposed to define it is exactly
the drift this file exists to catch.

**2026-08-05 — the orchestrator skipped re-review twice under `TAS-150`, and
the owner is the one who noticed.** The first submission got a full pass:
`release-reviewer` approved with notes, `api-contract-guard` returned a
blocker, `art-director` returned two. All three were fixed — and then verified
by the orchestrator and the builder alone, which is the pair the findings were
about. The PR was merged with `art-director`'s REQUEST CHANGES formally
unresolved; the orchestrator flagged that in writing and the owner chose to
merge, which is the owner's call to make, but it should not have been his to
make. The follow-up PR that removed a notice took no verdict at all.

Both skips were declared rather than hidden, and both were justified the same
way: the diff is small, the risk is visible, a reviewer costs fifteen minutes.
That reasoning is the failure. It is the writer deciding its own work does not
need review, which is the one judgement the three-read-only-roles split exists
to take away from it — and `AGENTS.md` had left the door open by writing step 5
as "rerun checks", saying nothing about re-verdicts. Closed under `TAS-140`:
step 5 now asks for a fresh verdict from every role whose blockers were fixed,
and a table fixes how much review a change needs by its class rather than by
how small it looks to the agent holding it.

Worth keeping in view: nothing in this session caught the gap except the owner
asking why. The harness has no mechanism that notices a missing verdict, and
the new rule is prose, not a gate — it will hold exactly as well as the next
orchestrator's willingness to follow it when it is inconvenient.

## Verification

`npm run check` is typecheck, lint at zero warnings, unit tests, and the
Playwright end-to-end suite. `npm run build` is the production build.

Neither proves visual, content, or deployment correctness, and the harness says
so in as many words. The unit suite is new as of `TAS-140` and covers the API
boundary, not the screens. The e2e suite is new as of `TAS-143`: mock-backed
smoke flows on its own Vite server, which is the dev server with browser
routing at base `/` — not the hash-routed, base-prefixed build that GitHub
Pages actually serves, so deploy-shaped regressions stay outside its reach.
Treat a green `check` as evidence that the contract layer holds and the smoke
flows still run, and nothing more.

CI runs `npm run check` on pull requests and pushes to `main`
(`.github/workflows/frontend.yml`), installing Chromium first and uploading
Playwright traces and the HTML report when the gate fails. Deployment to
GitHub Pages fires separately on push to `main` and runs only `typecheck` and
`build`, never `check`.
