import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function getGitHubPagesUrl(repository?: string) {
  const [owner, repo] = repository?.split("/") ?? [];
  return owner && repo ? `https://${owner}.github.io/${repo}/` : "";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH ?? "/";
  const publicUrl = withTrailingSlash(env.VITE_SITE_URL || getGitHubPagesUrl(process.env.GITHUB_REPOSITORY) || base);
  const apiProxyTarget = env.VITE_TASKA_API_PROXY_TARGET;

  return {
    base,
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
      // e2e/ belongs to Playwright; Vitest must not pick up its specs — it
      // throws outright on a Playwright test(). The globs need a `**/` prefix
      // because Vitest also scans .claude/worktrees, which holds scratch
      // checkouts of this same repository (see eslint.config.js globalIgnores,
      // which ignores them for the same reason).
      exclude: [...configDefaults.exclude, "**/e2e/**", "**/.claude/worktrees/**"],
    },
    plugins: [
      react(),
      {
        name: "taska-public-url",
        transformIndexHtml: (html) => html.replaceAll("%TASKA_PUBLIC_URL%", publicUrl),
      },
    ],
    server: {
      port: 5173,
      // Gateway CORS only allows its own frontend origin, so local dev
      // reaches it through a same-origin proxy. The target comes from
      // VITE_TASKA_API_PROXY_TARGET (see .env.example); no proxy otherwise.
      proxy: apiProxyTarget
        ? {
            "/api": {
              target: apiProxyTarget,
              changeOrigin: true,
              configure: (proxy) => {
                // The gateway rejects foreign origins with 403; without the
                // Origin header the proxied request is not a CORS request.
                proxy.on("proxyReq", (proxyReq) => {
                  proxyReq.removeHeader("origin");
                });
              },
            },
          }
        : undefined,
    },
  };
});
