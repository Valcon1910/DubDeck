#!/usr/bin/env node
// Keeps Chat's member list in step with the site's access lists.
//
//   node scripts/chat-sync.mjs            members + owners (run on every publish)
//   node scripts/chat-sync.mjs --schema   also (re)apply the database schema first
//
// Everyone on config/allowed-emails.json or config/allowed-emails-test.json is
// a member; people taken off both lists can no longer open Chat. The owners in
// web/src/vortex/admins.ts are moderators.
//
// Talks to Supabase with SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (the
// Management API), or to a local database with CHAT_DB_URL (uses psql).
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => fs.readFileSync(root + f, "utf8");

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const emails = new Set();
for (const f of ["config/allowed-emails.json", "config/allowed-emails-test.json"]) {
  try { for (const e of JSON.parse(read(f)).emails ?? []) emails.add(String(e).trim().toLowerCase()); } catch { /* missing list */ }
}
const owners = [...read("web/src/vortex/admins.ts").match(/OWNER_EMAILS = \[([^\]]*)\]/)?.[1].matchAll(/"([^"]+)"/g) ?? []]
  .map((m) => m[1].toLowerCase());
for (const o of owners) emails.add(o);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const name = (e) => e.split("@")[0].split(/[._-]+/).filter((p) => p && !/^\d+$/.test(p)).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
const list = [...emails].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).sort();

let sql = "";
if (process.argv.includes("--schema")) {
  // Every migration, in order (each one is safe to run again).
  for (const f of fs.readdirSync(root + "supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    sql += read(`supabase/migrations/${f}`) + "\n";
  }
}
sql += `
begin;
insert into public.profiles (email, name, member) values
  ${list.map((e) => `(${q(e)}, ${q(name(e))}, true)`).join(",\n  ")}
  on conflict (email) do update set member = true;
update public.profiles set member = false where email not in (${list.map(q).join(", ")});
delete from public.chat_owners where email not in (${owners.map(q).join(", ") || "''"});
insert into public.chat_owners (email) values ${owners.map((e) => `(${q(e)})`).join(", ")} on conflict do nothing;
commit;
`;

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (process.env.CHAT_DB_URL) {
  execFileSync("psql", [process.env.CHAT_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
} else if (token && ref) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) fail(`Supabase rejected the update: ${res.status} ${(await res.text()).slice(0, 500)}`);
} else {
  fail("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or CHAT_DB_URL for a local database).");
}
console.log(`Chat members: ${list.length} (${owners.length} moderators).`);
