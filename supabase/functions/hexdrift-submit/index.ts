// Hexdrift record checker. A player sends their best run on a map: the
// finish time and every button press. This re-drives the run with the game's
// own physics (copied from the game by scripts/hexdrift-share.mjs) and only
// saves it if the car really finishes in that time. Fake times can't get in.
//
// Called by the game with the player's Chat session; nobody can write
// records any other way (the table is read-only for players).

import { MAPS, trackOf } from "../_shared/hexdrift/maps.ts";
import { COUNTDOWN, newRace, PHYSICS_V, step } from "../_shared/hexdrift/race.ts";
import { cleanMap, roadDefOf, THEMES, versionOf } from "../_shared/hexdrift/custom.ts";
import { buildRoadTrack, type Track } from "../_shared/hexdrift/track.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

/**
 * The road of a map: a built-in one, or a community map ("<id>-<version>",
 * only while that version is the one published and not taken down).
 */
async function trackFor(mapId: string): Promise<Track | null> {
  const map = MAPS.find((m) => m.id === mapId);
  if (map) return trackOf(map);
  const c = mapId.match(/^(c[0-9a-z]{8})-([0-9a-z]{1,8})$/);
  if (!c) return null;
  const got = await call(`/rest/v1/hexdrift_maps?id=eq.${c[1]}&hidden=is.false&select=id,local_id,name,theme,pieces,version`);
  const row = got.data?.[0];
  if (!row || row.version !== c[2]) return null;
  const m = cleanMap({ id: row.local_id, name: row.name, theme: row.theme, pieces: row.pieces }, row.local_id);
  if (!m || versionOf(m) !== c[2]) return null;
  return buildRoadTrack(roadDefOf(m), THEMES[m.theme].biome);
}

/** Re-drives the run. Returns the finish time in steps, or null if it doesn't finish. */
function replay(track: Track | null, inputs: Uint8Array): number | null {
  if (!track) return null;
  const r = newRace(track);
  for (let i = 0; i < COUNTDOWN; i++) step(r, 0);
  for (const b of inputs) {
    step(r, b);
    if (r.phase === "finished") break;
  }
  return r.phase === "finished" ? r.finishTicks : null;
}

/** The car look: a small JSON object of part ids, or null if it's anything else. */
function cleanLook(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 400) return null;
  try {
    const o = JSON.parse(v);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const out: Record<string, string> = {};
    for (const k of ["body", "paint", "accent", "wing", "rims", "extra", "trail", "finish"]) {
      const x = o[k];
      if (typeof x === "string" && /^[a-z0-9-]{1,24}$/.test(x)) out[k] = x;
    }
    return JSON.stringify(out);
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Who is this? (Their Chat session, checked by Supabase.)
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = token ? await call("/auth/v1/user", { key: ANON, token }) : { ok: false, data: null };
  const email = String(user.data?.email ?? "").toLowerCase();
  if (!user.ok || !email) return json({ error: "Sign in to Vortex first" }, 401);
  const who = encodeURIComponent(email);
  const member = await call(`/rest/v1/profiles?select=member&email=eq.${who}`);
  if (!member.ok || !member.data?.[0]?.member) return json({ error: "You're not on the Vortex access list" }, 403);

  const body = await req.json().catch(() => null) as { map?: string; ticks?: number; inputs?: string; v?: number; look?: string } | null;
  const map = String(body?.map ?? "");
  const ticks = Number(body?.ticks);
  if (body?.v !== PHYSICS_V) return json({ error: "This run is from an older version of the game", stale: true }, 409);
  if (!/^[a-z0-9-]{1,40}$/.test(map) || !Number.isInteger(ticks) || ticks <= 0 || ticks > 36000) return json({ error: "Bad run" }, 400);
  const inputs = decode(String(body?.inputs ?? ""));
  if (!inputs || inputs.length !== ticks) return json({ error: "Bad run" }, 400);

  const look = cleanLook(body?.look);
  const got = replay(await trackFor(map), inputs);
  if (got !== ticks) return json({ error: "That run doesn't finish in that time", rejected: true }, 422);

  const m = encodeURIComponent(map);
  const board = `/rest/v1/hexdrift_records?map=eq.${m}&v=eq.${PHYSICS_V}`;
  const [top, mine] = await Promise.all([
    call(`${board}&select=email,ticks&order=ticks.asc,set_at.asc&limit=1`),
    call(`/rest/v1/hexdrift_records?map=eq.${m}&email=eq.${who}&select=ticks,v`),
  ]);
  const prevWr = top.data?.[0] ?? null;
  const old = mine.data?.[0] ?? null;
  const better = !old || old.v !== PHYSICS_V || ticks < old.ticks;
  if (better) {
    const saved = await call("/rest/v1/hexdrift_records?on_conflict=map,email", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { map, email, ticks, inputs: body!.inputs, v: PHYSICS_V, set_at: new Date().toISOString(), ...(look ? { look } : {}) },
    });
    if (!saved.ok) return json({ error: "Couldn't save the record" }, 500);
  } else if (look) {
    // Not faster, but show the car they drive now on their record.
    await call(`/rest/v1/hexdrift_records?map=eq.${m}&email=eq.${who}`, { method: "PATCH", prefer: "return=minimal", body: { look } });
  }
  const best = better ? ticks : old.ticks;
  // Rank: everyone faster, plus one.
  const ahead = await call(`${board}&ticks=lt.${best}&select=email`, { prefer: "count=exact" });
  const all = await call(`${board}&select=email`, { prefer: "count=exact" });
  const rank = (Array.isArray(ahead.data) ? ahead.data.length : 0) + 1;
  return json({
    accepted: true,
    improved: better,
    best,
    rank,
    players: Array.isArray(all.data) ? all.data.length : 0,
    worldRecord: rank === 1,
    beatWorldRecord: better && !!prevWr && prevWr.email !== email && ticks < prevWr.ticks,
  });
});
