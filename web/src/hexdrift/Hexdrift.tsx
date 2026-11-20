// Hexdrift: a fast time-trial racer built into Vortex. This file is the menu,
// the HUD and the finish screen; the game itself is in game.ts. Loaded only
// when someone opens it, so it adds nothing to the rest of the site.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAPS, BIOMES, medalFor, type MapDef, type Medal } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { Controls, type Action } from "./input.ts";
import { Game } from "./game.ts";
import "./hexdrift.css";

// ── Saved best times (on this device) ───────────────────────────────────────
interface Best { t: number; i: string; at: number }

function loadBest(id: string): Best | null {
  try {
    const v = JSON.parse(localStorage.getItem(`hexdrift.best.${id}`) ?? "null");
    return v && typeof v.t === "number" ? v : null;
  } catch { return null; }
}

function saveBest(id: string, ticks: number, inputs: number[]) {
  try {
    // The input bytes are the whole drive: kept for ghosts and record checks.
    let bin = "";
    for (const b of inputs) bin += String.fromCharCode(b);
    localStorage.setItem(`hexdrift.best.${id}`, JSON.stringify({ t: ticks, i: btoa(bin), at: Date.now() }));
  } catch { /* storage full or blocked: still playable */ }
}

const MEDAL_NAME: Record<Exclude<Medal, null>, string> = { vortex: "Vortex", gold: "Gold", silver: "Silver", bronze: "Bronze" };

function MedalIcon({ m, size = 18 }: { m: Medal; size?: number }) {
  if (!m) return null;
  return <span className={`hx-medal hx-medal-${m}`} style={{ width: size, height: size }} aria-label={`${MEDAL_NAME[m]} medal`} />;
}

function readMap(): MapDef | null {
  const id = location.hash.replace(/^#\/?/, "").split("/")[1];
  return MAPS.find((m) => m.id === id) ?? null;
}

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

function Menu() {
  return (
    <div className="hx-menu">
      <header className="hx-menu-head">
        <a className="hx-back" href="#/games" aria-label="Back to Vortex">‹ Vortex</a>
        <h1 className="hx-logo">HEX<span>DRIFT</span></h1>
        <p className="hx-sub">Time trial · beat the medals</p>
      </header>
      <ul className="hx-maps">
        {MAPS.map((m) => {
          const best = loadBest(m.id);
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
                    {best ? <><MedalIcon m={medal} />{formatTime(best.t)}</> : <span className="hx-dim">No time yet</span>}
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
        <span>Gamepads and touch work too</span>
      </p>
    </div>
  );
}

type Over = null | "pause" | { ticks: number; best: Best | null; isBest: boolean };

function Play({ map }: { map: MapDef }) {
  const host = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const cps = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const controls = useRef<Controls | null>(null);
  const [over, setOver] = useState<Over>(null);
  const overRef = useRef<Over>(null);
  overRef.current = over;
  const [touch, setTouch] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  const [best, setBest] = useState(() => loadBest(map.id));
  const [error, setError] = useState("");

  const restart = useCallback(() => { setOver(null); game.current?.restart(); }, []);
  const pause = useCallback((p: boolean) => {
    const g = game.current;
    if (!g || g.race.phase === "finished") return;
    g.setPaused(p);
    setOver(p ? "pause" : null);
  }, []);

  useEffect(() => {
    const c = new Controls((cmd) => {
      if (cmd === "restart") restart();
      else if (cmd === "camera") { const n = game.current?.cycleCamera(); try { localStorage.setItem("hexdrift.cam", String(n)); } catch { /* */ } }
      else if (cmd === "pause") {
        if (overRef.current === "pause") pause(false);
        else if (overRef.current === null) pause(true);
      }
    });
    controls.current = c;
    let g: Game;
    try {
      let cam = 0;
      try { cam = Number(localStorage.getItem("hexdrift.cam")) || 0; } catch { /* */ }
      g = new Game(host.current!, map, { time: time.current, speed: speed.current, cps: cps.current, count: count.current }, {
        onFinish(ticks, inputs) {
          const prev = loadBest(map.id);
          const isBest = !prev || ticks < prev.t;
          if (isBest) saveBest(map.id, ticks, inputs);
          const now = loadBest(map.id);
          setBest(now);
          setOver({ ticks, best: prev, isBest });
        },
        onHidden() { pause(true); },
      }, c, cam % 3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This device can't show 3D graphics.");
      return () => c.dispose();
    }
    game.current = g;
    g.start();
    if (import.meta.env.DEV) (window as unknown as { __hexdrift?: Game }).__hexdrift = g;
    const onTouch = () => setTouch(true);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouch);
      g.dispose();
      c.dispose();
      game.current = null;
    };
  }, [map, pause, restart]);

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
            <button type="button" className="hx-icon" aria-label="Camera (C)" title="Camera (C)" onClick={() => game.current?.cycleCamera()}>◉</button>
            <button type="button" className="hx-icon" aria-label="Pause (Esc)" title="Pause (Esc)" onClick={() => pause(true)}>II</button>
          </span>
        </div>
        <div className="hx-targets">
          {best && <span><MedalIcon m={medalFor(map, best.t)} size={12} />Best {formatTime(best.t)}</span>}
          <span><MedalIcon m="gold" size={12} />{formatTime(map.medals.gold)}</span>
        </div>
        <div className="hx-count" ref={count} />
        <div className="hx-speed"><span ref={speed}>0</span><em>km/h</em></div>
      </div>

      {touch && <TouchPad controls={controls} />}

      {over === "pause" && (
        <div className="hx-over"><div className="hx-panel">
          <h2>Paused</h2>
          <p className="hx-dim">{map.name}</p>
          <div className="hx-row">
            <button type="button" className="hx-btn hx-btn-main" onClick={() => pause(false)} autoFocus>Resume</button>
            <button type="button" className="hx-btn" onClick={restart}>Restart</button>
            <a className="hx-btn" href="#/hexdrift">Maps</a>
          </div>
        </div></div>
      )}
      {over && over !== "pause" && <Finish map={map} result={over} next={next} onRestart={restart} />}
    </div>
  );
}

function Finish({ map, result, next, onRestart }: { map: MapDef; result: { ticks: number; best: Best | null; isBest: boolean }; next: MapDef; onRestart: () => void }) {
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
