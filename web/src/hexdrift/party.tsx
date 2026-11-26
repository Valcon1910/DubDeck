// Hexdrift party rooms: the lobby (who's in, the host's map and mode), the
// race itself (inside the normal race screen, with the others' cars) and the
// results. The room's messages and links are in room.ts.
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAPS, BIOMES, type MapDef } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { readLook } from "./garage.ts";
import { parseLook } from "./online.ts";
import type { Game } from "./game.ts";
import { isRoomCode, newRoomCode, Room, ROOM_MAX, type CarState, type Mode, type RoomMsg } from "./room.ts";
import { IconBack, IconCrown, IconFlag } from "./ui/icons.tsx";

/** What a party race gives the race screen. */
export interface PartyRun {
  /** Wires the game into the room (other cars, your car out, the start); returns the undo. */
  attach(g: Game): () => void;
  finished(ticks: number): void;
  /** Your place, shown in the race's top bar. */
  hud: ReactNode;
  /** Over the race (waiting for the start, or for the others to finish). */
  overlay: ReactNode;
  /** Where "leave" goes. */
  leave: string;
}

/** After the first finish, the others get this long before the race closes. */
const CLOSE_AFTER = 30_000;
/** How long the host waits for slow devices to load before saying go anyway. */
const LOAD_WAIT = 12_000;
/** Elimination: the next round starts on its own after this. */
const NEXT_ROUND = 8_000;
const MODE_NAME: Record<Mode, string> = { race: "Race", elim: "Elimination" };

const roomLink = (code: string) => `${location.origin}${location.pathname}#/hexdrift/party/${code}`;
const raceId = () => Math.random().toString(36).slice(2, 10);

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
            <input id="hx-code" className="hx-code" value={clean} onChange={(e) => setCode(e.target.value)} placeholder="ABCDEF" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
            <button type="submit" className="hx-btn hx-btn-main" disabled={!isRoomCode(clean)}>Join</button>
          </form>
        </div>
      )}
    </div>
  );
}

interface RaceStage {
  k: "race"; id: string; map: string; mode: Mode; laps: number; who: string[]; round: number;
  go: boolean; startedAt: number; goAt: number; firstAt: number;
  times: Map<string, number>;
}
interface ResultStage { k: "result"; id: string; map: string; mode: Mode; round: number; order: string[]; out: string[]; times: Map<string, number>; at: number }
type Stage = { k: "lobby" } | RaceStage | ResultStage;
interface Settings { map: string; mode: Mode; laps: number }

/** #/hexdrift/party/<code>: the room, from the lobby through each race. */
export function Party({ code, sb, me, myName, nameOf, race }: {
  code: string; sb: SupabaseClient; me: string; myName: string;
  nameOf: (email: string) => string;
  race: (map: MapDef, run: PartyRun, key: string) => ReactNode;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const room = useRef<Room | null>(null);
  const [fail, setFail] = useState("");
  const [settings, setSettings] = useState<Settings>({ map: MAPS[0].id, mode: "race", laps: 1 });
  const [stage, setStage] = useState<Stage>({ k: "lobby" });
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Elimination: who's still in (null outside a run of rounds). */
  const alive = useRef<string[] | null>(null);
  /** Who on the race has loaded (the host's count). */
  const loaded = useRef(new Set<string>());
  /** The latest car of everyone, for places. */
  const cars = useRef(new Map<string, CarState>());
  const game = useRef<Game | null>(null);
  const [place, setPlace] = useState<[number, number] | null>(null);
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
      if (!fromHost) return;
      if (!MAPS.some((x) => x.id === m.map)) return;
      setSettings({ map: m.map, mode: m.mode, laps: m.laps });
    } else if (m.k === "start") {
      if (!fromHost || !MAPS.some((x) => x.id === m.map)) return;
      loaded.current = new Set();
      cars.current = new Map();
      if (m.mode === "elim") alive.current = m.who.slice();
      else alive.current = null;
      setSettings({ map: m.map, mode: m.mode, laps: m.laps });
      setPlace(null);
      setStage({ k: "race", id: m.id, map: m.map, mode: m.mode, laps: m.laps, who: m.who, round: m.round, go: false, startedAt: Date.now(), goAt: 0, firstAt: 0, times: new Map() });
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
      const times = new Map(st.times).set(from, m.ticks);
      setStage({ ...st, times, firstAt: st.firstAt || Date.now() });
    } else if (m.k === "result") {
      if (!fromHost || st.k !== "race" || st.id !== m.id) return;
      if (alive.current) alive.current = alive.current.filter((e) => !m.out.includes(e));
      setStage({ k: "result", id: m.id, map: st.map, mode: st.mode, round: st.round, order: m.order, out: m.out, times: st.times, at: Date.now() });
    } else if (m.k === "lobby") {
      if (!fromHost) return;
      alive.current = null;
      setStage({ k: "lobby" });
    }
  };

  function maybeGo(st: RaceStage) {
    const r = room.current;
    if (!r || st.go) return;
    const present = st.who.filter((e) => r.members.some((m) => m.email === e));
    if (present.every((e) => loaded.current.has(e)) || Date.now() - st.startedAt > LOAD_WAIT) r.send({ k: "go", id: st.id });
  }

  // Join the room (and leave it when this screen goes).
  useEffect(() => {
    const r = new Room(sb, code, { email: me, name: myName, look: JSON.stringify(readLook()) }, {
      change: () => bump(),
      car: (email, s) => { cars.current.set(email, s); game.current?.remoteState(email, s); },
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
      r.send({ k: "settings", ...settingsRef.current, race: st.k === "race" ? st.id : undefined });
    }
    seen.current = members.length;
  });

  // People leaving a race: their cars go.
  useEffect(() => {
    const g = game.current;
    if (!g) return;
    for (const e of g.remoteCars().keys()) if (!members.some((m) => m.email === e)) g.removeRemote(e);
  });

  // The host's clock: say go, close the race, start the next round.
  useEffect(() => {
    if (!isHost || stage.k === "lobby") return;
    const t = setInterval(() => {
      const st = stageRef.current;
      const rr = room.current;
      if (!rr) return;
      if (st.k === "race") {
        if (!st.go) { maybeGo(st); return; }
        const present = st.who.filter((e) => rr.members.some((m) => m.email === e));
        const allIn = present.every((e) => st.times.has(e));
        const late = st.firstAt && Date.now() - st.firstAt > CLOSE_AFTER;
        const tooLong = Date.now() - st.goAt > 15 * 60_000;
        if (allIn || late || tooLong) {
          const order = standings(st, cars.current, game.current, me);
          let out: string[] = [];
          if (st.mode === "elim") {
            // Anyone who left is out, and the last one home (or furthest back).
            out = st.who.filter((e) => !present.includes(e));
            const still = order.filter((e) => present.includes(e));
            if (still.length > 1) out.push(still[still.length - 1]);
          }
          rr.send({ k: "result", id: st.id, order, out });
        }
      } else if (st.k === "result" && st.mode === "elim") {
        const left = (alive.current ?? []).filter((e) => rr.members.some((m) => m.email === e));
        if (left.length > 1 && Date.now() - st.at > NEXT_ROUND) start(left, st.round + 1);
      }
    }, 400);
    return () => clearInterval(t);
  }, [isHost, stage.k]); // eslint-disable-line react-hooks/exhaustive-deps

  // A second's tick for the countdowns on screen.
  useEffect(() => {
    if (stage.k === "lobby") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [stage.k]);

  function start(who: string[], round: number) {
    const s = settingsRef.current;
    room.current?.send({ k: "start", map: s.map, mode: s.mode, laps: s.laps, id: raceId(), who: who.slice(0, ROOM_MAX), round });
  }
  function change(s: Partial<Settings>) {
    const next = { ...settingsRef.current, ...s };
    room.current?.send({ k: "settings", ...next });
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
  if (stage.k === "race" && stage.who.includes(me) && inRoom) {
    const map = MAPS.find((m) => m.id === stage.map)!;
    const mine = stage.times.get(me);
    const left = stage.who.filter((e) => !stage.times.has(e) && members.some((m) => m.email === e)).length;
    const closes = stage.firstAt ? Math.max(0, Math.ceil((CLOSE_AFTER - (now - stage.firstAt)) / 1000)) : 0;
    const run: PartyRun = {
      attach(g) {
        game.current = g;
        for (const e of stage.who) {
          if (e === me) continue;
          const m = members.find((x) => x.email === e);
          g.addRemote(e, m?.name || nameOf(e), parseLook(m?.look));
        }
        const cur = stageRef.current;
        g.setPaused(!(cur.k === "race" && cur.go));
        g.onCarState = (s) => room.current?.sendCar(s);
        room.current?.send({ k: "loaded", id: stage.id });
        const t = setInterval(() => {
          const st = stageRef.current;
          if (st.k !== "race") return;
          const order = standings(st, cars.current, g, me);
          setPlace([order.indexOf(me) + 1, order.length]);
        }, 300);
        return () => { clearInterval(t); g.onCarState = null; if (game.current === g) game.current = null; };
      },
      finished(ticks) { room.current?.send({ k: "finish", id: stage.id, ticks }); },
      hud: place && <span className="hx-chip hx-place" aria-label={`Place ${place[0]} of ${place[1]}`}>P{place[0]}<span className="hx-dim">/{place[1]}</span></span>,
      overlay: !stage.go ? (
        <div className="hx-party-wait" role="status">Waiting for everyone to load…</div>
      ) : mine !== undefined ? (
        <div className="hx-over hx-over-late"><div className="hx-panel">
          <p className="hx-dim">{stage.mode === "elim" ? `Round ${stage.round}` : map.name}</p>
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
    const map = MAPS.find((m) => m.id === stage.map)!;
    const still = (alive.current ?? []).filter((e) => members.some((m) => m.email === e));
    const champ = stage.mode === "elim" && still.length === 1 ? still[0] : null;
    const next = stage.mode === "elim" && still.length > 1 ? Math.max(0, Math.ceil((NEXT_ROUND - (now - stage.at)) / 1000)) : 0;
    return (
      <div className="hx-menu hx-page hx-party">{back}
        <h1 className="hx-page-title">{champ ? <><IconCrown size={22} /> {name(champ)} {champ === me ? "win" : "wins"}!</> : stage.mode === "elim" ? `Round ${stage.round}` : "Results"} <span className="hx-dim">{map.name}</span></h1>
        <ol className="hx-party-order">
          {stage.order.map((e, i) => (
            <li key={e} className={`${e === me ? "me" : ""} ${stage.out.includes(e) ? "out" : ""}`}>
              <b>{i + 1}</b><span>{name(e)}</span>
              <span className="hx-dim">{stage.times.has(e) ? formatTime(stage.times.get(e)!) : "Didn't finish"}{stage.out.includes(e) ? " · out" : ""}</span>
            </li>
          ))}
        </ol>
        {next > 0 && <p className="hx-dim">{still.includes(me) ? "You're still in." : "You're out: watch the rest from here."} Round {stage.round + 1} starts in {next}s.</p>}
        {isHost ? (
          <div className="hx-row">
            {stage.mode === "race" && <button type="button" className="hx-btn hx-btn-main" onClick={() => start(members.map((m) => m.email), 1)}>Race again</button>}
            {next > 0 && <button type="button" className="hx-btn hx-btn-main" onClick={() => start(still, stage.round + 1)}>Start now</button>}
            <button type="button" className="hx-btn" onClick={() => room.current?.send({ k: "lobby" })}>Back to the lobby</button>
          </div>
        ) : !next && <p className="hx-dim">Waiting for {name(r?.host ?? "")} to pick what's next.</p>}
      </div>
    );
  }

  // ── The lobby (and watching a race you're not in) ──
  const map = MAPS.find((m) => m.id === settings.map) ?? MAPS[0];
  const others = members.filter((m) => m.email !== me);
  const ready = others.every((m) => m.ready);
  const watching = stage.k === "race";
  return (
    <div className="hx-menu hx-page hx-party">{back}
      <h1 className="hx-page-title">Room <span className="hx-code-big">{code}</span></h1>
      <Invite code={code} />
      {!r || !inRoom ? <p className="hx-dim">Joining…</p> : (
        <>
          {watching && (
            <p className="hx-party-note" role="status">
              {stage.mode === "elim" ? `Round ${stage.round} is on` : "A race is on"}: {stage.who.length - stage.times.size} still driving.
              {stage.times.size > 0 && <> Fastest so far: {name([...stage.times].sort((a, b) => a[1] - b[1])[0][0])}.</>}
            </p>
          )}
          <section className="hx-party-grid">
            <div>
              <h2 className="hx-h2">Players <span className="hx-dim">{members.length}/{ROOM_MAX}</span></h2>
              <ul className="hx-party-list">
                {members.map((m) => {
                  const link = m.email === me ? null : r.links.get(m.email);
                  return (
                    <li key={m.email} className={m.email === me ? "me" : ""}>
                      <span className="hx-party-name">{m.email === r.host && <IconCrown size={14} />}{m.email === me ? `${m.name || "You"} (you)` : m.name || nameOf(m.email)}</span>
                      <span className="hx-dim hx-small">
                        {link === "failed" ? "Can't connect" : link === "connecting" ? "Connecting…" : ""}
                        {link && link !== "open" ? " · " : ""}{m.ready ? "Ready" : "Not ready"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="hx-row">
                <button type="button" className={`hx-btn ${members.find((m) => m.email === me)?.ready ? "" : "hx-btn-main"}`} aria-pressed={!!members.find((m) => m.email === me)?.ready}
                  onClick={() => r.update({ ready: !members.find((m) => m.email === me)?.ready })}>
                  {members.find((m) => m.email === me)?.ready ? "Not ready" : "I'm ready"}
                </button>
              </div>
            </div>
            <div>
              <h2 className="hx-h2">Race</h2>
              {isHost ? (
                <>
                  <label className="hx-party-field"><span className="hx-dim">Map</span>
                    <select value={settings.map} onChange={(e) => change({ map: e.target.value })} disabled={watching}>
                      {MAPS.map((m) => <option key={m.id} value={m.id}>{m.name} · {BIOMES[m.biome].name}</option>)}
                    </select>
                  </label>
                  <div className="hx-party-field"><span className="hx-dim">Mode</span>
                    <div className="hx-seg" role="radiogroup" aria-label="Mode">
                      {(["race", "elim"] as Mode[]).map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={settings.mode === k} className={settings.mode === k ? "on" : ""} disabled={watching} onClick={() => change({ mode: k })}>{MODE_NAME[k]}</button>
                      ))}
                    </div>
                  </div>
                  <p className="hx-dim hx-small">{settings.mode === "elim" ? "Rounds on the same map: whoever's last each round is out, until one is left." : "One race: first to the finish wins."}</p>
                  <div className="hx-row">
                    <button type="button" className="hx-btn hx-btn-main" data-sound="confirm" disabled={watching || (settings.mode === "elim" && members.length < 2)}
                      onClick={() => start(members.map((m) => m.email), 1)}>{ready ? "Start" : "Start anyway"}</button>
                  </div>
                  {settings.mode === "elim" && members.length < 2 && <p className="hx-dim hx-small">Elimination needs at least 2 players.</p>}
                  {!ready && !watching && <p className="hx-dim hx-small">Not everyone's ready yet.</p>}
                </>
              ) : (
                <>
                  <p><b>{map.name}</b> <span className="hx-dim">· {BIOMES[map.biome].name} · {MODE_NAME[settings.mode]}</span></p>
                  <p className="hx-dim">{name(r.host)} picks the map and starts the race.</p>
                </>
              )}
            </div>
          </section>
          <p className="hx-dim hx-small">Cars go through a relay, so nobody in the room can see your address. Party races don't count for records.</p>
        </>
      )}
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
function standings(st: RaceStage, cars: Map<string, CarState>, g: Game | null, me: string): string[] {
  const mine = g && st.who.includes(me) ? g.carState() : null;
  const dist = (e: string) => (e === me ? mine : cars.get(e))?.dist ?? -1;
  return st.who.slice().sort((a, b) => {
    const ta = st.times.get(a), tb = st.times.get(b);
    if (ta !== undefined || tb !== undefined) return (ta ?? Infinity) - (tb ?? Infinity) || (a < b ? -1 : 1);
    return dist(b) - dist(a) || (a < b ? -1 : 1);
  });
}
