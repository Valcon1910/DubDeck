// Hexdrift: a fast time-trial racer built into Vortex. This file is the menu,
// the HUD, the finish screen and Gaming Mode; the game itself is in game.ts.
// Loaded only when someone opens it, so it adds nothing to the rest of the site.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ALL_MAPS, MAPS, BIOMES, medalFor, type MapDef, type Medal } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { Controls, type Action } from "./input.ts";
import { Game } from "./game.ts";
import { allBests, allTimes, bestNow, bestTimeNow, clearBest, clearLive, offerBest, readLive, saveLive, type Best, type Run } from "./records.ts";
import { canFullscreen, disableGaming, enableGaming, enterFullscreen, isFullscreen, isGaming, isStandalone, onGaming } from "./gaming.ts";
import { board, medalLeaders, playerRecords, rankFor, recordRun, syncAccount, worldRecords, type Entry, type Leader, type Submitted } from "./online.ts";
import { CHAT_ON, displayName, useChat, type Profile } from "../vortex/chat/store";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemOf, MAX_POINTS, medalPoints, readLook, saveLook, SLOTS, type BodyDef, type Item, type Look, type Slot } from "./garage.ts";
import { Preview } from "./render/preview.ts";
import { Podium, podiumOrder } from "./render/podium.ts";
import { mapStill, spectator } from "./render/spectator.ts";
import { isMuted, play, setMuted, wireUiSounds } from "./ui/sound.ts";
import { IconBack, IconCamera, IconCrown, IconFlag, IconFullscreen, IconGamepad, IconGarage, IconLock, IconMedal, IconMute, IconPause, IconPlay, IconRestart, IconRoute, IconSound, IconTrophy } from "./ui/icons.tsx";
import type { IntroStage } from "./game.ts";
import "./hexdrift.css";

const MEDAL_NAME: Record<Exclude<Medal, null>, string> = { vortex: "Vortex", gold: "Gold", silver: "Silver", bronze: "Bronze" };

function MedalIcon({ m, size = 18 }: { m: Medal; size?: number }) {
  if (!m) return null;
  return <span className={`hx-medal hx-medal-${m}`} style={{ width: size, height: size }} aria-label={`${MEDAL_NAME[m]} medal`} />;
}

type View =
  | { kind: "menu" }
  | { kind: "maps" }
  | { kind: "map"; map: MapDef }
  | { kind: "play"; map: MapDef }
  | { kind: "records"; map: MapDef }
  | { kind: "player"; email: string }
  | { kind: "garage" };

/**
 * #/hexdrift (title), #/hexdrift/maps, #/hexdrift/map/<map> (its page),
 * #/hexdrift/<map> (race), #/hexdrift/<map>/records, #/hexdrift/player/<email>
 */
function readView(): View {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[1] === "garage") return { kind: "garage" };
  if (parts[1] === "maps") return { kind: "maps" };
  if (parts[1] === "map") { const m = MAPS.find((x) => x.id === parts[2]); return m ? { kind: "map", map: m } : { kind: "maps" }; }
  if (parts[1] === "player" && parts[2]) return { kind: "player", email: decodeURIComponent(parts[2]).toLowerCase() };
  // Maps still being built open by address on the dev server only.
  const map = (import.meta.env.DEV ? ALL_MAPS : MAPS).find((m) => m.id === parts[1]);
  if (!map) return { kind: "menu" };
  return parts[2] === "records" ? { kind: "records", map } : { kind: "play", map };
}

// ── Online records (through Chat's sign-in) ──────────────────────────────────
interface OnlineCtx {
  /** Signed in to the online records (null when offline, signed out or Chat is off). */
  sb: SupabaseClient | null;
  me: string;
  profiles: Map<string, Profile>;
  /** Sends best runs that haven't been sent yet (and takes in the account's others). */
  sync: () => Promise<Map<string, Submitted>>;
  /** Goes up whenever records from the account's other devices arrive. */
  rev: number;
}
const Online = createContext<OnlineCtx>({ sb: null, me: "", profiles: new Map(), sync: async () => new Map(), rev: 0 });
const useOnlineRecords = () => useContext(Online);
const nameOf = (profiles: Map<string, Profile>, email: string) => displayName(profiles.get(email), email);

// A run that was in progress when the page was reloaded (read once per page load).
let bootLive = readLive();

function pref(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function setPref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* */ } }

export function Hexdrift() {
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const on = () => setView(readView());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const chat = useChat();
  const sb = CHAT_ON && chat?.status === "ready" ? chat.sb : null;
  const me = chat?.me ?? "";
  const profiles = chat?.profiles ?? EMPTY;
  const [toast, setToast] = useState("");
  const [rev, setRev] = useState(0);
  const sync = useCallback(async () => {
    if (!sb) return new Map<string, Submitted>();
    const { sent: res, pulled } = await syncAccount(sb, me).catch(() => ({ sent: new Map<string, Submitted>(), pulled: false }));
    if (pulled) setRev((n) => n + 1);
    for (const [id, r] of res) {
      const name = MAPS.find((m) => m.id === id)?.name ?? id;
      if (r.beatWorldRecord) { setToast(`You took the world record on ${name}!`); break; }
      if (r.worldRecord && r.improved) setToast(`World record on ${name}!`);
    }
    return res;
  }, [sb, me]);
  // Send waiting runs now, and whenever the connection comes back.
  useEffect(() => {
    void sync();
    const on = () => void sync();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [sync]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  // Every press in the menus gets a sound; every screen change a whoosh.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => wireUiSounds(root.current!), []);
  const viewKey = view.kind + ("map" in view ? `:${view.map.id}` : "email" in view ? `:${view.email}` : "");
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    if (view.kind !== "play") play("whoosh");
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Online.Provider value={{ sb, me, profiles, sync, rev }}>
      <div className="hx" role="application" aria-label="Hexdrift" ref={root}>
        <div className="hx-view" key={viewKey}>
          {view.kind === "play" ? <Play map={view.map} />
            : view.kind === "records" ? <Records map={view.map} />
            : view.kind === "player" ? <Player email={view.email} />
            : view.kind === "garage" ? <Garage />
            : view.kind === "maps" ? <MapSelect />
            : view.kind === "map" ? <MapDetail map={view.map} />
            : <Title />}
        </div>
        {toast && <div className="hx-toast" role="status"><IconCrown size={18} />{toast}</div>}
      </div>
    </Online.Provider>
  );
}
const EMPTY = new Map<string, Profile>();

function useGaming() {
  const [on, setOn] = useState(isGaming);
  useEffect(() => onGaming(setOn), []);
  return on;
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

/**
 * True when this device has a keyboard: a mouse or trackpad is attached, or a
 * real key has been pressed here (remembered). Touch-only phones and tablets
 * don't get keyboard hints.
 */
function useKeyboard() {
  const [on, setOn] = useState(() => pref("hexdrift.kbd", "") === "1"
    || (typeof matchMedia !== "undefined" && matchMedia("(any-pointer: fine)").matches));
  useEffect(() => {
    if (on) return;
    const k = (e: KeyboardEvent) => { if (e.isTrusted && e.key.length > 0) { setPref("hexdrift.kbd", "1"); setOn(true); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [on]);
  return on;
}

/** Top bar shared by the menu screens: a way back, then sound, garage and Gaming Mode. */
function TopBar({ back, garage = true }: { back?: { href: string; label: string }; garage?: boolean }) {
  const gaming = useGaming();
  const [quiet, setQuiet] = useState(isMuted);
  return (
    <header className="hx-bar">
      {back ? <a className="hx-back" href={back.href}><IconBack size={18} />{back.label}</a>
        : gaming ? <span className="hx-back hx-dim">Gaming Mode is on</span>
        : <a className="hx-back" href="#/games" aria-label="Back to Vortex"><IconBack size={18} />Vortex</a>}
      <span className="hx-bar-r">
        <button type="button" className="hx-chipbtn hx-sq" data-sound="toggle" aria-label={quiet ? "Turn menu sounds on" : "Turn menu sounds off"}
          title={quiet ? "Sounds off" : "Sounds on"} onClick={() => { setMuted(!quiet); setQuiet(!quiet); if (quiet) play("toggle"); }}>
          {quiet ? <IconMute /> : <IconSound />}
        </button>
        {garage && <a className="hx-chipbtn" href="#/hexdrift/garage"><IconGarage />Garage</a>}
        <GamingButton />
      </span>
    </header>
  );
}

interface Pillar { place: number; look: Look | null; name: string; sub: React.ReactNode; href?: string; me?: boolean }
/** Lit pillars with each holder's car on top, and their name and time below. */
function PodiumView({ places, empty }: { places: Pillar[]; empty: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const pod = useRef<Podium | null>(null);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    try { pod.current = new Podium(host.current!); } catch { setFail(true); }
    return () => { pod.current?.dispose(); pod.current = null; };
  }, []);
  const sig = places.map((p) => `${p.place}:${p.name}:${JSON.stringify(p.look)}`).join("|");
  useEffect(() => { pod.current?.set(places.map((p) => ({ place: p.place, look: p.look }))); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = podiumOrder(places);
  return (
    <div className={`hx-podium ${places.length ? "" : "is-empty"} ${fail ? "no-3d" : ""}`} style={{ ["--n" as string]: Math.max(1, places.length) }}>
      <div className="hx-podium-stage" ref={host} />
      {places.length === 0 && <p className="hx-podium-empty">{empty}</p>}
      <ol className="hx-podium-names">
        {row.map((p, i) => (
          <li key={p.place} className={`hx-pl-${p.place} ${p.me ? "me" : ""}`} style={{ animationDelay: `${120 + i * 90}ms` }}>
            <span className="hx-pl-place">{p.place === 1 ? <IconCrown size={16} /> : null}#{p.place}</span>
            {p.href ? <a className="hx-pl-name" href={p.href}>{p.name}</a> : <span className="hx-pl-name">{p.name}</span>}
            <span className="hx-pl-sub">{p.sub}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The title screen: your car, the way in, and the medal leaders. */
function Title() {
  const keyboard = useKeyboard();
  const online = useOnline();
  const { sb, me, profiles, rev } = useOnlineRecords();
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [no3d, setNo3d] = useState(false);
  useEffect(() => {
    clearLive();
    bootLive = null;
    let alive = true;
    void allTimes().then((m) => {
      if (!alive) return;
      const p = medalPoints(m);
      setPoints(p);
      setDone(m.size);
      preview.current?.setLook(readLook(p));
    });
    return () => { alive = false; };
  }, [rev]);
  useEffect(() => {
    try { preview.current = new Preview(host.current!, "hero"); preview.current.setLook(readLook()); } catch { setNo3d(true); }
    return () => { preview.current?.dispose(); preview.current = null; };
  }, []);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void medalLeaders(sb, 5).then((l) => { if (alive) setLeaders(l); }).catch(() => { if (alive) setLeaders([]); });
    return () => { alive = false; };
  }, [sb, rev]);
  const pillars: Pillar[] = (leaders ?? []).map((l, i) => ({
    place: i + 1, look: l.look, name: l.email === me ? "You" : nameOf(profiles, l.email), me: l.email === me,
    href: `#/hexdrift/player/${encodeURIComponent(l.email)}`,
    sub: <><IconMedal size={14} />{l.points} pts{l.wrs ? <> · <IconCrown size={13} />{l.wrs}</> : null}</>,
  }));
  return (
    <div className="hx-menu hx-title">
      <div className="hx-lines" aria-hidden="true" />
      <TopBar />
      <section className="hx-hero">
        <div className="hx-hero-text">
          <h1 className="hx-logo" aria-label="HEXDRIFT">HEX<span aria-hidden="true">DRIFT</span></h1>
          <p className="hx-sub">Time trial racing. Beat the medals, chase the world record ghost.</p>
          <div className="hx-cta">
            <a className="hx-big" href="#/hexdrift/maps" data-sound="confirm"><IconPlay size={22} /><span>Play</span></a>
            <a className="hx-big hx-big-2" href="#/hexdrift/garage"><IconGarage size={22} /><span>Garage</span></a>
          </div>
          <dl className="hx-stats">
            <div><dt>Medal points</dt><dd>{points ?? "…"}<small>/{MAX_POINTS}</small></dd></div>
            <div><dt>Maps finished</dt><dd>{done}<small>/{MAPS.length}</small></dd></div>
          </dl>
          {!online && <p className="hx-offline">You're offline. Everything still works, and your records are saved on this device.</p>}
        </div>
        <div className="hx-hero-car" ref={host}>
          {no3d ? <p className="hx-dim">This device can't show 3D graphics.</p> : <p className="hx-hint">Drag to spin it any way</p>}
        </div>
      </section>
      <section className="hx-leaders" aria-labelledby="hx-leaders-h">
        <h2 id="hx-leaders-h" className="hx-h2"><IconTrophy />Medal leaders</h2>
        {sb ? (
          leaders === null ? <p className="hx-dim hx-center">Loading…</p>
            : <PodiumView places={pillars} empty="No medals yet this season. Finish a map to take the top pillar." />
        ) : <p className="hx-dim hx-center"><NeedOnlineText /></p>}
      </section>
      {keyboard && (
        <p className="hx-help">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows drive</span>
          <span><kbd>Space</kbd> drift</span>
          <span><kbd>Enter</kbd> back to checkpoint</span>
          <span><kbd>R</kbd> restart</span>
          <span><kbd>C</kbd> camera</span>
          <span>Gamepads and touch work too</span>
        </p>
      )}
    </div>
  );
}

/** A map's picture: a still from above, and the live drone view while hovered. */
function MapArt({ map, live = false }: { map: MapDef; live?: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void mapStill(map).then((u) => { if (alive) setSrc(u); });
    }, { rootMargin: "200px" });
    io.observe(el.current!);
    return () => { alive = false; io.disconnect(); };
  }, [map]);
  useEffect(() => {
    if (!live) return;
    const h = el.current!;
    spectator()?.show(h, map);
    return () => spectator()?.hide(h);
  }, [live, map]);
  const b = BIOMES[map.biome];
  return (
    <span className="hx-art" ref={el} style={{ ["--hx-sky" as string]: b.sky, ["--hx-g" as string]: b.ground }} aria-hidden="true">
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}

function MapSelect() {
  const [bests, setBests] = useState<Map<string, Best> | null>(null);
  const { sb, me, profiles, rev } = useOnlineRecords();
  const [wrs, setWrs] = useState<Map<string, Entry> | null>(null);
  const [hover, setHover] = useState("");
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void worldRecords(sb, MAPS.map((m) => m.id)).then((w) => { if (alive) setWrs(w); }).catch(() => {});
    return () => { alive = false; };
  }, [sb]);
  useEffect(() => {
    clearLive();
    bootLive = null;
    let alive = true;
    void allTimes().then((m) => { if (alive) setBests(m); });
    return () => { alive = false; };
  }, [rev]);
  return (
    <div className="hx-menu hx-maps-page">
      <TopBar back={{ href: "#/hexdrift", label: "Home" }} />
      <h1 className="hx-h1"><IconRoute size={28} />Choose a map</h1>
      <ul className="hx-maps">
        {MAPS.map((m, i) => {
          const best = bests?.get(m.id) ?? null;
          const medal = best ? medalFor(m, best.t) : null;
          const b = BIOMES[m.biome];
          const wr = wrs?.get(m.id);
          return (
            <li key={m.id} style={{ animationDelay: `${60 + i * 70}ms` }}>
              <a className="hx-map" href={`#/hexdrift/map/${m.id}`} style={{ ["--hx-a" as string]: b.accent }}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(m.id); }}
                onPointerLeave={() => setHover((h) => (h === m.id ? "" : h))}
                onFocus={() => setHover(m.id)} onBlur={() => setHover((h) => (h === m.id ? "" : h))}>
                <MapArt map={m} live={hover === m.id} />
                <span className="hx-map-text">
                  <strong>{m.name}</strong>
                  <span className="hx-map-tags"><em>{b.name}</em><em className={`hx-diff hx-diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</em></span>
                  <span className="hx-map-best">
                    {best ? <><MedalIcon m={medal} />{formatTime(best.t)}</> : <span className="hx-dim">{bests ? "No time yet" : "…"}</span>}
                  </span>
                  {wr && <span className="hx-map-wr" title="World record"><IconCrown size={14} />{formatTime(wr.ticks)} <span className="hx-dim">{wr.email === me ? "You" : nameOf(profiles, wr.email)}</span></span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A map's page: its drone view, what it's like, your best, and its top three. */
function MapDetail({ map }: { map: MapDef }) {
  const idx = MAPS.findIndex((m) => m.id === map.id);
  const b = BIOMES[map.biome];
  const { sb, me, profiles, rev } = useOnlineRecords();
  const [best, setBest] = useState<Best | null>(() => bestTimeNow(map.id));
  const [top, setTop] = useState<Entry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void allTimes().then(() => { if (alive) setBest(bestTimeNow(map.id)); });
    return () => { alive = false; };
  }, [map.id, rev]);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void board(sb, map.id, 3).then((r) => { if (alive) setTop(r.top); }).catch(() => { if (alive) setTop([]); });
    return () => { alive = false; };
  }, [sb, map.id, rev]);
  const order: Exclude<Medal, null>[] = ["vortex", "gold", "silver", "bronze"];
  const medal = best ? medalFor(map, best.t) : null;
  // Online: the map's top three. Offline or signed out: just your own best.
  const pillars: Pillar[] = sb && top
    ? top.map((e, i) => ({
      place: i + 1, look: e.look ?? (e.email === me ? readLook() : null), name: e.email === me ? "You" : nameOf(profiles, e.email), me: e.email === me,
      href: `#/hexdrift/player/${encodeURIComponent(e.email)}`, sub: <><MedalIcon m={medalFor(map, e.ticks)} size={12} />{formatTime(e.ticks)}</>,
    }))
    : best ? [{ place: 1, look: readLook(), name: "You", me: true, sub: <><MedalIcon m={medal} size={12} />{formatTime(best.t)}</> }] : [];
  return (
    <div className="hx-menu hx-detail-page" style={{ ["--hx-a" as string]: b.accent }}>
      <TopBar back={{ href: "#/hexdrift/maps", label: "Maps" }} />
      <section className={`hx-detail ${idx % 2 ? "flip" : ""}`}>
        <div className="hx-detail-view">
          <MapArt map={map} live />
          <span className="hx-live"><i />Live</span>
        </div>
        <div className="hx-detail-text">
          <p className="hx-kicker">{String(idx + 1).padStart(2, "0")} · {b.name} · <span className={`hx-diff hx-diff-${map.difficulty.toLowerCase()}`}>{map.difficulty}</span></p>
          <h1 className="hx-detail-name">{map.name}</h1>
          <p className="hx-detail-blurb">{map.blurb}</p>
          <div className="hx-detail-best">
            {best ? <><MedalIcon m={medal} size={22} /><span>Your best <strong>{formatTime(best.t)}</strong></span></> : <span className="hx-dim">No time yet</span>}
          </div>
          <ul className="hx-targets-row">
            {order.map((m) => (
              <li key={m} className={best && best.t <= map.medals[m] ? "got" : ""}><MedalIcon m={m} size={14} /><span>{formatTime(map.medals[m])}</span></li>
            ))}
          </ul>
          <div className="hx-cta">
            <a className="hx-big" href={`#/hexdrift/${map.id}`} data-sound="confirm"><IconFlag size={22} /><span>Race</span></a>
            {sb && <a className="hx-big hx-big-2" href={`#/hexdrift/${map.id}/records`}><IconTrophy size={20} /><span>Leaderboard</span></a>}
          </div>
        </div>
      </section>
      <section className="hx-leaders">
        <h2 className="hx-h2"><IconCrown />{sb ? "Top three" : "Your best"}</h2>
        {sb && top === null ? <p className="hx-dim hx-center">Loading…</p>
          : <PodiumView places={pillars} empty={sb ? "No records yet. The top pillar is yours to take." : "Finish the map to stand on the pillar."} />}
      </section>
    </div>
  );
}

let offAt = 0;
/** One tap turns Gaming Mode on; holding for 3 seconds turns it off. */
function GamingButton({ compact = false }: { compact?: boolean }) {
  const on = useGaming();
  const [holding, setHolding] = useState(false);
  const [fs, setFs] = useState(isFullscreen);
  const timer = useRef(0);
  useEffect(() => {
    const f = () => setFs(isFullscreen());
    document.addEventListener("fullscreenchange", f);
    document.addEventListener("webkitfullscreenchange", f);
    return () => { document.removeEventListener("fullscreenchange", f); document.removeEventListener("webkitfullscreenchange", f); };
  }, []);
  const start = () => {
    if (!on) return;
    setHolding(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setHolding(false); offAt = performance.now(); disableGaming(); }, 3000);
  };
  const cancel = () => { clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!on) {
    return (
      <button type="button" data-sound="toggle" className={`hx-gaming ${compact ? "hx-icon" : ""}`} title="Gaming Mode: full screen, and Back or reload can't end your run"
        aria-label="Turn on Gaming Mode"
        // Lifting the finger after the 3-second hold lands on this button: not a new tap.
        onClick={() => { if (performance.now() - offAt > 700) enableGaming(); }}>
        <IconGamepad />{compact ? null : <span>Gaming Mode</span>}
      </button>
    );
  }
  return (
    <>
      {canFullscreen() && !fs && (
        <button type="button" className={`hx-gaming ${compact ? "hx-icon" : ""}`} aria-label="Back to full screen" title="Back to full screen" onClick={() => void enterFullscreen()}>
          <IconFullscreen />{compact ? null : <span>Full screen</span>}
        </button>
      )}
      <button type="button" className={`hx-gaming on ${holding ? "holding" : ""} ${compact ? "hx-icon" : ""}`}
        aria-label="Gaming Mode is on. Hold for 3 seconds to turn it off"
        title="Hold for 3 seconds to turn off"
        onPointerDown={(e) => { e.preventDefault(); start(); }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); e.stopPropagation(); start(); } }}
        onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") cancel(); }}
        onContextMenu={(e) => e.preventDefault()}>
        <svg className="hx-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" />
          <circle className="hx-ring-fill" cx="18" cy="18" r="15" />
        </svg>
        {compact ? null : <span>{holding ? "Keep holding…" : "Gaming Mode on"}</span>}
      </button>
      <IphoneTip />
    </>
  );
}

/** iPhones can't go full screen from a website; the home-screen app can. */
function IphoneTip() {
  const [shown, setShown] = useState(() => !canFullscreen() && !isStandalone() && pref("hexdrift.iphoneTip", "") !== "1");
  if (!shown) return null;
  return (
    <div className="hx-tip" role="note">
      <p><strong>No full screen on iPhone websites.</strong> For no address bar, tap <b>Share</b> then <b>Add to Home Screen</b>, and open Vortex from there. Gaming Mode still stops Back from leaving your run.</p>
      <button type="button" className="hx-btn" onClick={() => { setPref("hexdrift.iphoneTip", "1"); setShown(false); }}>OK</button>
    </div>
  );
}

interface Result { ticks: number; best: Best | null; isBest: boolean; online?: "sending" | "waiting" | Submitted }
type Over = null | "pause" | "restored" | Result;

function Play({ map }: { map: MapDef }) {
  const host = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const cps = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLDivElement>(null);
  const split = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const controls = useRef<Controls | null>(null);
  const [over, setOver] = useState<Over>(null);
  const overRef = useRef<Over>(null);
  overRef.current = over;
  const [touch, setTouch] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  const [best, setBest] = useState<Best | null>(() => bestTimeNow(map.id));
  const [error, setError] = useState("");
  const gaming = useGaming();
  const { sb, me, profiles, sync } = useOnlineRecords();
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const [wrName, setWrName] = useState("");
  // The race-start cutscene (only when arriving at the map, not on restarts).
  const [intro, setIntro] = useState<IntroStage>("done");

  const loadGhost = useCallback((run: Run | null) => {
    game.current?.setGhost(run ? run.inputs : null, run?.t ?? 0);
  }, []);

  const restart = useCallback(() => {
    setOver(null);
    clearLive();
    bootLive = null;
    game.current?.restart();
  }, []);
  const pause = useCallback((p: boolean) => {
    const g = game.current;
    if (!g || g.race.phase === "finished") return;
    g.setPaused(p);
    setOver(p ? "pause" : null);
  }, []);

  useEffect(() => {
    const c = new Controls((cmd) => {
      if (cmd === "restart") restart();
      else if (cmd === "camera") setPref("hexdrift.cam", String(game.current?.cycleCamera() ?? 0));
      else if (cmd === "pause") {
        const o = overRef.current;
        if (o === "pause" || o === "restored") pause(false);
        else if (o === null) pause(true);
      }
    });
    controls.current = c;
    let g: Game;
    try {
      g = new Game(host.current!, map, { time: time.current, speed: speed.current, cps: cps.current, count: count.current, split: split.current }, {
        onFinish(ticks, inputs) {
          clearLive();
          bootLive = null;
          const prev = bestTimeNow(map.id);
          const isBest = !prev || ticks < prev.t;
          setOver({ ticks, best: prev, isBest });
          void offerBest(map.id, ticks, inputs).then(async (saved) => {
            if (!saved) return;
            const now = bestNow(map.id);
            setBest(bestTimeNow(map.id));
            loadGhost(now); // race your new best next time
            // Send it to the online records (or keep it for later when offline).
            setOver((o) => o && typeof o === "object" && o.ticks === ticks ? { ...o, online: navigator.onLine ? "sending" : "waiting" } : o);
            const res = (await syncRef.current()).get(map.id);
            if (res?.worldRecord) { game.current?.setRecordGhost(null); setWrName(""); }
            setOver((o) => o && typeof o === "object" && o.ticks === ticks ? { ...o, online: res ?? "waiting" } : o);
          });
        },
        onHidden() { pause(true); },
        onIntro(s) { setIntro(s); },
      }, c, (Number(pref("hexdrift.cam", "0")) || 0) % 3, readLook(), !(bootLive && bootLive.map === map.id && bootLive.inputs.length > 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This device can't show 3D graphics.");
      return () => c.dispose();
    }
    game.current = g;
    g.setGraphics(gfxPref());
    void allBests().then(() => {
      if (game.current !== g) return;
      const b = bestNow(map.id);
      setBest(bestTimeNow(map.id));
      loadGhost(b);
    });
    // Carry on a run the page was reloaded in the middle of.
    if (bootLive && bootLive.map === map.id && bootLive.inputs.length > 0) {
      g.restore(bootLive.inputs);
      g.setPaused(true);
      setOver("restored");
    }
    g.start();
    if (import.meta.env.DEV) Object.assign(window, { __hexdrift: g, __hexdriftClear: clearBest });

    // Save the run in progress every 2 seconds and when the page is closing.
    const keep = () => {
      const r = g.race;
      if (r.phase === "running" && r.inputs.length > 0 && !g.autopilot) saveLive(map.id, r.inputs);
    };
    const every = window.setInterval(keep, 2000);
    window.addEventListener("pagehide", keep);

    const onTouch = () => setTouch(true);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => {
      clearInterval(every);
      window.removeEventListener("pagehide", keep);
      window.removeEventListener("touchstart", onTouch);
      g.dispose();
      c.dispose();
      game.current = null;
    };
  }, [map, pause, restart, loadGhost]);

  // The world record's gold ghost (unless it's yours).
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void recordRun(sb, map.id).then((r) => {
      const g = game.current;
      if (!alive || !g || !r || r.email === me) return;
      const name = nameOf(profiles, r.email);
      if (g.setRecordGhost(r.inputs, r.ticks, name)) setWrName(name);
    }).catch(() => {});
    return () => { alive = false; };
    // Profiles arriving later only changes the label; not worth a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, map.id, me]);

  const idx = MAPS.findIndex((m) => m.id === map.id);
  const next = MAPS[(idx + 1) % MAPS.length];

  if (error) {
    return (
      <div className="hx-over"><div className="hx-panel">
        <h2>Can't start Hexdrift</h2><p>{error}</p><a className="hx-btn" href="#/hexdrift/maps">Back to maps</a>
      </div></div>
    );
  }

  return (
    <div className={`hx-play ${intro !== "done" ? "in-intro" : ""}`} ref={host}>
      {intro !== "done" && <Intro map={map} stage={intro} best={best} />}
      <div className="hx-hud" aria-live="off">
        <div className="hx-hud-top">
          <span className="hx-chip"><span className="hx-dim">CP</span> <span ref={cps}>0/0</span></span>
          <span className="hx-time" ref={time}>0:00.000</span>
          <span className="hx-hud-btns">
            <button type="button" className="hx-icon" aria-label="Restart (R)" title="Restart (R)" onClick={restart}><IconRestart /></button>
            <button type="button" className="hx-icon" aria-label="Camera (C)" title="Camera (C)" onClick={() => setPref("hexdrift.cam", String(game.current?.cycleCamera() ?? 0))}><IconCamera /></button>
            <GamingButton compact />
            <button type="button" className="hx-icon" aria-label="Pause (Esc)" title="Pause (Esc)" onClick={() => pause(true)}><IconPause /></button>
          </span>
        </div>
        <div className="hx-targets">
          {best && <span><MedalIcon m={medalFor(map, best.t)} size={12} />Best {formatTime(best.t)}</span>}
          <span><MedalIcon m="gold" size={12} />{formatTime(map.medals.gold)}</span>
          {wrName && <span className="hx-wr-chip"><IconCrown size={13} />{wrName}</span>}
        </div>
        <div className="hx-split" ref={split} />
        <div className="hx-count" ref={count} />
        <div className="hx-speed"><span ref={speed}>0</span><em>km/h</em></div>
      </div>

      {touch && <TouchPad controls={controls} />}

      {(over === "pause" || over === "restored") && (
        <div className="hx-over"><div className="hx-panel">
          <h2>{over === "restored" ? "Run restored" : "Paused"}</h2>
          <p className="hx-dim">{over === "restored" ? "The page reloaded, so your run was rebuilt exactly where you left it." : map.name}</p>
          <div className="hx-row">
            <button type="button" className="hx-btn hx-btn-main" onClick={() => pause(false)} autoFocus>{over === "restored" ? "Carry on" : "Resume"}</button>
            <button type="button" className="hx-btn" onClick={restart}>Restart</button>
            <a className="hx-btn" href={`#/hexdrift/map/${map.id}`}>Maps</a>
          </div>
          {over === "pause" && <GraphicsPicker game={game.current} />}
          {gaming && <p className="hx-dim hx-small">Gaming Mode is on: hold its button for 3 seconds to turn it off.</p>}
        </div></div>
      )}
      {over && typeof over === "object" && <Finish map={map} result={over} next={next} onRestart={restart} signedIn={!!sb} />}
    </div>
  );
}

const GFX_MODES = ["auto", "low", "medium", "high"] as const;
type GfxMode = (typeof GFX_MODES)[number];
function gfxPref(): GfxMode {
  const v = pref("hexdrift.gfx", "auto");
  return (GFX_MODES as readonly string[]).includes(v) ? (v as GfxMode) : "auto";
}

/** Graphics level: Auto (fits the device, steps down if frames get slow) or a fixed one. */
function GraphicsPicker({ game }: { game: Game | null }) {
  const [mode, setMode] = useState<GfxMode>(gfxPref);
  const label = (m: GfxMode) => m === "auto" ? `Auto${mode === "auto" && game ? ` (${game.graphics})` : ""}` : m[0].toUpperCase() + m.slice(1);
  return (
    <div className="hx-gfx" role="radiogroup" aria-label="Graphics">
      <span className="hx-dim hx-small">Graphics</span>
      <div className="hx-seg">
        {GFX_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""}
            onClick={() => { setMode(m); setPref("hexdrift.gfx", m); game?.setGraphics(m); }}>{label(m)}</button>
        ))}
      </div>
    </div>
  );
}

/** Titles over the race-start cutscene. */
function Intro({ map, stage, best }: { map: MapDef; stage: IntroStage; best: Best | null }) {
  const b = BIOMES[map.biome];
  const idx = MAPS.findIndex((m) => m.id === map.id);
  return (
    <div className={`hx-intro hx-intro-${stage}`} style={{ ["--hx-a" as string]: b.accent }} aria-live="polite">
      <div className="hx-bars" aria-hidden="true"><i /><i /></div>
      {stage === "fly" && (
        <div className="hx-intro-title">
          <p className="hx-kicker">{String(idx + 1).padStart(2, "0")} · {b.name} · {map.difficulty}</p>
          <h2>{map.name}</h2>
        </div>
      )}
      {stage === "car" && (
        <div className="hx-intro-targets">
          {best ? <span><MedalIcon m={medalFor(map, best.t)} size={16} />Your best {formatTime(best.t)}</span> : <span>First run</span>}
          <span><MedalIcon m="gold" size={16} />Gold {formatTime(map.medals.gold)}</span>
        </div>
      )}
      <p className="hx-intro-skip">Tap or press any key to skip</p>
    </div>
  );
}

function OnlineLine({ map, online, signedIn }: { map: MapDef; online: Result["online"]; signedIn: boolean }) {
  if (!online) return null;
  if (online === "sending") return <p className="hx-online hx-dim">Sending to the online records…</p>;
  if (online === "waiting") {
    return <p className="hx-online hx-dim">{signedIn || !CHAT_ON ? "Saved on this device. It'll be sent to the online records next time you're online." : "Saved on this device."}</p>;
  }
  return (
    <p className={`hx-online ${online.worldRecord ? "hx-online-wr" : ""}`}>
      {online.worldRecord ? <><IconCrown size={18} /> World record!</> : `Online rank #${online.rank} of ${online.players}`}{" "}
      <a href={`#/hexdrift/${map.id}/records`}>Leaderboard</a>
    </p>
  );
}

function Finish({ map, result, next, onRestart, signedIn }: { map: MapDef; result: Result; next: MapDef; onRestart: () => void; signedIn: boolean }) {
  const medal = medalFor(map, result.ticks);
  // The results slide in after the celebration; a chime if there's a medal.
  useEffect(() => {
    const t = setTimeout(() => play(medal || result.isBest ? "medal" : "whoosh"), 2500);
    return () => clearTimeout(t);
  }, [medal, result.isBest]);
  const order: Exclude<Medal, null>[] = ["vortex", "gold", "silver", "bronze"];
  return (
    <div className="hx-over hx-over-late"><div className="hx-panel hx-finish">
      <p className="hx-dim">{map.name}</p>
      <h2 className="hx-final">{formatTime(result.ticks)}</h2>
      {result.isBest
        ? <p className="hx-pb">{result.best ? `New best! −${formatTime(result.best.t - result.ticks)}` : "First finish!"}</p>
        : <p className="hx-dim">Best {formatTime(result.best!.t)} (+{formatTime(result.ticks - result.best!.t)})</p>}
      <OnlineLine map={map} online={result.online} signedIn={signedIn} />
      <p className="hx-got">{medal ? <><MedalIcon m={medal} size={28} />{MEDAL_NAME[medal]} medal</> : "No medal yet"}</p>
      <ul className="hx-medals">
        {order.map((m) => (
          <li key={m} className={result.ticks <= map.medals[m] ? "got" : ""}><MedalIcon m={m} size={14} />{MEDAL_NAME[m]}<span>{formatTime(map.medals[m])}</span></li>
        ))}
      </ul>
      <div className="hx-row">
        <button type="button" className="hx-btn hx-btn-main" onClick={onRestart} autoFocus>Restart</button>
        <a className="hx-btn" href={`#/hexdrift/${next.id}`}>Next map</a>
        <a className="hx-btn" href="#/hexdrift/maps">Maps</a>
      </div>
    </div></div>
  );
}

const ARROW = "M12 3 22 19H2z";
/** A triangle pointing up, turned to point the given way. */
const Arrow = ({ deg }: { deg: number }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${deg}deg)` }}><path d={ARROW} strokeLinejoin="round" /></svg>
);

/** On-screen buttons for phones and tablets (several can be held at once). */
function TouchPad({ controls }: { controls: React.RefObject<Controls | null> }) {
  const bind = (a: Action) => {
    const set = (e: React.PointerEvent | null, on: boolean) => {
      controls.current?.setTouch(a, on);
      if (e) (e.currentTarget as HTMLElement).classList.toggle("down", on);
      if (on && navigator.vibrate) try { navigator.vibrate(8); } catch { /* */ }
    };
    return {
      onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); set(e, true); },
      onPointerUp: (e: React.PointerEvent) => set(e, false),
      onPointerCancel: (e: React.PointerEvent) => set(e, false),
      onLostPointerCapture: (e: React.PointerEvent) => set(e, false),
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  };
  return (
    <div className="hx-touch">
      <div className="hx-touch-l">
        <button type="button" className="hx-t-steer" aria-label="Steer left" {...bind("left")}><Arrow deg={-90} /></button>
        <button type="button" className="hx-t-steer" aria-label="Steer right" {...bind("right")}><Arrow deg={90} /></button>
      </div>
      <div className="hx-touch-r">
        <button type="button" className="hx-t-small" aria-label="Back to checkpoint" {...bind("respawn")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 1-7.4 5h2.3A6 6 0 1 0 12 6v3L7 5l5-4z" /></svg>
        </button>
        <button type="button" className="hx-t-drift" aria-label="Drift" {...bind("drift")}>DRIFT</button>
        <div className="hx-t-col">
          <button type="button" className="hx-t-gas" aria-label="Gas" {...bind("gas")}><Arrow deg={0} /></button>
          <button type="button" className="hx-t-brake" aria-label="Brake" {...bind("brake")}><Arrow deg={180} /></button>
        </div>
      </div>
    </div>
  );
}

function Avatar({ p, email, size = 32 }: { p: Profile | undefined; email: string; size?: number }) {
  const name = displayName(p, email);
  return p?.avatar
    ? <img className="hx-av" src={p.avatar} alt="" width={size} height={size} loading="lazy" />
    : <span className="hx-av" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

function NeedOnlineText() {
  const online = useOnline();
  return <>{!CHAT_ON ? "Online records aren't set up on this site yet."
    : !online ? "You're offline. Leaderboards need the internet; your own times are still saved on this device."
    : "Sign in to Vortex Chat to see the online records."}</>;
}
function NeedOnline() { return <p className="hx-dim"><NeedOnlineText /></p>; }

/** A map's leaderboard: the world record, your rank, and the top 50. */
function Records({ map }: { map: MapDef }) {
  const { sb, me, profiles } = useOnlineRecords();
  const [data, setData] = useState<{ top: Entry[]; players: number; myRank: number | null } | null>(null);
  const [error, setError] = useState("");
  const mine = bestTimeNow(map.id);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void (async () => {
      const b = await board(sb, map.id);
      const inTop = b.top.findIndex((e) => e.email === me);
      const own = await playerRecords(sb, me).then((r) => r.find((e) => e.map === map.id)).catch(() => undefined);
      const myRank = inTop >= 0 ? inTop + 1 : own ? await rankFor(sb, map.id, own.ticks) : null;
      if (alive) setData({ ...b, myRank });
    })().catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Couldn't load the leaderboard"); });
    return () => { alive = false; };
  }, [sb, map.id, me]);
  const wr = data?.top[0];
  return (
    <div className="hx-menu hx-page">
      <header className="hx-menu-bar">
        <a className="hx-back" href={`#/hexdrift/map/${map.id}`}><IconBack size={18} />{map.name}</a>
        <a className="hx-btn hx-btn-main" href={`#/hexdrift/${map.id}`} data-sound="confirm">Race</a>
      </header>
      <h1 className="hx-page-title">{map.name} <span className="hx-dim">leaderboard</span></h1>
      {!sb ? <NeedOnline /> : error ? <p className="hx-dim">{error}</p> : !data ? <p className="hx-dim">Loading…</p> : (
        <>
          <div className="hx-cards">
            <div className="hx-card hx-card-wr">
              <span className="hx-dim"><IconCrown size={14} /> World record</span>
              <strong>{wr ? formatTime(wr.ticks) : "—"}</strong>
              <span>{wr ? <a href={`#/hexdrift/player/${encodeURIComponent(wr.email)}`}>{wr.email === me ? "You" : nameOf(profiles, wr.email)}</a> : "Nobody yet: be first"}</span>
            </div>
            <div className="hx-card">
              <span className="hx-dim">Your best</span>
              <strong>{mine ? formatTime(mine.t) : "—"}</strong>
              <span>{data.myRank ? `#${data.myRank} of ${data.players}` : mine ? "Not sent yet" : "No time yet"}</span>
            </div>
            <div className="hx-card">
              <span className="hx-dim">Players</span>
              <strong>{data.players}</strong>
              <span>with a time</span>
            </div>
          </div>
          {data.top.length > 0 && (
            <ol className="hx-board">
              {data.top.map((e, i) => (
                <li key={e.email} className={e.email === me ? "me" : ""}>
                  <span className="hx-board-rank">{i === 0 ? <IconCrown size={18} /> : i + 1}</span>
                  <a className="hx-board-who" href={`#/hexdrift/player/${encodeURIComponent(e.email)}`}>
                    <Avatar p={profiles.get(e.email)} email={e.email} size={28} />{nameOf(profiles, e.email)}{e.email === me && <em> (you)</em>}
                  </a>
                  <MedalIcon m={medalFor(map, e.ticks)} size={14} />
                  <span className="hx-board-time">{formatTime(e.ticks)}</span>
                  <span className="hx-board-gap hx-dim">{i > 0 ? `+${formatTime(e.ticks - data.top[0].ticks)}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** A player's page: their record and rank on every map. */
function Player({ email }: { email: string }) {
  const { sb, me, profiles } = useOnlineRecords();
  const [rows, setRows] = useState<{ e: Entry; rank: number; wr: boolean }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void (async () => {
      const recs = await playerRecords(sb, email);
      const ranked = await Promise.all(recs.map(async (e) => {
        const rank = await rankFor(sb, e.map, e.ticks);
        return { e, rank, wr: rank === 1 };
      }));
      if (alive) setRows(ranked);
    })().catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Couldn't load the records"); });
    return () => { alive = false; };
  }, [sb, email]);
  const p = profiles.get(email);
  const wrs = rows?.filter((r) => r.wr).length ?? 0;
  return (
    <div className="hx-menu hx-page">
      <header className="hx-menu-bar">
        <a className="hx-back" href="#/hexdrift"><IconBack size={18} />Home</a>
      </header>
      <div className="hx-player">
        <Avatar p={p} email={email} size={64} />
        <div>
          <h1 className="hx-page-title">{nameOf(profiles, email)}{email === me && <span className="hx-dim"> (you)</span>}</h1>
          {rows && <p className="hx-dim">{rows.length} of {MAPS.length} maps · {wrs} world record{wrs === 1 ? "" : "s"}</p>}
        </div>
      </div>
      {!sb ? <NeedOnline /> : error ? <p className="hx-dim">{error}</p> : !rows ? <p className="hx-dim">Loading…</p> : (
        <ol className="hx-board">
          {MAPS.map((m) => {
            const r = rows.find((x) => x.e.map === m.id);
            return (
              <li key={m.id}>
                <span className="hx-board-rank">{r ? (r.wr ? <IconCrown size={18} /> : `#${r.rank}`) : "—"}</span>
                <a className="hx-board-who" href={`#/hexdrift/map/${m.id}`}>{m.name}</a>
                <MedalIcon m={r ? medalFor(m, r.e.ticks) : null} size={14} />
                <span className="hx-board-time">{r ? formatTime(r.e.ticks) : <span className="hx-dim">No time</span>}</span>
                <span />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Pick your car and parts. Locked parts can be previewed but not used yet. */
function Garage() {
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [look, setLook] = useState<Look>(() => readLook());
  const [trying, setTrying] = useState<Look | null>(null);
  const [tab, setTab] = useState<Slot>("body");
  const [error, setError] = useState("");
  const { rev } = useOnlineRecords();

  useEffect(() => {
    let alive = true;
    void allTimes().then((m) => {
      if (!alive) return;
      const p = medalPoints(m);
      setPoints(p);
      setLook(readLook(p));
    });
    return () => { alive = false; };
  }, [rev]);

  useEffect(() => {
    try { preview.current = new Preview(host.current!); } catch { setError("This device can't show 3D graphics."); }
    return () => { preview.current?.dispose(); preview.current = null; };
  }, []);

  const shown = trying ?? look;
  useEffect(() => { preview.current?.setLook(shown); }, [shown]);

  const slot = SLOTS.find((s) => s.slot === tab)!;
  const have = points ?? 0;
  const pick = (it: Item | BodyDef) => {
    const next = { ...look, [tab]: it.id };
    if (tab === "trail") preview.current?.boost();
    if (tab === "finish") preview.current?.celebrate(it.id);
    if (it.need > have) { setTrying(next); return; }
    setTrying(null);
    setLook(next);
    saveLook(next);
  };
  const locked = trying ? SLOTS.find((s) => trying[s.slot] !== look[s.slot]) : null;
  const lockedItem = locked ? locked.items.find((i) => i.id === trying![locked.slot]) : null;

  return (
    <div className="hx-menu hx-page hx-garage">
      <header className="hx-menu-bar">
        <a className="hx-back" href="#/hexdrift"><IconBack size={18} />Home</a>
        <span className="hx-points" title="Your best medal on each map: bronze 1, silver 2, gold 3, Vortex 4">
          <MedalIcon m="gold" size={14} /> {points ?? "…"} / {MAX_POINTS} medal points
        </span>
      </header>
      <h1 className="hx-page-title">Garage</h1>
      <div className="hx-preview" ref={host}>
        {error && <p className="hx-dim">{error}</p>}
        <p className="hx-preview-hint hx-dim">Drag to spin</p>
        {lockedItem && (
          <div className="hx-preview-lock" role="status">
            <IconLock size={16} /> {lockedItem.name}: unlocks at {lockedItem.need} medal points (you have {have}).
            <button type="button" className="hx-btn" onClick={() => setTrying(null)}>Back to my car</button>
          </div>
        )}
      </div>
      <p className="hx-dim hx-small">Looks only: every car drives exactly the same, so records stay fair.</p>
      <div className="hx-tabs" role="tablist">
        {SLOTS.map((s) => (
          <button key={s.slot} type="button" role="tab" aria-selected={tab === s.slot} className={tab === s.slot ? "on" : ""}
            onClick={() => { setTab(s.slot); setTrying(null); }}>{s.label}</button>
        ))}
      </div>
      <ul className="hx-parts" role="tabpanel" aria-label={slot.label}>
        {slot.items.map((it) => {
          const lock = it.need > have;
          const on = look[tab] === it.id;
          // Cars show their factory paint; "Factory" paint and accent show the current car's.
          const car = itemOf("body", shown.body) as BodyDef;
          const color = tab === "body" ? (it as BodyDef).paint
            : it.id === "factory" && tab === "paint" ? car.paint
              : it.id === "factory" && tab === "accent" ? car.accent : (it as Item).color;
          return (
            <li key={it.id}>
              <button type="button" data-sound={lock ? "locked" : "click"} className={`hx-part ${on ? "on" : ""} ${lock ? "locked" : ""} ${trying?.[tab] === it.id ? "trying" : ""}`}
                aria-pressed={on} onClick={() => pick(it)}>
                {color ? <span className="hx-swatch" style={{ background: color }} /> : it.id === "rainbow" ? <span className="hx-swatch hx-rainbow" /> : null}
                <span className="hx-part-name">{it.name}</span>
                {tab === "body" && <span className="hx-part-blurb">{(it as BodyDef).blurb}</span>}
                <span className="hx-part-tag">{on ? "Equipped" : lock ? <><IconLock size={12} /> {it.need} pts</> : it.need === 0 ? "Free" : "Unlocked"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
