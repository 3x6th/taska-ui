# Taska UI

Read [AGENTS.md](AGENTS.md) first. It is the single authority for roles,
delivery flow, frontend constraints, evidence, and safety — this file only
points at it so every harness shares one source of truth. Do not duplicate
harness rules here; change `AGENTS.md` instead.

Authority order when sources conflict: the backend's `openapi.yml`
(vendored at `docs/contract/openapi.yml`) → `DESIGN.md` → the Jira `TAS`
story → `docs/ai/REFERENCE-LOCK.md` → `AGENTS.md`. A conflict stops the
conflicting work and defers to the higher-ranked source. The frontend adapts
to the backend, never the other way around.

Subagents live in `.claude/agents/`. `frontend-builder` is the only one that
may edit production frontend code.

Verification: `npm run check` (typecheck + lint + test), then `npm run build`.
A green build does not prove visual, content, or deployment correctness.
