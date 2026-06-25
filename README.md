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

## MVP Plan

1. Project shell and CI: Vite app, TypeScript config, npm scripts, GitHub Actions build.
2. API boundary: shared `TaskaApi` interface, stateful mock classes, REST implementation aligned with the draft.
3. Demo flows: login/invite, projects, kanban board, filters, notifications, create issue, issue slide-over.
4. Backend handoff: keep all server calls behind `TaskaApi` so Gateway contract changes stay isolated.
