#!/usr/bin/env node
// Make the here.now Site's restricted-access allowlist match config/allowed-emails.json.
//
//   HERENOW_API_KEY=hnk_... HERENOW_SLUG=my-site-ab12 node scripts/sync-access.mjs [file]
//
// PATCH /api/v1/publish/:slug/access replaces the whole list, so this reads the
// current policy first, shows the diff, and writes the file's full contents.
// It never sends invite emails (notify: false).

import { appendFileSync, readFileSync } from "node:fs";

const API = (process.env.HERENOW_API ?? "https://here.now").replace(/\/$/, "");
const CLIENT = process.env.HERENOW_CLIENT ?? "github-actions/dubdeck-access";
const KEY = process.env.HERENOW_API_KEY;
const SLUG = (process.env.HERENOW_SLUG ?? "").trim();
const FILE = process.argv[2] ?? "config/allowed-emails.json";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function load() {
  let data;
  try {
    data = JSON.parse(readFileSync(FILE, "utf8"));
  } catch (e) {
    fail(`${FILE} is not valid JSON: ${e.message}`);
  }
  const extra = Object.keys(data).filter((k) => !["emails", "domains"].includes(k));
  if (extra.length) fail(`${FILE}: unknown key(s) ${extra.join(", ")}. Only "emails" and "domains" are allowed.`);
  const emails = [...new Set((data.emails ?? []).map((e) => String(e).trim().toLowerCase()))].sort();
  const domains = [...new Set((data.domains ?? []).map((d) => String(d).trim().toLowerCase().replace(/^@/, "")))].sort();
  const badE = emails.filter((e) => !EMAIL.test(e));
  const badD = domains.filter((d) => !DOMAIN.test(d));
  if (badE.length) fail(`Invalid email(s) in ${FILE}: ${badE.join(", ")}`);
  if (badD.length) fail(`Invalid domain(s) in ${FILE}: ${badD.join(", ")}`);
  if (emails.length > 10000 || domains.length > 10000) fail("here.now allows at most 10,000 entries per list.");
  return { emails, domains };
}

async function call(method, body) {
  const res = await fetch(`${API}/api/v1/publish/${encodeURIComponent(SLUG)}/access`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "X-HereNow-Client": CLIENT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${method} access → ${res.status} ${data.code ?? ""} ${data.error ?? data.message ?? ""}`.trim());
  return data.access;
}

const want = load();
if (process.argv.includes("--check")) {
  console.log(`${FILE} is valid: ${want.emails.length} email(s), ${want.domains.length} domain(s).`);
  process.exit(0);
}
if (!KEY) fail("HERENOW_API_KEY is not set.");
if (!SLUG) fail("HERENOW_SLUG is not set (repository variable). Deploy the Site first.");

const current = await call("GET");
const have = {
  emails: [...(current.allowedEmails ?? [])].map((e) => e.toLowerCase()).sort(),
  domains: [...(current.allowedDomains ?? [])].map((d) => d.toLowerCase()).sort(),
};
const diff = (a, b) => a.filter((x) => !b.includes(x));
const lines = [
  `Current mode: ${current.mode} (policy v${current.accessPolicyVersion ?? "?"})`,
  ...diff(want.emails, have.emails).map((e) => `+ ${e}`),
  ...diff(have.emails, want.emails).map((e) => `- ${e}`),
  ...diff(want.domains, have.domains).map((d) => `+ @${d}`),
  ...diff(have.domains, want.domains).map((d) => `- @${d}`),
];
console.log(lines.join("\n"));

const same = current.mode === "restricted" && JSON.stringify(want) === JSON.stringify(have);
if (same) {
  console.log("Access policy already matches the file. Nothing to do.");
  process.exit(0);
}
if (!want.emails.length && !want.domains.length) {
  console.log("::warning::The allowlist is empty: the Site becomes owner-only (only the here.now account owner can open it).");
}

const saved = await call("PATCH", {
  mode: "restricted",
  allowedEmails: want.emails,
  allowedDomains: want.domains,
  notify: false,
});
const ok = saved.mode === "restricted" &&
  JSON.stringify([...saved.allowedEmails].sort()) === JSON.stringify(want.emails) &&
  JSON.stringify([...saved.allowedDomains].sort()) === JSON.stringify(want.domains);
if (!ok) fail(`here.now saved a different policy than requested: ${JSON.stringify(saved)}`);
console.log(`Saved: restricted, ${want.emails.length} email(s), ${want.domains.length} domain(s) (policy v${saved.accessPolicyVersion}).`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Access synced\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\`\n`);
}
