// The party room you're in, kept for the whole visit (not just while its page
// is open): who's in, the host's map and laps, and each race from the start
// to the results. Its page (party.tsx) and the card on other pages
// (partydock.tsx) both show it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTY_MAPS, type MapDef } from "./maps.ts";
import { readLook } from "./garage.ts";
import { parseLook } from "./online.ts";
import type { Game } from "./game.ts";
import { MONTH_CAP, Room, ROOM_MAX, type RoomMsg } from "./room.ts";
import { getMap, isCommunity, mapDefFrom } from "./community.ts";
import { getParty, subscribeParty } from "./partyhub.ts";

/** After the first finish, the others get this long before the race closes. */
export const CLOSE_AFTER = 30_000;
/** How long the host waits for slow devices to load before saying go anyway. */
const LOAD_WAIT = 12_000;

export const mapById = (id: string) => PARTY_MAPS.find((m) => m.id === id);
/** A map the room can race: built in, or a community map's exact version ("<id>-<version>"). */
const known = (id: string) => !!mapById(id) || isCommunity(id);
const raceId = () => Math.random().toString(36).slice(2, 10);

/** Community maps fetched this visit (null: gone, hidden, or since changed). */
const fetched = new Map<string, Promise<MapDef | null>>();
function communityDef(sb: SupabaseClient, id: string, nameOf: (e: string) => string): Promise<MapDef | null> {
  let p = fetched.get(id);
  if (!p) {
    const cut = id.lastIndexOf("-"), cid = id.slice(0, cut), version = id.slice(cut + 1);
    // Everyone races the version the host picked: an update since then doesn't load.
    p = getMap(sb, cid).then((c) => c && c.version === version ? mapDefFrom(c, nameOf(c.author)) : null).catch(() => null);
    p.then((d) => { if (!d) fetched.delete(id); }, () => fetched.delete(id));
    fetched.set(id, p);
  }
  return p;
}

export interface RaceStage {
  k: "race"; id: string; map: string; laps: number; who: string[];
  go: boolean; startedAt: number; goAt: number; firstAt: number;
  times: Map<string, number>;
}
export interface ResultStage { k: "result"; id: string; map: string; laps: number; order: string[]; times: Map<string, number> }
export type Stage = { k: "lobby" } | RaceStage | ResultStage;
export interface Settings { map: string; laps: number }
export interface Hud { place: number; of: number; lap: number; busy: boolean }

export class PartySession {
  readonly room: Room;
  settings: Settings = { map: PARTY_MAPS[0].id, laps: 3 };
  stage: Stage = { k: "lobby" };
  fail = "";
  note = "";
  hud: Hud | null = null;
  /** Community maps: missing while loading, null when it won't load. */
  readonly defs = new Map<string, MapDef | null>();
  /** Bumps on every change (for React). */
  version = 0;
  private subs = new Set<() => void>();
  /** Who on the race has loaded (the host's count). */
  private loaded = new Set<string>();
  /** The latest progress of everyone (from the race screen), for places. */
  private prog = new Map<string, { dist: number; done: boolean }>();
  private game: Game | null = null;
  private seen = 0;
  private clock = 0;

  constructor(readonly code: string, private sb: SupabaseClient, readonly me: string, myName: string, public nameOf: (e: string) => string) {
    this.room = new Room(sb, code, { email: me, name: myName, look: JSON.stringify(readLook()) }, {
      change: () => this.changed(),
      car: (email, d) => this.game?.remotePacket(email, d),
      msg: (from, m) => this.onMsg(from, m),
      fail: (why) => { this.fail = why; this.emit(); },
    });
    void this.room.join();
    this.clock = window.setInterval(() => this.tick(), 400);
    this.want();
  }

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  getVersion = () => this.version;
  private emit() { this.version++; this.subs.forEach((f) => f()); }

  get members() { return this.room.members; }
  get isHost() { return this.room.isHost; }
  get inRoom() { return this.room.members.some((m) => m.email === this.me); }
  /** You're on the grid of the race that's on. */
  get racing() { return this.stage.k === "race" && this.stage.who.includes(this.me) && this.inRoom; }
  defOf(id: string): MapDef | null | undefined { return mapById(id) ?? this.defs.get(id); }
  name(e: string) { return e === this.me ? "You" : this.room.members.find((m) => m.email === e)?.name || this.nameOf(e); }

  close() {
    clearInterval(this.clock);
    this.room.leave();
    this.subs.clear();
  }

  private changed() {
    const r = this.room;
    // The host tells anyone new what's set (and whether a race is on).
    if (r.isHost && r.members.length > this.seen) {
      const st = this.stage;
      r.send({ k: "settings", mode: "race", ...this.settings, race: st.k === "race" ? st.id : undefined });
    }
    this.seen = r.members.length;
    // People leaving a race: their cars go.
    const g = this.game;
    if (g) for (const e of g.progress().keys()) if (e && !r.members.some((m) => m.email === e)) g.removeRemote(e);
    this.emit();
  }

  private onMsg(from: string, m: RoomMsg) {
    const r = this.room;
    const st = this.stage;
    // Only the host sets the room up and starts or closes races.
    const fromHost = from === r.host;
    if (m.k === "settings") {
      if (!fromHost || !known(m.map)) return;
      this.settings = { map: m.map, laps: m.laps };
    } else if (m.k === "start") {
      if (!fromHost || !known(m.map)) return;
      this.loaded = new Set();
      this.prog = new Map();
      this.settings = { map: m.map, laps: m.laps };
      this.hud = null;
      this.note = "";
      this.stage = { k: "race", id: m.id, map: m.map, laps: m.laps, who: m.who, go: false, startedAt: Date.now(), goAt: 0, firstAt: 0, times: new Map() };
    } else if (m.k === "loaded") {
      if (st.k !== "race" || st.id !== m.id) return;
      this.loaded.add(from);
      if (r.isHost) this.maybeGo(st);
      return;
    } else if (m.k === "go") {
      if (!fromHost || st.k !== "race" || st.id !== m.id || st.go) return;
      this.stage = { ...st, go: true, goAt: Date.now() };
      this.game?.setPaused(false);
    } else if (m.k === "finish") {
      if (st.k !== "race" || st.id !== m.id || !st.who.includes(from) || st.times.has(from)) return;
      this.stage = { ...st, times: new Map(st.times).set(from, m.ticks), firstAt: st.firstAt || Date.now() };
    } else if (m.k === "result") {
      if (!fromHost || st.k !== "race" || st.id !== m.id) return;
      this.stage = { k: "result", id: m.id, map: st.map, laps: st.laps, order: m.order.filter((e) => st.who.includes(e)), times: st.times };
    } else if (m.k === "lobby") {
      if (!fromHost) return;
      this.stage = { k: "lobby" };
    }
    this.want();
    this.emit();
  }

  /** Fetch the community map that's picked or being raced. */
  private want() {
    const id = this.stage.k === "lobby" ? this.settings.map : this.stage.map;
    if (mapById(id) || !isCommunity(id) || this.defs.has(id)) return;
    void communityDef(this.sb, id, this.nameOf).then((d) => { this.defs.set(id, d); this.emit(); });
  }

  private maybeGo(st: RaceStage) {
    const r = this.room;
    if (st.go) return;
    const present = st.who.filter((e) => r.members.some((m) => m.email === e));
    if (present.every((e) => this.loaded.has(e)) || Date.now() - st.startedAt > LOAD_WAIT) r.send({ k: "go", id: st.id });
  }

  /** The host's clock: say go, then close the race. */
  private tick() {
    const st = this.stage, r = this.room;
    if (!r.isHost || st.k !== "race") return;
    if (!st.go) { this.maybeGo(st); return; }
    const present = st.who.filter((e) => r.members.some((m) => m.email === e));
    const allIn = present.every((e) => st.times.has(e));
    const late = st.firstAt && Date.now() - st.firstAt > CLOSE_AFTER;
    const tooLong = Date.now() - st.goAt > 20 * 60_000;
    if (allIn || late || tooLong) r.send({ k: "result", id: st.id, order: standings(st, this.prog, this.me) });
  }

  async start() {
    const r = this.room;
    this.note = "";
    this.emit();
    // The month's allowance of live messages: no new races near the end of it.
    const used = await r.monthUsage().catch(() => 0);
    if (used >= MONTH_CAP) {
      this.note = "Party races are resting until next month: this month's online allowance is nearly used up. Solo races and records still work.";
      this.emit();
      return;
    }
    const s = this.settings;
    const map = mapById(s.map);
    r.send({ k: "start", mode: "race", map: s.map, laps: map?.circuit ? s.laps : 1, id: raceId(), who: r.members.map((m) => m.email).slice(0, ROOM_MAX) });
  }
  change(s: Partial<Settings>) { this.room.send({ k: "settings", mode: "race", ...this.settings, ...s }); }
  toLobby() { this.room.send({ k: "lobby" }); }
  setReady(on: boolean) { this.room.update({ ready: on }); }

  /** Wires the race screen's game into the room; returns the undo. */
  attach(g: Game): () => void {
    const st = this.stage;
    if (st.k !== "race") return () => {};
    this.game = g;
    for (const e of st.who) {
      if (e === this.me) continue;
      const m = this.room.members.find((x) => x.email === e);
      g.addRemote(e, m?.name || this.nameOf(e), parseLook(m?.look));
    }
    g.setPaused(!st.go);
    g.onNet = (packet) => this.room.sendCar(packet);
    // Ready once everything's loaded (the host waits for everyone, then says go).
    void g.loaded.then(() => { const cur = this.stage; if (this.game === g && cur.k === "race" && cur.id === st.id) this.room.send({ k: "loaded", id: st.id }); });
    const t = setInterval(() => {
      const cur = this.stage;
      if (cur.k !== "race") return;
      const p = g.progress();
      this.prog = new Map([...p].map(([e, v]) => [e || this.me, v]));
      const order = standings(cur, this.prog, this.me);
      this.hud = { place: order.indexOf(this.me) + 1, of: order.length, lap: Math.min(cur.laps, g.race.lap + 1), busy: this.room.busy };
      this.emit();
    }, 300);
    return () => { clearInterval(t); g.onNet = null; if (this.game === g) this.game = null; };
  }
  finished(ticks: number) {
    const st = this.stage;
    if (st.k === "race") this.room.send({ k: "finish", id: st.id, ticks });
  }
}

/** Everyone on the race in order: finishers by time, then the rest by how far along they are. */
function standings(st: RaceStage, prog: Map<string, { dist: number }>, me: string): string[] {
  const dist = (e: string) => prog.get(e)?.dist ?? (e === me ? 0 : -1);
  return st.who.slice().sort((a, b) => {
    const ta = st.times.get(a), tb = st.times.get(b);
    if (ta !== undefined || tb !== undefined) return (ta ?? Infinity) - (tb ?? Infinity) || (a < b ? -1 : 1);
    return dist(b) - dist(a) || (a < b ? -1 : 1);
  });
}

// ── The one session for this tab ──

let current: PartySession | null = null;
let unhook: (() => void) | null = null;

/** The session for the party you're in (made on first ask, with the connection given). */
export function partySession(sb: SupabaseClient, me: string, myName: string, nameOf: (e: string) => string): PartySession | null {
  const code = getParty();
  if (!code) { if (current) { current.close(); current = null; } return null; }
  if (current && (current.code !== code || current.me !== me)) { current.close(); current = null; }
  if (!current) current = new PartySession(code, sb, me, myName, nameOf);
  current.nameOf = nameOf;
  // Leaving the party (from anywhere) closes the room.
  unhook ??= subscribeParty(() => { if (current && getParty() !== current.code) { current.close(); current = null; } });
  return current;
}
export const currentSession = () => current;
