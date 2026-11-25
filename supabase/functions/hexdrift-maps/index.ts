// Hexdrift Community Maps: publishing. A member sends a map from their
// editor with their own finish on it (the author time). This rebuilds the
// road from the pieces with the game's own code, re-drives the run, and only
// saves the map if the car really finishes in that time: every published map
// can be finished, and its medals are honest. Publishing the same editor map
// again updates it (a changed road gets a fresh leaderboard).
//
// Likes, plays, reports and moderation go straight to the database under its
// row-level security (see the hexdrift_community migration).

import { checkMap, cleanMap, roadDefOf, THEMES, versionOf, type CustomMap } from "../_shared/hexdrift/custom.ts";
import { buildRoadTrack } from "../_shared/hexdrift/track.ts";
import { COUNTDOWN, newRace, PHYSICS_V, step } from "../_shared/hexdrift/race.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** How many maps one player may publish (new ones per day, and in all). */
const PER_DAY = 10, IN_ALL = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function call(path: string, init: { method?: string; body?: unknown; key?: string; token?: string; prefer?: string } = {}) {
  const key = init.key ?? SERVICE;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  const bearer = init.token ?? (key.startsWith("eyJ") ? key : "");
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${URL}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function decode(b64: string): Uint8Array | null {
  try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** Re-drives a run on the map: its finish time in steps, or null. */
export function replayOn(m: CustomMap, inputs: Uint8Array): number | null {
  const r = newRace(buildRoadTrack(roadDefOf(m), THEMES[m.theme].biome));
  for (let i = 0; i < COUNTDOWN; i++) step(r, 0);
  for (const b of inputs) {
    step(r, b);
    if (r.phase === "finished") break;
  }
  return r.phase === "finished" ? r.finishTicks : null;
}

const newId = () => "c" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = token ? await call("/auth/v1/user", { key: ANON, token }) : { ok: false, data: null };
  const email = String(user.data?.email ?? "").toLowerCase();
  if (!user.ok || !email) return json({ error: "Sign in to Vortex first" }, 401);
  const who = encodeURIComponent(email);
  const member = await call(`/rest/v1/profiles?select=member&email=eq.${who}`);
  if (!member.ok || !member.data?.[0]?.member) return json({ error: "You're not on the Vortex access list" }, 403);

  const body = await req.json().catch(() => null) as { map?: unknown; v?: number } | null;
  if (body?.v !== PHYSICS_V) return json({ error: "Update the game first: it's an older version", stale: true }, 409);
  const raw = body?.map as Record<string, unknown> | undefined;
  const m = cleanMap(raw, "");
  if (!m || !m.id || typeof raw?.id !== "string" || m.id !== raw.id) return json({ error: "That isn't a map" }, 400);
  if (!m.name.trim()) return json({ error: "Give the map a name" }, 400);

  const check = checkMap(m);
  if (!check.road || check.problems.length) return json({ error: check.problems[0]?.text ?? "This road can't be built" }, 422);
  const version = versionOf(m);
  const a = m.author;
  if (!a || a.hash !== version) return json({ error: "Drive the map to the finish first: your time sets its medals" }, 422);
  const inputs = decode(a.inputs);
  if (!inputs || inputs.length !== a.ticks || a.ticks > 36000) return json({ error: "Bad author run" }, 400);
  if (replayOn(m, inputs) !== a.ticks) return json({ error: "Your author run doesn't finish in that time on this map. Drive it again.", rejected: true }, 422);

  // Publishing again updates the map; a new one has limits.
  const mine = await call(`/rest/v1/hexdrift_maps?author=eq.${who}&select=id,local_id,published_at,version`);
  if (!mine.ok) return json({ error: "Couldn't reach the maps" }, 500);
  const rows = (mine.data ?? []) as { id: string; local_id: string; published_at: string; version: string }[];
  const old = rows.find((r) => r.local_id === m.id);
  if (!old) {
    const day = Date.now() - 24 * 3600 * 1000;
    if (rows.filter((r) => Date.parse(r.published_at) > day).length >= PER_DAY) return json({ error: `You can publish ${PER_DAY} new maps a day. Try again tomorrow.` }, 429);
    if (rows.length >= IN_ALL) return json({ error: `You have ${IN_ALL} maps out. Take one down to publish another.` }, 429);
  }
  const id = old?.id ?? newId();
  const now = new Date().toISOString();
  const row = {
    id, author: email, local_id: m.id, name: m.name.trim(), theme: m.theme, pieces: m.pieces, version,
    author_ticks: a.ticks, author_inputs: a.inputs, length_m: Math.round(check.length), checkpoints: check.road.gates.length,
    v: PHYSICS_V, updated_at: now,
  };
  const saved = old
    ? await call(`/rest/v1/hexdrift_maps?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: row })
    : await call("/rest/v1/hexdrift_maps", { method: "POST", prefer: "return=minimal", body: { ...row, published_at: now } });
  if (!saved.ok) return json({ error: "Couldn't save the map" }, 500);

  // The author's run opens the leaderboard on this version (unless they already beat it there).
  const key = `${id}-${version}`;
  const had = await call(`/rest/v1/hexdrift_records?map=eq.${key}&email=eq.${who}&v=eq.${PHYSICS_V}&select=ticks`);
  if (!(had.data?.[0]?.ticks <= a.ticks)) await call("/rest/v1/hexdrift_records?on_conflict=map,email", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { map: key, email, ticks: a.ticks, inputs: a.inputs, v: PHYSICS_V, set_at: now },
  });
  return json({ id, version, updated: !!old, changed: !!old && old.version !== version });
});
