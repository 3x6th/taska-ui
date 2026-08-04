# Taska UI

MVP frontend for Taska, a lightweight issue tracker with project list, kanban board, issue slide-over, create issue flow, notifications, dark/light theme, and mock-backed interactions.

## Stack

- React 19 + TypeScript
- Vite 8
- React Router
- TanStack Query
- dnd-kit for board drag-and-drop
- lucide-react icons
- CSS custom properties for the design tokens from `DESIGN.md`

## Run

```bash
npm install
npm run dev
```

Build and typecheck:

```bash
npm run typecheck
npm run build
```

## API Mode

The default `hybrid` mode sends auth, projects, issues, workflow and notifications to API Gateway. Until TAS-137 provides project membership and member read endpoints, hybrid mode exposes the current user as the project's only visible member.

For the temporary admin-only test environment:

```bash
VITE_TASKA_ASSUME_PROJECT_ADMIN=true
```

Remove this flag after TAS-137 is deployed. It is a UI compatibility switch; backend authorization remains authoritative.

To opt into REST-only mode once the remaining gateway endpoints are available:

```bash
VITE_TASKA_API_MODE=rest
VITE_TASKA_API_BASE_URL=/api/v1
```

Use `VITE_TASKA_API_MODE=mock` for the fully in-memory demo. The switch happens in `src/api/client.ts`; the shared UI contract is `src/api/TaskaApi.ts`, mock behavior is in `src/api/mock/MockTaskaApi.ts`, and the gateway adapter is in `src/api/rest/RestTaskaApi.ts`.

## AI harness

This repository is built with an explicit agent harness. [AGENTS.md](AGENTS.md) is
the single authority for roles, source ranking, frontend constraints, evidence, and
safety; [CLAUDE.md](CLAUDE.md) only points at it.

Four subagents live in `.claude/agents/`. `frontend-builder` is the only one that may
edit production code; `art-director`, `api-contract-guard`, and `release-reviewer` are
read-only, enforced through their tool lists.

Supporting records are in [docs/ai/](docs/ai/) — notably
[API-DIVERGENCE.md](docs/ai/API-DIVERGENCE.md), which tracks every place the UI
compensates for gateway behaviour that differs from the REST draft.

Third-party skills are pinned in `skills-lock.json` and restored on demand:

```bash
npx skills experimental_install
```

They land in `.agents/skills/` (git-ignored, like `node_modules`) and are reachable
through the tracked symlinks in `.claude/skills/`.

`art-director` can use the Refero design-reference MCP declared in `.mcp.json`,
constrained by [docs/ai/REFERENCE-LOCK.md](docs/ai/REFERENCE-LOCK.md). It reads the
token from `REFERO_API_KEY` in your environment — the committed config never contains
the literal value. Without the variable set, that agent just has no reference tools.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. It builds the Vite app, uploads `dist`, and deploys it through GitHub Pages.

To enable it in GitHub:

1. Push the repo to GitHub.
2. Open `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` or run `Deploy to GitHub Pages` manually from the Actions tab.

For a repository named `taska-ui`, the app will be served at:

```text
https://<username>.github.io/taska-ui/
```

The Pages workflow sets:

```text
VITE_BASE_PATH=/${{ github.event.repository.name }}/
VITE_ROUTER_MODE=hash
```

`VITE_BASE_PATH` makes Vite asset URLs work under the repository path. `VITE_ROUTER_MODE=hash` avoids GitHub Pages refresh/deep-link 404s for client-side routes.

For a custom domain such as `tasks.example.com`, set this repository variable in GitHub:

```text
VITE_BASE_PATH=/
VITE_SITE_URL=https://tasks.example.com/
```

`VITE_SITE_URL` is used for Open Graph previews in Telegram and other messengers. Keep `VITE_ROUTER_MODE=hash` unless you add a separate SPA fallback strategy. With the default GitHub Pages hosting, hash routing keeps routes reload-safe on both `github.io` and custom domains.

## MVP Plan

1. Project shell and CI: Vite app, TypeScript config, npm scripts, GitHub Actions build.
2. API boundary: shared `TaskaApi` interface, stateful mock classes, REST implementation aligned with the draft.
3. Demo flows: login/invite, projects, kanban board, filters, notifications, create issue, issue slide-over.
4. Backend handoff: keep all server calls behind `TaskaApi` so Gateway contract changes stay isolated.
