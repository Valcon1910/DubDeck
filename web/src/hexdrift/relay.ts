// Cars peer to peer over WebRTC, only through Cloudflare's TURN relay (switched
// off for now: see RELAY_ON in room.ts). Every connection is relay-only and
// only relay candidates go out or come in, so a browser only ever offers the
// relay's addresses and no player can learn another's IP, even with a changed
// game. The signals go over the room's live channel.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { CarLink, Link } from "./room.ts";

interface Peer { pc: RTCPeerConnection; ch: RTCDataChannel | null; open: boolean; pending: RTCIceCandidateInit[] }
interface Signal { to: string; from: string; sdp?: { type: RTCSdpType; sdp: string }; cand?: RTCIceCandidateInit }

const isRelay = (c: string | undefined) => !!c && / typ relay( |$)/.test(c);
/** Session descriptions carry candidates too: keep only relay ones (and no other addresses). */
const stripAddrs = (sdp: string) => sdp.split(/\r?\n/).filter((l) => !l.startsWith("a=candidate:") || isRelay(l)).join("\r\n");

/** Short-lived relay credentials for this room (null when the relay isn't set up). */
export async function relayServers(sb: SupabaseClient, room: string): Promise<RTCIceServer[] | null> {
  const { data, error } = await sb.functions.invoke("hexdrift-turn", { body: { room } });
  const servers = (data as { iceServers?: RTCIceServer[] } | null)?.iceServers;
  return error || !servers?.length ? null : servers;
}

export class RelayLink implements CarLink {
  readonly perSecond = 20;
  readonly budgeted = false;
  links = new Map<string, Link>();
  private peers = new Map<string, Peer>();

  constructor(private ch: RealtimeChannel, private me: string, private ice: RTCIceServer[], private recv: (from: string, data: string) => void, private changed: () => void, private isMember: (e: string) => boolean) {
    ch.on("broadcast", { event: "signal" }, ({ payload }) => void this.signal(payload as Signal));
  }

  sync(members: string[]) {
    const inRoom = new Set(members);
    for (const e of [...this.peers.keys()]) if (!inRoom.has(e)) this.drop(e);
    // One connection per pair: the one whose email sorts first calls.
    for (const e of inRoom) if (e !== this.me && !this.peers.has(e) && this.me < e) void this.call(e);
  }

  send(data: string) {
    for (const p of this.peers.values()) if (p.open && p.ch && p.ch.bufferedAmount < 16_000) p.ch.send(data);
  }

  close() { for (const e of [...this.peers.keys()]) this.drop(e); }

  private peer(email: string): Peer {
    let p = this.peers.get(email);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice, iceTransportPolicy: "relay" });
    p = { pc, ch: null, open: false, pending: [] };
    this.peers.set(email, p);
    this.links.set(email, "connecting");
    pc.onicecandidate = (e) => { if (e.candidate && isRelay(e.candidate.candidate)) this.signalTo(email, { cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { this.links.set(email, "failed"); this.changed(); } };
    pc.ondatachannel = (e) => this.wire(email, p!, e.channel);
    return p;
  }

  private wire(email: string, p: Peer, ch: RTCDataChannel) {
    p.ch = ch;
    ch.onopen = () => { p.open = true; this.links.set(email, "open"); this.changed(); };
    ch.onclose = () => { p.open = false; if (this.peers.get(email) === p) { this.links.set(email, "failed"); this.changed(); } };
    ch.onmessage = (e) => { if (typeof e.data === "string" && e.data.length < 4000) this.recv(email, e.data); };
  }

  private async call(email: string) {
    const p = this.peer(email);
    this.wire(email, p, p.pc.createDataChannel("cars", { ordered: false, maxRetransmits: 0 }));
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.signalTo(email, { sdp: { type: offer.type, sdp: stripAddrs(offer.sdp ?? "") } });
  }

  private signalTo(to: string, body: Omit<Signal, "to" | "from">) {
    void this.ch.send({ type: "broadcast", event: "signal", payload: { ...body, to, from: this.me } });
  }

  private async signal(s: Signal) {
    if (!s || s.to !== this.me || typeof s.from !== "string" || s.from === this.me || !this.isMember(s.from)) return;
    try {
      if (s.sdp && (s.sdp.type === "offer" || s.sdp.type === "answer") && typeof s.sdp.sdp === "string") {
        if (s.sdp.type === "offer" && this.me < s.from) return; // we call them, not the other way
        const p = this.peer(s.from);
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
}
