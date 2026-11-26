// Hexdrift party rooms. Who's in a room and the race settings go over a
// private Supabase live channel (members only). The cars go peer to peer over
// WebRTC data channels, but only through Cloudflare's TURN relay: every
// connection is relay-only, so a browser only ever offers the relay's
// addresses and no player can learn another's IP, even with a changed game.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export const ROOM_MAX = 8;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (they read like 1 and 0)
export const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => LETTERS[b % LETTERS.length]).join("");
export const isRoomCode = (s: string) => /^[A-Z]{6}$/.test(s);

export interface Member {
  email: string; name: string;
  /** The car's look (JSON text, as stored with records). */
  look: string;
  ready: boolean;
  /** When they joined (ms): the first one in is the host. */
  joined: number;
}

/** A car as sent to the others, about 20 times a second. */
export interface CarState {
  x: number; y: number; z: number; yaw: number;
  speed: number; steer: number; boost: boolean;
  /** Distance along the road (m), the lap (from 0) and whether they've finished. */
  dist: number; lap: number; done: boolean;
  /** Race time (steps since GO) when sent. */
  t: number;
}
const CAR_FLOATS = 10;
function packCar(c: CarState): ArrayBuffer {
  const a = new Float32Array(CAR_FLOATS);
  a.set([c.x, c.y, c.z, c.yaw, c.speed, c.steer, c.boost ? 1 : 0, c.dist, c.lap + (c.done ? 1000 : 0), c.t]);
  return a.buffer;
}
function unpackCar(b: ArrayBuffer): CarState | null {
  if (b.byteLength !== CAR_FLOATS * 4) return null;
  const a = new Float32Array(b);
  if (!a.every(Number.isFinite)) return null;
  const done = a[8] >= 1000;
  return { x: a[0], y: a[1], z: a[2], yaw: a[3], speed: a[4], steer: a[5], boost: a[6] > 0.5, dist: a[7], lap: done ? a[8] - 1000 : a[8], done, t: a[9] };
}

/** Messages to the whole room (reliable, through the live channel). */
export type RoomMsg =
  | { k: "settings"; map: string; mode: string; laps: number }
  | { k: "start"; map: string; mode: string; laps: number; id: string }
  | { k: "finish"; id: string; ticks: number }
  | { k: "out"; id: string; email: string }
  | { k: "lobby" };

interface Peer { pc: RTCPeerConnection; ch: RTCDataChannel | null; open: boolean; pending: RTCIceCandidateInit[] }
export type Link = "connecting" | "open" | "failed";

/** Only relay candidates go out or come in: no host or server-reflexive addresses, ever. */
const isRelay = (c: string | undefined) => !!c && / typ relay( |$)/.test(c);

export interface RoomEvents {
  /** Members, their links or the settings changed. */
  change(): void;
  car(email: string, s: CarState): void;
  msg(from: string, m: RoomMsg): void;
  /** Couldn't join (full room, no relay, not signed in). */
  fail(why: string): void;
}

export class Room {
  members: Member[] = [];
  links = new Map<string, Link>();
  private ch: RealtimeChannel | null = null;
  private peers = new Map<string, Peer>();
  private ice: RTCIceServer[] = [];
  private joined = Date.now();
  private me: Member;
  private closed = false;

  constructor(private sb: SupabaseClient, readonly code: string, me: { email: string; name: string; look: string }, private ev: RoomEvents) {
    this.me = { ...me, ready: false, joined: this.joined };
  }

  get email() { return this.me.email; }
  /** The host picks the map and starts the race: whoever has been in longest. */
  get host() { return this.members[0]?.email ?? this.me.email; }
  get isHost() { return this.host === this.me.email; }

  async join() {
    const { data, error } = await this.sb.functions.invoke("hexdrift-turn", { body: { room: this.code } });
    const servers = (data as { iceServers?: RTCIceServer[] } | null)?.iceServers;
    if (error || !servers?.length) {
      let why = "Multiplayer isn't available right now.";
      try { const j = await (error as { context?: Response } | null)?.context?.json(); if (j?.error) why = j.error; } catch { /* keep the plain message */ }
      this.ev.fail(why);
      return;
    }
    if (this.closed) return;
    this.ice = servers;
    const ch = this.sb.channel(`hxroom:${this.code}`, { config: { private: true, broadcast: { self: false }, presence: { key: this.me.email } } });
    this.ch = ch;
    ch.on("presence", { event: "sync" }, () => this.sync());
    ch.on("broadcast", { event: "signal" }, ({ payload }) => void this.signal(payload as Signal));
    ch.on("broadcast", { event: "msg" }, ({ payload }) => {
      const p = payload as { from?: string; m?: RoomMsg };
      if (p?.from && p.m && this.members.some((x) => x.email === p.from)) this.ev.msg(p.from, p.m);
    });
    ch.subscribe((st) => {
      if (st === "SUBSCRIBED") void ch.track(this.me);
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") this.ev.fail("Couldn't reach the room. Check your connection.");
    });
  }

  /** Changes what the others see about you (ready, look). */
  update(ch: Partial<Pick<Member, "ready" | "look" | "name">>) {
    this.me = { ...this.me, ...ch };
    void this.ch?.track(this.me);
  }

  send(m: RoomMsg) {
    void this.ch?.send({ type: "broadcast", event: "msg", payload: { from: this.me.email, m } });
    // You hear your own messages too (same order of events everywhere).
    this.ev.msg(this.me.email, m);
  }

  /** Your car to everyone you're linked with (dropped, never queued, if the link is slow). */
  sendCar(s: CarState) {
    const b = packCar(s);
    for (const p of this.peers.values()) if (p.open && p.ch && p.ch.bufferedAmount < 16_000) p.ch.send(b);
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
    this.members = list;
    // Too many in the room: the latest to arrive leaves again.
    const mine = list.findIndex((m) => m.email === this.me.email);
    if (mine >= ROOM_MAX) { this.leave(); this.ev.fail(`This room is full (${ROOM_MAX} players).`); return; }
    const inRoom = new Set(list.slice(0, ROOM_MAX).map((m) => m.email));
    for (const e of [...this.peers.keys()]) if (!inRoom.has(e)) this.drop(e);
    // One connection per pair: the one whose email sorts first calls.
    for (const e of inRoom) if (e !== this.me.email && !this.peers.has(e) && this.me.email < e) void this.call(e);
    this.ev.change();
  }

  private peer(email: string): Peer {
    let p = this.peers.get(email);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice, iceTransportPolicy: "relay" });
    p = { pc, ch: null, open: false, pending: [] };
    this.peers.set(email, p);
    this.links.set(email, "connecting");
    pc.onicecandidate = (e) => {
      if (e.candidate && isRelay(e.candidate.candidate)) this.signalTo(email, { cand: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") { this.links.set(email, "failed"); this.ev.change(); }
    };
    pc.ondatachannel = (e) => this.wire(email, p!, e.channel);
    return p;
  }

  private wire(email: string, p: Peer, ch: RTCDataChannel) {
    p.ch = ch;
    ch.binaryType = "arraybuffer";
    ch.onopen = () => { p.open = true; this.links.set(email, "open"); this.ev.change(); };
    ch.onclose = () => { p.open = false; if (this.peers.get(email) === p) { this.links.set(email, "failed"); this.ev.change(); } };
    ch.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const s = unpackCar(e.data);
      if (s) this.ev.car(email, s);
    };
  }

  private async call(email: string) {
    const p = this.peer(email);
    this.wire(email, p, p.pc.createDataChannel("cars", { ordered: false, maxRetransmits: 0 }));
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.signalTo(email, { sdp: { type: offer.type, sdp: stripAddrs(offer.sdp ?? "") } });
  }

  private signalTo(to: string, body: Omit<Signal, "to" | "from">) {
    void this.ch?.send({ type: "broadcast", event: "signal", payload: { ...body, to, from: this.me.email } });
  }

  private async signal(s: Signal) {
    if (!s || s.to !== this.me.email || typeof s.from !== "string" || s.from === this.me.email) return;
    if (!this.members.some((m) => m.email === s.from)) return;
    try {
      if (s.sdp && (s.sdp.type === "offer" || s.sdp.type === "answer") && typeof s.sdp.sdp === "string") {
        const p = this.peer(s.from);
        if (s.sdp.type === "offer" && this.me.email < s.from) return; // we call them, not the other way
        await p.pc.setRemoteDescription({ type: s.sdp.type, sdp: stripAddrs(s.sdp.sdp) });
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c);
        if (s.sdp.type === "offer") {
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          this.signalTo(s.from, { sdp: { type: ans.type, sdp: stripAddrs(ans.sdp ?? "") } });
        }
      } else if (s.cand && isRelay(s.cand.candidate)) {
        const p = this.peers.get(s.from);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.cand);
        else p.pending.push(s.cand);
      }
    } catch { /* a bad or late signal: the link just doesn't open */ }
  }

  private drop(email: string) {
    const p = this.peers.get(email);
    if (!p) return;
    this.peers.delete(email);
    this.links.delete(email);
    p.ch?.close();
    p.pc.close();
  }

  leave() {
    this.closed = true;
    for (const e of [...this.peers.keys()]) this.drop(e);
    if (this.ch) { void this.ch.untrack(); void this.sb.removeChannel(this.ch); this.ch = null; }
  }
}

interface Signal { to: string; from: string; sdp?: { type: RTCSdpType; sdp: string }; cand?: RTCIceCandidateInit }

/** Session descriptions carry candidates too: keep only relay ones (and no other addresses). */
function stripAddrs(sdp: string): string {
  return sdp.split(/\r?\n/).filter((l) => !l.startsWith("a=candidate:") || isRelay(l)).join("\r\n");
}
