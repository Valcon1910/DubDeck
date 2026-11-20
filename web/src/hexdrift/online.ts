// Online records: sends your best runs to the record checker (a Supabase
// function that re-drives each run before saving it) and reads the boards.
// Uses Chat's sign-in, so it only works where Chat does; offline, runs wait on
// this device and are sent the next time the game is opened online.
import type { SupabaseClient } from "@supabase/supabase-js";
import { markSynced, PHYSICS_V, toB64, fromB64, unsynced, type Run } from "./records.ts";

/** The checker is deployed once per physics version, so old and new games never mix. */
const FN = `hexdrift-v${PHYSICS_V}`;
const TABLE = "hexdrift_records";

export interface Entry { email: string; ticks: number; set_at: string; map: string }
export interface Submitted {
  accepted: true; improved: boolean; best: number; rank: number; players: number;
  worldRecord: boolean; beatWorldRecord: boolean;
}
export type SubmitResult = Submitted | { accepted: false; error: string; final: boolean };

export async function submitRun(sb: SupabaseClient, run: Run): Promise<SubmitResult> {
  const { data, error } = await sb.functions.invoke(FN, { body: { map: run.map, ticks: run.t, inputs: toB64(run.inputs), v: run.v } });
  if (!error && data?.accepted) return data as Submitted;
  // A refused run (wrong time or old version) will never be accepted: stop retrying it.
  const status = (error as { context?: Response } | null)?.context?.status ?? 0;
  const final = status === 409 || status === 422 || status === 400;
  return { accepted: false, error: data?.error ?? error?.message ?? "Couldn't send the run", final };
}

let syncing: Promise<Map<string, Submitted>> | null = null;
/** Sends every best run not sent yet. Returns what the checker said, per map. */
export function syncPending(sb: SupabaseClient): Promise<Map<string, Submitted>> {
  if (syncing) return syncing;
  syncing = (async () => {
    const out = new Map<string, Submitted>();
    if (typeof navigator !== "undefined" && !navigator.onLine) return out;
    for (const run of await unsynced()) {
      const r = await submitRun(sb, run).catch(() => null);
      if (!r) break; // network trouble: try again later
      if (r.accepted) { out.set(run.map, r); await markSynced(run.map, run.t); }
      else if (r.final) await markSynced(run.map, run.t);
    }
    return out;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** The top 50 and how many players have a time on this map. */
export async function board(sb: SupabaseClient, map: string) {
  const [top, count] = await Promise.all([
    sb.from(TABLE).select("map,email,ticks,set_at").eq("map", map).eq("v", PHYSICS_V).order("ticks").order("set_at").limit(50),
    sb.from(TABLE).select("email", { count: "exact", head: true }).eq("map", map).eq("v", PHYSICS_V),
  ]);
  if (top.error) throw top.error;
  return { top: (top.data ?? []) as Entry[], players: count.count ?? (top.data?.length ?? 0) };
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
