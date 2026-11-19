#!/usr/bin/env node
// Send here.now's "you got in" invite email to one address already allowed on a Site.
//   HERENOW_API_KEY=... EMAIL=me@x.co node scripts/send-invite.mjs
import { findSlug, SITE_NAME } from "./herenow-site.mjs";
import { gmailReady, sendWelcome } from "./mail.mjs";

const API = (process.env.HERENOW_API ?? "https://here.now").replace(/\/$/, "");
const CLIENT = "github-actions/vortex-invite";
const KEY = process.env.HERENOW_API_KEY;
const email = String(process.env.EMAIL ?? "").trim().toLowerCase();
const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };

if (!KEY) fail("HERENOW_API_KEY is not set.");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("That isn't a valid email address.");
const slug = await findSlug({ api: API, key: KEY, client: CLIENT });
if (!slug) fail(`No ${SITE_NAME} Site found.`);
if (gmailReady()) {
  const sent = await sendWelcome([email], `https://${slug}.here.now/`, { [email]: "there" });
  if (!sent.length) fail("Gmail didn't send it. Check the GMAIL_ADDRESS and GMAIL_APP_PASSWORD secrets.");
  console.log(`Sent your own "you got in" email from Gmail (${SITE_NAME}).`);
  process.exit(0);
}
console.log("No Gmail secrets yet, so this is here.now's own invite email.");
const res = await fetch(`${API}/api/v1/publish/${encodeURIComponent(slug)}/access/invites`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "X-HereNow-Client": CLIENT, "Content-Type": "application/json" },
  body: JSON.stringify({ emails: [email] }),
});
const text = await res.text();
if (!res.ok) fail(`here.now: ${res.status} ${text.slice(0, 300)}`);
let skipped = [];
try { skipped = JSON.parse(text).notifications?.skipped ?? []; } catch {}
if (skipped.length) fail(`Not sent: ${JSON.stringify(skipped).slice(0, 300)} (the address must be on ${SITE_NAME}'s list).`);
console.log(`Sent the invite email for ${SITE_NAME} (${slug}).`);
