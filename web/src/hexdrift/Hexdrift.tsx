// Hexdrift: a fast time-trial racer built into Vortex. This file is the menu,
// the HUD, the finish screen and Gaming Mode; the game itself is in game.ts.
// Loaded only when someone opens it, so it adds nothing to the rest of the site.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAPS, BIOMES, medalFor, type MapDef, type Medal } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { Controls, type Action } from "./input.ts";
import { Game } from "./game.ts";
import { allBests, bestNow, clearBest, clearLive, offerBest, readLive, saveLive, type Run } from "./records.ts";
import { canFullscreen, disableGaming, enableGaming, enterFullscreen, isFullscreen, isGaming, isStandalone, onGaming } from "./gaming.ts";
import "./hexdrift.css";

const MEDAL_NAME: Record<Exclude<Medal, null>, string> = { vortex: "Vortex", gold: "Gold", silver: "Silver", bronze: "Bronze" };

function MedalIcon({ m, size = 18 }: { m: Medal; size?: number }) {
  if (!m) return null;
  return <span className={`hx-medal hx-medal-${m}`} style={{ width: size, height: size }} aria-label={`${MEDAL_NAME[m]} medal`} />;
}

function readMap(): MapDef | null {
  const id = location.hash.replace(/^#\/?/, "").split("/")[1];
  return MAPS.find((m) => m.id === id) ?? null;
}

// A run that was in progress when the page was reloaded (read once per page load).
let bootLive = readLive();

function pref(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function setPref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* */ } }

export function Hexdrift() {
  const [map, setMap] = useState<MapDef | null>(readMap);
  useEffect(() => {
    const on = () => setMap(readMap());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <div className="hx" role="application" aria-label="Hexdrift">
      {map ? <Play key={map.id} map={map} /> : <Menu />}
    </div>
  );
}

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

function Menu() {
  const [bests, setBests] = useState<Map<string, Run> | null>(null);
  const gaming = useGaming();
  const online = useOnline();
  useEffect(() => {
    // Back at the menu: the unfinished run is over.
    clearLive();
    bootLive = null;
    let alive = true;
    void allBests().then((m) => { if (alive) setBests(new Map(m)); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="hx-menu">
      <header className="hx-menu-head">
        <div className="hx-menu-bar">
          {gaming ? <span className="hx-back hx-dim">Gaming Mode is on</span> : <a className="hx-back" href="#/games" aria-label="Back to Vortex">‹ Vortex</a>}
          <GamingButton />
        </div>
        <h1 className="hx-logo">HEX<span>DRIFT</span></h1>
        <p className="hx-sub">Time trial · beat the medals · race your ghost</p>
        {!online && <p className="hx-offline">You're offline. Everything still works, and your records are saved on this device.</p>}
      </header>
      <ul className="hx-maps">
        {MAPS.map((m) => {
          const best = bests?.get(m.id) ?? null;
          const medal = best ? medalFor(m, best.t) : null;
          const b = BIOMES[m.biome];
          return (
            <li key={m.id}>
              <a className="hx-map" href={`#/hexdrift/${m.id}`} style={{ ["--hx-a" as string]: b.accent, ["--hx-sky" as string]: b.sky, ["--hx-g" as string]: b.ground }}>
                <span className="hx-map-art" aria-hidden="true"><span /></span>
                <span className="hx-map-text">
                  <strong>{m.name}</strong>
                  <span className="hx-map-tags"><em>{b.name}</em><em>{m.difficulty}</em></span>
                  <span className="hx-map-best">
                    {best ? <><MedalIcon m={medal} />{formatTime(best.t)}</> : <span className="hx-dim">{bests ? "No time yet" : "…"}</span>}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="hx-help">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows drive</span>
        <span><kbd>Space</kbd> drift</span>
        <span><kbd>Enter</kbd> back to checkpoint</span>
        <span><kbd>R</kbd> restart</span>
        <span><kbd>C</kbd> camera</span>
        <span><kbd>G</kbd> ghost on/off</span>
        <span>Gamepads and touch work too</span>
      </p>
    </div>
  );
}

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
    timer.current = window.setTimeout(() => { setHolding(false); disableGaming(); }, 3000);
  };
  const cancel = () => { clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!on) {
    return (
      <button type="button" className={`hx-gaming ${compact ? "hx-icon" : ""}`} title="Gaming Mode: full screen, and Back or reload can't end your run"
        aria-label="Turn on Gaming Mode"
        onClick={enableGaming}>
        {compact ? "⛶" : <>⛶ Gaming Mode</>}
      </button>
    );
  }
  return (
    <>
      {canFullscreen() && !fs && (
        <button type="button" className={`hx-gaming ${compact ? "hx-icon" : ""}`} aria-label="Back to full screen" title="Back to full screen" onClick={() => void enterFullscreen()}>
          {compact ? "⤢" : "⤢ Full screen"}
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

interface Result { ticks: number; best: Run | null; isBest: boolean }
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
  const [best, setBest] = useState<Run | null>(() => bestNow(map.id));
  const [ghost, setGhost] = useState(() => pref("hexdrift.ghost", "1") === "1");
  const [hasGhost, setHasGhost] = useState(false);
  const [error, setError] = useState("");
  const gaming = useGaming();

  const loadGhost = useCallback((run: Run | null) => {
    const ok = game.current?.setGhost(run ? run.inputs : null, run?.t ?? 0) ?? false;
    setHasGhost(ok);
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
  const toggleGhost = useCallback(() => {
    const on = game.current?.toggleGhost() ?? true;
    setGhost(on);
    setPref("hexdrift.ghost", on ? "1" : "0");
  }, []);

  useEffect(() => {
    const c = new Controls((cmd) => {
      if (cmd === "restart") restart();
      else if (cmd === "camera") setPref("hexdrift.cam", String(game.current?.cycleCamera() ?? 0));
      else if (cmd === "ghost") toggleGhost();
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
          const prev = bestNow(map.id);
          const isBest = !prev || ticks < prev.t;
          setOver({ ticks, best: prev, isBest });
          void offerBest(map.id, ticks, inputs).then((saved) => {
            if (!saved) return;
            const now = bestNow(map.id);
            setBest(now);
            loadGhost(now); // race your new best next time
          });
        },
        onHidden() { pause(true); },
      }, c, (Number(pref("hexdrift.cam", "0")) || 0) % 3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This device can't show 3D graphics.");
      return () => c.dispose();
    }
    game.current = g;
    if (pref("hexdrift.ghost", "1") !== "1") g.toggleGhost();
    void allBests().then(() => {
      if (game.current !== g) return;
      const b = bestNow(map.id);
      setBest(b);
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
  }, [map, pause, restart, toggleGhost, loadGhost]);

  const idx = MAPS.findIndex((m) => m.id === map.id);
  const next = MAPS[(idx + 1) % MAPS.length];

  if (error) {
    return (
      <div className="hx-over"><div className="hx-panel">
        <h2>Can't start Hexdrift</h2><p>{error}</p><a className="hx-btn" href="#/hexdrift">Back to maps</a>
      </div></div>
    );
  }

  return (
    <div className="hx-play" ref={host}>
      <div className="hx-hud" aria-live="off">
        <div className="hx-hud-top">
          <span className="hx-chip"><span className="hx-dim">CP</span> <span ref={cps}>0/0</span></span>
          <span className="hx-time" ref={time}>0:00.000</span>
          <span className="hx-hud-btns">
            <button type="button" className="hx-icon" aria-label="Restart (R)" title="Restart (R)" onClick={restart}>↺</button>
            <button type="button" className="hx-icon" aria-label="Camera (C)" title="Camera (C)" onClick={() => setPref("hexdrift.cam", String(game.current?.cycleCamera() ?? 0))}>◉</button>
            {hasGhost && (
              <button type="button" className={`hx-icon ${ghost ? "" : "off"}`} aria-pressed={ghost} aria-label="Ghost (G)" title="Ghost of your best run (G)" onClick={toggleGhost}>👻</button>
            )}
            <GamingButton compact />
            <button type="button" className="hx-icon" aria-label="Pause (Esc)" title="Pause (Esc)" onClick={() => pause(true)}>II</button>
          </span>
        </div>
        <div className="hx-targets">
          {best && <span><MedalIcon m={medalFor(map, best.t)} size={12} />Best {formatTime(best.t)}</span>}
          <span><MedalIcon m="gold" size={12} />{formatTime(map.medals.gold)}</span>
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
            <a className="hx-btn" href="#/hexdrift">Maps</a>
          </div>
          {gaming && <p className="hx-dim hx-small">Gaming Mode is on: hold its button for 3 seconds to turn it off.</p>}
        </div></div>
      )}
      {over && typeof over === "object" && <Finish map={map} result={over} next={next} onRestart={restart} />}
    </div>
  );
}

function Finish({ map, result, next, onRestart }: { map: MapDef; result: Result; next: MapDef; onRestart: () => void }) {
  const medal = medalFor(map, result.ticks);
  const order: Exclude<Medal, null>[] = ["vortex", "gold", "silver", "bronze"];
  return (
    <div className="hx-over"><div className="hx-panel hx-finish">
      <p className="hx-dim">{map.name}</p>
      <h2 className="hx-final">{formatTime(result.ticks)}</h2>
      {result.isBest
        ? <p className="hx-pb">{result.best ? `New best! −${formatTime(result.best.t - result.ticks)}` : "First finish!"}</p>
        : <p className="hx-dim">Best {formatTime(result.best!.t)} (+{formatTime(result.ticks - result.best!.t)})</p>}
      <p className="hx-got">{medal ? <><MedalIcon m={medal} size={28} />{MEDAL_NAME[medal]} medal</> : "No medal yet"}</p>
      <ul className="hx-medals">
        {order.map((m) => (
          <li key={m} className={result.ticks <= map.medals[m] ? "got" : ""}><MedalIcon m={m} size={14} />{MEDAL_NAME[m]}<span>{formatTime(map.medals[m])}</span></li>
        ))}
      </ul>
      <div className="hx-row">
        <button type="button" className="hx-btn hx-btn-main" onClick={onRestart} autoFocus>Restart</button>
        <a className="hx-btn" href={`#/hexdrift/${next.id}`}>Next map</a>
        <a className="hx-btn" href="#/hexdrift">Maps</a>
      </div>
    </div></div>
  );
}

/** On-screen buttons for phones and tablets (several can be held at once). */
function TouchPad({ controls }: { controls: React.RefObject<Controls | null> }) {
  const bind = (a: Action) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); controls.current?.setTouch(a, true); },
    onPointerUp: () => controls.current?.setTouch(a, false),
    onPointerCancel: () => controls.current?.setTouch(a, false),
    onLostPointerCapture: () => controls.current?.setTouch(a, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <div className="hx-touch">
      <div className="hx-touch-l">
        <button type="button" aria-label="Steer left" {...bind("left")}>◀</button>
        <button type="button" aria-label="Steer right" {...bind("right")}>▶</button>
      </div>
      <div className="hx-touch-r">
        <button type="button" className="hx-t-small" aria-label="Back to checkpoint" {...bind("respawn")}>⟲</button>
        <button type="button" className="hx-t-drift" aria-label="Drift" {...bind("drift")}>DRIFT</button>
        <button type="button" className="hx-t-brake" aria-label="Brake" {...bind("brake")}>▼</button>
        <button type="button" className="hx-t-gas" aria-label="Gas" {...bind("gas")}>▲</button>
      </div>
    </div>
  );
}
