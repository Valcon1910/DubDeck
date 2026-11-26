// Hexdrift party rooms: the lobby (who's in, the host's map and laps), the
// race itself (inside the normal race screen, with the others' cars) and the
// results on the podium. The room's messages and budget are in room.ts, the
// cars in netcar.ts.
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTY_MAPS, BIOMES, type MapDef } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { readLook, type Look } from "./garage.ts";
import { parseLook } from "./online.ts";
import type { Game } from "./game.ts";
import { isRoomCode, MONTH_CAP, newRoomCode, Room, ROOM_MAX, type RoomMsg } from "./room.ts";
import { IconBack, IconCrown, IconFlag } from "./ui/icons.tsx";
import { getMap, isCommunity, listMaps, mapDefFrom, type CMap } from "./community.ts";

/** What a party race gives the race screen. */
export interface PartyRun {
  /** Your place on the grid (0 is pole), out of how many, and the laps. */
  slot: number; of: number; laps: number;
  /** Wires the game into the room (other cars, your car out, the start); returns the undo. */
  attach(g: Game): () => void;
  finished(ticks: number): void;
  /** Your place and lap, shown in the race's top bar. */
  hud: ReactNode;
  /** Over the race (waiting for the start, or for the others to finish). */
  overlay: ReactNode;
  /** Where "leave" goes. */
  leave: string;
}

/** A pillar on the results podium. */
export interface PartyPlace { place: number; look: Look | null; name: string; sub: ReactNode; me: boolean }

/** After the first finish, the others get this long before the race closes. */
const CLOSE_AFTER = 30_000;
/** How long the host waits for slow devices to load before saying go anyway. */
const LOAD_WAIT = 12_000;
export const LAPS = [1, 2, 3, 4, 5];

const roomLink = (code: string) => `${location.origin}${location.pathname}#/hexdrift/party/${code}`;
const raceId = () => Math.random().toString(36).slice(2, 10);
const mapById = (id: string) => PARTY_MAPS.find((m) => m.id === id);
/** A map the room can race: built in, or a community map's exact version ("<id>-<version>"). */
const known = (id: string) => !!mapById(id) || isCommunity(id);

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

function Bar({ back = "#/hexdrift", label = "Home" }: { back?: string; label?: string }) {
  return <header className="hx-menu-bar"><a className="hx-back" href={back}><IconBack size={18} />{label}</a></header>;
}

/** #/hexdrift/party: start a room or join one with its code. */
export function PartyHome({ signedIn, offline }: { signedIn: boolean; offline: ReactNode }) {
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  return (
    <div className="hx-menu hx-page">
      <Bar />
      <h1 className="hx-page-title">Party</h1>
      <p className="hx-dim">Race up to {ROOM_MAX} friends at once. Make a room and send them the link, or type the code they sent you.</p>
      {!signedIn ? <p className="hx-dim">{offline}</p> : (
        <div className="hx-party-start">
          <button type="button" className="hx-big" data-sound="confirm" onClick={() => { location.hash = `#/hexdrift/party/${newRoomCode()}`; }}>
            <IconFlag size={22} /><span>Make a room</span>
          </button>
          <form className="hx-party-join" onSubmit={(e) => { e.preventDefault(); if (isRoomCode(clean)) location.hash = `#/hexdrift/party/${clean}`; }}>
            <label htmlFor="hx-code" className="hx-dim">Room code</label>
            <input id="hx-code" className="hx-code" value={clean} onChange={(e) => setCode(e.target.value)} placeholder="ABCDEF" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            <button type="submit" className="hx-btn hx-btn-main" disabled={!isRoomCode(clean)}>Join</button>
          </form>
        </div>
      )}
    </div>
  );
}

interface RaceStage {
  k: "race"; id: string; map: string; laps: number; who: string[];
  go: boolean; startedAt: number; goAt: number; firstAt: number;
  times: Map<string, number>;
}
interface ResultStage { k: "result"; id: string; map: string; laps: number; order: string[]; times: Map<string, number> }
type Stage = { k: "lobby" } | RaceStage | ResultStage;
interface Settings { map: string; laps: number }

/** #/hexdrift/party/<code>: the room, from the lobby through each race. */
export function Party({ code, sb, me, myName, nameOf, race, podium }: {
  code: string; sb: SupabaseClient; me: string; myName: string;
  nameOf: (email: string) => string;
  race: (map: MapDef, run: PartyRun, key: string) => ReactNode;
  podium: (places: PartyPlace[]) => ReactNode;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const room = useRef<Room | null>(null);
  const [fail, setFail] = useState("");
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<Settings>({ map: PARTY_MAPS[0].id, laps: 3 });
  const [stage, setStage] = useState<Stage>({ k: "lobby" });
  /** Community maps on this screen: undefined while loading, null when it won't load. */
  const [defs, setDefs] = useState(() => new Map<string, MapDef | null>());
  const defOf = (id: string): MapDef | null | undefined => mapById(id) ?? defs.get(id);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Who on the race has loaded (the host's count). */
  const loaded = useRef(new Set<string>());
  /** The latest progress of everyone (from the race screen), for places. */
  const prog = useRef(new Map<string, { dist: number; done: boolean }>());
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<{ place: number; of: number; lap: number; busy: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(0);

  const onMsg = useRef<(from: string, m: RoomMsg) => void>(() => {});
  onMsg.current = (from, m) => {
    const r = room.current;
    if (!r) return;
    const st = stageRef.current;
    // Only the host sets the room up and starts or closes races.
    const fromHost = from === r.host;
    if (m.k === "settings") {
      if (!fromHost || !known(m.map)) return;
      setSettings({ map: m.map, laps: m.laps });
    } else if (m.k === "start") {
      if (!fromHost || !known(m.map)) return;
      loaded.current = new Set();
      prog.current = new Map();
      setSettings({ map: m.map, laps: m.laps });
      setHud(null);
      setNote("");
      setStage({ k: "race", id: m.id, map: m.map, laps: m.laps, who: m.who, go: false, startedAt: Date.now(), goAt: 0, firstAt: 0, times: new Map() });
    } else if (m.k === "loaded") {
      if (st.k !== "race" || st.id !== m.id) return;
      loaded.current.add(from);
      if (r.isHost) maybeGo(st);
    } else if (m.k === "go") {
      if (!fromHost || st.k !== "race" || st.id !== m.id || st.go) return;
      setStage({ ...st, go: true, goAt: Date.now() });
      game.current?.setPaused(false);
    } else if (m.k === "finish") {
      if (st.k !== "race" || st.id !== m.id || !st.who.includes(from) || st.times.has(from)) return;
      setStage({ ...st, times: new Map(st.times).set(from, m.ticks), firstAt: st.firstAt || Date.now() });
    } else if (m.k === "result") {
      if (!fromHost || st.k !== "race" || st.id !== m.id) return;
      setStage({ k: "result", id: m.id, map: st.map, laps: st.laps, order: m.order.filter((e) => st.who.includes(e)), times: st.times });
    } else if (m.k === "lobby") {
      if (fromHost) setStage({ k: "lobby" });
    }
  };

  function maybeGo(st: RaceStage) {
    const r = room.current;
    if (!r || st.go) return;
    const present = st.who.filter((e) => r.members.some((m) => m.email === e));
    if (present.every((e) => loaded.current.has(e)) || Date.now() - st.startedAt > LOAD_WAIT) r.send({ k: "go", id: st.id });
  }

  // Fetch the community map that's picked or being raced.
  const want = stage.k === "lobby" ? settings.map : stage.map;
  useEffect(() => {
    if (mapById(want) || !isCommunity(want) || defs.has(want)) return;
    let alive = true;
    void communityDef(sb, want, nameOf).then((d) => { if (alive) setDefs((m) => new Map(m).set(want, d)); });
    return () => { alive = false; };
  }, [sb, want]); // eslint-disable-line react-hooks/exhaustive-deps

  // Join the room (and leave it when this screen goes).
  useEffect(() => {
    const r = new Room(sb, code, { email: me, name: myName, look: JSON.stringify(readLook()) }, {
      change: () => bump(),
      car: (email, d) => game.current?.remotePacket(email, d),
      msg: (from, m) => onMsg.current(from, m),
      fail: (why) => setFail(why),
    });
    room.current = r;
    void r.join();
    return () => { r.leave(); room.current = null; };
  }, [sb, code, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = room.current;
  const members = r?.members ?? [];
  const isHost = !!r && r.isHost;
  const inRoom = members.some((m) => m.email === me);

  // The host tells anyone new what's set (and whether a race is on).
  useEffect(() => {
    if (!r || !isHost) return;
    if (members.length > seen.current) {
      const st = stageRef.current;
      r.send({ k: "settings", mode: "race", ...settingsRef.current, race: st.k === "race" ? st.id : undefined });
    }
    seen.current = members.length;
  });

  // People leaving a race: their cars go.
  useEffect(() => {
    const g = game.current;
    if (!g) return;
    for (const e of g.progress().keys()) if (e && !members.some((m) => m.email === e)) g.removeRemote(e);
  });

  // The host's clock: say go, then close the race.
  useEffect(() => {
    if (!isHost || stage.k !== "race") return;
    const t = setInterval(() => {
      const st = stageRef.current, rr = room.current;
      if (!rr || st.k !== "race") return;
      if (!st.go) { maybeGo(st); return; }
      const present = st.who.filter((e) => rr.members.some((m) => m.email === e));
      const allIn = present.every((e) => st.times.has(e));
      const late = st.firstAt && Date.now() - st.firstAt > CLOSE_AFTER;
      const tooLong = Date.now() - st.goAt > 20 * 60_000;
      if (allIn || late || tooLong) rr.send({ k: "result", id: st.id, order: standings(st, prog.current, me) });
    }, 400);
    return () => clearInterval(t);
  }, [isHost, stage.k]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tick for the countdowns on screen.
  useEffect(() => {
    if (stage.k !== "race") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [stage.k]);

  async function start() {
    const rr = room.current;
    if (!rr) return;
    setNote("");
    // The month's allowance of live messages: no new races near the end of it.
    const used = await rr.monthUsage().catch(() => 0);
    if (used >= MONTH_CAP) { setNote("Party races are resting until next month: this month's online allowance is nearly used up. Solo races and records still work."); return; }
    const s = settingsRef.current;
    const map = mapById(s.map);
    rr.send({ k: "start", mode: "race", map: s.map, laps: map?.circuit ? s.laps : 1, id: raceId(), who: rr.members.map((m) => m.email).slice(0, ROOM_MAX) });
  }
  function change(s: Partial<Settings>) {
    room.current?.send({ k: "settings", mode: "race", ...settingsRef.current, ...s });
  }

  const name = (e: string) => e === me ? "You" : members.find((m) => m.email === e)?.name || nameOf(e);
  const back = <Bar back="#/hexdrift/party" label="Party" />;

  if (fail) {
    return (
      <div className="hx-menu hx-page">{back}
        <h1 className="hx-page-title">Room {code}</h1>
        <p className="hx-dim">{fail}</p>
        <div className="hx-row"><a className="hx-btn" href="#/hexdrift/party">Back</a></div>
      </div>
    );
  }

  // ── The race ──
  if (stage.k === "race" && stage.who.includes(me) && inRoom && !defOf(stage.map)) {
    const gone = defOf(stage.map) === null;
    return (
      <div className="hx-menu hx-page hx-party">{back}
        <h1 className="hx-page-title">Room {code}</h1>
        <p className={gone ? "" : "hx-dim"} role="status">{gone ? "This map won't load on your device (it may have been changed or taken down). You'll be in the next race." : "Loading the map…"}</p>
      </div>
    );
  }
  if (stage.k === "race" && stage.who.includes(me) && inRoom) {
    const map = defOf(stage.map)!;
    const mine = stage.times.get(me);
    const left = stage.who.filter((e) => !stage.times.has(e) && members.some((m) => m.email === e)).length;
    const closes = stage.firstAt ? Math.max(0, Math.ceil((CLOSE_AFTER - (now - stage.firstAt)) / 1000)) : 0;
    const run: PartyRun = {
      slot: stage.who.indexOf(me), of: stage.who.length, laps: stage.laps,
      attach(g) {
        game.current = g;
        for (const e of stage.who) {
          if (e === me) continue;
          const m = members.find((x) => x.email === e);
          g.addRemote(e, m?.name || nameOf(e), parseLook(m?.look));
        }
        const cur = stageRef.current;
        g.setPaused(!(cur.k === "race" && cur.go));
        g.onNet = (packet) => room.current?.sendCar(packet);
        room.current?.send({ k: "loaded", id: stage.id });
        const t = setInterval(() => {
          const st = stageRef.current;
          if (st.k !== "race") return;
          const p = g.progress();
          prog.current = new Map([...p].map(([e, v]) => [e || me, v]));
          const order = standings(st, prog.current, me);
          setHud({ place: order.indexOf(me) + 1, of: order.length, lap: Math.min(st.laps, g.race.lap + 1), busy: !!room.current?.busy });
        }, 300);
        return () => { clearInterval(t); g.onNet = null; if (game.current === g) game.current = null; };
      },
      finished(ticks) { room.current?.send({ k: "finish", id: stage.id, ticks }); },
      hud: hud && <>
        <span className="hx-chip hx-place" aria-label={`Place ${hud.place} of ${hud.of}`}>P{hud.place}<span className="hx-dim">/{hud.of}</span></span>
        {stage.laps > 1 && <span className="hx-chip"><span className="hx-dim">LAP</span> {hud.lap}/{stage.laps}</span>}
        {hud.busy && <span className="hx-chip hx-busy" role="status">Network busy</span>}
      </>,
      overlay: !stage.go ? (
        <div className="hx-party-wait" role="status">Waiting for everyone to load…</div>
      ) : mine !== undefined ? (
        <div className="hx-over hx-over-late"><div className="hx-panel">
          <p className="hx-dim">{map.name}</p>
          <h2 className="hx-final">{formatTime(mine)}</h2>
          <p>{left ? `Waiting for ${left} more…` : "Everyone's in."}{closes && left ? ` The race closes in ${closes}s.` : ""}</p>
          <Times st={stage} name={name} />
        </div></div>
      ) : stage.firstAt ? (
        <div className="hx-party-wait" role="status">Someone's finished: {closes}s left</div>
      ) : null,
      leave: "#/hexdrift/party",
    };
    return <>{race(map, run, stage.id)}</>;
  }

  // ── Results ──
  if (stage.k === "result") {
    const mapName = defOf(stage.map)?.name ?? "Community map";
    const places: PartyPlace[] = stage.order.slice(0, 3).map((e, i) => ({
      place: i + 1, name: name(e), me: e === me, look: parseLook(members.find((m) => m.email === e)?.look),
      sub: stage.times.has(e) ? formatTime(stage.times.get(e)!) : "Didn't finish",
    }));
    return (
      <div className="hx-menu hx-page hx-party">{back}
        <h1 className="hx-page-title">{stage.order[0] ? <><IconCrown size={22} /> {name(stage.order[0])} {stage.order[0] === me ? "win" : "wins"}!</> : "Results"} <span className="hx-dim">{mapName}{stage.laps > 1 ? ` · ${stage.laps} laps` : ""}</span></h1>
        {podium(places)}
        <ol className="hx-party-order">
          {stage.order.map((e, i) => (
            <li key={e} className={e === me ? "me" : ""}>
              <b>{i + 1}</b><span>{name(e)}</span>
              <span className="hx-dim">{stage.times.has(e) ? formatTime(stage.times.get(e)!) : "Didn't finish"}</span>
            </li>
          ))}
        </ol>
        {note && <p className="hx-party-note" role="status">{note}</p>}
        {isHost ? (
          <div className="hx-row">
            <button type="button" className="hx-btn hx-btn-main" onClick={() => void start()}>Race again</button>
            <button type="button" className="hx-btn" onClick={() => room.current?.send({ k: "lobby" })}>Back to the lobby</button>
          </div>
        ) : <p className="hx-dim">Waiting for {name(r?.host ?? "")} to pick what's next.</p>}
      </div>
    );
  }

  // ── The lobby (and waiting out a race you're not in) ──
  const picked = defOf(settings.map);
  const map = picked ?? PARTY_MAPS[0];
  const community = isCommunity(settings.map);
  const mapLabel = picked ? `${picked.name} · ${community ? picked.blurb : BIOMES[picked.biome].name}` : picked === null ? "A community map that won't load" : "Loading the map…";
  const others = members.filter((m) => m.email !== me);
  const ready = others.every((m) => m.ready);
  const watching = stage.k === "race";
  const myReady = !!members.find((m) => m.email === me)?.ready;
  return (
    <div className="hx-menu hx-page hx-party">{back}
      <h1 className="hx-page-title">Room <span className="hx-code-big">{code}</span></h1>
      <Invite code={code} />
      {!r || !inRoom ? <p className="hx-dim">Joining…</p> : (
        <>
          {watching && (
            <p className="hx-party-note" role="status">
              A race is on: {stage.who.length - stage.times.size} still driving. You'll be in the next one.
            </p>
          )}
          {note && <p className="hx-party-note" role="status">{note}</p>}
          <section className="hx-party-grid">
            <div>
              <h2 className="hx-h2">Players <span className="hx-dim">{members.length}/{ROOM_MAX}</span></h2>
              <ul className="hx-party-list">
                {members.map((m) => {
                  const link = m.email === me ? undefined : r.links.get(m.email);
                  return (
                    <li key={m.email} className={m.email === me ? "me" : ""}>
                      <span className="hx-party-name">{m.email === r.host && <IconCrown size={14} />}{m.email === me ? `${m.name || "You"} (you)` : m.name || nameOf(m.email)}</span>
                      <span className="hx-dim hx-small">
                        {link === "failed" ? "Can't connect · " : link === "connecting" ? "Connecting… · " : ""}{m.ready ? "Ready" : "Not ready"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="hx-row">
                <button type="button" className={`hx-btn ${myReady ? "" : "hx-btn-main"}`} aria-pressed={myReady} onClick={() => r.update({ ready: !myReady })}>
                  {myReady ? "Not ready" : "I'm ready"}
                </button>
              </div>
            </div>
            <div>
              <h2 className="hx-h2">Race</h2>
              {isHost ? (
                <>
                  <label className="hx-party-field"><span className="hx-dim">Map</span>
                    <select value={settings.map} onChange={(e) => change({ map: e.target.value })} disabled={watching}>
                      {community && <optgroup label="Community"><option value={settings.map}>{mapLabel}</option></optgroup>}
                      <optgroup label="Circuits (laps)">
                        {PARTY_MAPS.filter((m) => m.circuit).map((m) => <option key={m.id} value={m.id}>{m.name} · {BIOMES[m.biome].name}</option>)}
                      </optgroup>
                      <optgroup label="Sprints (start to finish)">
                        {PARTY_MAPS.filter((m) => !m.circuit).map((m) => <option key={m.id} value={m.id}>{m.name} · {BIOMES[m.biome].name}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  <CommunityPick sb={sb} nameOf={nameOf} disabled={watching} onPick={(id) => change({ map: id })} />
                  {picked === null && <p className="hx-party-note" role="status">This map won't load (it may have been changed or taken down). Pick another one.</p>}
                  {!community && map.circuit && (
                    <div className="hx-party-field"><span className="hx-dim">Laps</span>
                      <div className="hx-seg" role="radiogroup" aria-label="Laps">
                        {LAPS.map((n) => (
                          <button key={n} type="button" role="radio" aria-checked={settings.laps === n} className={settings.laps === n ? "on" : ""} disabled={watching} onClick={() => change({ laps: n })}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="hx-row">
                    <button type="button" className="hx-btn hx-btn-main" data-sound="confirm" disabled={watching || !picked} onClick={() => void start()}>{ready ? "Start" : "Start anyway"}</button>
                  </div>
                  {!ready && !watching && <p className="hx-dim hx-small">Not everyone's ready yet.</p>}
                </>
              ) : (
                <>
                  <p>{picked ? <><b>{picked.name}</b> <span className="hx-dim">· {community ? picked.blurb : BIOMES[picked.biome].name}{picked.circuit ? ` · ${settings.laps} ${settings.laps === 1 ? "lap" : "laps"}` : ""}</span></> : <span className="hx-dim">{mapLabel}</span>}</p>
                  <p className="hx-dim">{name(r.host)} picks the map and starts the race.</p>
                </>
              )}
            </div>
          </section>
          <p className="hx-dim hx-small">Cars bump into each other. Party races don't count for records.</p>
        </>
      )}
    </div>
  );
}

/** The host's search for a community map (published maps that work with this version of the game). */
function CommunityPick({ sb, nameOf, disabled, onPick }: { sb: SupabaseClient; nameOf: (e: string) => string; disabled: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"trending" | "mine">("trending");
  const [list, setList] = useState<CMap[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr(false);
    const t = setTimeout(() => {
      void listMaps(sb, tab, q, undefined, 12)
        .then((l) => { if (alive) setList(l.filter((c) => !c.hidden)); })
        .catch(() => { if (alive) { setList([]); setErr(true); } });
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [sb, open, q, tab]);
  if (!open) return <div className="hx-row"><button type="button" className="hx-btn" disabled={disabled} onClick={() => setOpen(true)}>Community map…</button></div>;
  return (
    <div className="hx-party-pick">
      <div className="hx-seg" role="radiogroup" aria-label="Which maps">
        {([["trending", "Popular"], ["mine", "Mine"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setList(null); }}>{label}</button>
        ))}
      </div>
      <input type="search" placeholder="Search community maps" aria-label="Search community maps" value={q} onChange={(e) => setQ(e.target.value)} />
      {list === null ? <p className="hx-dim hx-small">Loading…</p> : err ? <p className="hx-dim hx-small">Community maps can't be reached right now.</p> : !list.length ? <p className="hx-dim hx-small">No maps found.</p> : (
        <ul className="hx-party-picklist">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={disabled} onClick={() => { onPick(`${c.id}-${c.version}`); setOpen(false); }}>
                <span>{c.name}</span><span className="hx-dim hx-small">by {nameOf(c.author)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="hx-row"><button type="button" className="hx-btn" onClick={() => setOpen(false)}>Close</button></div>
    </div>
  );
}

function Invite({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => roomLink(code), [code]);
  return (
    <div className="hx-party-invite">
      <input readOnly value={link} aria-label="Room link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="hx-btn" onClick={() => {
        void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
      }}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

function Times({ st, name }: { st: RaceStage; name: (e: string) => string }) {
  const list = [...st.times].sort((a, b) => a[1] - b[1]);
  return (
    <ol className="hx-party-order hx-small">
      {list.map(([e, t], i) => <li key={e}><b>{i + 1}</b><span>{name(e)}</span><span className="hx-dim">{formatTime(t)}</span></li>)}
    </ol>
  );
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
