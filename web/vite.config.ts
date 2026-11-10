import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const YT_HOST = "ytstream-download-youtube-videos.p.rapidapi.com";

/**
 * here.now integration:
 * - writes dist/.herenow/proxy.json from herenow/proxy.template.json. Its /yt/*
 *   route forwards to the YTStream API and adds the RAPIDAPI_KEY account
 *   variable, so the key never reaches the browser. If DUBDECK_API_HOST is set,
 *   the old DubDeck backend routes are added too;
 * - injects a Content-Security-Policy: the Site itself, YouTube thumbnails, and
 *   YouTube's video hosts (for saving files).
 */
function herenow(apiHost: string | null, isBuild: boolean): Plugin {
  const yt = "https://*.googlevideo.com";
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${yt} https://api.github.com${isBuild ? "" : " ws: http://localhost:* http://127.0.0.1:*"}`,
    "img-src 'self' data: blob: https:",
    `media-src 'self' blob: ${yt}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "vortex-herenow",
    transformIndexHtml(html) {
      return html.replace("__CSP__", csp);
    },
    closeBundle() {
      if (!isBuild) return;
      const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "herenow/proxy.template.json"), "utf8"));
      if (apiHost) {
        const headers = { "X-DubDeck-Key": "${DUBDECK_BACKEND_KEY}" };
        manifest.proxies["/api/*"] = { upstream: `https://${apiHost}/api`, headers, rateLimit: "1000/hour/ip" };
        manifest.proxies["/events"] = { upstream: `https://${apiHost}/api/events`, method: "GET", headers, rateLimit: "600/hour/ip" };
      }
      const out = path.resolve(__dirname, "dist/.herenow/proxy.json");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ["DUBDECK_", "RAPIDAPI_"]), ...process.env };
  const isBuild = command === "build";
  const apiHost = (env.DUBDECK_API_HOST || "").trim().toLowerCase() || null;
  if (apiHost && !HOST_RE.test(apiHost)) {
    throw new Error(`DUBDECK_API_HOST must be a bare hostname like api.example.com, got "${apiHost}"`);
  }
  // In dev, Vite plays the role of the here.now proxy: it adds the key server-side.
  // Set RAPIDAPI_KEY in web/.env.local (never commit it) to try real lookups locally.
  const ytProxy = {
    "/gv": { target: "https://redirector.googlevideo.com", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/gv/, "") },
    "/yt": {
      target: `https://${YT_HOST}`, changeOrigin: true,
      headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY || "", "X-RapidAPI-Host": YT_HOST },
      rewrite: (p: string) => p.replace(/^\/yt/, ""),
    },
  };

  return {
    plugins: [react(), herenow(apiHost, isBuild)],
    // The repository the admin editor saves to (set automatically in GitHub Actions).
    define: { __VORTEX_REPO__: JSON.stringify(env.GITHUB_REPOSITORY || "Valcon1910/DubDeck") },
    build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
    server: { port: 5173, proxy: ytProxy },
    preview: { port: 4173, proxy: ytProxy },
  };
});
