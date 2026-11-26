// The computer studio: the map in 3D with an object list, a properties panel
// and tools to move, turn and resize things, shape the land and set the sky.
// Like a simple game studio. Everything still saves as the same CustomMap,
// so studio maps drive, check and publish like any other.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkMap, encodeMap, LIMITS, medalsOf, THEMES, WEATHERS, versionOf, type CustomMap, type Folder, type ObjDef, type ThemeId, type Weather } from "./sim/custom.ts";
import { MATS, PART_LIMITS, SHAPES, type Mat, type PartDef, type Shape } from "./sim/parts.ts";
import { KITS } from "./sim/kit.ts";
import { MAT as LAND, SCULPT, type Sculpt } from "./sim/road.ts";
import { formatTime } from "./sim/race.ts";
import { authorOf, deleteMap, myMap, saveMap } from "./mymaps.ts";
import { publishedOf, publishMap } from "./community.ts";
import { PublishBox } from "./pubbox.tsx";
import { Chips, RoadPanel, usePieceOps } from "./editor.tsx";
import { IconBack } from "./ui/icons.tsx";
import { StudioView, type Pick, type Tool } from "./render/studio.ts";
import { MAT_COLOR } from "./render/parts.ts";

const THEME_IDS = Object.keys(THEMES) as ThemeId[];
const SHAPE_NAMES: Record<Shape, string> = { box: "Block", wedge: "Wedge", ramp: "Ramp", cyl: "Cylinder", ball: "Ball" };
const MAT_NAMES: Record<Mat, string> = { solid: "Solid", bouncy: "Bouncy", ice: "Ice", boost: "Boost", kill: "Kill zone" };
const SIZES: Record<Shape, [number, number, number]> = { box: [4, 4, 4], wedge: [8, 3, 6], ramp: [10, 2.5, 14], cyl: [4, 6, 4], ball: [4, 4, 4] };
const TOOLS: [Tool, string, string][] = [["select", "Select", "Q"], ["move", "Move", "W"], ["rotate", "Rotate", "E"], ["scale", "Resize", "R"], ["terrain", "Terrain", "T"]];
const MOVE_SNAPS = [0, 0.5, 1, 2, 4, 8];
const TURN_SNAPS = [0, 5, 15, 45, 90];
type Brush = "raise" | "lower" | "smooth" | "flatten" | "paint";
const BRUSHES: [string, Brush][] = [["Raise", "raise"], ["Lower", "lower"], ["Smooth", "smooth"], ["Flatten", "flatten"], ["Paint", "paint"]];
const LAND_NAMES = Object.keys(LAND) as (keyof typeof LAND)[];
const pretty = (o: string) => o.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A tower crane made of parts (no kit has one): mast, jib, weights, cab and hook. */
function crane(x: number, y: number, z: number): PartDef[] {
  const Y = "#f2b705", G = "#59606e";
  const b = (p: [number, number, number], s: [number, number, number], c: string, shape: Shape = "box"): PartDef => ({ s: shape, p: [r2(x + p[0]), r2(y + p[1]), r2(z + p[2])], z: s, c });
  return [
    b([0, 1, 0], [6, 2, 6], G), b([0, 17, 0], [2, 30, 2], Y), b([10, 32.8, 0], [28, 1.6, 1.6], Y),
    b([-7, 32.8, 0], [8, 1.6, 1.6], Y), b([-9.5, 30.6, 0], [3, 3, 2.4], G), b([1.8, 30.4, 0], [2.6, 2.6, 2.6], "#e8e8e8"),
    b([18, 24.2, 0], [0.5, 16, 0.5], "#30333a", "cyl"), b([18, 15.6, 0], [1.4, 1.4, 1.4], "#30333a"),
  ];
}

type Clip = { parts: PartDef[]; objs: ObjDef[] };
const CLIP = "hexdrift.studio.clip";

export function Studio({ id, sb, me }: { id: string; sb: SupabaseClient | null; me: string }) {
  const [map, setMapState] = useState<CustomMap | null>(() => myMap(id));
  const undo = useRef<CustomMap[]>([]);
  const redo = useRef<CustomMap[]>([]);
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState<Pick[]>([]);
  const [piece, setPiece] = useState(0);
  const [tab, setTab] = useState<"road" | "map" | "insert">("road");
  const [tool, setTool] = useState<Tool>("select");
  const [snapMove, setSnapMove] = useState(1);
  const [snapTurn, setSnapTurn] = useState(15);
  const [brush, setBrush] = useState<Brush>("raise");
  const [brushR, setBrushR] = useState(16);
  const [brushK, setBrushK] = useState(1.5);
  const [paint, setPaint] = useState<keyof typeof LAND>("grass");
  const [filter, setFilter] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<StudioView | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  const check = useMemo(() => map ? checkMap(map) : null, [map]);

  const commit = useCallback((next: CustomMap, keepPiece?: number) => {
    next = { ...next, updated: Date.now() };
    setMapState((cur) => {
      if (cur) { undo.current.push(cur); if (undo.current.length > 100) undo.current.shift(); }
      redo.current = [];
      return next;
    });
    if (!saveMap(next)) setMsg("This device's storage is full: the change isn't saved.");
    if (keepPiece !== undefined) setPiece(keepPiece);
  }, []);
  const back = useCallback((from: React.RefObject<CustomMap[]>, to: React.RefObject<CustomMap[]>) => {
    setMapState((cur) => {
      const prev = from.current.pop();
      if (!prev || !cur) return cur;
      to.current.push(cur);
      saveMap(prev);
      setPiece((s) => Math.min(s, Math.max(0, prev.pieces.length - 1)));
      setSel((l) => l.filter((p) => p.i < (p.kind === "part" ? prev.parts?.length ?? 0 : prev.objs?.length ?? 0)));
      return prev;
    });
  }, []);
  const ops = usePieceOps(map, piece, commit, setMsg);

  // ── The 3D view ──
  const handlers = useRef({
    pick: (_p: Pick | null, _add: boolean) => {},
    moved: (_p: Pick, _pos: [number, number, number], _rot: [number, number, number], _size: [number, number, number] | null) => {},
    brush: (_ph: "start" | "move" | "end", _x: number, _z: number) => {},
  });
  useEffect(() => {
    const v = new StudioView(host.current!, {
      pick: (p, add) => handlers.current.pick(p, add),
      moved: (p, pos, rot, size) => handlers.current.moved(p, pos, rot, size),
      brush: (ph, x, z) => handlers.current.brush(ph, x, z),
    });
    view.current = v;
    if (mapRef.current) v.setMap(mapRef.current);
    return () => { v.dispose(); view.current = null; };
  }, []);
  useEffect(() => { if (map) view.current?.setMap(map); }, [map]);
  useEffect(() => { view.current?.setSel(sel); }, [sel, map]);
  useEffect(() => { view.current?.setTool(tool); }, [tool]);
  useEffect(() => { view.current?.setSnap(snapMove, snapTurn); }, [snapMove, snapTurn]);
  useEffect(() => { view.current?.setBrush(brushR); }, [brushR]);

  handlers.current.pick = (p, add) => {
    if (!p) { if (!add) setSel([]); return; }
    setSel((l) => {
      const has = l.some((q) => q.kind === p.kind && q.i === p.i);
      if (!add) return [p];
      return has ? l.filter((q) => !(q.kind === p.kind && q.i === p.i)) : [...l, p];
    });
  };
  handlers.current.moved = (p, pos, rot, size) => {
    const m = mapRef.current;
    if (!m) return;
    const R = PART_LIMITS.reach;
    if (p.kind === "part") {
      const parts = (m.parts ?? []).map((d, i) => {
        if (i !== p.i) return d;
        const q: PartDef = { ...d, p: [clamp(pos[0], -R, R), clamp(pos[1], -500, 1500), clamp(pos[2], -R, R)] };
        if (rot.some((a) => a)) q.r = rot; else delete q.r;
        if (size) q.z = size.map((s) => clamp(s, PART_LIMITS.minSize, PART_LIMITS.size)) as [number, number, number];
        return q;
      });
      commit({ ...m, parts });
    } else {
      const objs = (m.objs ?? []).map((d, i) => {
        if (i !== p.i) return d;
        const q: ObjDef = { ...d, p: [clamp(pos[0], -R, R), clamp(pos[2], -R, R)] };
        const r = Math.round(((rot[0] % 360) + 360) % 360 * 10) / 10, y = clamp(pos[1], -50, 300);
        if (r) q.r = r; else delete q.r;
        if (Math.abs(y) > 0.05) q.y = r2(y); else delete q.y;
        return q;
      });
      commit({ ...m, objs });
    }
  };

  // ── The terrain brush: a stroke edits a working copy, saved when you let go ──
  const stroke = useRef<{ h: Map<string, number>; m: Map<string, number>; last: [number, number] | null; level: number; t: number } | null>(null);
  handlers.current.brush = (ph, x, z) => {
    const m = mapRef.current;
    if (!m) return;
    if (ph === "start") {
      const h = new Map<string, number>(), mm = new Map<string, number>();
      for (const [i, j, v] of m.terrain?.h ?? []) h.set(`${i},${j}`, v);
      for (const [i, j, v] of m.terrain?.m ?? []) mm.set(`${i},${j}`, v);
      stroke.current = { h, m: mm, last: null, level: h.get(`${Math.round(x / SCULPT)},${Math.round(z / SCULPT)}`) ?? 0, t: 0 };
    }
    const S = stroke.current;
    if (!S) return;
    if (ph !== "end" && (!S.last || Math.hypot(x - S.last[0], z - S.last[1]) > brushR / 4)) {
      S.last = [x, z];
      dab(S, x, z);
      const now = performance.now();
      // A preview now and then while dragging (building the world takes a moment).
      if (now - S.t > 450) { S.t = now; view.current?.setMap({ ...m, terrain: sculptOf(S) }); }
    }
    if (ph === "end") {
      stroke.current = null;
      const t = sculptOf(S);
      if ((t.h?.length ?? 0) + (t.m?.length ?? 0) > LIMITS.sculpt * 2 || (t.h?.length ?? 0) > LIMITS.sculpt || (t.m?.length ?? 0) > LIMITS.sculpt) { setMsg("That's as much land shaping as a map can hold."); view.current?.setMap(m); return; }
      commit({ ...m, terrain: t.h || t.m ? t : undefined });
    }
  };
  const dab = (S: NonNullable<typeof stroke.current>, x: number, z: number) => {
    const r = brushR, n = Math.ceil(r / SCULPT), ci = Math.round(x / SCULPT), cj = Math.round(z / SCULPT);
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
      const d = Math.hypot(i * SCULPT - x, j * SCULPT - z);
      if (d > r) continue;
      const w = (1 - (d / r) ** 2) ** 2, k = `${i},${j}`;
      if (brush === "paint") { S.m.set(k, LAND[paint]); continue; }
      const h = S.h.get(k) ?? 0;
      let v = h;
      if (brush === "raise") v = h + brushK * w;
      else if (brush === "lower") v = h - brushK * w;
      else if (brush === "flatten") v = h + (S.level - h) * Math.min(1, w * brushK * 0.5);
      else {
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => S.h.get(`${i + a},${j + b}`) ?? 0);
        v = h + ((nb[0] + nb[1] + nb[2] + nb[3]) / 4 - h) * Math.min(1, w * brushK * 0.5);
      }
      S.h.set(k, clamp(Math.round(v * 4) / 4, -60, 60));
    }
  };
  const sculptOf = (S: NonNullable<typeof stroke.current>): Sculpt => {
    const h: [number, number, number][] = [], mm: [number, number, number][] = [];
    for (const [k, v] of S.h) if (v) { const [i, j] = k.split(",").map(Number); h.push([i, j, v]); }
    for (const [k, v] of S.m) { const [i, j] = k.split(",").map(Number); mm.push([i, j, v]); }
    return { ...(h.length ? { h } : {}), ...(mm.length ? { m: mm } : {}) };
  };

  // ── Changing parts and objects ──
  const last = sel[sel.length - 1];
  const editPart = useCallback((i: number, ch: Partial<PartDef>) => {
    const m = mapRef.current;
    if (!m?.parts?.[i]) return;
    const q: PartDef = { ...m.parts[i], ...ch };
    for (const k of Object.keys(ch) as (keyof PartDef)[]) if (ch[k] === undefined) delete q[k];
    commit({ ...m, parts: m.parts.map((d, j) => (j === i ? q : d)) });
  }, [commit]);
  const editObj = useCallback((i: number, ch: Partial<ObjDef>) => {
    const m = mapRef.current;
    if (!m?.objs?.[i]) return;
    const q: ObjDef = { ...m.objs[i], ...ch };
    for (const k of Object.keys(ch) as (keyof ObjDef)[]) if (ch[k] === undefined) delete q[k];
    commit({ ...m, objs: m.objs.map((d, j) => (j === i ? q : d)) });
  }, [commit]);

  /** Adds parts and objects (selecting them), at most up to the limits. */
  const insert = useCallback((parts: PartDef[], objs: ObjDef[], folder?: string) => {
    const m = mapRef.current;
    if (!m) return;
    const np = m.parts?.length ?? 0, no = m.objs?.length ?? 0;
    if (np + parts.length > PART_LIMITS.count) { setMsg(`At most ${PART_LIMITS.count} parts.`); return; }
    if (no + objs.length > LIMITS.objs) { setMsg(`At most ${LIMITS.objs} objects.`); return; }
    let folders = m.folders;
    let f: number | undefined;
    if (folder) {
      if ((folders?.length ?? 0) >= LIMITS.folders) { setMsg(`At most ${LIMITS.folders} folders.`); return; }
      folders = [...(folders ?? []), { name: folder }];
      f = folders.length - 1;
    }
    const tag = <T extends { f?: number }>(d: T): T => (f === undefined ? d : { ...d, f });
    commit({
      ...m, folders,
      parts: parts.length ? [...(m.parts ?? []), ...parts.map(tag)] : m.parts,
      objs: objs.length ? [...(m.objs ?? []), ...objs.map(tag)] : m.objs,
    });
    setSel([...parts.map((_, k) => ({ kind: "part" as const, i: np + k })), ...objs.map((_, k) => ({ kind: "obj" as const, i: no + k }))]);
    if (tool === "select" || tool === "terrain") setTool("move");
  }, [commit, tool]);

  const here = () => {
    const v = view.current;
    const [tx, , tz] = v?.target() ?? [0, 0, 0];
    const s = snapMove || 1;
    const x = Math.round(tx / s) * s, z = Math.round(tz / s) * s;
    return [x, v?.groundY(x, z) ?? 0, z] as const;
  };
  const addPart = (s: Shape) => {
    const [x, y, z] = here(), sz = SIZES[s];
    insert([{ s, p: [r2(x), r2(y + sz[1] / 2), r2(z)], z: [...sz] }], []);
  };
  const addObj = (o: string) => { const [x, , z] = here(); insert([], [{ o, p: [r2(x), r2(z)] }]); };
  const addCrane = () => { const [x, y, z] = here(); insert(crane(x, y, z), [], "Crane"); };

  const removeSel = useCallback(() => {
    const m = mapRef.current;
    if (!m || !sel.length) return;
    const dp = new Set(sel.filter((p) => p.kind === "part").map((p) => p.i)), dob = new Set(sel.filter((p) => p.kind === "obj").map((p) => p.i));
    commit({ ...m, parts: m.parts?.filter((_, i) => !dp.has(i)), objs: m.objs?.filter((_, i) => !dob.has(i)) });
    setSel([]);
  }, [sel, commit]);
  const clipOf = (): Clip | null => {
    const m = mapRef.current;
    if (!m || !sel.length) return null;
    return { parts: sel.filter((p) => p.kind === "part").map((p) => m.parts![p.i]), objs: sel.filter((p) => p.kind === "obj").map((p) => m.objs![p.i]) };
  };
  const shifted = (c: Clip, dx: number, dz: number): Clip => ({
    parts: c.parts.map((d) => ({ ...d, p: [r2(d.p[0] + dx), d.p[1], r2(d.p[2] + dz)] })),
    objs: c.objs.map((d) => ({ ...d, p: [r2(d.p[0] + dx), r2(d.p[1] + dz)] })),
  });
  const copy = () => { const c = clipOf(); if (!c) return; try { localStorage.setItem(CLIP, JSON.stringify(c)); } catch { /* storage full: nothing to keep */ } setMsg(`Copied ${c.parts.length + c.objs.length}.`); };
  const paste = () => {
    let c: Clip | null = null;
    try { c = JSON.parse(localStorage.getItem(CLIP) ?? "null"); } catch { c = null; }
    if (!c || !Array.isArray(c.parts) || !Array.isArray(c.objs)) return;
    // Pasted where the camera looks (another map, or further along this one).
    const all = [...c.parts.map((d) => [d.p[0], d.p[2]]), ...c.objs.map((d) => d.p)];
    if (!all.length) return;
    const cx = all.reduce((a, p) => a + p[0], 0) / all.length, cz = all.reduce((a, p) => a + p[1], 0) / all.length;
    const [x, , z] = here();
    const kit = KITS[THEMES[mapRef.current!.theme].kit] ?? {};
    // On top of the originals: put it a step aside instead.
    const on = Math.abs(x - cx) < 1 && Math.abs(z - cz) < 1, step = on ? snapMove || 2 : 0;
    const s = shifted(c, x - cx + step, z - cz + step);
    insert(s.parts.map(({ f: _f, ...d }) => d), s.objs.filter((o) => Object.hasOwn(kit, o.o)).map(({ f: _f, ...d }) => d));
  };
  const dup = () => { const c = clipOf(); if (!c) return; const s = shifted(c, snapMove || 2, snapMove || 2); insert(s.parts, s.objs); };
  const focusSel = () => {
    const m = mapRef.current;
    if (!m || !last) return;
    if (last.kind === "part") { const d = m.parts![last.i]; view.current?.focus(d.p[0], d.p[1], d.p[2], Math.max(20, Math.max(...d.z) * 3)); }
    else { const d = m.objs![last.i]; view.current?.focus(d.p[0], view.current.groundY(d.p[0], d.p[1]), d.p[1], 40); }
  };

  // ── Folders ──
  const folderOf = (p: Pick) => (p.kind === "part" ? map?.parts?.[p.i]?.f : map?.objs?.[p.i]?.f);
  const setFolder = (f: number | undefined) => {
    const m = mapRef.current;
    if (!m) return;
    const ps = new Set(sel.filter((p) => p.kind === "part").map((p) => p.i)), os = new Set(sel.filter((p) => p.kind === "obj").map((p) => p.i));
    const put = <T extends { f?: number }>(d: T): T => { const q = { ...d }; if (f === undefined) delete q.f; else q.f = f; return q; };
    commit({ ...m, parts: m.parts?.map((d, i) => (ps.has(i) ? put(d) : d)), objs: m.objs?.map((d, i) => (os.has(i) ? put(d) : d)) });
  };
  const newFolder = () => {
    const m = mapRef.current;
    if (!m) return;
    if ((m.folders?.length ?? 0) >= LIMITS.folders) { setMsg(`At most ${LIMITS.folders} folders.`); return; }
    const folders = [...(m.folders ?? []), { name: `Folder ${(m.folders?.length ?? 0) + 1}` }];
    const f = folders.length - 1;
    const ps = new Set(sel.filter((p) => p.kind === "part").map((p) => p.i)), os = new Set(sel.filter((p) => p.kind === "obj").map((p) => p.i));
    commit({ ...m, folders, parts: m.parts?.map((d, i) => (ps.has(i) ? { ...d, f } : d)), objs: m.objs?.map((d, i) => (os.has(i) ? { ...d, f } : d)) });
  };
  const editFolder = (k: number, ch: Partial<Folder>) => {
    const m = mapRef.current;
    if (!m?.folders) return;
    commit({ ...m, folders: m.folders.map((f, i) => (i === k ? { ...f, ...ch } : f)) });
  };
  const dropFolder = (k: number) => {
    const m = mapRef.current;
    if (!m?.folders) return;
    const fix = <T extends { f?: number }>(d: T): T => {
      if (d.f === undefined || d.f < k) return d;
      const q = { ...d };
      if (d.f === k) delete q.f; else q.f = d.f - 1;
      return q;
    };
    const folders = m.folders.filter((_, i) => i !== k);
    commit({ ...m, folders: folders.length ? folders : undefined, parts: m.parts?.map(fix), objs: m.objs?.map(fix) });
  };

  // ── Keys ──
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) back(redo, undo); else back(undo, redo); return; }
    if (mod && k === "y") { e.preventDefault(); back(redo, undo); return; }
    if (mod && k === "c") { e.preventDefault(); copy(); return; }
    if (mod && k === "v") { e.preventDefault(); paste(); return; }
    if (mod && k === "d") { e.preventDefault(); dup(); return; }
    if (mod && k === "g") { e.preventDefault(); if (sel.length) newFolder(); return; }
    if (mod || e.altKey) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel.length) { e.preventDefault(); removeSel(); } return; }
    if (e.key === "Escape") { setSel([]); return; }
    if (k === "f") { focusSel(); return; }
    const t = TOOLS.find(([, , key]) => key.toLowerCase() === k);
    if (t) setTool(t[0]);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // ── Community Maps ──
  const [pub, setPub] = useState<{ id: string; version: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => {
    if (!sb || !me) return;
    let alive = true;
    void publishedOf(sb, me, id).then((p) => { if (alive) setPub(p); }).catch(() => {});
    return () => { alive = false; };
  }, [sb, me, id]);
  const publish = async () => {
    if (!sb || !map) return;
    setPublishing(true);
    const r = await publishMap(sb, map);
    setPublishing(false);
    if (r.ok) { setPub({ id: r.id, version: versionOf(map) }); setMsg(r.updated ? (r.changed ? "Updated. The road changed, so its leaderboard starts fresh." : "Updated.") : "Published! It's in Community Maps now."); }
    else setMsg(r.error);
  };
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(t); }, [msg]);

  if (!map || !check) {
    return <div className="hx-menu"><a className="hx-back" href="#/hexdrift/editor"><IconBack /> My maps</a><p>That map isn't on this device.</p></div>;
  }
  const author = authorOf(map);
  const broken = !check.road;
  const kit = KITS[THEMES[map.theme].kit] ?? {};
  const kitNames = Object.keys(kit).filter((o) => o !== "stand" && pretty(o).toLowerCase().includes(filter.toLowerCase()));
  const driveHere = () => {
    const s = view.current?.spotHere();
    if (!s) return;
    location.hash = `#/hexdrift/test/${map.id}?from=${[s.x, s.y, s.z, s.yaw].map((v) => Math.round(v * 1000) / 1000).join(",")}`;
  };
  const share = async () => {
    const code = encodeMap(map);
    try { await navigator.clipboard.writeText(code); setMsg("Map code copied. Anyone can add it under My maps."); }
    catch { window.prompt("Copy this map code:", code); }
  };
  const isSel = (kind: Pick["kind"], i: number) => sel.some((p) => p.kind === kind && p.i === i);
  const clickItem = (p: Pick, e: React.MouseEvent) => handlers.current.pick(p, e.shiftKey || e.ctrlKey || e.metaKey);
  const items = (f: number | undefined) => [
    ...(map.parts ?? []).flatMap((d, i) => (d.f === f ? [{ p: { kind: "part", i } as Pick, name: `${SHAPE_NAMES[d.s]}${d.m && d.m !== "solid" ? ` · ${MAT_NAMES[d.m]}` : ""}`, dot: d.m && d.m !== "solid" ? MAT_COLOR[d.m] : d.c ?? MAT_COLOR.solid }] : [])),
    ...(map.objs ?? []).flatMap((d, i) => (d.f === f ? [{ p: { kind: "obj", i } as Pick, name: pretty(d.o), dot: "" }] : [])),
  ];
  const Item = ({ it }: { it: ReturnType<typeof items>[number] }) => (
    <li>
      <button type="button" className={`hx-st-item ${isSel(it.p.kind, it.p.i) ? "on" : ""}`} onClick={(e) => clickItem(it.p, e)} onDoubleClick={focusSel}>
        <span className={`hx-st-dot ${it.p.kind}`} style={it.dot ? { background: it.dot } : undefined} />{it.name}
      </button>
    </li>
  );
  const lastPart = last?.kind === "part" ? map.parts?.[last.i] : undefined;
  const lastObj = last?.kind === "obj" ? map.objs?.[last.i] : undefined;
  const env = map.env ?? {};
  const setEnv = (ch: Partial<typeof env>) => {
    const e = { ...env, ...ch };
    for (const k of Object.keys(ch) as (keyof typeof env)[]) if (ch[k] === undefined) delete e[k];
    commit({ ...map, env: Object.keys(e).length ? e : undefined });
  };

  return (
    <div className="hx-st">
      <header className="hx-st-bar">
        <a className="hx-icon" href="#/hexdrift/editor" aria-label="My maps" title="My maps"><IconBack /></a>
        <input className="hx-ed-name" value={map.name} maxLength={LIMITS.nameLen} aria-label="Map name"
          onChange={(e) => { const next = { ...map, name: e.target.value }; setMapState(next); saveMap(next); }} />
        <div className="hx-st-tools" role="toolbar" aria-label="Tools">
          {TOOLS.map(([t, name, key]) => (
            <button key={t} type="button" className={`hx-chip-btn ${tool === t ? "on" : ""}`} aria-pressed={tool === t} title={`${name} (${key})`} onClick={() => setTool(t)}>{name}</button>
          ))}
        </div>
        <label className="hx-st-snap" title="Move snap">Snap
          <select value={snapMove} onChange={(e) => setSnapMove(Number(e.target.value))} aria-label="Move snap">
            {MOVE_SNAPS.map((v) => <option key={v} value={v}>{v ? `${v} m` : "Off"}</option>)}
          </select>
          <select value={snapTurn} onChange={(e) => setSnapTurn(Number(e.target.value))} aria-label="Turn snap">
            {TURN_SNAPS.map((v) => <option key={v} value={v}>{v ? `${v}°` : "Off"}</option>)}
          </select>
        </label>
        <button type="button" className="hx-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={() => back(undo, redo)}>↶</button>
        <button type="button" className="hx-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!redo.current.length} onClick={() => back(redo, undo)}>↷</button>
        <button type="button" className="hx-btn" disabled={broken} onClick={driveHere} title="A practice run from the road nearest the middle of the view (not timed)">Drive from here</button>
        <a className={`hx-btn hx-btn-main ${broken ? "hx-off" : ""}`} href={broken ? undefined : `#/hexdrift/test/${map.id}`} aria-disabled={broken}>Drive</a>
      </header>

      <aside className="hx-st-left" aria-label="Explorer">
        <div className="hx-st-head"><strong>Explorer</strong>
          <button type="button" className="hx-linkbtn" onClick={newFolder} title="New folder (Ctrl+G puts the selection in one)">+ Folder</button>
        </div>
        <ul className="hx-st-tree">
          <li><button type="button" className={`hx-st-item ${tab === "road" && !sel.length ? "on" : ""}`} onClick={() => { setSel([]); setTab("road"); }}><span className="hx-st-dot road" />Road ({map.pieces.length} pieces)</button></li>
          <li><button type="button" className={`hx-st-item ${tab === "map" && !sel.length ? "on" : ""}`} onClick={() => { setSel([]); setTab("map"); }}><span className="hx-st-dot sky" />Sky and land</button></li>
          {(map.folders ?? []).map((f, k) => (
            <li key={`f${k}`} className="hx-st-folder">
              <div className="hx-st-frow">
                <button type="button" className="hx-st-twist" aria-label={f.open === false ? "Open folder" : "Close folder"} onClick={() => editFolder(k, { open: f.open === false ? undefined : false })}>{f.open === false ? "▸" : "▾"}</button>
                <input value={f.name} aria-label="Folder name" maxLength={32} onChange={(e) => { const m = mapRef.current!; const next = { ...m, folders: m.folders!.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)) }; setMapState(next); saveMap(next); }} />
                {sel.length > 0 && <button type="button" className="hx-linkbtn" onClick={() => setFolder(k)} title="Put the selection in this folder">Put in</button>}
                <button type="button" className="hx-linkbtn hx-danger" aria-label="Remove folder (keeps what's in it)" title="Remove folder (keeps what's in it)" onClick={() => dropFolder(k)}>✕</button>
              </div>
              {f.open !== false && <ul>{items(k).map((it) => <Item key={`${it.p.kind}${it.p.i}`} it={it} />)}</ul>}
            </li>
          ))}
          {items(undefined).map((it) => <Item key={`${it.p.kind}${it.p.i}`} it={it} />)}
        </ul>
        <button type="button" className={`hx-btn hx-st-insert ${tab === "insert" ? "on" : ""}`} onClick={() => { setTab("insert"); setSel([]); }}>+ Insert</button>
      </aside>

      <div className="hx-st-view" ref={host}>
        {broken && <p className="hx-st-warn">This road can't be built: {check.problems[0]?.text}</p>}
        <p className="hx-st-hint">Drag to orbit · right-drag to pan · scroll to zoom{tool === "terrain" ? " · Alt+drag to orbit while shaping" : " · click to pick, Shift+click to add"}</p>
      </div>

      <aside className="hx-st-right" aria-label="Properties">
        <div className="hx-ed-info">
          <span>{(check.length / 1000).toFixed(2)} km · {map.pieces.filter((q) => q.k === "C").length} CP · {map.parts?.length ?? 0} parts · {map.objs?.length ?? 0} objects</span>
          <span>{author ? <>Author {formatTime(author.ticks)} · Gold {formatTime(medalsOf(author.ticks).gold)}</> : "Drive to the finish to set the author time"}</span>
        </div>
        {check.problems.length > 0 && (
          <ul className="hx-ed-problems" role="status">
            {check.problems.slice(0, 3).map((q, i) => (
              <li key={i}>{q.piece >= 0 ? <button type="button" onClick={() => { setSel([]); setTab("road"); setPiece(q.piece); }}>Piece {q.piece + 1}</button> : null} {q.text}</li>
            ))}
          </ul>
        )}

        {tool === "terrain" ? (
          <section className="hx-st-props">
            <h2>Terrain</h2>
            <Chips label="Brush" values={BRUSHES} value={brush} onPick={setBrush} />
            <Slider label="Size" value={brushR} min={8} max={80} step={4} unit=" m" onChange={setBrushR} />
            {brush !== "paint" && <Slider label="Strength" value={brushK} min={0.25} max={4} step={0.25} onChange={setBrushK} />}
            {brush === "paint" && <Chips label="Ground" values={LAND_NAMES.map((n) => [pretty(n), n])} value={paint} onPick={setPaint} />}
            <p className="hx-dim hx-small">Drag on the land. The road keeps its own height: shape the land around it. Flatten levels to where you start.</p>
            {(map.terrain?.h?.length || map.terrain?.m?.length) ? <button type="button" className="hx-btn hx-danger" onClick={() => commit({ ...map, terrain: undefined })}>Reset the land</button> : null}
          </section>
        ) : sel.length > 1 ? (
          <section className="hx-st-props">
            <h2>{sel.length} selected</h2>
            <div className="hx-row">
              <button type="button" className="hx-btn" onClick={dup}>Duplicate</button>
              <button type="button" className="hx-btn" onClick={copy}>Copy</button>
              <button type="button" className="hx-btn hx-danger" onClick={removeSel}>Delete</button>
            </div>
            <FolderPick folders={map.folders} value={folderOf(last)} onPick={setFolder} />
            <p className="hx-dim hx-small">The handles move the one picked last.</p>
          </section>
        ) : lastPart ? (
          <section className="hx-st-props">
            <div className="hx-ed-head"><h2>{SHAPE_NAMES[lastPart.s]}</h2>
              <span>
                <button type="button" className="hx-icon" aria-label="Duplicate" title="Duplicate (Ctrl+D)" onClick={dup}>⧉</button>
                <button type="button" className="hx-icon hx-danger" aria-label="Delete" title="Delete" onClick={removeSel}>✕</button>
              </span>
            </div>
            <Chips label="Shape" values={SHAPES.map((s) => [SHAPE_NAMES[s], s])} value={lastPart.s} onPick={(s) => editPart(last.i, { s })} />
            <Vec label="Position" v={lastPart.p} step={snapMove || 0.5} onSet={(p) => editPart(last.i, { p })} />
            <Vec label="Size" v={lastPart.z} step={0.5} min={PART_LIMITS.minSize} max={PART_LIMITS.size} onSet={(z) => editPart(last.i, { z })} />
            <Vec label="Turn" names={["Yaw", "Pitch", "Roll"]} v={lastPart.r ?? [0, 0, 0] as [number, number, number]} step={snapTurn || 1} min={-360} max={360} onSet={(r) => editPart(last.i, { r: r.some((a) => a) ? r : undefined })} />
            <Chips label="Physics" values={MATS.map((m) => [MAT_NAMES[m], m])} value={lastPart.m ?? "solid"} onPick={(m) => editPart(last.i, { m: m === "solid" ? undefined : m })} />
            {(lastPart.m ?? "solid") === "solid" && (
              <label className="hx-ed-row"><span className="hx-dim">Colour</span>
                <input type="color" value={lastPart.c ?? MAT_COLOR.solid} onChange={(e) => editPart(last.i, { c: e.target.value.toLowerCase() })} />
              </label>
            )}
            <p className="hx-dim hx-small">{({ solid: "You can drive on it and bump into it.", bouncy: "Throws the car back.", ice: "Almost no grip.", boost: "Speeds you up while you're on it.", kill: "Touch it and you're back at the last checkpoint." } as Record<Mat, string>)[lastPart.m ?? "solid"]}</p>
            <FolderPick folders={map.folders} value={lastPart.f} onPick={setFolder} />
          </section>
        ) : lastObj ? (
          <section className="hx-st-props">
            <div className="hx-ed-head"><h2>{pretty(lastObj.o)}</h2>
              <span>
                <button type="button" className="hx-icon" aria-label="Duplicate" title="Duplicate (Ctrl+D)" onClick={dup}>⧉</button>
                <button type="button" className="hx-icon hx-danger" aria-label="Delete" title="Delete" onClick={removeSel}>✕</button>
              </span>
            </div>
            <Vec label="Position" names={["X", "Z"]} v={lastObj.p} step={snapMove || 0.5} onSet={(p) => editObj(last.i, { p })} />
            <Vec label="Heading and lift" names={["Heading", "Lift"]} v={[lastObj.r ?? 0, lastObj.y ?? 0]} step={snapTurn || 1} onSet={([r, y]) => editObj(last.i, { r: r ? clamp(r, -360, 360) : undefined, y: y ? clamp(y, -50, 300) : undefined })} />
            <label className="hx-ed-row"><span className="hx-dim">Object</span>
              <select value={lastObj.o} onChange={(e) => editObj(last.i, { o: e.target.value })}>
                {Object.keys(kit).map((o) => <option key={o} value={o}>{pretty(o)}</option>)}
              </select>
            </label>
            <p className="hx-dim hx-small">Stands on the ground. {kit[lastObj.o]?.solid === false ? "You can drive through it." : "It's solid."}</p>
            <FolderPick folders={map.folders} value={lastObj.f} onPick={setFolder} />
          </section>
        ) : tab === "insert" ? (
          <section className="hx-st-props">
            <h2>Insert</h2>
            <p className="hx-dim hx-small">New things go where the view is looking.</p>
            <div className="hx-ed-row"><span className="hx-dim">Parts</span>
              <div className="hx-ed-chips">{SHAPES.map((s) => <button key={s} type="button" className="hx-chip-btn" onClick={() => addPart(s)}>{SHAPE_NAMES[s]}</button>)}</div>
            </div>
            <div className="hx-ed-row"><span className="hx-dim">Ready-made</span>
              <div className="hx-ed-chips"><button type="button" className="hx-chip-btn" onClick={addCrane}>Crane</button></div>
            </div>
            <input className="hx-st-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${THEMES[map.theme].name} objects`} aria-label="Search objects" />
            <div className="hx-st-objs">
              {kitNames.map((o) => <button key={o} type="button" className="hx-chip-btn" onClick={() => addObj(o)}>{pretty(o)}</button>)}
              {!kitNames.length && <span className="hx-dim">Nothing by that name.</span>}
            </div>
          </section>
        ) : tab === "map" ? (
          <section className="hx-st-props">
            <h2>Sky and land</h2>
            <label className="hx-ed-row"><span className="hx-dim">Time</span>
              <input type="checkbox" checked={env.time !== undefined} onChange={(e) => setEnv({ time: e.target.checked ? 12 : undefined })} aria-label="Set the time of day" />
              {env.time !== undefined ? <input type="range" min={0} max={24} step={0.25} value={env.time} aria-label="Time of day" onChange={(e) => { const next = { ...map, env: { ...env, time: Number(e.target.value) } }; setMapState(next); }} onPointerUp={() => setEnv({ time: mapRef.current?.env?.time })} onKeyUp={() => setEnv({ time: mapRef.current?.env?.time })} /> : <span className="hx-dim">The theme's own</span>}
              {env.time !== undefined && <span className="hx-ed-val">{String(Math.floor(env.time)).padStart(2, "0")}:{String(Math.round((env.time % 1) * 60)).padStart(2, "0")}</span>}
            </label>
            <label className="hx-ed-row"><span className="hx-dim">Fog</span>
              <input type="checkbox" checked={env.fog !== undefined} onChange={(e) => setEnv({ fog: e.target.checked ? 0.5 : undefined })} aria-label="Set the fog" />
              {env.fog !== undefined ? <input type="range" min={0} max={1} step={0.05} value={env.fog} aria-label="Fog" onChange={(e) => { const next = { ...map, env: { ...env, fog: Number(e.target.value) } }; setMapState(next); }} onPointerUp={() => setEnv({ fog: mapRef.current?.env?.fog })} onKeyUp={() => setEnv({ fog: mapRef.current?.env?.fog })} /> : <span className="hx-dim">The theme's own</span>}
            </label>
            <Chips label="Weather" values={[["Theme's", "" as Weather | ""], ...WEATHERS.map((w) => [pretty(w), w] as [string, Weather])]} value={env.weather ?? ""} onPick={(w) => setEnv({ weather: w || undefined })} />
            <div className="hx-ed-row"><span className="hx-dim">Scenery</span>
              <button type="button" className={`hx-chip-btn ${map.scenery !== false ? "on" : ""}`} onClick={() => commit({ ...map, scenery: map.scenery === false ? undefined : false })}>{map.scenery !== false ? "Automatic" : "Only what I place"}</button>
            </div>
            <Chips label="Theme" values={THEME_IDS.map((t) => [THEMES[t].name, t])} value={map.theme} onPick={(t) => {
              // Objects from the old theme's kit don't exist in the new one.
              const k = KITS[THEMES[t].kit] ?? {};
              const objs = map.objs?.filter((o) => Object.hasOwn(k, o.o));
              if ((objs?.length ?? 0) < (map.objs?.length ?? 0) && !confirm("Objects that aren't in this theme will be removed.")) return;
              setSel([]);
              commit({ ...map, theme: t, objs: objs?.length ? objs : undefined });
            }} />
            <p className="hx-dim hx-small">Time, fog and weather only change how it looks. Land shaping is under the Terrain tool.</p>
          </section>
        ) : (
          <section className="hx-st-props hx-st-road">
            <h2>Road</h2>
            {map.grid ? <>
              <p className="hx-dim">This road is built from tiles ({map.grid.length} tiles).</p>
              <div className="hx-row">
                <a className="hx-btn" href={`#/hexdrift/editor/${map.id}/tiles`}>Edit tiles</a>
                <button type="button" className="hx-btn" onClick={() => { if (confirm("Edit it piece by piece from now on? The tile editor won't open it any more.")) commit({ ...map, grid: undefined }); }}>Edit as pieces</button>
              </div>
            </> : <>
              <RoadPanel map={map} sel={piece} setSel={setPiece} ops={ops} bad={new Set(check.problems.map((q) => q.piece))} wide />
              <a className="hx-linkbtn" href={`#/hexdrift/editor/${map.id}/simple`}>Open in the simple editor</a>
            </>}
          </section>
        )}

        <PublishBox map={map} signedIn={!!sb} author={!!author} problems={check.problems.length} pub={pub} publishing={publishing}
          onRate={(r) => { const next = { ...map, rating: r }; setMapState(next); saveMap(next); }} onPublish={() => void publish()} />
        <details className="hx-ed-more">
          <summary>Map settings</summary>
          <div className="hx-row">
            <button type="button" className="hx-btn" onClick={() => void share()}>Copy map code</button>
            <button type="button" className="hx-btn hx-danger" onClick={() => { if (confirm(`Delete “${map.name}”? This can't be undone.`)) { deleteMap(map.id); location.hash = "#/hexdrift/editor"; } }}>Delete map</button>
          </div>
          <p className="hx-dim hx-small">Keys: Q select · W move · E rotate · R resize · T terrain · F focus · Ctrl+C / Ctrl+V copy and paste · Ctrl+D duplicate · Ctrl+G folder · Delete · Ctrl+Z undo</p>
        </details>
      </aside>
      {msg && <div className="hx-toast" role="status">{msg}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit = "", onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="hx-ed-row"><span className="hx-dim">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="hx-ed-val">{value}{unit}</span>
    </label>
  );
}

/** A row of number boxes (x, y, z...): typed values are kept on Enter or leaving the box. */
function Vec<T extends number[]>({ label, v, names = ["X", "Y", "Z"], step, min = -1e5, max = 1e5, onSet }: { label: string; v: T; names?: string[]; step: number; min?: number; max?: number; onSet: (v: T) => void }) {
  return (
    <div className="hx-ed-row hx-st-vec"><span className="hx-dim">{label}</span>
      {v.map((x, k) => <NumBox key={k} name={names[k]} full={`${label} ${names[k]}`} value={x} step={step} onSet={(n) => { const out = [...v] as T; out[k] = r2(clamp(n, min, max)); onSet(out); }} />)}
    </div>
  );
}

function NumBox({ name, full, value, step, onSet }: { name: string; full: string; value: number; step: number; onSet: (v: number) => void }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const done = () => { const n = parseFloat(t); if (n === n && n !== value) onSet(n); else setT(String(value)); };
  return (
    <label className="hx-st-num"><span>{name}</span>
      <input type="number" step={step} value={t} aria-label={full} onChange={(e) => setT(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function FolderPick({ folders, value, onPick }: { folders: Folder[] | undefined; value: number | undefined; onPick: (f: number | undefined) => void }) {
  if (!folders?.length) return null;
  return (
    <label className="hx-ed-row"><span className="hx-dim">Folder</span>
      <select value={value ?? -1} onChange={(e) => onPick(Number(e.target.value) < 0 ? undefined : Number(e.target.value))}>
        <option value={-1}>None</option>
        {folders.map((f, k) => <option key={k} value={k}>{f.name}</option>)}
      </select>
    </label>
  );
}
