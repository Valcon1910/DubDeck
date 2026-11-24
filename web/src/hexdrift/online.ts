// Online records: sends your best runs to the record checker (a Supabase
// function that re-drives each run before saving it) and reads the boards.
// Uses Chat's sign-in, so it only works where Chat does; offline, runs wait on
// this device and are sent the next time the game is opened online.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readLook, SLOTS, type Look } from "./garage.ts";
import { MAPS, medalFor } from "./maps.ts";
import { MEDAL_POINTS } from "./garage.ts";
import { adoptRun, markSynced, PHYSICS_V, toB64, fromB64, unsynced, type Run } from "./records.ts";

/** The checker is deployed once per physics version, so old and new games never mix. */
const FN = `hexdrift-v${PHYSICS_V}`;
const TABLE = "hexdrift_records";

export interface Entry { email: string; ticks: number; set_at: string; map: string; look?: Look | null }

/** A stored look (JSON text) back into a Look, or null if it's missing or odd. */
export function parseLook(v: unknown): Look | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    const out = {} as Look;
    for (const { slot, items } of SLOTS) {
      const it = items.find((i) => i.id === o[slot]);
      out[slot] = it ? it.id : items[0].id;
    }
    return out;
  } catch { return null; }
}

/** Selects with the car look, falling back to without it until the column exists. */
let hasLook = true;
async function withLook<T>(run: (cols: string) => PromiseLike<{ data: T | null; error: unknown }>, base: string) {
  if (hasLook) {
    const r = await run(`${base},look`);
    if (!r.error) return r;
    hasLook = false;
  }
  return run(base);
}
const lookOf = (rows: Record<string, unknown>[] | null) => (rows ?? []).map((r) => ({ ...r, look: parseLook(r.look) }));
export interface Submitted {
  accepted: true; improved: boolean; best: number; rank: number; players: number;
  worldRecord: boolean; beatWorldRecord: boolean;
}
export type SubmitResult = Submitted | { accepted: false; error: string; final: boolean };

export async function submitRun(sb: SupabaseClient, run: Run): Promise<SubmitResult> {
  const { data, error } = await sb.functions.invoke(FN, { body: { map: run.map, ticks: run.t, inputs: toB64(run.inputs), v: run.v, look: JSON.stringify(readLook()) } });
  if (!error && data?.accepted) return data as Submitted;
  // A refused run (wrong time or old version) will never be accepted: stop retrying it.
  const status = (error as { context?: Response } | null)?.context?.status ?? 0;
  const final = status === 409 || status === 422 || status === 400;
  return { accepted: false, error: data?.error ?? error?.message ?? "Couldn't send the run", final };
}

/**
 * Brings this account's records from its other devices onto this one (the
 * same bests on a phone and a laptop). Older-physics rows still count for
 * medals on maps that haven't changed. Returns true when anything changed.
 */
export async function pullMine(sb: SupabaseClient, me: string): Promise<boolean> {
  const { data, error } = await sb.from(TABLE).select("map,ticks,inputs,v,set_at").eq("email", me);
  if (error || !data) return false;
  let changed = false;
  for (const r of data as { map: string; ticks: number; inputs: string; v: number; set_at: string }[]) {
    if (await adoptRun(r.map, r.ticks, fromB64(r.inputs), r.v, me, Date.parse(r.set_at) || Date.now())) changed = true;
  }
  return changed;
}

let syncing: Promise<{ sent: Map<string, Submitted>; pulled: boolean }> | null = null;
/**
 * Syncs this device with the account: takes in its better records from other
 * devices, then sends every best run not sent yet. Returns what the checker
 * said, per map, and whether records came in.
 */
export function syncAccount(sb: SupabaseClient, me: string) {
  if (syncing) return syncing;
  syncing = (async () => {
    const sent = new Map<string, Submitted>();
    if (typeof navigator !== "undefined" && !navigator.onLine) return { sent, pulled: false };
    const pulled = me ? await pullMine(sb, me).catch(() => false) : false;
    for (const run of await unsynced(me)) {
      const r = await submitRun(sb, run).catch(() => null);
      if (!r) break; // network trouble: try again later
      if (r.accepted) { sent.set(run.map, r); await markSynced(run.map, run.t, me); }
      else if (r.final) await markSynced(run.map, run.t, me);
    }
    return { sent, pulled };
  })().finally(() => { syncing = null; });
  return syncing;
}

/** The top 50 and how many players have a time on this map. */
export async function board(sb: SupabaseClient, map: string, limit = 50) {
  const [top, count] = await Promise.all([
    withLook((cols) => sb.from(TABLE).select(cols).eq("map", map).eq("v", PHYSICS_V).order("ticks").order("set_at").limit(limit), "map,email,ticks,set_at"),
    sb.from(TABLE).select("email", { count: "exact", head: true }).eq("map", map).eq("v", PHYSICS_V),
  ]);
  if (top.error) throw top.error;
  const rows = lookOf(top.data as unknown as Record<string, unknown>[]) as unknown as Entry[];
  return { top: rows, players: count.count ?? rows.length };
}

export interface Leader { email: string; points: number; maps: number; wrs: number; look: Look | null }
/**
 * The medal table: every player's medal points across all maps (their best
 * medal on each), most first. Ties go to more world records, then more maps.
 */
export async function medalLeaders(sb: SupabaseClient, limit = 5): Promise<Leader[]> {
  const r = await withLook((cols) => sb.from(TABLE).select(cols).eq("v", PHYSICS_V).order("ticks").limit(5000), "map,email,ticks,set_at");
  if (r.error) throw r.error;
  const rows = lookOf(r.data as unknown as Record<string, unknown>[]) as unknown as Entry[];
  const by = new Map<string, Leader & { at: string }>();
  const firstOn = new Set<string>();
  for (const e of rows) {
    const m = MAPS.find((x) => x.id === e.map);
    if (!m) continue;
    let l = by.get(e.email);
    if (!l) { l = { email: e.email, points: 0, maps: 0, wrs: 0, look: null, at: "" }; by.set(e.email, l); }
    const medal = medalFor(m, e.ticks);
    if (medal) l.points += MEDAL_POINTS[medal];
    l.maps++;
    // Rows come fastest first, so the first one per map is its world record.
    if (!firstOn.has(e.map)) { firstOn.add(e.map); l.wrs++; }
    if (e.set_at > l.at && e.look) { l.at = e.set_at; l.look = e.look; }
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wrs - a.wrs || b.maps - a.maps).slice(0, limit)
    .map(({ at: _at, ...l }) => l);
}

/** Where a time would rank (1 = world record). */
export async function rankFor(sb: SupabaseClient, map: string, ticks: number) {
  const { count } = await sb.from(TABLE).select("email", { count: "exact", head: true }).eq("map", map).eq("v", PHYSICS_V).lt("ticks", ticks);
  return (count ?? 0) + 1;
}

/** The world record on every map (one small query per map). */
export async function worldRecords(sb: SupabaseClient, maps: string[]) {
  const rows = await Promise.all(maps.map((m) =>
    sb.from(TABLE).select("map,email,ticks,set_at").eq("map", m).eq("v", PHYSICS_V).order("ticks").order("set_at").limit(1)));
  const out = new Map<string, Entry>();
  for (const r of rows) if (r.data?.[0]) out.set(r.data[0].map, r.data[0] as Entry);
  return out;
}

/** The world record with its button presses, for the gold ghost. */
export async function recordRun(sb: SupabaseClient, map: string) {
  const { data } = await sb.from(TABLE).select("email,ticks,inputs").eq("map", map).eq("v", PHYSICS_V).order("ticks").order("set_at").limit(1);
  const r = data?.[0];
  return r ? { email: r.email as string, ticks: r.ticks as number, inputs: fromB64(r.inputs as string) } : null;
}

/** A player's records on every map. */
export async function playerRecords(sb: SupabaseClient, email: string) {
  const { data, error } = await sb.from(TABLE).select("map,email,ticks,set_at").eq("email", email).eq("v", PHYSICS_V);
  if (error) throw error;
  return (data ?? []) as Entry[];
}
