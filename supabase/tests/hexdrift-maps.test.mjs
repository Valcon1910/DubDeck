// Checks Hexdrift Community Maps against a local Supabase (npx supabase start,
// npx supabase functions serve, with supabase/functions/hexdrift-v<N> copied
// from hexdrift-submit and hexdrift-maps-v<N> from hexdrift-maps).
// Run from web/: node ../supabase/tests/hexdrift-maps.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { newMap, roadDefOf, THEMES, versionOf } from "../../web/src/hexdrift/sim/custom.ts";
import { buildRoadTrack } from "../../web/src/hexdrift/sim/track.ts";
import { botRun } from "../../web/src/hexdrift/sim/bot.ts";
import { PHYSICS_V } from "../../web/src/hexdrift/sim/race.ts";

const { createClient } = createRequire(new URL("../../web/package.json", import.meta.url))("@supabase/supabase-js");

const BASE = process.env.SUPA_URL ?? "http://127.0.0.1:54321";
const LOGIN = `${BASE}/functions/v1/vortex-login`;
const PUBLISH = `${BASE}/functions/v1/hexdrift-maps-v${PHYSICS_V}`;
const SUBMIT = `${BASE}/functions/v1/hexdrift-v${PHYSICS_V}`;
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";
const svc = createClient(BASE, process.env.SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU", { auth: { persistSession: false } });

async function login(email) {
  const r = await fetch(LOGIN, { method: "POST", headers: { "x-vortex-secret": SECRET, "x-vortex-email": email } });
  const s = await r.json();
  assert.ok(s.access_token, `login ${email}: ${JSON.stringify(s)}`);
  const sb = createClient(s.url, s.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  return { sb, token: s.access_token, anonKey: s.anonKey, email };
}
const b64 = (a) => Buffer.from(Uint8Array.from(a)).toString("base64");
async function post(url, who, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}`, apikey: who.anonKey }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
/** A map with the autopilot's finish on it as the author time. */
function authored(m) {
  const run = botRun(buildRoadTrack(roadDefOf(m), THEMES[m.theme].biome));
  assert.ok(run, "the autopilot finishes the test map");
  return { ...m, author: { ticks: run.ticks, inputs: b64(run.inputs), hash: versionOf(m) } };
}

const [ann, bob, cat, dan] = await Promise.all(["ann@x.test", "bob@x.test", "cat@x.test", "dan@x.test"].map(login));
await svc.from("hexdrift_maps").delete().in("author", [ann.email, bob.email, cat.email, dan.email]);

const m = authored(newMap("baja"));
m.name = "Test Loop";

// Refused: no author run, a faked author time, a broken road, an old game, no sign-in.
assert.equal((await post(PUBLISH, ann, { map: { ...m, author: undefined }, v: PHYSICS_V })).status, 422);
assert.equal((await post(PUBLISH, ann, { map: { ...m, author: { ...m.author, ticks: m.author.ticks - 30 } }, v: PHYSICS_V })).status, 400);
const fakeInputs = Buffer.from(m.author.inputs, "base64"); fakeInputs.fill(0, 100, 400);
assert.equal((await post(PUBLISH, ann, { map: { ...m, author: { ...m.author, inputs: fakeInputs.toString("base64") } }, v: PHYSICS_V })).status, 422);
const crossing = authored(newMap("baja"));
crossing.pieces = [...crossing.pieces, { k: "L", a: 180, r: 30 }, { k: "S", len: 200 }];
assert.equal((await post(PUBLISH, ann, { map: { ...crossing, author: { ...m.author, hash: versionOf(crossing) } }, v: PHYSICS_V })).status, 422);
assert.equal((await post(PUBLISH, ann, { map: m, v: PHYSICS_V - 1 })).status, 409);
assert.equal((await fetch(PUBLISH, { method: "POST", body: JSON.stringify({ map: m, v: PHYSICS_V }) })).status, 401);

// Published: in the list, with the author run as the first record.
let r = await post(PUBLISH, ann, { map: m, v: PHYSICS_V });
assert.equal(r.status, 200, JSON.stringify(r.data));
const id = r.data.id;
assert.match(id, /^c[0-9a-z]{8}$/);
const key = `${id}-${versionOf(m)}`;
const { data: listed } = await bob.sb.from("hexdrift_maps").select("id,name,author_ticks,likes,plays").eq("id", id);
assert.equal(listed?.[0]?.name, "Test Loop");
const { data: recs } = await bob.sb.from("hexdrift_records").select("email,ticks").eq("map", key);
assert.deepEqual(recs, [{ email: ann.email, ticks: m.author.ticks }]);

// Others' runs on it go through the record checker like any map.
const bobRun = botRun(buildRoadTrack(roadDefOf(m), THEMES[m.theme].biome), { look: 3, corner: 12, gain: 2.4 });
r = await post(SUBMIT, bob, { map: key, ticks: bobRun.ticks, inputs: b64(bobRun.inputs), v: PHYSICS_V });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.players, 2);
// …but not on an old version of it.
assert.equal((await post(SUBMIT, bob, { map: `${id}-zzz`, ticks: bobRun.ticks, inputs: b64(bobRun.inputs), v: PHYSICS_V })).status, 422);

// The browse list: Bob's run is the world record now, two players finished it.
let { data: cards } = await cat.sb.rpc("hexdrift_list", { p_sort: "new", p_search: "test loop", p_v: PHYSICS_V, p_author: null, p_limit: 10 });
let card = cards.find((c) => c.id === id);
assert.ok(card, "the map is in the list");
assert.equal(card.finishers, 2);
assert.equal(card.wr_ticks, Math.min(m.author.ticks, bobRun.ticks));
assert.equal(card.difficulty, null, "not rated before 5 players");
({ data: cards } = await cat.sb.rpc("hexdrift_list", { p_sort: "author", p_search: "", p_v: PHYSICS_V, p_author: ann.email, p_limit: 10 }));
assert.deepEqual(cards.map((c) => c.id), [id]);
const holder = bobRun.ticks < m.author.ticks ? bob : ann;
const { data: held } = await cat.sb.rpc("hexdrift_held", { p_email: holder.email, p_v: PHYSICS_V });
assert.ok(held.some((h) => h.map === key), "the record holder's profile lists it");

// Likes (not your own), plays (each player once).
assert.ok((await ann.sb.from("hexdrift_map_likes").insert({ map_id: id, email: ann.email })).error, "no liking your own map");
assert.ok(!(await bob.sb.from("hexdrift_map_likes").insert({ map_id: id, email: bob.email })).error);
await bob.sb.rpc("hexdrift_played", { p_map: id });
await bob.sb.rpc("hexdrift_played", { p_map: id });
await cat.sb.rpc("hexdrift_played", { p_map: id });
let { data: row } = await svc.from("hexdrift_maps").select("likes,plays,hidden").eq("id", id).single();
assert.deepEqual(row, { likes: 1, plays: 2, hidden: false });

// Publishing again updates it; a changed road gets a fresh leaderboard.
const m2 = authored({ ...m, pieces: [...m.pieces, { k: "S", len: 60 }] });
r = await post(PUBLISH, ann, { map: m2, v: PHYSICS_V });
assert.deepEqual([r.status, r.data.id, r.data.updated, r.data.changed], [200, id, true, true]);

// Three reports hide it from everyone but its maker; members can't moderate.
for (const who of [bob, cat, dan]) assert.ok(!(await who.sb.from("hexdrift_map_reports").insert({ map_id: id, email: who.email, reason: "broken" })).error);
({ data: row } = await svc.from("hexdrift_maps").select("reports,hidden").eq("id", id).single());
assert.deepEqual(row, { reports: 3, hidden: true });
assert.equal((await bob.sb.from("hexdrift_maps").select("id").eq("id", id)).data.length, 0);
assert.equal((await ann.sb.from("hexdrift_maps").select("id").eq("id", id)).data.length, 1);
assert.ok((await bob.sb.rpc("hexdrift_moderate", { p_map: id, p_action: "unhide" })).error);

// The maker takes it down: its records go too.
assert.ok(!(await ann.sb.from("hexdrift_maps").delete().eq("id", id)).error);
assert.equal((await svc.from("hexdrift_records").select("map").like("map", `${id}-%`)).data.length, 0);
console.log("hexdrift community maps: all good");
