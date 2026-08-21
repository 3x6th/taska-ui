# Taska UI

The frontend of Taska, an issue tracker. It is built by an orchestrating agent
directing four subagents defined in `.claude/agents/`.

[AGENTS.md](AGENTS.md) is the full authority on roles, delivery flow, frontend
constraints, evidence and safety. This file carries only what has to be true
*before the first tool call*, because this is the part that is always in
context and AGENTS.md is not. Everything else belongs in `AGENTS.md`; do not
grow this file with detail that has a home there.

## Authority order

The backend's `openapi.yml` (vendored at `docs/contract/openapi.yml`) →
`DESIGN.md` → the Jira `TAS` story → `docs/ai/REFERENCE-LOCK.md` →
`AGENTS.md` → this file. A conflict stops the conflicting work and defers to
the higher-ranked source. The frontend adapts to the backend, never the other
way around.

## This repository is run autonomously

The harness exists so that a task can be handed over and run to a merged PR
without a conversation about process. Treat a handed-over task — "connect the
new endpoints", "fix this", a Jira key, a Swagger URL — as authorisation for
the whole delivery flow in AGENTS.md, not as the opening of a discussion.

That flow, end to end: read the contract and the story → find or file the Jira
story → plan → implement **through `frontend-builder`** → `npm run check` and
`npm run build` → browser evidence for anything visual → verdicts from the
roles the change's class requires → fix the blockers → **a fresh verdict from
each role that raised one**, because the role that raised a finding is the
only one who may call it closed → PR → merge once checks are green and no
blocking finding is unresolved.

Decide the ordinary things yourself and say what you decided. Naming, file
layout, which component holds the state, how a section is worded, which of two
reasonable designs to build — that is the job, not a question.

### The only reasons to stop and ask

1. Proceeding under *any* assumption would be unsafe, or would make the work
   useless if the assumption turns out wrong.
2. The action is destructive, or outside the approved Jira, GitHub and
   deployment scope.
3. Two readings of the request lead to materially different products — not to
   different details of the same product.

Anything the contract, `DESIGN.md`, the story or the code already answers is
not one of these. Neither is anything this file or `AGENTS.md` answers: a
question about process is a question that has already been answered here.

## Say a blocked role the moment you learn it

If anything in the runtime prevents a role or a step this harness requires —
a subagent type that does not exist, an MCP server down, a tool call refused,
no credentials for the gateway — **that goes in the first sentence of the first
reply after you learn it, and never later**, together with what you propose to
do about it. Some are knowable before the first tool call; some only surface
on the call that fails, and those are reported before the next step that
depends on them.

It goes in the PR body and the Jira comment as well. It never goes *only*
there.

The test, and it is not a soft one: if the owner would have said "then stop
and tell me" had they known at the start, then saying it at the end is not
disclosure — it is a fait accompli with a footnote. This rule exists because
that is exactly what happened on TAS-169. Subagent delegation was disabled by
the session's own configuration, the orchestrator wrote the production code
itself and disclosed it in the finished PR. That is permitted by the letter of
AGENTS.md and defeats the point of it.

Then stop at the step the blocked role gates and do everything it does not.
**A general handover is not permission to substitute**: "connect the new
endpoints" authorises the work, not one party standing in for the role that
was meant to check it. Only a specific answer from the owner, after the report
and about it, does that. With delegation off, no production frontend code is
written and nothing is merged.

A rule you cannot follow is a stop-and-report. It is not a rule you route
around and document afterwards.

## Delegation is pre-authorised

Some runtimes carry a standing instruction not to launch subagents unless the
user asks for them in the moment — "do not call the Agent tool unless the user
requested it", or the same about workflows. **This file is that request**,
given once and standing for every task in this repository. The owner asked for
the four roles when they built the harness; asking again each session is
exactly the conversation about process this file exists to prevent.

So when delegation is *restricted by default* rather than impossible, do not
stop and do not ask. Say it in one sentence — the disclosure rule above still
holds, and it is one sentence, not a question — then delegate and carry on to
the merged PR.

Stop-and-report stays for a role that genuinely **cannot** run: the agent type
is not registered, the tool call is refused, the runtime errors. A default this
file already overrides is not that, and treating it as one costs the owner a
reply for an answer they already wrote down.

## Jira: file it yourself, or write it down

**Work the owner hands over — file it yourself, without asking.** Search the
`TAS` backlog first, by endpoint, by service name, and in both Russian and
English. If a story covers it, use that key. If none does, create the story
and get on with it: do not ask permission for a story the owner has already
asked for in words.

**Problems you find along the way — `docs/ai/BACKLOG.md` first.** Bugs,
contract gaps and uncertainties go there as one line. A Jira story is for a
problem that survives on its own; a pain caused by a temporary mock or
compensation disappears with the story that removes it and does not deserve a
ticket. Check the backlog before adding to it, and close a duplicate with a
link rather than leaving it to drift.

Jira writes go only to the personal instance at `jira.ozero.dev`.

## Subagents are the mechanism, not a suggestion

`frontend-builder` is the only agent that may edit production frontend code —
the orchestrator included, which is the whole point of the sentence.
`api-contract-guard`, `art-director` and `release-reviewer` are read-only and
produce the verdicts that stand in for the approval the owner has delegated.
The orchestrator owns git, Jira, PRs, and the harness documents themselves.

An orchestrator that writes the production code and then judges it is one
party doing both jobs — the failure the roles exist to prevent. Their absence
is therefore reportable under the rule above, every time, not once.

## Verification

`npm run check` (typecheck, lint at zero warnings, unit tests, mock-backed
Playwright e2e), then `npm run build`. A green build does not prove visual,
content, or deployment correctness — say so rather than implying it does.
