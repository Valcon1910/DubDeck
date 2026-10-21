import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * here.now integration:
 * - writes dist/.herenow/proxy.json from herenow/proxy.template.json with the
 *   backend's hostname (DUBDECK_API_HOST, e.g. dubdeck-api.example.com);
 * - injects a Content-Security-Policy that only allows the Site itself, Google
 *   Identity Services, and the backend origin (for signed media/thumbnail URLs).
 */
function herenow(apiOrigin: string | null, apiHost: string | null, isBuild: boolean): Plugin {
  const media = apiOrigin ? ` ${apiOrigin}` : "";
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "frame-src https://accounts.google.com/gsi/",
    `connect-src 'self' https://accounts.google.com/gsi/${isBuild ? "" : " ws: http://localhost:* http://127.0.0.1:*"}`,
    "img-src 'self' data: https:" + (isBuild ? "" : " http://127.0.0.1:*"),
    `media-src 'self'${media}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "dubdeck-herenow",
    transformIndexHtml(html) {
      return html.replace("__CSP__", csp);
    },
    closeBundle() {
      if (!isBuild || !apiHost) return;
      const template = fs.readFileSync(path.resolve(__dirname, "herenow/proxy.template.json"), "utf8");
      const out = path.resolve(__dirname, "dist/.herenow/proxy.json");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, template.replaceAll("__DUBDECK_API_HOST__", apiHost));
      JSON.parse(fs.readFileSync(out, "utf8")); // fail the build on invalid JSON
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "DUBDECK_"), ...process.env };
  const isBuild = command === "build";
  const apiHost = (env.DUBDECK_API_HOST || "").trim().toLowerCase() || null;
  if (apiHost && !HOST_RE.test(apiHost)) {
    throw new Error(`DUBDECK_API_HOST must be a bare hostname like api.example.com, got "${apiHost}"`);
  }
  if (isBuild && !apiHost && env.DUBDECK_ALLOW_NO_PROXY !== "1") {
    throw new Error("Set DUBDECK_API_HOST (your tunnel hostname) to build for here.now.");
  }
  const devBackend = env.DUBDECK_DEV_BACKEND || "http://127.0.0.1:8000";
  const apiOrigin = apiHost ? `https://${apiHost}` : isBuild ? null : devBackend;
  // In dev, Vite plays the role of the here.now proxy: it injects the key server-side.
  const proxyHeaders = { "X-DubDeck-Key": env.DUBDECK_BACKEND_KEY || "" };

  return {
    plugins: [react(), herenow(apiOrigin, apiHost, isBuild)],
    build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: devBackend, changeOrigin: true, headers: proxyHeaders },
        "/events": {
          target: devBackend, changeOrigin: true, headers: proxyHeaders,
          rewrite: (p) => p.replace(/^\/events/, "/api/events"),
        },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        "/api": { target: devBackend, changeOrigin: true, headers: proxyHeaders },
        "/events": {
          target: devBackend, changeOrigin: true, headers: proxyHeaders,
          rewrite: (p) => p.replace(/^\/events/, "/api/events"),
        },
      },
    },
  };
});
