#!/usr/bin/env node
// Make the here.now Site's restricted-access allowlist match config/allowed-emails.json.
//
//   HERENOW_API_KEY=hnk_... HERENOW_SLUG=my-site-ab12 node scripts/sync-access.mjs [file]
//
// PATCH /api/v1/publish/:slug/access replaces the whole list, so this reads the
// current policy first, shows the diff, and writes the file's full contents.
// It never sends invite emails (notify: false).

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { findSlug, SITE_NAME } from "./herenow-site.mjs";
import { sendWelcome } from "./mail.mjs";

const API = (process.env.HERENOW_API ?? "https://here.now").replace(/\/$/, "");
const CLIENT = process.env.HERENOW_CLIENT ?? "github-actions/dubdeck-access";
const KEY = process.env.HERENOW_API_KEY;
let SLUG = "";
// The test site has its own list (HERENOW_ACCESS_FILE=config/allowed-emails-test.json).
let FILE = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.HERENOW_ACCESS_FILE ?? "config/allowed-emails.json";
if (!existsSync(FILE)) {
  console.log(`::warning::${FILE} doesn't exist yet; using config/allowed-emails.json.`);
  FILE = "config/allowed-emails.json";
}
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

// The Apply page is a separate Site anyone can open: HERENOW_ACCESS_MODE=public.
if (process.env.HERENOW_ACCESS_MODE === "public") {
  if (!KEY) fail("HERENOW_API_KEY is not set.");
  SLUG = (await findSlug({ api: API, key: KEY, client: CLIENT })) ?? "";
  if (!SLUG) fail(`No ${SITE_NAME} Site found.`);
  const now = await call("GET");
  if (now.mode !== "anyone_with_link") await call("PATCH", { mode: "anyone_with_link" });
  console.log(`${SITE_NAME} (${SLUG}) is open to anyone with the link.`);
  process.exit(0);
}

const want = load();
if (process.argv.includes("--check")) {
  console.log(`${FILE} is valid: ${want.emails.length} email(s), ${want.domains.length} domain(s).`);
  process.exit(0);
}
if (!KEY) fail("HERENOW_API_KEY is not set.");
SLUG = (await findSlug({ api: API, key: KEY, client: CLIENT })) ?? "";
if (!SLUG) {
  // Nothing to update yet; the deploy workflow applies the list when it creates the Site.
  console.log(`::notice::No ${SITE_NAME} Site yet; the next deploy applies the access list.`);
  process.exit(0);
}

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
// Accepted applicants who were just let in get here.now's invite email: it says
// they were given access and links to the site.
const ACCEPTED_FILE = "config/applications.json";
// Test mode accepts onto the test site (testAccepted).
const KEY_NAME = FILE === "config/allowed-emails.json" ? "accepted" : FILE === "config/allowed-emails-test.json" ? "testAccepted" : "";
if (KEY_NAME && existsSync(ACCEPTED_FILE)) {
  let accepted = [];
  try { accepted = (JSON.parse(readFileSync(ACCEPTED_FILE, "utf8"))[KEY_NAME] ?? []).map((e) => String(e).toLowerCase()); } catch {}
  const invite = diff(want.emails, have.emails).filter((e) => accepted.includes(e));
  let names = {};
  try { names = JSON.parse(readFileSync(ACCEPTED_FILE, "utf8")).names ?? {}; } catch {}
  // Your own email from Gmail when set up; here.now's invite email otherwise.
  const viaGmail = await sendWelcome(invite, `https://${SLUG}.here.now/`, names);
  if (viaGmail.length) console.log(`Sent your "you got in" email from Gmail to ${viaGmail.length} accepted applicant(s).`);
  const rest = invite.filter((e) => !viaGmail.includes(e));
  if (rest.length) {
    const res = await fetch(`${API}/api/v1/publish/${encodeURIComponent(SLUG)}/access/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "X-HereNow-Client": CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify({ emails: rest }),
    });
    if (res.ok) console.log(`Sent here.now's invite email to ${rest.length} accepted applicant(s).`);
    else console.log(`::warning::Couldn't send the invite email(s): ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
console.log(`Saved: restricted, ${want.emails.length} email(s), ${want.domains.length} domain(s) (policy v${saved.accessPolicyVersion}).`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Access synced\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\`\n`);
}
