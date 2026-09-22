import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // .claude/worktrees holds scratch checkouts of this same repository; linting
  // them reports every finding twice. docs/ai/evidence and docs/ai/reviews hold
  // the same thing for a different reason — a review that keeps a source copy
  // of the tree it reviewed — and cost more than a double report: lint fails on
  // another story's snapshot, so `npm run check` cannot run at all in a
  // checkout that has ever hosted a review. All three are git-ignored, which is
  // the repository already saying they are not its source.
  globalIgnores([
    "dist",
    "coverage",
    ".agents",
    ".claude/skills",
    ".claude/worktrees",
    "docs/ai/evidence",
    "docs/ai/reviews",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // The codebase already marks deliberately-unused parameters with a
      // leading underscore — that is the signal, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The entry point mounts the app; it is not a hot-reload boundary and has
    // nothing to export.
    files: ["src/main.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
]);
