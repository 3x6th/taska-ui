# Codex runtime adapter

`AGENTS.md` owns policy. This adapter binds its four roles to Codex without
changing source ranking, production-code ownership, staged reviews, blocker
re-verdicts, Jira discipline, or the merge gate. Claude Code remains supported.

## Role definitions

`.claude/agents/*.md` are the canonical role bodies, including for Codex.
`npm run harness:sync` copies the complete bodies into `.codex/agents/*.toml`
and appends a labelled runtime binding. Do not edit the generated files.
`npm run harness:check` checks exact generation and parses every TOML file.
It runs offline in `npm run check` and CI. Python 3.11+ is required.

Native Codex roles inherit the parent's model; `opus` in Claude's metadata is
not a Codex model. The isolated launcher ignores user configuration and selects
`gpt-6.1-sol` explicitly; `TASKA_CODEX_MODEL` can select another available model.
Generated roles and the isolated launcher request high reasoning effort.
Keep a strong configured model for design, implementation and reviews. For a
mechanical follow-up, the orchestrator may use a supported explicit native
spawn override under AGENTS.md's model policy. Do not silently substitute a
cheap model for a reviewer. No account-wide configuration is changed here.

The app may expose only a generic `spawn_agent`, without custom role selection.
For `frontend-builder`, read the canonical role body and give it in the brief,
along with the story, contract pin, accepted design and explicit scope. This
is a builder role invocation, not permission for the orchestrator to write
production code. Native read-only consultations may research a problem, but
are not reviewer verdicts.

## Reviewer isolation

Current Codex custom agents inherit the parent's permissions. Putting
`sandbox_mode = "read-only"` in their TOML does not create an independent
boundary. See [OpenAI's subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
The generated TOML files describe roles; **the launcher enforces review isolation**.

`scripts/codex-harness.py run` starts a fresh top-level `codex exec`, rather
than a child agent of the writable app session. For all three reviewers it uses:

- `--sandbox read-only`, approval `never`, and no inherited execution rules;
- `--ignore-user-config` and `--ephemeral`; existing Codex authentication is
  reused without copying or printing credentials;
- apps, plugins, memories, image generation, browser/computer control, hooks,
  permission requests and nested agents disabled;
- web search disabled, login shells disabled, and shell environment inheritance
  disabled (only a fixed executable PATH is supplied). No Jira,
  GitHub or browser connector is supplied to this isolated process.

Before each review, a real Codex sandbox probe reads a disposable fixture,
tries overwriting it, tries creating another file in the repository, and tries
connecting to a listening localhost socket. Reads must succeed and all three
writes/connections must fail with a permission error. An unavailable sandbox,
old CLI, missing authentication, absent result or nonzero exit blocks the role.
Do not turn off sandboxing or approve a reviewer's write to make it run.

The parent launcher creates the evidence files and captures the final answer;
the reviewer receives no writable evidence directory. Reviewers can inspect
local files and diffs but cannot fetch a contract or visit the running UI.
The orchestrator supplies those reads and captures browser evidence through
the tools available in its current session. If that is insufficient for a
verdict, the reviewer reports the gap and the run stops at that gate. A green
launcher exit means a response exists, not that its verdict is APPROVE.

The fixture probe verifies the OS command boundary. Before accepting a new
CLI version, also smoke-test the actual reviewer process against a disposable
file using both a shell write and its edit/patch tool; record the denials and
the CLI version locally. Do not claim this is a general restriction on what
files the reviewer may read, or protection against a malicious local executable.

## Commands

The launcher prefers the CLI bundled with ChatGPT/Codex on macOS, then PATH.
It checks for current CLI options and refuses an obsolete version. Set
`TASKA_CODEX_BIN` to select a specific installed executable; it is validated
and fails closed rather than falling back if incompatible. It never installs
or updates a CLI. On this machine the app CLI was verified as
`0.165.0-alpha.1.2`; PATH's `codex 0.46.0` lacks the required flags.

```bash
npm run harness:check
npm run harness:probe
python3 scripts/codex-harness.py run release-reviewer \
  docs/ai/reviews/TAS-NNN-brief.md \
  --output docs/ai/reviews/TAS-NNN-release-round-1.md
```

Use a fresh output name each time. The brief is UTF-8 and contains the Jira
scope and acceptance, exact commit/diff command, changed files, commands and
results, contract pin, browser evidence paths where relevant, and known
limitations. Ask for every blocker and at most three other findings. The
`.md` answer, `.log` transcript and `.json` runtime/probe manifest stay in
git-ignored `docs/ai/reviews/`. Inspect the verdict and summarize it on Jira.
Fixes require a fresh invocation of the role that raised each blocker.

The same command supports all four role names. `frontend-builder` runs with
workspace-write, still with approval `never` and without external integrations;
the orchestrator runs any checks requiring unavailable network/browser access.
Never start it alongside another production-code writer. A builder failure
is reported just like any other missing role; do not take over its edits.

An app may refuse nested OS sandboxes. Run this launcher as a separately
approved local command, keeping **the child's** read-only and approval-never
settings. The outer approval is permission to launch the isolated process,
not permission to raise its privileges. If the outer launch is refused,
report it and stop at the review gate.

## Tool mapping and readiness

| Harness instrument | Codex binding |
| --- | --- |
| Agent / task | Native subagent for builder or research; isolated CLI for gated reviews |
| Read, Grep, Glob, Bash | Available file/shell tools; `rg` first; reviewer's shell under read-only |
| Claude Browser preview tools | Available Codex browser/computer tools; preserve viewport/theme evidence requirements |
| Jira | Personal `jira.ozero.dev` connector, verified before use; browser fallback on the same host if unavailable |
| GitHub writes | Authenticated `gh`, orchestrator only |
| Refero / Context7 | Available matching tools; discover before use, follow REFERENCE-LOCK; report a required gap |
| Skills | Restored `.agents/skills/` through `skills-lock.json`; Claude symlinks remain supported |

At the start of a delivery, confirm the required tools work, the canonical
roles are synchronized, the CLI is authenticated, and the read-only probe
passes before relying on a reviewer. Supply the same role body in both
runtimes. A runtime name or a successful generic spawn is not proof of a
restricted role. The blocked-role disclosure in `AGENTS.md` still applies.
