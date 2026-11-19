#!/usr/bin/env node
// Build the public entry/Apply page: web/apply + config/apply.json (texts you can
// change in Admin) + the real site's address → the given output folder.
//   node scripts/build-apply.mjs /tmp/apply-dist
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) { console.error("Usage: build-apply.mjs <out-dir>"); process.exit(1); }
const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };
const texts = read("config/apply.json");
const slug = String(process.env.REAL_SLUG || read("config/site.json").slug || "").trim();
const clean = Object.fromEntries(Object.entries(texts)
  .filter(([k, v]) => /^[a-zA-Z]{1,40}$/.test(k) && typeof v === "string")
  .map(([k, v]) => [k, v.slice(0, 1000)]));
if (clean.accent && !/^#[0-9a-fA-F]{6}$/.test(clean.accent)) delete clean.accent;
cpSync("web/apply", out, { recursive: true });
writeFileSync(`${out}/apply.json`, JSON.stringify({ ...clean, siteUrl: /^[a-z0-9-]{1,80}$/.test(slug) ? `https://${slug}.here.now/` : "" }, null, 2) + "\n");
console.log(`Built the Apply page in ${out}${existsSync(`${out}/index.html`) ? "" : " (index.html missing!)"}.`);
