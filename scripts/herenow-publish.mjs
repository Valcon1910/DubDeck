#!/usr/bin/env node
// Publish a built directory to here.now: create (or update) → upload → finalize.
//
//   HERENOW_API_KEY=hnk_... [HERENOW_SLUG=my-site-ab12] node scripts/herenow-publish.mjs web/dist
//
// Without HERENOW_SLUG a new Site is created and its slug is printed; save it as
// the HERENOW_SLUG repository variable so later runs update the same Site.
// The job fails if finalize reports warnings about .herenow/proxy.json or
// .herenow/data.json (here.now still publishes, but silently disables the routes).

import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API = (process.env.HERENOW_API ?? "https://here.now").replace(/\/$/, "");
const CLIENT = process.env.HERENOW_CLIENT ?? "github-actions/dubdeck-deploy";
const KEY = process.env.HERENOW_API_KEY;
const SLUG = (process.env.HERENOW_SLUG ?? "").trim();
const dir = process.argv[2];

const TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  webp: "image/webp",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

if (!KEY) fail("HERENOW_API_KEY is not set.");
if (!dir) fail("Usage: node scripts/herenow-publish.mjs <dir>");

function walk(root, at = root) {
  return readdirSync(at, { withFileTypes: true }).flatMap((d) => {
    const full = join(at, d.name);
    if (d.isDirectory()) return walk(root, full);
    if (!d.isFile()) return [];
    const path = relative(root, full).split(sep).join("/");
    const data = readFileSync(full);
    const ext = path.split(".").pop().toLowerCase();
    return [{
      path,
      full,
      size: statSync(full).size,
      contentType: TYPES[ext] ?? "application/octet-stream",
      hash: createHash("sha256").update(data).digest("hex"),
    }];
  });
}

async function call(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "X-HereNow-Client": CLIENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      fail(`${method} ${path} → ${res.status} ${data.code ?? ""} ${data.error ?? data.message ?? ""}`.trim());
    }
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    console.warn(`${method} ${path} → ${res.status}; retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

async function upload(u, file) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(u.url, {
      method: u.method ?? "PUT",
      headers: u.headers ?? { "Content-Type": file.contentType },
      body: readFileSync(file.full),
    });
    if (res.ok) return;
    console.warn(`upload ${file.path} → ${res.status} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  fail(`Uploading ${file.path} failed.`);
}

const files = walk(dir);
if (!files.some((f) => f.path === "index.html")) fail(`${dir}/index.html not found. Did the build run?`);
if (!files.some((f) => f.path === ".herenow/proxy.json") && process.env.DUBDECK_ALLOW_NO_PROXY !== "1") {
  fail(`${dir}/.herenow/proxy.json not found. Build with DUBDECK_API_HOST set.`);
}
console.log(`Publishing ${files.length} files from ${dir} to ${SLUG || "a new Site"}`);

const body = {
  files: files.map(({ path, size, contentType, hash }) => ({ path, size, contentType, hash })),
  spaMode: true,
  displayName: "DubDeck",
  displayDescription: "Private video and audio downloader (web front end).",
};
const created = SLUG
  ? await call("PUT", `/api/v1/publish/${encodeURIComponent(SLUG)}`, body)
  : await call("POST", "/api/v1/publish", body);
const slug = created.slug ?? SLUG;
const uploads = created.upload?.uploads ?? [];
const byPath = new Map(files.map((f) => [f.path, f]));
console.log(`Uploading ${uploads.length} changed file(s); ${created.upload?.skipped?.length ?? 0} unchanged.`);

const queue = [...uploads];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let u = queue.shift(); u; u = queue.shift()) await upload(u, byPath.get(u.path));
}));

const fin = await call("POST", `/api/v1/publish/${encodeURIComponent(slug)}/finalize`, {
  versionId: created.upload.versionId,
});
const warnings = fin.warnings ?? [];
for (const w of warnings) console.log(`::warning::here.now: ${w}`);
const manifestWarnings = warnings.filter((w) => /proxy\.json|data\.json|\.herenow\//i.test(w));
if (manifestWarnings.length) {
  fail(`here.now reported manifest problems; proxy routes may be disabled:\n${manifestWarnings.join("\n")}`);
}

console.log(`Live: ${fin.siteUrl}${fin.unchanged ? " (unchanged)" : ""}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### DubDeck deployed\n\n${fin.siteUrl}\n\nslug: \`${slug}\`\n`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${slug}\nsite_url=${fin.siteUrl}\n`);
if (!SLUG) {
  console.log(`::notice::New Site created. Save "${slug}" as the HERENOW_SLUG repository variable.`);
}
