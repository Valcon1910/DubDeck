// Hexdrift party rooms. Who's in a room, the race settings and the cars go
// over a private Supabase live channel (members only), so no player ever
// talks to another directly and nobody's address is exposed.
//
// Supabase's free plan allows 100 live messages a second across the whole
// project (chat included) and 2 million a month, and a message to a room
// counts once for the send and once for each player who gets it. So every
// room keeps to a share of a project-wide budget (all rooms in play split it,
// counted through a shared "who's playing" channel), cars are sent only when
// something changes, and when the budget is tight sends wait (the newest
// state goes, nothing piles up) and the race shows "Network busy". A monthly
// count stops new races before the plan's limit.
//
// The cars can instead go peer to peer through Cloudflare's relay (relay.ts),
// which has no such limits; that's off until it's set up (RELAY_ON).
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { RelayLink, relayServers } from "./relay.ts";

export const ROOM_MAX = 8;
/** Cars through Cloudflare's relay instead of the live channel (needs the hexdrift-turn function and its secrets). */
export const RELAY_ON = false;
/** Live messages a second all Hexdrift rooms together may use (the plan allows 100; chat keeps the rest). */
export const PROJECT_BUDGET = 60;
/** The most a player sends a second, however quiet the project is. */
const MAX_RATE = 8;
/** New races stop at this many messages in a month (the plan allows 2 million, chat included). */
export const MONTH_CAP = 1_800_000;

export { newRoomCode, isRoomCode } from "./partyhub.ts";

export interface Member {
  email: string; name: string;
  /** The car's look (JSON text, as stored with records). */
  look: string;
  ready: boolean;
  /** When they joined (ms): the first one in is the host. */
  joined: number;
}

/** Party modes (more later). */
export type Mode = "race";
/** Messages to the whole room (reliable, through the live channel). */
export type RoomMsg =
  /** The host's choices (sent again when someone joins). race: the one under way, if any. */
  | { k: "settings"; map: string; mode: Mode; laps: number; race?: string }
  | { k: "start"; map: string; mode: Mode; laps: number; id: string; who: string[] }
  /** Your game has loaded; the host says go once everyone's has (or after a wait). */
  | { k: "loaded"; id: string }
  | { k: "go"; id: string }
  | { k: "finish"; id: string; ticks: number }
  /** The host closes a race: everyone in order. */
  | { k: "result"; id: string; order: string[] }
  | { k: "lobby" };

const str = (v: unknown, n = 80): v is string => typeof v === "string" && v.length <= n;
const emails = (v: unknown): v is string[] => Array.isArray(v) && v.length <= ROOM_MAX * 2 && v.every((e) => str(e, 320));
/** Messages come from other players' browsers: only well-formed ones get through. */
export function validMsg(m: unknown): RoomMsg | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const mode = o.mode === "race";
  const laps = typeof o.laps === "number" && Number.isInteger(o.laps) && o.laps >= 1 && o.laps <= 5;
  switch (o.k) {
    case "settings": return str(o.map) && mode && laps && (o.race === undefined || str(o.race)) ? o as RoomMsg : null;
    case "start": return str(o.map) && mode && laps && str(o.id) && emails(o.who) ? o as RoomMsg : null;
    case "loaded": case "go": return str(o.id) ? o as RoomMsg : null;
    case "finish": return str(o.id) && typeof o.ticks === "number" && Number.isInteger(o.ticks) && o.ticks > 0 && o.ticks < 1e7 ? o as RoomMsg : null;
    case "result": return str(o.id) && emails(o.order) ? o as RoomMsg : null;
    case "lobby": return o as RoomMsg;
    default: return null;
  }
}

export type Link = "connecting" | "open" | "failed";

/** How the cars travel: the live channel (counted against the budget) or the relay. */
export interface CarLink {
  /** The most it sends a second. */
  readonly perSecond: number;
  /** Counted against the project's live-message budget. */
  readonly budgeted: boolean;
  /** Per player, when there are direct links (the relay). */
  links: Map<string, Link>;
  sync(members: string[]): void;
  send(data: string): void;
  close(): void;
}

/** Cars as live-channel messages. */
class BroadcastLink implements CarLink {
  readonly perSecond = MAX_RATE;
  readonly budgeted = true;
  links = new Map<string, Link>();
  constructor(private ch: RealtimeChannel, private me: string, recv: (from: string, data: string) => void, isMember: (e: string) => boolean) {
    ch.on("broadcast", { event: "car" }, ({ payload }) => {
      const p = payload as { from?: unknown; d?: unknown };
      if (typeof p?.from === "string" && p.from !== me && typeof p.d === "string" && p.d.length < 4000 && isMember(p.from)) recv(p.from, p.d);
    });
  }
  sync() {}
  send(d: string) { void this.ch.send({ type: "broadcast", event: "car", payload: { from: this.me, d } }); }
  close() {}
}

export interface RoomEvents {
  /** Members, their links or the settings changed. */
  change(): void;
  /** A car packet from another player (see netcar.ts). */
  car(email: string, data: string): void;
  msg(from: string, m: RoomMsg): void;
  /** Couldn't join (full room, not signed in, no connection). */
  fail(why: string): void;
}

export class Room {
  members: Member[] = [];
  /** The month's count of live messages (as last heard), or null before the first check. */
  usage: number | null = null;
  private ch: RealtimeChannel | null = null;
  private live: RealtimeChannel | null = null;
  private link: CarLink | null = null;
  private joined = Date.now();
  private me: Member;
  private closed = false;
  /** Players in rooms right now, project-wide (from the shared channel). */
  private players = 1;
  private tokens = 1;
  private tokAt = performance.now();
  private queue: RoomMsg[] = [];
  private car: string | (() => string) | null = null;
  private carSince = 0;
  private timer = 0;
  /** Messages used and not yet added to the month's count. */
  private used = 0;
  private meter = 0;

  constructor(private sb: SupabaseClient, readonly code: string, me: { email: string; name: string; look: string }, private ev: RoomEvents) {
    this.me = { ...me, ready: false, joined: this.joined };
  }

  get email() { return this.me.email; }
  /** The host picks the map and starts the race: whoever has been in longest. */
  get host() { return this.members[0]?.email ?? this.me.email; }
  get isHost() { return this.host === this.me.email; }
  get links() { return this.link?.links ?? new Map<string, Link>(); }
  /** Sends a second this player may make now (its share of the project's budget). */
  get rate() {
    const l = this.link;
    if (!l) return 1;
    if (!l.budgeted) return l.perSecond;
    return Math.min(l.perSecond, PROJECT_BUDGET / (Math.max(1, this.players) * Math.max(1, this.members.length)));
  }
  /** True while your car's updates are waiting for room in the budget. */
  get busy() {
    return this.car !== null && performance.now() - this.carSince > Math.max(1500, 2500 / this.rate);
  }

  async join() {
    const isMember = (e: string) => this.members.some((m) => m.email === e);
    const servers = RELAY_ON ? await relayServers(this.sb, this.code).catch(() => null) : null;
    if (this.closed) return;
    const ch = this.sb.channel(`hxroom:${this.code}`, { config: { private: true, broadcast: { self: false }, presence: { key: this.me.email } } });
    this.ch = ch;
    ch.on("presence", { event: "sync" }, () => this.sync());
    ch.on("broadcast", { event: "msg" }, ({ payload }) => {
      const p = payload as { from?: unknown; m?: unknown };
      const m = validMsg(p?.m);
      if (m && typeof p.from === "string" && isMember(p.from)) this.ev.msg(p.from, m);
    });
    const recv = (from: string, d: string) => this.ev.car(from, d);
    this.link = servers ? new RelayLink(ch, this.me.email, servers, recv, () => this.ev.change(), isMember) : new BroadcastLink(ch, this.me.email, recv, isMember);
    ch.subscribe((st) => {
      if (st === "SUBSCRIBED") { void ch.track(this.me); this.count(this.members.length + 1); }
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") this.ev.fail("Couldn't reach the room. Check your connection.");
    });
    // Everyone in a room, project-wide: the budget is split between them.
    if (this.link.budgeted) {
      const live = this.sb.channel("hxlive", { config: { private: true, presence: { key: this.me.email } } });
      this.live = live;
      live.on("presence", { event: "sync" }, () => { this.players = Math.max(1, Object.keys(live.presenceState()).length); });
      live.subscribe((st) => { if (st === "SUBSCRIBED") void live.track({}); });
    }
    this.meter = window.setInterval(() => void this.flushUsage(), 30_000);
  }

  /** Changes what the others see about you (ready, look). */
  update(ch: Partial<Pick<Member, "ready" | "look" | "name">>) {
    this.me = { ...this.me, ...ch };
    void this.ch?.track(this.me);
    this.count(this.members.length);
  }

  send(m: RoomMsg) {
    this.queue.push(m);
    // You hear your own messages straight away (same order of events everywhere).
    this.ev.msg(this.me.email, m);
    this.pump();
  }

  /** Your car's latest state: sent as soon as the budget allows (a newer one replaces one still waiting). */
  sendCar(data: string | (() => string)) {
    if (this.car === null) this.carSince = performance.now();
    this.car = data;
    this.pump();
  }

  /** The month's count, checked before a race starts. */
  async monthUsage(): Promise<number> {
    // Adds what's waiting (or nothing) and reads the total back.
    const n = this.link?.budgeted ? this.used : 0;
    this.used -= n;
    const { data, error } = await this.sb.rpc("hexdrift_usage_add", { n });
    if (error) this.used += n;
    else if (typeof data === "number") this.usage = data;
    return this.usage ?? 0;
  }

  private count(n: number) { this.used += Math.max(1, n); }

  private async flushUsage() {
    if (!this.used || !this.link?.budgeted) return;
    const n = this.used;
    this.used = 0;
    const { data, error } = await this.sb.rpc("hexdrift_usage_add", { n });
    if (error) this.used += n; // try again next time
    else if (typeof data === "number") this.usage = data;
  }

  private pump() {
    clearTimeout(this.timer);
    const ch = this.ch, l = this.link;
    if (!ch || !l) { if (this.queue.length || this.car) this.timer = window.setTimeout(() => this.pump(), 200); return; }
    const now = performance.now(), rate = this.rate;
    this.tokens = Math.min(2, this.tokens + ((now - this.tokAt) / 1000) * rate);
    this.tokAt = now;
    const n = this.members.length;
    // Room messages are few and matter: they may borrow a little ahead.
    while (this.queue.length && this.tokens > -2) {
      void ch.send({ type: "broadcast", event: "msg", payload: { from: this.me.email, m: this.queue.shift() } });
      this.tokens -= 1;
      this.count(n);
    }
    if (this.car !== null && this.tokens >= 1) {
      l.send(typeof this.car === "function" ? this.car() : this.car);
      this.car = null;
      if (l.budgeted) { this.tokens -= 1; this.count(n); }
    }
    if (this.queue.length || this.car !== null) {
      const wait = Math.max(20, ((1 - this.tokens) / rate) * 1000);
      this.timer = window.setTimeout(() => this.pump(), wait);
    }
  }

  private sync() {
    if (!this.ch) return;
    const state = this.ch.presenceState<Member>();
    const list: Member[] = [];
    for (const [key, metas] of Object.entries(state)) {
      const m = metas[metas.length - 1];
      if (!m || m.email !== key) continue;
      list.push({ email: m.email, name: String(m.name ?? "").slice(0, 60), look: String(m.look ?? ""), ready: !!m.ready, joined: Number(m.joined) || 0 });
    }
    list.sort((a, b) => a.joined - b.joined || (a.email < b.email ? -1 : 1));
    // Too many in the room: the latest to arrive leaves again.
    const mine = list.findIndex((m) => m.email === this.me.email);
    if (mine >= ROOM_MAX) { this.leave(); this.ev.fail(`This room is full (${ROOM_MAX} players).`); return; }
    this.members = list.slice(0, ROOM_MAX);
    this.link?.sync(this.members.map((m) => m.email));
    this.ev.change();
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.meter);
    void this.flushUsage();
    this.link?.close();
    for (const c of [this.ch, this.live]) if (c) { void c.untrack(); void this.sb.removeChannel(c); }
    this.ch = this.live = null;
  }
}
