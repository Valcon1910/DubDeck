// Hexdrift party rooms: the lobby (who's in, the host's map and laps), the
// race itself (inside the normal race screen, with the others' cars) and the
// results on the podium. The room lives in partysession.ts (it stays open on
// other pages, with a card in the corner), its messages and budget in room.ts,
// the cars in netcar.ts.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTY_MAPS, BIOMES, type MapDef } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import type { Look } from "./garage.ts";
import { parseLook } from "./online.ts";
import type { Game } from "./game.ts";
import { isRoomCode, ROOM_MAX } from "./room.ts";
import { IconBack, IconCrown, IconFlag } from "./ui/icons.tsx";
import { isCommunity, listMaps, type CMap } from "./community.ts";
import { createParty, getParty, joinParty, leaveParty, partyHash, partyLink, useParty } from "./partyhub.ts";
import { CLOSE_AFTER, partySession, type PartySession, type RaceStage } from "./partysession.ts";

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
  /** Leaves the room. */
  leave(): void;
}

/** A pillar on the results podium. */
export interface PartyPlace { place: number; look: Look | null; name: string; sub: ReactNode; me: boolean }

export const LAPS = [1, 2, 3, 4, 5];

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
      <h1 className="hx-page-title">Multiplayer</h1>
      <p className="hx-dim">Race up to {ROOM_MAX} friends at once. Start a party and send them the link, or type the code they sent you.</p>
      {!signedIn ? <p className="hx-dim">{offline}</p> : (
        <div className="hx-party-start">
          <button type="button" className="hx-big" data-sound="confirm" onClick={() => { void createParty().then((c) => { location.hash = partyHash(c); }); }}>
            <IconFlag size={22} /><span>Start a party</span>
          </button>
          <form className="hx-party-join" onSubmit={(e) => { e.preventDefault(); if (isRoomCode(clean)) { joinParty(clean); location.hash = partyHash(clean); } }}>
            <label htmlFor="hx-code" className="hx-dim">Party code</label>
            <input id="hx-code" className="hx-code" value={clean} onChange={(e) => setCode(e.target.value)} placeholder="ABCDEF" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            <button type="submit" className="hx-btn hx-btn-main" disabled={!isRoomCode(clean)}>Join</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** The party session for a room page (joining that room if you weren't in it). */
export function useSession(code: string, sb: SupabaseClient, me: string, myName: string, nameOf: (e: string) => string): PartySession | null {
  const active = useParty();
  useEffect(() => { if (getParty() !== code) joinParty(code); }, [code]);
  const session = active === code ? partySession(sb, me, myName, nameOf) : null;
  useSyncExternalStore(session?.subscribe ?? noSub, session?.getVersion ?? zero);
  return session;
}
const noSub = () => () => {};
const zero = () => 0;

/** #/hexdrift/party/<code>: the room, from the lobby through each race. */
export function Party({ code, sb, me, myName, nameOf, race, podium }: {
  code: string; sb: SupabaseClient; me: string; myName: string;
  nameOf: (email: string) => string;
  race: (map: MapDef, run: PartyRun, key: string) => ReactNode;
  podium: (places: PartyPlace[]) => ReactNode;
}) {
  const s = useSession(code, sb, me, myName, nameOf);
  const [now, setNow] = useState(() => Date.now());
  const stageK = s?.stage.k;
  // A tick for the countdowns on screen.
  useEffect(() => {
    if (stageK !== "race") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [stageK]);
  if (!s) return <div className="hx-menu hx-page"><Bar /><h1 className="hx-page-title">Party {code}</h1><p className="hx-dim">Joining…</p></div>;
  const r = s.room, stage = s.stage, settings = s.settings, note = s.note, fail = s.fail, hud = s.hud;
  const members = s.members, isHost = s.isHost, inRoom = s.inRoom;
  const defOf = (id: string) => s.defOf(id);
  const start = () => s.start();
  const change = (c: Parameters<PartySession["change"]>[0]) => s.change(c);
  const leave = () => { leaveParty(); location.hash = "#/hexdrift/party"; };
  const name = (e: string) => s.name(e);
  const back = <Bar back="#/hexdrift" label="Home" />;

  if (fail) {
    return (
      <div className="hx-menu hx-page">{back}
        <h1 className="hx-page-title">Party {code}</h1>
        <p className="hx-dim">{fail}</p>
        <div className="hx-row"><button type="button" className="hx-btn" onClick={leave}>Back</button></div>
      </div>
    );
  }

  // ── The race ──
  if (stage.k === "race" && stage.who.includes(me) && inRoom && !defOf(stage.map)) {
    const gone = defOf(stage.map) === null;
    return (
      <div className="hx-menu hx-page hx-party">{back}
        <h1 className="hx-page-title">Party {code}</h1>
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
      attach: (g) => s.attach(g),
      finished: (ticks) => s.finished(ticks),
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
      leave,
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
            <button type="button" className="hx-btn" onClick={() => s.toLobby()}>Back to the lobby</button>
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
      <h1 className="hx-page-title">Party <span className="hx-code-big">{code}</span></h1>
      <Invite code={code} />
      {!inRoom ? <p className="hx-dim">Joining…</p> : (
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
                <button type="button" className={`hx-btn ${myReady ? "" : "hx-btn-main"}`} aria-pressed={myReady} onClick={() => s.setReady(!myReady)}>
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
  const link = useMemo(() => partyLink(code), [code]);
  return (
    <div className="hx-party-invite">
      <input readOnly value={link} aria-label="Party link" onFocus={(e) => e.currentTarget.select()} />
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

