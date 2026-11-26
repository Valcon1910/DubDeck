// Stand-in for Supabase's live channel between pages of one browser (BroadcastChannel).
(() => {
  const me = new URLSearchParams(location.search).get("as");
  if (!me) return;
  const MAP = {
    id: "cpartyt01", version: "abc123", author: "c@x.test", name: "Party Test Map", theme: "miami", author_ticks: 1800,
    length_m: 400, checkpoints: 1, likes: 0, plays: 0, reports: 0, featured_at: null, hidden: false,
    published_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", local_id: "u0000test", picture: "", scene: {},
    pieces: [{ k: "S", len: 80 }, { k: "R", a: 90, r: 60 }, { k: "S", len: 100 }, { k: "C" }, { k: "L", a: 90, r: 60 }, { k: "S", len: 120 }],
  };
  window.__hxParty = { me, sb: {
    functions: { invoke: async () => ({ data: { iceServers: [{ urls: "turn:127.0.0.1:9", username: "x", credential: "y" }] }, error: null }) },
    // The month's message count (a test can set window.__hxUsage to see the guard).
    // One published community map (the editor's starter road), for the host's picker.
    from: () => {
      let id = "";
      const q = { select: () => q, eq: (k, v) => { if (k === "id") id = v; return q; }, maybeSingle: async () => ({ data: id === MAP.id ? MAP : null, error: null }) };
      return q;
    },
    rpc: async (fn, args) => { if (fn === "hexdrift_list") return { data: [MAP], error: null }; window.__hxSent = (window.__hxSent ?? 0) + (args?.n ?? 0); return { data: window.__hxUsage ?? window.__hxSent, error: null }; },
    channel(name, opts) {
      const bc = new BroadcastChannel(name), key = opts.config.presence.key;
      const hs = [], state = {}; let mine = null, closed = false;
      const sync = () => hs.filter((h) => h.type === "presence").forEach((h) => h.cb());
      bc.onmessage = ({ data: d }) => {
        if (d.t === "track") { state[d.key] = [d.meta]; sync(); if (d.ask && mine) bc.postMessage({ t: "track", key, meta: mine }); }
        else if (d.t === "untrack") { delete state[d.key]; sync(); }
        else if (d.t === "bc") hs.filter((h) => h.type === "broadcast" && h.event === d.event).forEach((h) => h.cb({ payload: d.payload }));
      };
      const ch = {
        on(type, f, cb) { hs.push({ type, event: f.event, cb }); return ch; },
        subscribe(cb) { setTimeout(() => { if (!closed) cb("SUBSCRIBED"); }, 0); return ch; },
        async track(meta) { if (closed) return; mine = meta; state[key] = [meta]; bc.postMessage({ t: "track", key, meta, ask: true }); sync(); },
        async untrack() { if (!closed) bc.postMessage({ t: "untrack", key }); },
        async send(m) { if (closed) return; window.__hxBroadcasts = (window.__hxBroadcasts ?? 0) + 1; bc.postMessage({ t: "bc", event: m.event, payload: m.payload }); },
        presenceState() { return state; }, _close() { closed = true; bc.close(); },
      };
      return ch;
    },
    removeChannel(ch) { ch._close(); },
  } };
})();
