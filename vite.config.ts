import { defineConfig, loadEnv } from "vite";
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

  return {
    base,
    plugins: [
      react(),
      {
        name: "taska-public-url",
        transformIndexHtml: (html) => html.replaceAll("%TASKA_PUBLIC_URL%", publicUrl),
      },
    ],
    server: {
      port: 5173,
      // Gateway CORS only allows https://taska.ozero.dev, so local dev
      // reaches it through a same-origin proxy.
      proxy: {
        "/api": {
          target: env.VITE_TASKA_API_PROXY_TARGET || "https://api.taska.ozero.dev",
          changeOrigin: true,
          configure: (proxy) => {
            // The gateway rejects foreign origins with 403; without the
            // Origin header the proxied request is not a CORS request.
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("origin");
            });
          },
        },
      },
    },
  };
});
