// The party card in the top right of every Vortex page while you're in a
// Hexdrift party: the map, laps, what's happening and who's in. When the host
// starts a race, everyone on it is taken straight into it, wherever they are.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, useChat } from "../vortex/chat/store";
import { BIOMES } from "./maps.ts";
import { ROOM_MAX } from "./room.ts";
import { leaveParty, partyHash, useParty } from "./partyhub.ts";
import { partySession, type PartySession } from "./partysession.ts";
import { thumbOf } from "./thumbs.ts";
import { IconCrown } from "./ui/icons.tsx";
import "./partydock.css";

const noSub = () => () => {};
const zero = () => 0;
const useHash = () => {
  const [h, setH] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setH(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
};

export function PartyDock() {
  const code = useParty();
  const chat = useChat();
  // Tests run two pages against a stand-in for the live channel (development only).
  const fake = import.meta.env.DEV ? (window as { __hxParty?: { sb: SupabaseClient; me: string } }).__hxParty : undefined;
  const sb = (chat?.status === "ready" ? chat.sb : null) ?? fake?.sb ?? null;
  const me = chat?.status === "ready" ? chat.me : fake?.me ?? "";
  const profiles = chat?.profiles;
  const nameOf = (e: string) => displayName(profiles?.get(e), e);
  const s = code && sb && me ? partySession(sb, me, nameOf(me), nameOf) : null;
  useSyncExternalStore(s?.subscribe ?? noSub, s?.getVersion ?? zero);
  const hash = useHash();
  const onRoom = !!code && hash.startsWith(partyHash(code));

  // The host started a race you're on: in you go.
  const pulled = useRef("");
  const race = s?.stage.k === "race" && s.stage.who.includes(me) ? s.stage.id : "";
  useEffect(() => {
    if (!race || !code || pulled.current === race) return;
    pulled.current = race;
    if (!location.hash.startsWith(partyHash(code))) location.hash = partyHash(code);
  }, [race, code]);

  const card = useRef<HTMLDivElement>(null);
  const show = !!s && !onRoom;
  // Corner notices go below the card.
  useEffect(() => {
    const el = card.current, root = document.documentElement;
    if (!show || !el) { root.style.removeProperty("--hx-party-h"); return; }
    const ro = new ResizeObserver(() => root.style.setProperty("--hx-party-h", `${Math.round(el.getBoundingClientRect().bottom) + 8}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--hx-party-h"); };
  }, [show]);

  if (!s || !show) return null;
  return <Card s={s} me={me} innerRef={card} />;
}

function Card({ s, me, innerRef }: { s: PartySession; me: string; innerRef: React.Ref<HTMLDivElement> }) {
  const st = s.stage, set = s.settings;
  const mapId = st.k === "lobby" ? set.map : st.map;
  const def = s.defOf(mapId);
  const laps = st.k === "lobby" ? (def?.circuit ? set.laps : 1) : st.laps;
  const members = s.members;
  const ready = members.filter((m) => m.ready).length;
  const status = s.fail ? s.fail
    : !s.inRoom ? "Joining…"
    : st.k === "race" ? (st.who.includes(me) ? "Race on" : `Race on · you're in the next one`)
    : st.k === "result" ? "Results are in"
    : s.isHost ? (members.length > 1 ? `${ready}/${members.length} ready · you pick the map` : "Waiting for friends · you're the host")
    : `${ready}/${members.length} ready · waiting for ${s.name(s.room.host)}`;
  const pic = def && thumbOf(def.id);
  const tint = def ? BIOMES[def.biome].accent : "#7a5cff";
  return (
    <div ref={innerRef} className="hx-dock" role="region" aria-label="Hexdrift party">
      <a className="hx-dock-main" href={partyHash(s.code)}>
        <span className="hx-dock-pic" style={pic ? { backgroundImage: `url(${pic})` } : { background: `linear-gradient(135deg, ${tint}, #1a1440)` }} aria-hidden="true" />
        <span className="hx-dock-text">
          <span className="hx-dock-kicker">Hexdrift party · {s.code}</span>
          <strong>{def ? def.name : def === null ? "Map won't load" : "Loading map…"}{def && <em> · {laps} {laps === 1 ? "lap" : "laps"}</em>}</strong>
          <span className="hx-dock-status" role="status">{status}</span>
        </span>
      </a>
      <div className="hx-dock-foot">
        <ul className="hx-dock-who" aria-label={`${members.length} of ${ROOM_MAX} players`}>
          {members.slice(0, ROOM_MAX).map((m) => (
            <li key={m.email} title={m.email === me ? "You" : m.name || s.nameOf(m.email)} className={m.ready ? "ready" : ""}>
              {m.email === s.room.host && <IconCrown size={10} />}{(m.email === me ? "You" : m.name || s.nameOf(m.email)).slice(0, 1).toUpperCase()}
            </li>
          ))}
        </ul>
        <a className="hx-dock-btn hx-dock-open" href={partyHash(s.code)}>Open</a>
        <button type="button" className="hx-dock-btn" onClick={leaveParty}>Leave</button>
      </div>
    </div>
  );
}
