# Taska UI

MVP frontend for Taska, a lightweight issue tracker with project list, kanban board, issue slide-over, create issue flow, notifications, dark/light theme, and mock-backed interactions.

## Stack

- React 19 + TypeScript
- Vite 8
- React Router
- TanStack Query
- dnd-kit for board drag-and-drop
- lucide-react icons
- CSS custom properties for the design tokens from `design_handoff_taska`

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

The app uses the in-memory mock API by default. It is stateful, so creating issues, moving cards, editing issue fields, assigning users, and marking notifications read all update the demo state during the session.

To point the same UI at API Gateway later:

```bash
VITE_TASKA_API_MODE=rest
VITE_TASKA_API_BASE_URL=/api/v1
```

The switch happens in `src/api/client.ts`. The shared UI contract is `src/api/TaskaApi.ts`; mock behavior is in `src/api/mock/MockTaskaApi.ts`, and the future REST client is in `src/api/rest/RestTaskaApi.ts`.

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
```

Keep `VITE_ROUTER_MODE=hash` unless you add a separate SPA fallback strategy. With the default GitHub Pages hosting, hash routing keeps routes reload-safe on both `github.io` and custom domains.

## MVP Plan

1. Project shell and CI: Vite app, TypeScript config, npm scripts, GitHub Actions build.
2. API boundary: shared `TaskaApi` interface, stateful mock classes, REST implementation aligned with the draft.
3. Demo flows: login/invite, projects, kanban board, filters, notifications, create issue, issue slide-over.
4. Backend handoff: keep all server calls behind `TaskaApi` so Gateway contract changes stay isolated.
