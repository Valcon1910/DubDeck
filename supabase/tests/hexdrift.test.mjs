// Checks Hexdrift's online records against a local Supabase (npx supabase start,
// npx supabase functions serve, with supabase/functions/hexdrift-v<N> copied
// from hexdrift-submit). Run from web/: node ../supabase/tests/hexdrift.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MAPS, trackOf } from "../../web/src/hexdrift/maps.ts";
import { botRun } from "../../web/src/hexdrift/sim/bot.ts";
import { PHYSICS_V } from "../../web/src/hexdrift/sim/race.ts";

// supabase-js lives in web/node_modules.
const { createClient } = createRequire(new URL("../../web/package.json", import.meta.url))("@supabase/supabase-js");

const BASE = process.env.SUPA_URL ?? "http://127.0.0.1:54321";
const LOGIN = `${BASE}/functions/v1/vortex-login`;
const SUBMIT = `${BASE}/functions/v1/hexdrift-v${PHYSICS_V}`;
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";

async function login(email) {
  const r = await fetch(LOGIN, { method: "POST", headers: { "x-vortex-secret": SECRET, "x-vortex-email": email } });
  const s = await r.json();
  assert.ok(s.access_token, `login ${email}: ${JSON.stringify(s)}`);
  const sb = createClient(s.url, s.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  return { sb, token: s.access_token, anonKey: s.anonKey };
}
const b64 = (a) => Buffer.from(Uint8Array.from(a)).toString("base64");
async function submit(who, body) {
  const r = await fetch(SUBMIT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}`, apikey: who.anonKey }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

const map = MAPS[0].id;
const fast = botRun(trackOf(MAPS[0]), { look: 4, corner: 15, gain: 2.4 }, 120);
const slow = botRun(trackOf(MAPS[0]), { look: 3, corner: 9, gain: 2.4 }, 120);
assert.ok(fast && slow && slow.ticks > fast.ticks, "need two different bot runs");
const run = (r) => ({ map, ticks: r.ticks, inputs: b64(r.inputs), v: PHYSICS_V });

const [ann, bob] = await Promise.all([login("ann@x.test"), login("bob@x.test")]);
// Clean slate for this map.
const svc = createClient(BASE, process.env.SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU", { auth: { persistSession: false } });
await svc.from("hexdrift_records").delete().eq("map", map);

// Fake times are rejected; so are wrong versions, unknown maps and no sign-in.
let r = await submit(ann, { ...run(slow), ticks: slow.ticks - 60, inputs: b64(slow.inputs.slice(0, slow.ticks - 60)) });
assert.equal(r.status, 422, JSON.stringify(r.data));
const tampered = slow.inputs.slice(); for (let i = 200; i < 260; i++) tampered[i] = 0;
r = await submit(ann, { ...run(slow), inputs: b64(tampered) });
assert.equal(r.status, 422, "changed presses");
assert.equal((await submit(ann, { ...run(slow), v: PHYSICS_V - 1 })).status, 409);
assert.equal((await submit(ann, { ...run(slow), map: "nope" })).status, 422);
assert.equal((await fetch(SUBMIT, { method: "POST", body: JSON.stringify(run(slow)) })).status, 401);

// A real run is saved: first on the board.
r = await submit(ann, run(slow));
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual([r.data.accepted, r.data.improved, r.data.rank, r.data.players, r.data.worldRecord], [true, true, 1, 1, true]);
// Slower than your best: kept, not replaced.
r = await submit(ann, run(slow));
assert.equal(r.data.improved, false);

// Bob takes the world record.
r = await submit(bob, run(fast));
assert.deepEqual([r.data.rank, r.data.players, r.data.beatWorldRecord], [1, 2, true]);

// Players can read the board but can't write it.
const { data: board, error } = await ann.sb.from("hexdrift_records").select("email,ticks").eq("map", map).eq("v", PHYSICS_V).order("ticks");
assert.equal(error, null);
assert.deepEqual(board.map((b) => b.email), ["bob@x.test", "ann@x.test"]);
assert.ok((await ann.sb.from("hexdrift_records").insert({ map, email: "ann@x.test", ticks: 1, inputs: "AA==", v: PHYSICS_V })).error, "direct insert");
await ann.sb.from("hexdrift_records").update({ ticks: 1 }).eq("map", map);
await ann.sb.from("hexdrift_records").delete().eq("map", map);
const { data: after } = await svc.from("hexdrift_records").select("email,ticks").eq("map", map).order("ticks");
assert.deepEqual(after.map((b) => b.ticks), [fast.ticks, slow.ticks], "update/delete blocked");

await svc.from("hexdrift_records").delete().eq("map", map);
console.log("✓ Hexdrift records: fake runs rejected, real runs ranked, table read-only");
