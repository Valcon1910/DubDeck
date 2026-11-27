// The phone map editor: track tiles on a grid. Pick a tile and it goes where
// the cursor is, and the cursor moves on to where the track leaves it, so a
// map is a row of taps. Tap a placed tile to swap, turn, lift or delete it.
// Swipe to look around, pinch to zoom. Every change saves on the device.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkMap, encodeMap, LIMITS, medalsOf, THEMES, versionOf, withGrid, type CustomMap, type ThemeId } from "./sim/custom.ts";
import { CELL, cellsOf, chainOf, DIRS, exitOf, piecesOfGrid, slowLoops, TILE_NAMES, type Tile, type TileKind } from "./sim/grid.ts";
import { BIOMES } from "./maps.ts";
import { formatTime } from "./sim/race.ts";
import { authorOf, deleteMap, myMap, saveMap } from "./mymaps.ts";
import { publishedOf, publishMap } from "./community.ts";
import { PublishBox } from "./pubbox.tsx";
import { IconBack } from "./ui/icons.tsx";
import type { BotReply } from "./botworker.ts";

const THEME_IDS = Object.keys(THEMES) as ThemeId[];
const MAX_TILES = 200;
const PALETTE: TileKind[] = ["straight", "left", "right", "bigleft", "bigright", "up", "down", "jump", "loop", "wallleft", "wallright", "roofleft", "roofright", "boost", "cp", "finish", "start"];

// ── Tile drawings, in the tile's own frame: forward and left, in cells, from its entry cell's centre ──
type P = [number, number];
const arc = (cf: number, cl: number, r: number, side: 1 | -1): P[] => {
  const out: P[] = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; out.push([cf + r * Math.sin(a), cl - side * r * Math.cos(a)]); }
  return out;
};
const STRAIGHT: P[] = [[-0.5, 0], [0.5, 0]];
/** The road's centre lines (and gaps, drawn dashed). */
function roadOf(k: TileKind): { road: P[][]; gap?: P[] } {
  switch (k) {
    case "left": return { road: [arc(-0.5, 0.5, 0.5, 1)] };
    case "right": return { road: [arc(-0.5, -0.5, 0.5, -1)] };
    case "bigleft": return { road: [arc(-0.5, 1.5, 1.5, 1)] };
    case "bigright": return { road: [arc(-0.5, -1.5, 1.5, -1)] };
    case "jump": return { road: [STRAIGHT], gap: [[0.5, 0], [1.5, 0]] };
    case "loop": return { road: [[[-0.5, 0], [0, 0]], [[0, -1], [0.5, -1]]] };
    case "finish": return { road: [[[-0.5, 0], [1.5, 0]]] };
    case "wallleft": case "wallright": return { road: [[[-0.5, 0], [2.5, 0]]] };
    case "roofleft": case "roofright": return { road: [[[-0.5, 0], [4.5, 0]]] };
    default: return { road: [STRAIGHT] };
  }
}
const ROAD_W = 18 / CELL;

/** A small picture of a tile for the palette. */
function TileIcon({ k }: { k: TileKind }) {
  const { road, gap } = roadOf(k);
  const all = [...road.flat(), ...(gap ?? [])];
  if (k === "loop") all.push([0, -0.95], [0.4, -0.5]);
  // Screen: forward is up, left is left.
  const xs = all.map((p) => -p[1]), ys = all.map((p) => -p[0]);
  const pad = 0.4;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const s = Math.max(x1 - x0, y1 - y0);
  const vb = `${(x0 + x1) / 2 - s / 2} ${(y0 + y1) / 2 - s / 2} ${s} ${s}`;
  const path = (pts: P[]) => pts.map((p, i) => `${i ? "L" : "M"}${-p[1]} ${-p[0]}`).join("");
  return (
    <svg viewBox={vb} aria-hidden="true" className="hx-gr-icon">
      {road.map((r, i) => <path key={i} d={path(r)} stroke="currentColor" strokeWidth={ROAD_W} fill="none" strokeLinecap="butt" opacity={0.85} />)}
      {gap && <path d={path(gap)} stroke="currentColor" strokeWidth={0.08} strokeDasharray="0.12 0.12" fill="none" />}
      {k === "loop" && <circle cx={0.5} cy={0} r={0.42} stroke="currentColor" strokeWidth={0.16} fill="none" />}
      {(k === "wallleft" || k === "wallright" || k === "roofleft" || k === "roofright") && (() => {
        const s = k.endsWith("left") ? 1 : -1, n = k.startsWith("roof") ? 4 : 2;
        return <path d={`M${-0.35 * s} 0.3Q${-0.6 * s} ${-n / 2} ${-0.35 * s} ${-n + 0.3}`} stroke="#ff4fd8" strokeWidth={0.12} fill="none" />;
      })()}
      {k === "boost" && <path d="M-0.2 0.1L0 -0.15L0.2 0.1M-0.2 0.35L0 0.1L0.2 0.35" stroke="#22e3ff" strokeWidth={0.08} fill="none" />}
      {k === "cp" && <path d="M-0.4 0H0.4" stroke="#ffd23d" strokeWidth={0.12} />}
      {(k === "start" || k === "finish") && <path d={k === "start" ? "M-0.3 0.2H0.3" : "M-0.3 0H0.3"} stroke="#fff" strokeWidth={0.12} strokeDasharray="0.1 0.1" />}
      {(k === "up" || k === "down") && <path d={k === "up" ? "M-0.2 0.15L0 -0.15L0.2 0.15" : "M-0.2 -0.15L0 0.15L0.2 -0.15"} stroke="#fff" strokeWidth={0.09} fill="none" />}
    </svg>
  );
}

interface Cursor { x: number; z: number; y: number; d: Tile["d"] }
interface Cam { x: number; z: number; K: number }

// ── The editor ──────────────────────────────────────────────────────────────
export function GridEditor({ id, sb, me }: { id: string; sb: SupabaseClient | null; me: string }) {
  const [map, setMap] = useState<CustomMap | null>(() => myMap(id));
  const tiles = useMemo(() => map?.grid ?? [], [map]);
  const chain = useMemo(() => chainOf(tiles), [tiles]);
  const check = useMemo(() => (map ? checkMap(map) : null), [map]);
  const slow = useMemo(() => slowLoops(tiles, chain), [tiles, chain]);
  const [sel, setSel] = useState(-1);
  const [cur, setCur] = useState<Cursor>(() => {
    const t = map?.grid ?? [];
    const c = chainOf(t);
    const last = t[c.order[c.order.length - 1]];
    if (!last) return { x: 0, z: 0, y: 0, d: 0 };
    if (c.done) return { x: last.x, z: last.z, y: last.y, d: last.d };
    const e = exitOf(last);
    return { x: e.x, z: e.z, y: e.y, d: e.d };
  });
  const undo = useRef<Tile[][]>([]);
  const redo = useRef<Tile[][]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(t); }, [msg]);

  // Every change goes on the undo list and is saved on the device.
  const commit = useCallback((next: Tile[]) => {
    if (!map) return;
    undo.current.push(tiles); if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    const m = withGrid(map, next);
    setMap(m);
    if (!saveMap(m)) setMsg("This device's storage is full: the change isn't saved.");
  }, [map, tiles]);
  const back = useCallback((from: React.RefObject<Tile[][]>, to: React.RefObject<Tile[][]>) => {
    if (!map) return;
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(tiles);
    const m = withGrid(map, prev);
    setMap(m); saveMap(m); setSel(-1);
  }, [map, tiles]);

  const place = useCallback((k: TileKind) => {
    let next = [...tiles];
    if (sel >= 0) {
      // Swap the picked tile for this one.
      const swapped = { ...next[sel], k };
      next[sel] = swapped;
      if (k === "start") next = next.filter((t) => t === swapped || t.k !== "start");
      commit(next);
      setSel(next.indexOf(swapped));
      return;
    }
    if (tiles.length >= MAX_TILES) { setMsg(`At most ${MAX_TILES} tiles.`); return; }
    const t: Tile = { k, x: cur.x, z: cur.z, y: cur.y, d: cur.d };
    const e = exitOf(t);
    // The finish at the end of the track moves on ahead of the new tile.
    const fin = chain.done ? tiles[chain.order[chain.order.length - 1]] : null;
    const pushFin = !!fin && k !== "finish" && k !== "start" && fin.x === t.x && fin.z === t.z && fin.y === t.y && fin.d === t.d;
    // A tile already starting here is replaced; there's only one start (and one finish).
    next = next.filter((u) => !(u.x === t.x && u.z === t.z && Math.abs(u.y - t.y) <= 1) && !(k === "start" && u.k === "start") && !(k === "finish" && u.k === "finish"));
    next.push(t);
    if (pushFin) next.push({ k: "finish", x: e.x, z: e.z, y: e.y, d: e.d });
    commit(next);
    setCur({ x: e.x, z: e.z, y: e.y, d: e.d });
  }, [tiles, chain, sel, cur, commit]);

  const rotate = useCallback(() => {
    if (sel >= 0) { const next = [...tiles]; const t = next[sel]; next[sel] = { ...t, d: ((t.d + 3) % 4) as Tile["d"] }; commit(next); setCur({ ...cur, d: next[sel].d }); }
    else setCur((c) => ({ ...c, d: ((c.d + 3) % 4) as Tile["d"] }));
  }, [tiles, sel, cur, commit]);
  const lift = useCallback((by: 1 | -1) => {
    const y = (v: number) => Math.max(-8, Math.min(30, v + by));
    if (sel >= 0) { const next = [...tiles]; next[sel] = { ...next[sel], y: y(next[sel].y) }; commit(next); setCur((c) => ({ ...c, y: next[sel].y })); }
    else setCur((c) => ({ ...c, y: y(c.y) }));
  }, [tiles, sel, commit]);
  const remove = useCallback(() => {
    if (sel < 0) return;
    const t = tiles[sel];
    commit(tiles.filter((_, i) => i !== sel));
    setSel(-1);
    setCur({ x: t.x, z: t.z, y: t.y, d: t.d });
  }, [tiles, sel, commit]);

  /** A tap on the map: pick the tile there, or put the cursor on the empty cell. */
  const tapCell = useCallback((x: number, z: number) => {
    let best = -1;
    tiles.forEach((t, i) => {
      if (cellsOf(t).some(([cx, cz]) => cx === x && cz === z) && (best < 0 || t.y >= tiles[best].y)) best = i;
    });
    if (best >= 0) { const t = tiles[best]; setSel(best); setCur({ x: t.x, z: t.z, y: t.y, d: t.d }); return; }
    setSel(-1);
    // An empty cell where a tile's road comes out: carry on from it.
    const from = tiles.map(exitOf).find((e) => e.x === x && e.z === z);
    setCur((c) => from ? { x, z, y: from.y, d: from.d } : { ...c, x, z });
  }, [tiles]);

  // Keys on computers: R turns, PageUp/PageDown lift, Delete removes, Escape lets go, Ctrl+Z undoes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const key = e.key.toLowerCase();
      if (key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) back(redo, undo); else back(undo, redo); return; }
      if (key === "y" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); back(redo, undo); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === "r") rotate();
      else if (e.key === "PageUp") { e.preventDefault(); lift(1); }
      else if (e.key === "PageDown") { e.preventDefault(); lift(-1); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      else if (e.key === "Escape") setSel(-1);
      else if (e.key === "Enter" && map) location.hash = `#/hexdrift/test/${map.id}`;
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [rotate, lift, remove, back, map]);

  // The autopilot test drives the map in the background.
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
    w.onmessage = (e: MessageEvent<BotReply>) => {
      const r = e.data;
      w.terminate();
      if (worker.current === w) worker.current = null;
      setBot(r.ok ? `The autopilot finished in ${formatTime(r.ticks)}. You can beat that.` : r.error ? `The autopilot couldn't drive it: ${r.error}` : "The autopilot got stuck. It's careful, so a human may still make it.");
    };
    w.postMessage(map);
  }, [map]);

  // Community Maps.
  const [pub, setPub] = useState<{ id: string; version: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => {
    if (!sb || !me) return;
    let alive = true;
    void publishedOf(sb, me, id).then((p) => { if (alive) setPub(p); }).catch(() => {});
    return () => { alive = false; };
  }, [sb, me, id]);
  const publish = useCallback(async () => {
    if (!sb || !map) return;
    setPublishing(true);
    const r = await publishMap(sb, map);
    setPublishing(false);
    if (r.ok) { setPub({ id: r.id, version: versionOf(map) }); setMsg(r.updated ? (r.changed ? "Updated. The road changed, so its leaderboard starts fresh." : "Updated.") : "Published! It's in Community Maps now."); }
    else setMsg(r.error);
  }, [sb, map]);

  if (!map || !check) return <div className="hx-menu"><a className="hx-back" href="#/hexdrift/editor"><IconBack /> My maps</a><p>That map isn't on this device.</p></div>;
  const author = authorOf(map);
  const broken = !check.road || !chain.done;
  const from = piecesOfGrid(tiles, chain).from;
  const share = async () => {
    const code = encodeMap(map);
    try { await navigator.clipboard.writeText(code); setMsg("Map code copied. Anyone can add it under My maps."); }
    catch { window.prompt("Copy this map code:", code); }
  };
  const picked = sel >= 0 ? tiles[sel] : null;

  return (
    <div className="hx-ed hx-gr">
      <header className="hx-ed-bar">
        <a className="hx-icon" href="#/hexdrift/editor" aria-label="My maps" title="My maps"><IconBack /></a>
        <input className="hx-ed-name" value={map.name} maxLength={LIMITS.nameLen} aria-label="Map name"
          onChange={(e) => { const next = { ...map, name: e.target.value }; setMap(next); saveMap(next); }} />
        <button type="button" className="hx-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={() => back(undo, redo)}>↶</button>
        <button type="button" className="hx-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!redo.current.length} onClick={() => back(redo, undo)}>↷</button>
        <a className={`hx-btn hx-btn-main ${broken ? "hx-off" : ""}`} href={broken ? undefined : `#/hexdrift/test/${map.id}`} aria-disabled={broken} title="Drive it (Enter)">Drive</a>
      </header>

      <div className="hx-ed-stage">
        <GridView map={map} tiles={tiles} onChain={new Set(chain.order)} clash={new Set(chain.clash)} slow={new Set(slow)} sel={sel} cur={cur} onTap={tapCell} />
      </div>

      <div className="hx-ed-side">
        <div className="hx-ed-info">
          <span>{(check.length / 1000).toFixed(2)} km · {tiles.filter((t) => t.k === "cp").length} CP · {tiles.length} tiles</span>
          <span>{author ? <>Author {formatTime(author.ticks)} · Gold {formatTime(medalsOf(author.ticks).gold)}</> : "Drive to the finish to set the author time"}</span>
          <button type="button" className="hx-linkbtn" disabled={broken || bot === "…"} onClick={runBot}>{bot === "…" ? "Autopilot driving…" : "Autopilot test"}</button>
        </div>
        {bot && bot !== "…" && <p className="hx-ed-bot" role="status">{bot}</p>}
        {check.problems.length > 0 && (
          <ul className="hx-ed-problems" role="status">
            {check.problems.slice(0, 3).map((q, i) => {
              const t = q.piece >= 0 ? from[q.piece] ?? -1 : -1;
              return <li key={i}>{t >= 0 ? <button type="button" onClick={() => { setSel(t); const u = tiles[t]; setCur({ x: u.x, z: u.z, y: u.y, d: u.d }); }}>Show</button> : null} {q.text}</li>;
            })}
          </ul>
        )}
        {slow.length > 0 && <p className="hx-ed-bot hx-gr-tip">A loop needs speed: put about four straights or a boost before it.</p>}

        <div className="hx-ed-panel">
          <div className="hx-gr-tools">
            <span className="hx-gr-what">{picked ? <><strong>{TILE_NAMES[picked.k]}</strong> · level {picked.y}</> : <>New tile · level {cur.y}</>}</span>
            <button type="button" className="hx-gr-tool" onClick={rotate} aria-label="Rotate" title="Rotate (R)">⟳<small>Rotate</small></button>
            <button type="button" className="hx-gr-tool" onClick={() => lift(1)} aria-label="Up a level" title="Up (Page Up)">▲<small>Up</small></button>
            <button type="button" className="hx-gr-tool" onClick={() => lift(-1)} aria-label="Down a level" title="Down (Page Down)">▼<small>Down</small></button>
            <button type="button" className="hx-gr-tool hx-danger" onClick={remove} disabled={sel < 0} aria-label="Delete tile" title="Delete">✕<small>Delete</small></button>
            {sel >= 0 && <button type="button" className="hx-gr-tool" onClick={() => setSel(-1)} aria-label="Done" title="Done (Esc)">✓<small>Done</small></button>}
          </div>
          <div className="hx-gr-palette" role="group" aria-label={picked ? "Swap the tile for" : "Add a tile"}>
            {PALETTE.map((k) => (
              <button key={k} type="button" className={`hx-gr-tile ${picked?.k === k ? "on" : ""}`} onClick={() => place(k)}>
                <TileIcon k={k} />{TILE_NAMES[k]}
              </button>
            ))}
          </div>

          <PublishBox map={map} signedIn={!!sb} author={!!author} problems={check.problems.length} pub={pub} publishing={publishing}
            onRate={(r) => { const m = { ...map, rating: r }; setMap(m); saveMap(m); }} onPublish={() => void publish()} />

          <details className="hx-ed-more">
            <summary>Map settings</summary>
            <div className="hx-ed-row">
              <span className="hx-dim">Theme</span>
              <div className="hx-ed-chips">
                {THEME_IDS.map((t) => <button key={t} type="button" className={`hx-chip-btn ${map.theme === t ? "on" : ""}`} onClick={() => { const m = { ...map, theme: t }; setMap(m); saveMap(m); }}>{THEMES[t].name}</button>)}
              </div>
            </div>
            <div className="hx-row">
              <button type="button" className="hx-btn" onClick={() => void share()}>Copy map code</button>
              <button type="button" className="hx-btn hx-danger" onClick={() => { if (confirm(`Delete “${map.name}”? This can't be undone.`)) { deleteMap(map.id); location.hash = "#/hexdrift/editor"; } }}>Delete map</button>
            </div>
            <p className="hx-dim hx-small">Tap a tile to place it where the arrow is. Tap a placed tile to swap, turn, lift or delete it. Swipe to look around, pinch to zoom.</p>
          </details>
        </div>
      </div>
      {msg && <div className="hx-toast" role="status">{msg}</div>}
    </div>
  );
}

// ── The grid from above ─────────────────────────────────────────────────────
function GridView({ map, tiles, onChain, clash, slow, sel, cur, onTap }: {
  map: CustomMap; tiles: Tile[]; onChain: Set<number>; clash: Set<number>; slow: Set<number>; sel: number; cur: Cursor; onTap: (x: number, z: number) => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Cam | null>(null);
  const size = useRef({ w: 300, h: 200 });
  const props = useRef({ map, tiles, onChain, clash, slow, sel, cur });
  props.current = { map, tiles, onChain, clash, slow, sel, cur };

  /** Fits every tile (and the cursor) in view. */
  const fit = useCallback(() => {
    const { tiles, cur } = props.current;
    let x0 = cur.x, x1 = cur.x, z0 = cur.z, z1 = cur.z;
    for (const t of tiles) for (const [x, z] of cellsOf(t)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const { w, h } = size.current;
    const K = Math.min(w / ((x1 - x0 + 2) * CELL), h / ((z1 - z0 + 2) * CELL), 6);
    cam.current = { x: ((x0 + x1) / 2) * CELL, z: ((z0 + z1) / 2) * CELL, K: Math.max(0.3, K) };
  }, []);

  const draw = useCallback(() => {
    const el = cv.current;
    if (!el) return;
    const { map, tiles, onChain, clash, slow, sel, cur } = props.current;
    const { w, h } = size.current;
    if (!cam.current) fit();
    const { x: cx, z: cz, K } = cam.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.max(1, Math.round(w * dpr)); el.height = Math.max(1, Math.round(h * dpr)); }
    const g = el.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = BIOMES[THEMES[map.theme].biome];
    g.fillStyle = b.ground; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(0, 0, w, h);
    // Screen x is −world x (so the left of a car going up the screen is on the left).
    const sx = (x: number) => w / 2 - (x - cx) * K, sy = (z: number) => h / 2 - (z - cz) * K;
    // Cell lines.
    g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1;
    const i0 = Math.floor((cx - w / 2 / K) / CELL) - 1, i1 = Math.ceil((cx + w / 2 / K) / CELL) + 1;
    const j0 = Math.floor((cz - h / 2 / K) / CELL) - 1, j1 = Math.ceil((cz + h / 2 / K) / CELL) + 1;
    if (i1 - i0 < 200 && j1 - j0 < 200) {
      g.beginPath();
      for (let i = i0; i <= i1; i++) { const x = sx((i + 0.5) * CELL); g.moveTo(x, 0); g.lineTo(x, h); }
      for (let j = j0; j <= j1; j++) { const y = sy((j + 0.5) * CELL); g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
    }
    // A tile's own frame → screen.
    const at = (t: { x: number; z: number; d: number }, f: number, l: number): [number, number] => {
      const [fx, fz] = DIRS[t.d], [lx, lz] = DIRS[(t.d + 1) % 4];
      return [sx((t.x + fx * f + lx * l) * CELL), sy((t.z + fz * f + lz * l) * CELL)];
    };
    const line = (t: Tile, pts: P[]) => { g.beginPath(); pts.forEach(([f, l], i) => { const [x, y] = at(t, f, l); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); };
    const order = tiles.map((_, i) => i).sort((a, c) => tiles[a].y - tiles[c].y);
    g.lineCap = "butt"; g.lineJoin = "round";
    for (const i of order) {
      const t = tiles[i];
      const { road, gap } = roadOf(t.k);
      g.globalAlpha = onChain.has(i) ? 1 : 0.45;
      // Outline, then the road (lighter the higher it is).
      g.strokeStyle = i === sel ? b.accent : clash.has(i) ? "#ff4d5e" : slow.has(i) ? "#ffb02e" : "rgba(0,0,0,0.6)";
      g.lineWidth = ROAD_W * CELL * K + (i === sel ? 6 : 3);
      for (const r of road) line(t, r);
      const lv = Math.max(-4, Math.min(8, t.y));
      g.strokeStyle = `hsl(230 12% ${32 + lv * 5}%)`;
      g.lineWidth = ROAD_W * CELL * K;
      for (const r of road) line(t, r);
      if (gap) { g.setLineDash([4, 5]); g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 2; line(t, gap); g.setLineDash([]); }
      // Marks.
      const across = (f: number, col: string, wpx: number, dash?: number[]) => {
        g.strokeStyle = col; g.lineWidth = wpx; if (dash) g.setLineDash(dash);
        line(t, [[f, ROAD_W / 2], [f, -ROAD_W / 2]]); g.setLineDash([]);
      };
      if (t.k === "start") across(-0.2, "#fff", Math.max(2, 4 * K), [Math.max(2, 3 * K), Math.max(2, 3 * K)]);
      if (t.k === "finish") across(0, "#fff", Math.max(2, 4 * K), [Math.max(2, 3 * K), Math.max(2, 3 * K)]);
      if (t.k === "cp") across(0, "#ffd23d", Math.max(2, 3 * K));
      if (t.k === "boost") { g.strokeStyle = "#22e3ff"; g.lineWidth = Math.max(1.5, 2 * K); for (const f of [-0.25, 0.05]) line(t, [[f, 0.2], [f + 0.18, 0], [f, -0.2]]); }
      if (t.k === "up" || t.k === "down") { g.strokeStyle = "#fff"; g.lineWidth = Math.max(1.5, 2 * K); const s = t.k === "up" ? 1 : -1; line(t, [[-0.1 * s, 0.18], [0.12 * s, 0], [-0.1 * s, -0.18]]); }
      if (t.k === "loop") {
        g.strokeStyle = `hsl(230 12% ${45 + lv * 5}%)`; g.lineWidth = ROAD_W * CELL * K * 0.5;
        const [x, y] = at(t, 0, -0.5);
        g.beginPath(); g.arc(x, y, 0.42 * CELL * K, 0, Math.PI * 2); g.stroke();
      }
      if (t.y !== 0 && K > 0.5) {
        const [x, y] = at(t, 0, 0);
        g.globalAlpha = 1; g.fillStyle = "rgba(0,0,0,0.6)"; g.font = "600 11px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
        const s = `${t.y > 0 ? "+" : ""}${t.y}`;
        g.fillRect(x - 11, y - 8, 22, 16); g.fillStyle = "#fff"; g.fillText(s, x, y);
      }
    }
    g.globalAlpha = 1;
    // The cursor: where the next tile goes, and which way it faces.
    if (sel < 0) {
      const [x, y] = at(cur, 0, 0), half = (CELL * K) / 2 - 2;
      g.strokeStyle = b.accent; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.strokeRect(x - half, y - half, half * 2, half * 2); g.setLineDash([]);
      g.fillStyle = b.accent;
      const tip = at(cur, 0.35, 0), l = at(cur, 0.05, 0.2), r = at(cur, 0.05, -0.2);
      g.beginPath(); g.moveTo(...tip); g.lineTo(...l); g.lineTo(...r); g.closePath(); g.fill();
      if (cur.y !== 0 && half > 30) { g.font = "600 11px system-ui"; g.textAlign = "center"; g.fillText(`level ${cur.y}`, x, y + half - 8); }
    }
  }, [fit]);

  // Size and redraws.
  useEffect(() => {
    const el = cv.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (first && el.clientWidth > 0) { first = false; fit(); }
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw, fit]);
  useEffect(() => { draw(); }, [map, tiles, sel, cur, draw]);
  // Keep the cursor on screen as the track grows.
  useEffect(() => {
    const c = cam.current;
    if (!c) return;
    const { w, h } = size.current;
    const px = w / 2 - (cur.x * CELL - c.x) * c.K, py = h / 2 - (cur.z * CELL - c.z) * c.K, m = CELL * c.K;
    if (px < m || px > w - m || py < m || py > h - m) { c.x = cur.x * CELL; c.z = cur.z * CELL; draw(); }
  }, [cur, draw]);

  // Pointers: one finger swipes, two pinch, a press that hardly moves is a tap.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef({ moved: false, x: 0, y: 0, d: 0, mx: 0, my: 0, cam: { x: 0, z: 0, K: 1 } as Cam });
  const raf = useRef(0);
  const redraw = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(draw); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const zoomAt = (c: Cam, f: number, px: number, py: number): Cam => {
    const { w, h } = size.current;
    const K = Math.min(12, Math.max(0.15, c.K * f));
    // Keep the point under the fingers where it is.
    const wx = c.x - (px - w / 2) / c.K, wz = c.z - (py - h / 2) / c.K;
    return { K, x: wx + (px - w / 2) / K, z: wz + (py - h / 2) / K };
  };
  const local = (e: React.PointerEvent | React.WheelEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    const ps = [...ptrs.current.values()];
    const G = gest.current;
    G.cam = { ...cam.current! };
    if (ps.length === 1) { G.moved = false; G.x = ps[0].x; G.y = ps[0].y; }
    else if (ps.length === 2) { G.moved = true; G.d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1; G.mx = (ps[0].x + ps[1].x) / 2; G.my = (ps[0].y + ps[1].y) / 2; }
  };
  const move = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, local(e));
    const ps = [...ptrs.current.values()];
    const G = gest.current;
    if (ps.length === 1) {
      const dx = ps[0].x - G.x, dy = ps[0].y - G.y;
      if (!G.moved && dx * dx + dy * dy < 64) return;
      G.moved = true;
      cam.current = { ...G.cam, x: G.cam.x + dx / G.cam.K, z: G.cam.z + dy / G.cam.K };
    } else if (ps.length === 2) {
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
      const mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
      const z = zoomAt(G.cam, d / G.d, G.mx, G.my);
      cam.current = { ...z, x: z.x + (mx - G.mx) / z.K, z: z.z + (my - G.my) / z.K };
    }
    redraw();
  };
  const up = (e: React.PointerEvent) => {
    const had = ptrs.current.delete(e.pointerId);
    const G = gest.current;
    if (had && ptrs.current.size === 0 && !G.moved && e.type === "pointerup") {
      const c = cam.current!, p = local(e), { w, h } = size.current;
      const x = c.x - (p.x - w / 2) / c.K, z = c.z - (p.y - h / 2) / c.K;
      onTap(Math.round(x / CELL), Math.round(z / CELL));
    }
    // One finger left after a pinch: carry on swiping from here.
    const ps = [...ptrs.current.values()];
    if (ps.length === 1) { G.x = ps[0].x; G.y = ps[0].y; G.cam = { ...cam.current! }; }
  };
  const wheel = (e: React.WheelEvent) => {
    const p = local(e);
    cam.current = zoomAt(cam.current!, Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    redraw();
  };
  const zoomBy = (f: number) => { const { w, h } = size.current; cam.current = zoomAt(cam.current!, f, w / 2, h / 2); redraw(); };

  return (
    <div className="hx-ed-viewbox">
      <canvas ref={cv} className="hx-ed-view" aria-label="The track from above. Tap a square to pick it." role="img"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
      <div className="hx-ed-zoom">
        <button type="button" className="hx-icon" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
        <button type="button" className="hx-icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
        <button type="button" className="hx-icon" aria-label="Show the whole track" onClick={() => { fit(); draw(); }}>⤢</button>
      </div>
    </div>
  );
}
