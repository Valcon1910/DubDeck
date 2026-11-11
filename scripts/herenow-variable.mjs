#!/usr/bin/env node
// Store a secret as a here.now account variable that proxy routes can inject,
// pinned so here.now only ever sends it to the given upstream host.
//
//   HERENOW_API_KEY=hnk_... VALUE=... node scripts/herenow-variable.mjs RAPIDAPI_KEY ytstream-download-youtube-videos.p.rapidapi.com
//
// The value is read from the VALUE environment variable, never from arguments,
// so it doesn't end up in logs or shell history.

const API = (process.env.HERENOW_API ?? "https://here.now").replace(/\/$/, "");
const [name, ...hosts] = process.argv.slice(2);
const host = hosts.join(", ");
const key = process.env.HERENOW_API_KEY;
const value = process.env.VALUE ?? "";

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

if (!key) fail("HERENOW_API_KEY is not set.");
if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name ?? "") || !host) fail("Usage: herenow-variable.mjs <NAME> <upstream-host>...");
if (!value.trim()) fail(`${name} is empty.`);

const res = await fetch(`${API}/api/v1/me/variables/${name}`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${key}`,
    "X-HereNow-Client": "github-actions/vortex-engine",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ value: value.trim(), allowedUpstreams: hosts }),
});
if (!res.ok) fail(`here.now rejected ${name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
console.log(`here.now variable ${name} saved, pinned to ${host}.`);
