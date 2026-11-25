// The map editor: build a road from pieces, see it from above, drive it.
// Made for phones first (thumb-sized chips, one piece at a time); the studio
// layout on computers adds keyboard keys and more room.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkMap, decodeMap, encodeMap, LIMITS, medalsOf, newMap, pieceAt, pieceLen, THEMES, type CustomMap, type Piece, type ThemeId } from "./sim/custom.ts";
import { GAP, type Surf } from "./sim/road.ts";
import { BIOMES } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { authorOf, deleteMap, myBest, myMap, myMaps, saveMap } from "./mymaps.ts";
import { IconBack } from "./ui/icons.tsx";
import type { BotReply } from "./botworker.ts";

const THEME_IDS = Object.keys(THEMES) as ThemeId[];

// ── My maps ─────────────────────────────────────────────────────────────────
export function MyMaps() {
  const [maps, setMaps] = useState(myMaps);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const create = (theme: ThemeId) => {
    const m = newMap(theme);
    m.name = `${THEMES[theme].name} ${maps.length + 1}`;
    if (!saveMap(m)) { setMsg("This device's storage is full."); return; }
    location.hash = `#/hexdrift/editor/${m.id}`;
  };
  const importCode = () => {
    const m = decodeMap(code);
    if (!m) { setMsg("That isn't a map code."); return; }
    saveMap(m);
    setMaps(myMaps());
    setCode("");
    setMsg(`Added “${m.name}”.`);
  };
  return (
    <div className="hx-menu">
      <header className="hx-menu-head">
        <a className="hx-back" href="#/hexdrift"><IconBack /> Back</a>
        <h1 className="hx-title">My maps</h1>
        <p className="hx-sub">Build a road piece by piece, drive it, and set the author time that decides its medals.</p>
      </header>
      <section className="hx-ed-new">
        <h2>New map</h2>
        <div className="hx-ed-themes">
          {THEME_IDS.map((t) => {
            const b = BIOMES[THEMES[t].biome];
            return (
              <button key={t} type="button" className="hx-ed-theme" style={{ "--hx-sky": b.sky, "--hx-g": b.ground, "--hx-a": b.accent } as React.CSSProperties} onClick={() => create(t)}>
                <span />{THEMES[t].name}
              </button>
            );
          })}
        </div>
      </section>
      {maps.length > 0 && (
        <ul className="hx-ed-list">
          {maps.map((m) => {
            const a = authorOf(m);
            const b = myBest(m);
            return (
              <li key={m.id}>
                <a href={`#/hexdrift/editor/${m.id}`}>
                  <strong>{m.name}</strong>
                  <span className="hx-dim">{THEMES[m.theme].name} · {(m.pieces.reduce((s, p) => s + pieceLen(p), 0) / 1000).toFixed(2)} km</span>
                  <span className="hx-dim">{a ? `Author ${formatTime(a.ticks)}` : "No author time yet"}{b ? ` · Best ${formatTime(b.t)}` : ""}</span>
                </a>
                <a className="hx-btn" href={`#/hexdrift/test/${m.id}`}>Drive</a>
              </li>
            );
          })}
        </ul>
      )}
      <section className="hx-ed-import">
        <label htmlFor="hx-code">Have a map code?</label>
        <div className="hx-row">
          <input id="hx-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="HX1.…" autoComplete="off" spellCheck={false} />
          <button type="button" className="hx-btn" disabled={!code.trim()} onClick={importCode}>Add</button>
        </div>
        {msg && <p className="hx-dim" role="status">{msg}</p>}
      </section>
    </div>
  );
}

// ── Choices for a piece ──────────────────────────────────────────────────────
const LENS = [20, 40, 60, 100, 150, 250, 400];
const ANGLES = [15, 30, 45, 60, 90, 120, 180];
const RADII: [string, number][] = [["Hairpin", 20], ["Tight", 35], ["Medium", 60], ["Wide", 110], ["Sweeper", 220]];
const RISES = [-12, -6, -3, 0, 3, 6, 12];
const WIDTHS: [string, number][] = [["Narrow", 5.5], ["Normal", 9], ["Wide", 12]];
const SURFACES: [string, Surf][] = [["Asphalt", "asphalt"], ["Dirt", "dirt"], ["Sand", "sand"], ["Ice", "ice"], ["Metal", "metal"]];
const WALLS: [string, NonNullable<Piece["walls"]>][] = [["None", ""], ["Both", "B"], ["Left", "L"], ["Right", "R"]];
const BOOSTS: [string, NonNullable<Piece["boost"]> | ""][] = [["None", ""], ["Full", "A"], ["Left", "L"], ["Right", "R"]];
const RAMPS: [string, number][] = [["None", 0], ["Small", 1.5], ["Big", 3]];
const GAPS = [10, 15, 20, 30, 45, 60];
const LANDINGS = [-6, -3, 0, 3];

/** What a piece carries on from the one before (width, surface, walls). */
function carried(m: CustomMap, i: number) {
  let hw = 9, surf: Surf = THEMES[m.theme].surf ?? "asphalt", walls: NonNullable<Piece["walls"]> = "", tunnel = false;
  for (let j = 0; j <= i && j < m.pieces.length; j++) {
    const p = m.pieces[j];
    if (p.k === "C") continue;
    if (p.hw !== undefined) hw = p.hw;
    if (p.surf !== undefined) surf = p.surf;
    if (p.walls !== undefined) walls = p.walls;
    if (p.tunnel !== undefined) tunnel = p.tunnel;
  }
  return { hw, surf, walls, tunnel };
}

const NAMES: Record<Piece["k"], string> = { S: "Straight", L: "Left", R: "Right", C: "Checkpoint", G: "Jump gap" };
function label(p: Piece) {
  if (p.k === "S") return `${p.len} m`;
  if (p.k === "L" || p.k === "R") return `${p.k === "L" ? "←" : "→"} ${p.a}°`;
  if (p.k === "G") return `Gap ${p.len} m`;
  return "CP";
}

// ── The editor ──────────────────────────────────────────────────────────────
export function Editor({ id }: { id: string }) {
  const [map, setMapState] = useState<CustomMap | null>(() => myMap(id));
  const [sel, setSel] = useState(() => Math.max(0, (map?.pieces.length ?? 1) - 1));
  const undo = useRef<CustomMap[]>([]);
  const redo = useRef<CustomMap[]>([]);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"shape" | "road" | "extras">("shape");
  const [wide, setWide] = useState(() => matchMedia("(min-width: 900px) and (pointer: fine)").matches);
  useEffect(() => {
    const q = matchMedia("(min-width: 900px) and (pointer: fine)");
    const f = () => setWide(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);

  const check = useMemo(() => map ? checkMap(map) : null, [map]);
  // The autopilot drives the map in the background: can it be finished?
  const [bot, setBot] = useState("");
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => setBot((b) => (b === "…" ? b : "")), [map]);
  const runBot = useCallback(() => {
    if (!map) return;
    worker.current?.terminate();
    const w = new Worker(new URL("./botworker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setBot("…");
    const m = map;
    w.onmessage = (e: MessageEvent<BotReply>) => {
      const r = e.data;
      w.terminate();
      if (worker.current === w) worker.current = null;
      if (r.ok) setBot(`The autopilot finished in ${formatTime(r.ticks)}. You can beat that.`);
      else if (r.error) setBot(`The autopilot couldn't drive it: ${r.error}`);
      else { const i = pieceAt(m, r.s); setSel(i); setBot(`The autopilot got stuck around piece ${i + 1}. It's careful, so a human may still make it.`); }
    };
    w.postMessage(m);
  }, [map]);

  const commit = useCallback((next: CustomMap, keepSel?: number) => {
    setMapState((cur) => {
      if (cur) { undo.current.push(cur); if (undo.current.length > 100) undo.current.shift(); }
      redo.current = [];
      return next;
    });
    if (!saveMap(next)) setMsg("This device's storage is full: the change isn't saved.");
    if (keepSel !== undefined) setSel(keepSel);
  }, []);
  const back = useCallback((from: React.RefObject<CustomMap[]>, to: React.RefObject<CustomMap[]>) => {
    setMapState((cur) => {
      const prev = from.current.pop();
      if (!prev || !cur) return cur;
      to.current.push(cur);
      saveMap(prev);
      setSel((s) => Math.min(s, prev.pieces.length - 1));
      return prev;
    });
  }, []);

  const edit = useCallback((change: Partial<Piece>, at = sel) => {
    if (!map) return;
    const pieces = map.pieces.map((p, i) => {
      if (i !== at) return p;
      const q: Piece = { ...p, ...change };
      for (const k of Object.keys(change) as (keyof Piece)[]) if (change[k] === undefined) delete q[k];
      return q;
    });
    commit({ ...map, pieces });
  }, [map, sel, commit]);

  const add = useCallback((k: Piece["k"]) => {
    if (!map) return;
    if (map.pieces.length >= LIMITS.pieces) { setMsg(`At most ${LIMITS.pieces} pieces.`); return; }
    const like = [...map.pieces.slice(0, sel + 1)].reverse().find((p) => p.k === k);
    const c = carried(map, sel);
    const base: Piece = k === "S" ? { k, len: like?.len ?? 60 } : k === "L" || k === "R" ? { k, a: like?.a ?? 90, r: like?.r ?? 60 } : k === "G" ? { k, len: like?.len ?? 20 } : { k };
    if (k !== "C") Object.assign(base, { hw: c.hw, surf: c.surf, walls: c.walls });
    const pieces = [...map.pieces];
    const at = map.pieces.length ? sel + 1 : 0;
    // A gap needs a kicker before it to clear it.
    if (k === "G" && at > 0) { const prev = pieces[at - 1]; if (prev.k === "S" && !prev.ramp) pieces[at - 1] = { ...prev, ramp: 1.5 }; }
    pieces.splice(at, 0, base);
    commit({ ...map, pieces }, at);
  }, [map, sel, commit]);

  const remove = useCallback(() => {
    if (!map || !map.pieces.length) return;
    const pieces = map.pieces.filter((_, i) => i !== sel);
    commit({ ...map, pieces }, Math.max(0, Math.min(sel, pieces.length - 1)));
  }, [map, sel, commit]);
  const move = useCallback((d: -1 | 1) => {
    if (!map) return;
    const j = sel + d;
    if (j < 0 || j >= map.pieces.length) return;
    const pieces = [...map.pieces];
    [pieces[sel], pieces[j]] = [pieces[j], pieces[sel]];
    commit({ ...map, pieces }, j);
  }, [map, sel, commit]);
  const dup = useCallback(() => {
    if (!map || !map.pieces[sel]) return;
    const pieces = [...map.pieces];
    pieces.splice(sel + 1, 0, { ...map.pieces[sel] });
    commit({ ...map, pieces }, sel + 1);
  }, [map, sel, commit]);

  // Studio keys: arrows pick, S/L/R/C/G add, Delete removes, Ctrl+Z undoes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const z = e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey);
      if (z) { e.preventDefault(); if (e.shiftKey) back(redo, undo); else back(undo, redo); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); back(redo, undo); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = map?.pieces.length ?? 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); if (e.altKey) move(-1); else setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(n - 1, s + 1)); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      else if (e.key === "d") dup();
      else if ("slrcg".includes(e.key.toLowerCase()) && e.key.length === 1) add(e.key.toUpperCase() as Piece["k"]);
      else if (e.key === "Enter") location.hash = `#/hexdrift/test/${id}`;
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [map, add, remove, move, dup, back, id]);

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(t); }, [msg]);

  if (!map || !check) {
    return <div className="hx-menu"><a className="hx-back" href="#/hexdrift/editor"><IconBack /> My maps</a><p>That map isn't on this device.</p></div>;
  }
  const p = map.pieces[sel];
  const c = carried(map, sel);
  const author = authorOf(map);
  const bad = new Set(check.problems.map((q) => q.piece));
  const broken = !check.road;
  const share = async () => {
    const code = encodeMap(map);
    try { await navigator.clipboard.writeText(code); setMsg("Map code copied. Anyone can add it under My maps."); }
    catch { window.prompt("Copy this map code:", code); }
  };

  return (
    <div className={`hx-ed ${wide ? "hx-ed-wide" : ""}`}>
      <header className="hx-ed-bar">
        <a className="hx-icon" href="#/hexdrift/editor" aria-label="My maps" title="My maps"><IconBack /></a>
        <input className="hx-ed-name" value={map.name} maxLength={LIMITS.nameLen} aria-label="Map name"
          onChange={(e) => { const next = { ...map, name: e.target.value }; setMapState(next); saveMap(next); }} />
        <button type="button" className="hx-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={() => back(undo, redo)}>↶</button>
        <button type="button" className="hx-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!redo.current.length} onClick={() => back(redo, undo)}>↷</button>
        <a className={`hx-btn hx-btn-main ${broken ? "hx-off" : ""}`} href={broken ? undefined : `#/hexdrift/test/${map.id}`} aria-disabled={broken} title="Drive it (Enter)">Drive</a>
      </header>

      <div className="hx-ed-stage">
        <Preview map={map} check={check} sel={sel} onPick={setSel} />
        {wide && <Profile map={map} check={check} sel={sel} onPick={setSel} />}
      </div>

      <div className="hx-ed-side">
      <div className="hx-ed-info">
        <span>{(check.length / 1000).toFixed(2)} km · {map.pieces.filter((q) => q.k === "C").length} CP</span>
        <span>{author ? <>Author {formatTime(author.ticks)} · Gold {formatTime(medalsOf(author.ticks).gold)}</> : "Drive to the finish to set the author time"}</span>
        <button type="button" className="hx-linkbtn" disabled={broken || bot === "…"} onClick={runBot}>{bot === "…" ? "Autopilot driving…" : "Autopilot test"}</button>
      </div>
      {bot && bot !== "…" && <p className="hx-ed-bot" role="status">{bot}</p>}
      {check.problems.length > 0 && (
        <ul className="hx-ed-problems" role="status">
          {check.problems.slice(0, 3).map((q, i) => (
            <li key={i}>{q.piece >= 0 ? <button type="button" onClick={() => setSel(q.piece)}>Piece {q.piece + 1}</button> : null} {q.text}</li>
          ))}
        </ul>
      )}

      <div className="hx-ed-panel">
        <div className="hx-ed-strip" role="listbox" aria-label="Pieces">
          {map.pieces.map((q, i) => (
            <button key={i} type="button" role="option" aria-selected={i === sel} className={`hx-ed-piece k-${q.k} ${i === sel ? "on" : ""} ${bad.has(i) ? "bad" : ""}`}
              onClick={() => setSel(i)} ref={i === sel ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}>
              <small>{i + 1}</small>{label(q)}
            </button>
          ))}
        </div>

        <div className="hx-ed-add">
          <span className="hx-dim">Add</span>
          {(["S", "L", "R", "C", "G"] as const).map((k) => (
            <button key={k} type="button" className="hx-chip-btn" onClick={() => add(k)} title={`${NAMES[k]} (${k})`}>{NAMES[k]}</button>
          ))}
        </div>

        {p && (
          <div className="hx-ed-inspect">
            <div className="hx-ed-head">
              <strong>{sel + 1}. {NAMES[p.k]}</strong>
              <span>
                <button type="button" className="hx-icon" aria-label="Move earlier" disabled={sel === 0} onClick={() => move(-1)}>‹</button>
                <button type="button" className="hx-icon" aria-label="Move later" disabled={sel === map.pieces.length - 1} onClick={() => move(1)}>›</button>
                <button type="button" className="hx-icon" aria-label="Duplicate (D)" title="Duplicate (D)" onClick={dup}>⧉</button>
                <button type="button" className="hx-icon hx-danger" aria-label="Delete piece" title="Delete" onClick={remove}>✕</button>
              </span>
            </div>
            {p.k !== "C" && p.k !== "G" && (
              <div className="hx-tabs" role="tablist">
                {(["shape", "road", "extras"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "shape" ? "Shape" : t === "road" ? "Road" : "Extras"}</button>
                ))}
              </div>
            )}
            {p.k === "C" && <p className="hx-dim">A checkpoint gate. Crash after it and you come back here.</p>}
            {p.k === "G" && <>
              <Chips label="Gap" values={GAPS.map((v) => [`${v} m`, v])} value={p.len} onPick={(v) => edit({ len: v })} />
              <Chips label="Landing" values={LANDINGS.map((v) => [v > 0 ? `+${v} m` : `${v} m`, v])} value={p.rise ?? 0} onPick={(v) => edit({ rise: v || undefined })} />
              <p className="hx-dim">Open air: put a kicker or a boost on the piece before it.</p>
            </>}
            {(p.k === "S" || p.k === "L" || p.k === "R") && tab === "shape" && <>
              {p.k === "S"
                ? <Chips label="Length" values={LENS.map((v) => [`${v}`, v])} value={p.len} onPick={(v) => edit({ len: v })} step={5} min={5} max={800} />
                : <>
                  <Chips label="Turn" values={ANGLES.map((v) => [`${v}°`, v])} value={p.a} onPick={(v) => edit({ a: v })} step={5} min={5} max={270} />
                  <Chips label="Radius" values={RADII} value={p.r} onPick={(v) => edit({ r: v })} step={5} min={15} max={600} />
                  <div className="hx-ed-row"><span className="hx-dim">Way</span>
                    <button type="button" className={`hx-chip-btn ${p.k === "L" ? "on" : ""}`} onClick={() => edit({ k: "L" })}>Left</button>
                    <button type="button" className={`hx-chip-btn ${p.k === "R" ? "on" : ""}`} onClick={() => edit({ k: "R" })}>Right</button>
                  </div>
                </>}
              <Chips label="Climb" values={RISES.map((v) => [v > 0 ? `+${v}` : `${v}`, v])} value={p.rise ?? 0} onPick={(v) => edit({ rise: v || undefined })} step={1} min={-40} max={40} />
            </>}
            {(p.k === "S" || p.k === "L" || p.k === "R") && tab === "road" && <>
              <Chips label="Width" values={WIDTHS} value={p.hw ?? c.hw} onPick={(v) => edit({ hw: v })} />
              <Chips label="Surface" values={SURFACES} value={p.surf ?? c.surf} onPick={(v) => edit({ surf: v })} />
              <Chips label="Walls" values={WALLS} value={p.walls ?? c.walls} onPick={(v) => edit({ walls: v })} />
            </>}
            {(p.k === "S" || p.k === "L" || p.k === "R") && tab === "extras" && <>
              <Chips label="Boost" values={BOOSTS} value={p.boost ?? ""} onPick={(v) => edit({ boost: v || undefined })} />
              <Chips label="Kicker" values={RAMPS} value={p.ramp ?? 0} onPick={(v) => edit({ ramp: v || undefined })} />
              <div className="hx-ed-row"><span className="hx-dim">Tunnel</span>
                <button type="button" className={`hx-chip-btn ${c.tunnel ? "on" : ""}`} onClick={() => edit({ tunnel: !c.tunnel })}>{c.tunnel ? "On" : "Off"}</button>
              </div>
              {wide && <Chips label="Left side" values={THEMES[map.theme].choice.map((s) => [s, s])} value={p.scene?.[0]} onPick={(v) => edit({ scene: [v, p.scene?.[1] ?? v] })} />}
              {wide && <Chips label="Right side" values={THEMES[map.theme].choice.map((s) => [s, s])} value={p.scene?.[1]} onPick={(v) => edit({ scene: [p.scene?.[0] ?? v, v] })} />}
            </>}
          </div>
        )}

        <details className="hx-ed-more">
          <summary>Map settings</summary>
          <Chips label="Theme" values={THEME_IDS.map((t) => [THEMES[t].name, t])} value={map.theme} onPick={(t) => commit({ ...map, theme: t })} />
          <div className="hx-row">
            <button type="button" className="hx-btn" onClick={() => void share()}>Copy map code</button>
            <button type="button" className="hx-btn hx-danger" onClick={() => { if (confirm(`Delete “${map.name}”? This can't be undone.`)) { deleteMap(map.id); location.hash = "#/hexdrift/editor"; } }}>Delete map</button>
          </div>
          {wide && <p className="hx-dim hx-small">Keys: S L R C G add a piece · ← → pick · Alt+← move · D duplicate · Delete · Ctrl+Z undo · Enter drive</p>}
        </details>
      </div>
      </div>
      {msg && <div className="hx-toast" role="status">{msg}</div>}
    </div>
  );
}

function Chips<T extends string | number>({ label, values, value, onPick, step, min, max }: {
  label: string; values: [string, T][]; value: T | undefined; onPick: (v: T) => void; step?: number; min?: number; max?: number;
}) {
  const n = typeof value === "number" && step !== undefined;
  return (
    <div className="hx-ed-row">
      <span className="hx-dim">{label}</span>
      <div className="hx-ed-chips">
        {n && <button type="button" className="hx-chip-btn" aria-label={`${label} less`} onClick={() => onPick(Math.max(min!, (value as number) - step!) as T)}>−</button>}
        {values.map(([l, v]) => (
          <button key={String(v)} type="button" className={`hx-chip-btn ${v === value ? "on" : ""}`} onClick={() => onPick(v)}>{l}</button>
        ))}
        {n && <button type="button" className="hx-chip-btn" aria-label={`${label} more`} onClick={() => onPick(Math.min(max!, (value as number) + step!) as T)}>+</button>}
        {n && !values.some(([, v]) => v === value) && <span className="hx-ed-val">{value}</span>}
      </div>
    </div>
  );
}

// ── The map from above ──────────────────────────────────────────────────────
// Drag to pan, pinch or scroll to zoom, tap to pick a piece, double-tap to fit.
interface Cam { zoom: number; cu: number; cz: number }
function Preview({ map, check, sel, onPick }: { map: CustomMap; check: ReturnType<typeof checkMap>; sel: number; onPick: (i: number) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 200 });
  const [cam, setCam] = useState<Cam | null>(null);
  const view = useRef({ K: 1, cu: 0, cz: 0, w: 300, h: 200, k: 1 });
  useEffect(() => {
    const el = cv.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The road's box: the fitted view.
  const fit = useMemo(() => {
    const road = check.road;
    if (!road) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of road.strands[0].pts) { x0 = Math.min(x0, -p.x); x1 = Math.max(x1, -p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return { x0, x1, z0, z1, y0, y1 };
  }, [check]);
  useEffect(() => {
    const el = cv.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.max(1, Math.round(size.w * dpr)); el.height = Math.max(1, Math.round(size.h * dpr));
    const g = el.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = BIOMES[THEMES[map.theme].biome];
    g.fillStyle = b.ground; g.fillRect(0, 0, size.w, size.h);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 0, size.w, size.h);
    const road = check.road;
    if (!road || !fit) { g.fillStyle = "#fff"; g.font = "14px system-ui"; g.fillText("This road can't be built.", 16, 28); return; }
    const pts = road.strands[0].pts;
    // Screen x is -world x so right bends go right; +z is up.
    const pad = 24;
    const k = Math.min((size.w - pad * 2) / Math.max(40, fit.x1 - fit.x0), (size.h - pad * 2) / Math.max(40, fit.z1 - fit.z0));
    const K = k * (cam?.zoom ?? 1);
    const cu = cam?.cu ?? (fit.x0 + fit.x1) / 2, cz = cam?.cz ?? (fit.z0 + fit.z1) / 2;
    view.current = { K, cu, cz, w: size.w, h: size.h, k };
    const sx = (x: number) => size.w / 2 + K * (-x - cu), sy = (z: number) => size.h / 2 - K * (z - cz);
    // A 50 m grid when zoomed in, to judge sizes.
    if (K > 1.2) {
      g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1;
      const step = 50 * K;
      for (let x = ((size.w / 2 - K * cu) % step + step) % step; x < size.w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size.h); g.stroke(); }
      for (let y = ((size.h / 2 + K * cz) % step + step) % step; y < size.h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(size.w, y); g.stroke(); }
    }
    const bad = new Set(check.problems.map((q) => q.piece));
    const lw = (p: { hw: number }) => Math.max(2.5, p.hw * 2 * K);
    // Low parts first so bridges draw over the roads under them.
    const order = pts.map((_, i) => i).filter((i) => i < pts.length - 1).sort((a, c) => pts[a].y - pts[c].y);
    g.lineCap = "round";
    const { y0, y1 } = fit;
    for (const pass of [0, 1]) {
      for (const i of order) {
        const a = pts[i], c = pts[i + 1];
        if (a.flags & GAP) continue;
        const pi = pieceAt(map, a.s);
        const h = y1 > y0 ? (a.y - y0) / (y1 - y0) : 0.5;
        g.beginPath(); g.moveTo(sx(a.x), sy(a.z)); g.lineTo(sx(c.x), sy(c.z));
        if (pass === 0) { g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = lw(a) + 3; }
        else {
          g.strokeStyle = bad.has(pi) ? "#ff4d5e" : pi === sel ? b.accent : `hsl(230 12% ${30 + 40 * h}%)`;
          g.lineWidth = lw(a);
        }
        g.stroke();
      }
    }
    g.setLineDash([3, 5]); g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1.5;
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].flags & GAP) { g.beginPath(); g.moveTo(sx(pts[i].x), sy(pts[i].z)); g.lineTo(sx(pts[i + 1].x), sy(pts[i + 1].z)); g.stroke(); }
    g.setLineDash([]);
    const gate = (gt: { x: number; z: number; fx: number; fz: number; hw: number }, col: string) => {
      const rx = gt.fz, rz = -gt.fx;
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.moveTo(sx(gt.x + rx * gt.hw), sy(gt.z + rz * gt.hw)); g.lineTo(sx(gt.x - rx * gt.hw), sy(gt.z - rz * gt.hw)); g.stroke();
    };
    for (const gt of road.gates) gate(gt, "#ffd23d");
    gate(road.finish, "#ffffff");
    const s0 = pts[0];
    g.fillStyle = "#3dff8a"; g.beginPath(); g.arc(sx(s0.x), sy(s0.z), 5, 0, Math.PI * 2); g.fill();
  }, [map, check, sel, size, fit, cam]);

  // Pointers: one drags, two pinch; a press that hardly moves is a tap.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<{ moved: boolean; x: number; y: number; d: number; cam: Cam; lastTap: number }>({ moved: false, x: 0, y: 0, d: 0, cam: { zoom: 1, cu: 0, cz: 0 }, lastTap: 0 });
  const camNow = (): Cam => { const v = view.current; return { zoom: v.K / v.k, cu: v.cu, cz: v.cz }; };
  const zoomAt = (c: Cam, f: number, px: number, py: number): Cam => {
    const v = view.current;
    const zoom = Math.min(40, Math.max(0.5, c.zoom * f));
    const K0 = v.k * c.zoom, K1 = v.k * zoom;
    // Keep the world point under (px, py) where it is.
    const wu = c.cu + (px - v.w / 2) / K0, wz = c.cz - (py - v.h / 2) / K0;
    return { zoom, cu: wu - (px - v.w / 2) / K1, cz: wz + (py - v.h / 2) / K1 };
  };
  const local = (e: { clientX: number; clientY: number }) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    const G = gest.current;
    G.cam = camNow();
    const ps = [...ptrs.current.values()];
    if (ps.length === 1) { G.moved = false; G.x = ps[0].x; G.y = ps[0].y; }
    else { G.moved = true; G.d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y); G.x = (ps[0].x + ps[1].x) / 2; G.y = (ps[0].y + ps[1].y) / 2; }
  };
  const moveP = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, local(e));
    const G = gest.current, v = view.current;
    const ps = [...ptrs.current.values()];
    if (ps.length === 1) {
      const dx = ps[0].x - G.x, dy = ps[0].y - G.y;
      if (!G.moved && dx * dx + dy * dy < 64) return;
      G.moved = true;
      const K = v.k * G.cam.zoom;
      setCam({ zoom: G.cam.zoom, cu: G.cam.cu - dx / K, cz: G.cam.cz + dy / K });
    } else if (ps.length >= 2) {
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
      const z = zoomAt(G.cam, d / Math.max(10, G.d), G.x, G.y);
      const K = v.k * z.zoom;
      setCam({ zoom: z.zoom, cu: z.cu - (mx - G.x) / K, cz: z.cz + (my - G.y) / K });
    }
  };
  const up = (e: React.PointerEvent) => {
    const had = ptrs.current.delete(e.pointerId);
    const G = gest.current;
    if (ptrs.current.size > 0) { const p = [...ptrs.current.values()][0]; G.cam = camNow(); G.x = p.x; G.y = p.y; G.moved = true; return; }
    if (!had || G.moved || e.type === "pointercancel") return;
    const now = performance.now();
    if (now - G.lastTap < 300) { setCam(null); G.lastTap = 0; return; }
    G.lastTap = now;
    pick(local(e));
  };
  const pick = (at: { x: number; y: number }) => {
    const road = check.road;
    if (!road) return;
    const v = view.current;
    const wx = -(v.cu + (at.x - v.w / 2) / v.K), wz = v.cz - (at.y - v.h / 2) / v.K;
    let best = -1, bd = Infinity;
    for (const p of road.strands[0].pts) { const d = (p.x - wx) ** 2 + (p.z - wz) ** 2; if (d < bd) { bd = d; best = p.s; } }
    if (best >= 0 && bd < (30 / v.K) ** 2 + 400) onPick(pieceAt(map, best));
  };
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCam(zoomAt(camNow(), Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="hx-ed-viewbox">
      <canvas ref={cv} className="hx-ed-view" onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}
        aria-label="The map from above: tap a piece to pick it, drag to move, pinch or scroll to zoom" />
      <div className="hx-ed-zoom">
        <button type="button" className="hx-icon" aria-label="Zoom in" onClick={() => setCam(zoomAt(camNow(), 1.5, view.current.w / 2, view.current.h / 2))}>+</button>
        <button type="button" className="hx-icon" aria-label="Zoom out" onClick={() => setCam(zoomAt(camNow(), 1 / 1.5, view.current.w / 2, view.current.h / 2))}>−</button>
        {cam && <button type="button" className="hx-icon" aria-label="Fit the whole map" title="Fit (double-tap)" onClick={() => setCam(null)}>⤢</button>}
      </div>
    </div>
  );
}

/** The road's height along its length (studio). */
function Profile({ map, check, sel, onPick }: { map: CustomMap; check: ReturnType<typeof checkMap>; sel: number; onPick: (i: number) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => {
    const el = cv.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 70;
  const span = useRef({ s1: 1 });
  useEffect(() => {
    const el = cv.current!, road = check.road;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(w * dpr); el.height = Math.round(H * dpr);
    const g = el.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    if (!road) return;
    const pts = road.strands[0].pts;
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    if (y1 - y0 < 10) { const m = (y0 + y1) / 2; y0 = m - 5; y1 = m + 5; }
    const s1 = pts[pts.length - 1].s;
    span.current.s1 = s1;
    const X = (s: number) => 4 + (s / s1) * (w - 8), Y = (y: number) => H - 8 - ((y - y0) / (y1 - y0)) * (H - 16);
    const b = BIOMES[THEMES[map.theme].biome];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      if (a.flags & GAP) continue;
      g.strokeStyle = pieceAt(map, a.s) === sel ? b.accent : "rgba(255,255,255,0.75)";
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(X(a.s), Y(a.y)); g.lineTo(X(c.s), Y(c.y)); g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.5)"; g.font = "11px system-ui";
    g.fillText(`${Math.round(y1 - y0)} m`, 6, 12);
  }, [map, check, sel, w]);
  const click = (e: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect();
    onPick(pieceAt(map, ((e.clientX - r.left - 4) / (r.width - 8)) * span.current.s1));
  };
  return <canvas ref={cv} className="hx-ed-profile" style={{ height: H }} onClick={click} aria-label="Height along the road: click to pick a piece" />;
}
