// Stand-in for Supabase's live channel between pages of one browser (BroadcastChannel).
(() => {
  const me = new URLSearchParams(location.search).get("as");
  if (!me) return;
  window.__hxParty = { me, sb: {
    functions: { invoke: async () => ({ data: { iceServers: [{ urls: "turn:127.0.0.1:9", username: "x", credential: "y" }] }, error: null }) },
    channel(name, opts) {
      const bc = new BroadcastChannel(name), key = opts.config.presence.key;
      const hs = [], state = {}; let mine = null;
      const sync = () => hs.filter((h) => h.type === "presence").forEach((h) => h.cb());
      bc.onmessage = ({ data: d }) => {
        if (d.t === "track") { state[d.key] = [d.meta]; sync(); if (d.ask && mine) bc.postMessage({ t: "track", key, meta: mine }); }
        else if (d.t === "untrack") { delete state[d.key]; sync(); }
        else if (d.t === "bc") hs.filter((h) => h.type === "broadcast" && h.event === d.event).forEach((h) => h.cb({ payload: d.payload }));
      };
      const ch = {
        on(type, f, cb) { hs.push({ type, event: f.event, cb }); return ch; },
        subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 0); return ch; },
        async track(meta) { mine = meta; state[key] = [meta]; bc.postMessage({ t: "track", key, meta, ask: true }); sync(); },
        async untrack() { bc.postMessage({ t: "untrack", key }); },
        async send(m) { bc.postMessage({ t: "bc", event: m.event, payload: m.payload }); },
        presenceState() { return state; }, _bc: bc,
      };
      return ch;
    },
    removeChannel(ch) { ch._bc.close(); },
  } };
})();
