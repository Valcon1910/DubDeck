// Community Maps: maps players publish from the editor. Reading, likes, plays
// and reports go straight to the database (its row-level security decides who
// may do what); publishing goes through the hexdrift-maps function, which
// re-drives the author run first.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanMap, medalsOf, roadDefOf, THEMES, type CustomMap, type ThemeId } from "./sim/custom.ts";
import { PHYSICS_V } from "./sim/race.ts";
import type { MapDef } from "./maps.ts";

const FN = `hexdrift-maps-v${PHYSICS_V}`;
const T = "hexdrift_maps";

export interface CMap {
  id: string; author: string; name: string; theme: ThemeId; version: string;
  author_ticks: number; length_m: number; checkpoints: number;
  likes: number; plays: number; reports: number;
  featured_at: string | null; hidden: boolean; published_at: string; updated_at: string;
  local_id: string;
  pieces?: unknown;
}
const CARD = "id,author,name,theme,version,author_ticks,length_m,checkpoints,likes,plays,reports,featured_at,hidden,published_at,updated_at,local_id";

export type Sort = "featured" | "popular" | "played" | "new" | "mine" | "hidden";

/** True for a community map's record id ("<map id>-<version>"). */
export const isCommunity = (mapId: string) => /^c[0-9a-z]{8}-[0-9a-z]+$/.test(mapId);

export async function listMaps(sb: SupabaseClient, sort: Sort, me: string, search = "", limit = 60): Promise<CMap[]> {
  let q = sb.from(T).select(CARD);
  if (sort === "mine") q = q.eq("author", me);
  else if (sort === "hidden") q = q.eq("hidden", true);
  else q = q.eq("hidden", false);
  if (sort === "featured") q = q.not("featured_at", "is", null).order("featured_at", { ascending: false });
  else if (sort === "popular") q = q.order("likes", { ascending: false }).order("published_at", { ascending: false });
  else if (sort === "played") q = q.order("plays", { ascending: false }).order("published_at", { ascending: false });
  else q = q.order(sort === "hidden" ? "reports" : "published_at", { ascending: false });
  const s = search.trim().replace(/[%_,()*]/g, " ").trim();
  if (s) q = q.ilike("name", `%${s}%`);
  const { data, error } = await q.limit(limit);
  if (error) throw error;
  return (data ?? []) as CMap[];
}

/** A map with its pieces, or null when it's gone (or hidden from you). */
export async function getMap(sb: SupabaseClient, id: string): Promise<CMap | null> {
  const { data, error } = await sb.from(T).select(CARD + ",pieces").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as CMap | null) ?? null;
}

/** The published map as an editor map (to drive, or to copy into your editor). */
export function customOf(c: CMap): CustomMap | null {
  return cleanMap({ id: c.local_id, name: c.name, theme: c.theme, pieces: c.pieces }, c.local_id);
}

/** The published map as the game sees it: online records under "<id>-<version>". */
export function mapDefFrom(c: CMap, by: string): MapDef | null {
  const m = customOf(c);
  if (!m) return null;
  return {
    id: `${c.id}-${c.version}`, name: c.name, biome: THEMES[c.theme].biome, difficulty: "Medium",
    blurb: `${THEMES[c.theme].name} · by ${by}`, road: roadDefOf(m),
    medals: medalsOf(c.author_ticks), since: PHYSICS_V,
  };
}

export type PublishResult = { ok: true; id: string; updated: boolean; changed: boolean } | { ok: false; error: string };
export async function publishMap(sb: SupabaseClient, m: CustomMap): Promise<PublishResult> {
  const { data, error } = await sb.functions.invoke(FN, { body: { map: m, v: PHYSICS_V } });
  if (!error && data?.id) return { ok: true, id: data.id, updated: !!data.updated, changed: !!data.changed };
  let msg = data?.error as string | undefined;
  const ctx = (error as { context?: Response } | null)?.context;
  if (!msg && ctx) msg = await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined);
  return { ok: false, error: msg ?? "Couldn't publish the map. Check your connection." };
}

/** Which of these maps you like. */
export async function myLikes(sb: SupabaseClient, me: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await sb.from("hexdrift_map_likes").select("map_id").eq("email", me).in("map_id", ids);
  return new Set((data ?? []).map((r: { map_id: string }) => r.map_id));
}
export async function setLike(sb: SupabaseClient, me: string, id: string, on: boolean) {
  const r = on
    ? await sb.from("hexdrift_map_likes").insert({ map_id: id, email: me })
    : await sb.from("hexdrift_map_likes").delete().eq("map_id", id).eq("email", me);
  if (r.error) throw r.error;
}
/** Counts you as a player of the map (once). */
export async function markPlayed(sb: SupabaseClient, id: string) { await sb.rpc("hexdrift_played", { p_map: id }); }

export type Reason = "name" | "broken" | "copied" | "other";
export const REASONS: [Reason, string][] = [["name", "Rude name"], ["broken", "Broken or impossible"], ["copied", "Copied from someone"], ["other", "Something else"]];
export async function reportMap(sb: SupabaseClient, me: string, id: string, reason: Reason, note: string) {
  const r = await sb.from("hexdrift_map_reports").insert({ map_id: id, email: me, reason, note: note.slice(0, 200) });
  if (r.error && r.error.code !== "23505") throw r.error; // already reported: fine
}
export async function myReport(sb: SupabaseClient, me: string, id: string) {
  const { data } = await sb.from("hexdrift_map_reports").select("reason").eq("map_id", id).eq("email", me).maybeSingle();
  return !!data;
}
export async function reportsOf(sb: SupabaseClient, id: string) {
  const { data } = await sb.from("hexdrift_map_reports").select("email,reason,note,created_at").eq("map_id", id).order("created_at");
  return (data ?? []) as { email: string; reason: Reason; note: string; created_at: string }[];
}

export type ModAction = "feature" | "unfeature" | "hide" | "unhide";
export async function moderate(sb: SupabaseClient, id: string, action: ModAction) {
  const r = await sb.rpc("hexdrift_moderate", { p_map: id, p_action: action });
  if (r.error) throw r.error;
}
export async function takeDown(sb: SupabaseClient, id: string) {
  const r = await sb.from(T).delete().eq("id", id);
  if (r.error) throw r.error;
}
let owner: Promise<boolean> | null = null;
export function amOwner(sb: SupabaseClient) {
  owner ??= Promise.resolve(sb.rpc("is_chat_owner")).then((r) => r.data === true).catch(() => false);
  return owner;
}

/** Your published copy of an editor map, if any. */
export async function publishedOf(sb: SupabaseClient, me: string, localId: string) {
  const { data } = await sb.from(T).select("id,version").eq("author", me).eq("local_id", localId).maybeSingle();
  return (data as { id: string; version: string } | null) ?? null;
}
