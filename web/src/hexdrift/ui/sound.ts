// Interface sounds, made live with WebAudio: no files to download, nothing to
// credit, and they play instantly even offline. Each sound is a few short
// oscillators and filtered noise bursts through one master bus with a soft
// compressor, so they sit together like one designed set.
//
// Browsers only allow audio after a user gesture, so the context is created
// on the first press and everything before that is silent.

import impactsUrl from "../sfx/impacts.mp3?url";
import uiUrl from "../sfx/ui.mp3?url";
import raceUrl from "../sfx/race.wav?url";
import crashUrl from "../sfx/crash.mp3?url";

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let bus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem("hexdrift.uiSound") === "off"; } catch { /* */ }

function audio(always = false): { c: Ctx; out: GainNode } | null {
  if (muted && !always) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { return null; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.002; comp.release.value = 0.12;
    bus = ctx.createGain();
    bus.gain.value = 0.55;
    bus.connect(comp).connect(ctx.destination);
    // One second of white noise, reused by every noisy sound.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  loadUi(ctx);
  return ctx.state === "closed" ? null : { c: ctx, out: bus! };
}

/** The audio context, once a gesture has unlocked it (shared with the game's sounds). */
export function audioContext(): { c: Ctx; out: GainNode } | null { return audio(); }
/** The same context even with interface sounds off (the music has its own switch). */
export function musicContext(): Ctx | null { return audio(true)?.c ?? null; }

// ── Recorded hits (Kenney's Impact Sounds, CC0) ──
// One small file holding every clip, fetched the first time a sound plays;
// until it's in, the synthesised versions stand in.
const SPRITE: Record<string, [number, number][]> = {
  hit_heavy: [[0.25, 0.1648], [0.6648, 0.3564], [1.2711, 0.1144], [1.6355, 0.204], [2.0895, 0.1309]],
  hit_light: [[2.4705, 0.5424], [3.2629, 0.6547], [4.1676, 0.4888]],
  metal: [[4.9064, 0.1558], [5.3122, 0.1714], [5.7336, 0.1309]],
  wood: [[6.1145, 0.3298], [6.6942, 0.3298], [7.274, 0.3298], [7.8538, 0.779], [8.8828, 0.779]],
  plastic: [[9.9118, 0.1611], [10.3229, 0.1146], [10.6875, 0.1611]],
  snow: [[11.0986, 0.3709], [11.7195, 0.3708], [12.3403, 0.3707]],
  land: [[12.961, 0.5268], [13.7378, 0.569], [14.5568, 0.5694]],
  glass: [[15.3763, 0.5405], [16.1667, 0.5405]],
};
let sprite: AudioBuffer | null = null;
let spriteLoading = false;
function loadSprite(c: Ctx) {
  if (sprite || spriteLoading) return;
  spriteLoading = true;
  fetch(impactsUrl).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { sprite = buf; })
    .catch(() => { spriteLoading = false; });
}
// ── Crashes and the engine start (CC0, see sfx/CREDITS.txt): a second small sheet ──
const CRASH: Record<string, [number, number][]> = {
  crash: [[0.05, 0.4484]], glass: [[0.6484, 0.6035], [1.4019, 0.7467]],
  debris: [[2.2986, 0.7722], [3.2207, 0.5815]], knock: [[3.9522, 0.2635], [4.3657, 0.2762], [4.7919, 0.2009]],
  start: [[5.1428, 1.8438]],
};
let crashBuf: AudioBuffer | null = null;
let crashLoading = false;
function loadCrash(c: Ctx) {
  if (crashBuf || crashLoading) return;
  crashLoading = true;
  fetch(crashUrl).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { crashBuf = buf; }).catch(() => { crashLoading = false; });
}
function crashClip(c: Ctx, out: AudioNode, name: string, vol: number, rate = 1, at = 0): boolean {
  if (!crashBuf) { loadCrash(c); return false; }
  const takes = CRASH[name];
  const [t, d] = takes[Math.floor(Math.random() * takes.length)];
  const s = c.createBufferSource(); s.buffer = crashBuf;
  s.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
  const g = c.createGain(); g.gain.value = vol;
  s.connect(g).connect(out);
  s.start(c.currentTime + at, Math.max(0, t - 0.01), d / s.playbackRate.value + 0.05);
  return true;
}

/** Fetches the recorded hits and race sounds ahead of a race (once the audio is unlocked). */
export function preloadSounds() { const a = audio(); if (a) { loadSprite(a.c); loadRace(a.c); loadCrash(a.c); } }

// ── Recorded interface sounds (Kenney's Interface Sounds, CC0) ──
const UI: Partial<Record<UiSound, [number, number, number]>> = {
  // start, length, volume
  hover: [0.15, 0.045, 0.25], click: [0.345, 0.0116, 0.7], confirm: [0.5066, 0.29, 0.6], back: [0.9464, 0.0914, 0.6],
  whoosh: [1.1879, 0.38, 0.5], toggle: [1.7178, 0.1364, 0.6], locked: [2.0042, 0.1045, 0.6], tick: [2.2587, 0.0203, 0.5],
  count: [2.429, 0.0404, 0.9], go: [2.6194, 0.539, 0.8], reveal: [3.3084, 0.2254, 0.6], medal: [3.6838, 0.4904, 0.8],
};
let uiBuf: AudioBuffer | null = null;
let uiLoading = false;
function loadUi(c: Ctx) {
  if (uiBuf || uiLoading) return;
  uiLoading = true;
  fetch(uiUrl).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { uiBuf = buf; }).catch(() => { uiLoading = false; });
}
function uiClip(c: Ctx, out: AudioNode, s: UiSound, k: number): boolean {
  const e = UI[s];
  if (!e) return false;
  if (!uiBuf) { loadUi(c); return false; }
  const src = c.createBufferSource(); src.buffer = uiBuf;
  if (s === "count") src.playbackRate.value = 0.9;
  const g = c.createGain(); g.gain.value = e[2] * k;
  src.connect(g).connect(out);
  src.start(c.currentTime, e[0], e[1] + 0.02);
  return true;
}

// ── Race sounds (engine loops, tyres, boost): one lossless sheet so loops are seamless ──
/** Where each clip sits in the race sheet: start and length (seconds). */
export const RACE_CLIPS = {
  e0: [0.1, 0.864082], e1: [1.064082, 0.666667], e2: [1.830748, 0.682585], e3: [2.613333, 0.616054],
  e4: [3.329388, 0.630839], e5: [4.060227, 0.629569], squeal: [4.789796, 3.0], boost: [7.889796, 0.341723], rush: [8.331519, 2.5],
  wind: [11.031519, 3.5],
} as const;
let raceBuf: AudioBuffer | null = null;
let raceLoading = false;
function loadRace(c: Ctx) {
  if (raceBuf || raceLoading) return;
  raceLoading = true;
  fetch(raceUrl).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { raceBuf = buf; }).catch(() => { raceLoading = false; });
}
/** The race sheet once loaded (starts loading it otherwise). */
export function raceSheet(): AudioBuffer | null { if (!raceBuf && ctx) loadRace(ctx); return raceBuf; }
/** Plays a random take of a recorded clip; false if they aren't loaded yet. */
function clip(c: Ctx, out: AudioNode, name: string, vol: number, rate = 1, at = 0): boolean {
  if (!sprite) { loadSprite(c); return false; }
  const takes = SPRITE[name];
  if (!takes) return false;
  const [t, d] = takes[Math.floor(Math.random() * takes.length)];
  const s = c.createBufferSource(); s.buffer = sprite;
  s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = c.createGain(); g.gain.value = vol;
  s.connect(g).connect(out);
  s.start(c.currentTime + at, Math.max(0, t - 0.01), d + 0.04);
  return true;
}

interface Tone { f: number; f2?: number; type?: OscillatorType; at?: number; dur: number; vol: number; attack?: number }
function tone(c: Ctx, out: AudioNode, t: Tone) {
  const t0 = c.currentTime + (t.at ?? 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = t.type ?? "sine";
  o.frequency.setValueAtTime(t.f, t0);
  if (t.f2) o.frequency.exponentialRampToValueAtTime(t.f2, t0 + t.dur);
  const a = t.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(t.vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);
  o.connect(g).connect(out);
  o.start(t0); o.stop(t0 + t.dur + 0.02);
}

interface Noise { at?: number; dur: number; vol: number; f: number; f2?: number; q?: number; type?: BiquadFilterType; attack?: number }
function noise(c: Ctx, out: AudioNode, n: Noise) {
  const t0 = c.currentTime + (n.at ?? 0);
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = n.type ?? "bandpass"; f.Q.value = n.q ?? 1.2;
  f.frequency.setValueAtTime(n.f, t0);
  if (n.f2) f.frequency.exponentialRampToValueAtTime(n.f2, t0 + n.dur);
  const g = c.createGain();
  const a = n.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(n.vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
  s.connect(f).connect(g).connect(out);
  s.start(t0, Math.random() * 0.5); s.stop(t0 + n.dur + 0.02);
}

export type UiSound = "hover" | "click" | "confirm" | "back" | "whoosh" | "toggle" | "locked" | "tick" | "count" | "go" | "reveal" | "medal"
  // In the race (synthesised for now; recorded sounds come with the sound pass):
  | "impact" | "crash" | "start" | "land" | "checkpoint" | "boost" | "finish"
  | "smash-metal" | "smash-wood" | "smash-plastic" | "smash-snow";

let lastHover = 0;
/** Plays one sound (k: 0..1, how hard, for impacts). Cheap enough to call on every press. */
export function play(s: UiSound, k = 1) {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  if (s === "hover") { const now = performance.now(); if (now - lastHover < 45) return; lastHover = now; }
  if (uiClip(c, out, s, 1)) return;
  switch (s) {
    case "hover": {
      tone(c, out, { f: 2400, f2: 2100, type: "sine", dur: 0.035, vol: 0.05 });
      break;
    }
    case "tick": tone(c, out, { f: 1800, type: "triangle", dur: 0.03, vol: 0.06 }); break;
    case "click":
      // A tight mechanical click: noise transient + a short pitched body.
      noise(c, out, { dur: 0.025, vol: 0.32, f: 3800, q: 0.8 });
      tone(c, out, { f: 520, f2: 260, type: "triangle", dur: 0.07, vol: 0.22 });
      break;
    case "confirm":
      noise(c, out, { dur: 0.03, vol: 0.25, f: 4200, q: 0.8 });
      tone(c, out, { f: 660, type: "triangle", dur: 0.12, vol: 0.18 });
      tone(c, out, { f: 990, type: "sine", at: 0.06, dur: 0.22, vol: 0.16 });
      tone(c, out, { f: 1320, type: "sine", at: 0.11, dur: 0.3, vol: 0.1 });
      break;
    case "back":
      noise(c, out, { dur: 0.025, vol: 0.25, f: 2600, q: 0.8 });
      tone(c, out, { f: 600, f2: 340, type: "triangle", dur: 0.12, vol: 0.18 });
      break;
    case "toggle":
      tone(c, out, { f: 880, type: "square", dur: 0.04, vol: 0.05 });
      tone(c, out, { f: 1320, type: "square", at: 0.045, dur: 0.05, vol: 0.05 });
      break;
    case "locked":
      tone(c, out, { f: 220, type: "square", dur: 0.08, vol: 0.08 });
      tone(c, out, { f: 165, type: "square", at: 0.09, dur: 0.12, vol: 0.08 });
      break;
    case "whoosh":
      // A page transition: a filtered noise sweep with a low air swell.
      noise(c, out, { dur: 0.42, vol: 0.2, f: 500, f2: 3200, q: 0.9, attack: 0.12 });
      tone(c, out, { f: 90, f2: 160, type: "sine", dur: 0.38, vol: 0.12, attack: 0.1 });
      break;
    case "reveal":
      noise(c, out, { dur: 1.1, vol: 0.16, f: 300, f2: 2400, q: 0.7, attack: 0.5 });
      tone(c, out, { f: 55, f2: 82, type: "sawtooth", dur: 1.2, vol: 0.06, attack: 0.4 });
      tone(c, out, { f: 110, type: "sine", at: 0.9, dur: 0.9, vol: 0.12 });
      break;
    case "count":
      // Countdown: a punchy synth beep with a sub thump, not a voice.
      tone(c, out, { f: 740, type: "square", dur: 0.16, vol: 0.12 });
      tone(c, out, { f: 740, type: "sine", dur: 0.3, vol: 0.18 });
      tone(c, out, { f: 120, f2: 50, type: "sine", dur: 0.18, vol: 0.4 });
      break;
    case "go":
      tone(c, out, { f: 1480, type: "square", dur: 0.25, vol: 0.1 });
      tone(c, out, { f: 1480, type: "sine", dur: 0.6, vol: 0.2 });
      tone(c, out, { f: 2220, type: "sine", at: 0.02, dur: 0.5, vol: 0.08 });
      tone(c, out, { f: 140, f2: 45, type: "sine", dur: 0.3, vol: 0.5 });
      noise(c, out, { dur: 0.5, vol: 0.12, f: 1200, f2: 6000, q: 0.6, attack: 0.02 });
      break;
    case "impact": {
      // A body thump with a scrape of grit; louder and lower when harder.
      // Recorded metal on top: heavy crunches for big hits, knocks for taps.
      const v = 0.15 + 0.45 * k;
      const rec = clip(c, out, k > 0.45 ? "hit_heavy" : "hit_light", 0.35 + 0.55 * k, 1.05 - 0.2 * k);
      if (k > 0.25) crashClip(c, out, "knock", 0.25 + 0.4 * k, 1.1 - 0.3 * k);
      tone(c, out, { f: 95 + 60 * (1 - k), f2: 40, type: "sine", dur: 0.22, vol: v * (rec ? 0.7 : 1) });
      noise(c, out, { dur: 0.12 + 0.2 * k, vol: v * (rec ? 0.35 : 0.7), f: 900, f2: 300, q: 0.7 });
      if (!rec) noise(c, out, { dur: 0.05, vol: v * 0.5, f: 3200, q: 1 });
      break;
    }
    case "crash": {
      // A real car crash: the bang, then glass and bits of metal coming down.
      if (crashClip(c, out, "crash", 0.55 + 0.45 * k, 1.05 - 0.15 * k)) {
        if (k > 0.75) crashClip(c, out, "glass", 0.3 + 0.3 * k, 1, 0.06);
        crashClip(c, out, "debris", 0.25 + 0.3 * k, 1, 0.12);
      }
      clip(c, out, "hit_heavy", 0.5 * k, 0.85);
      tone(c, out, { f: 70, f2: 30, type: "sine", dur: 0.45, vol: 0.35 + 0.35 * k });
      noise(c, out, { dur: 0.4, vol: 0.25 * k, f: 700, f2: 200, q: 0.6 });
      break;
    }
    case "start":
      // The engine firing up on the grid.
      if (!crashClip(c, out, "start", 0.7)) tone(c, out, { f: 40, f2: 90, type: "sawtooth", dur: 0.9, vol: 0.06, attack: 0.2 });
      break;
    case "land": {
      const rec = clip(c, out, "land", 0.3 + 0.5 * k, 0.9);
      tone(c, out, { f: 70, f2: 38, type: "sine", dur: 0.2, vol: 0.2 + 0.35 * k });
      noise(c, out, { dur: 0.16, vol: (0.12 + 0.2 * k) * (rec ? 0.5 : 1), f: 500, f2: 200, q: 0.6 });
      break;
    }
    case "checkpoint":
      tone(c, out, { f: 1046, type: "triangle", dur: 0.14, vol: 0.14 });
      tone(c, out, { f: 1568, type: "sine", at: 0.06, dur: 0.32, vol: 0.13 });
      noise(c, out, { dur: 0.3, vol: 0.06, f: 6000, q: 0.6, attack: 0.02 });
      break;
    case "boost":
      if (raceBuf) { // the recorded thruster ignition, layered with a rising rush
        const [t, d] = RACE_CLIPS.boost;
        const src = c.createBufferSource(); src.buffer = raceBuf; src.playbackRate.value = 0.92 + Math.random() * 0.1;
        const g = c.createGain(); g.gain.value = 0.9;
        src.connect(g).connect(out); src.start(c.currentTime, t, d);
        noise(c, out, { dur: 0.7, vol: 0.12, f: 500, f2: 5000, q: 0.7, attack: 0.05 });
        break;
      }
      noise(c, out, { dur: 0.55, vol: 0.2, f: 400, f2: 4200, q: 0.8, attack: 0.04 });
      tone(c, out, { f: 120, f2: 360, type: "sawtooth", dur: 0.4, vol: 0.05, attack: 0.03 });
      break;
    case "finish":
      noise(c, out, { dur: 1.4, vol: 0.22, f: 2500, f2: 900, q: 0.4, attack: 0.05 }); // a crowd-ish roar
      tone(c, out, { f: 60, f2: 35, type: "sine", dur: 0.5, vol: 0.4 });
      break;
    case "smash-metal":
      if (clip(c, out, "metal", 0.35 + 0.4 * k)) { tone(c, out, { f: 1800 + 500 * Math.random(), type: "sine", dur: 0.4, vol: 0.03 + 0.03 * k }); break; }
      tone(c, out, { f: 640 + 300 * Math.random(), f2: 420, type: "square", dur: 0.25, vol: 0.05 + 0.06 * k });
      tone(c, out, { f: 1800 + 500 * Math.random(), type: "sine", dur: 0.5, vol: 0.05 + 0.05 * k });
      noise(c, out, { dur: 0.15, vol: 0.15 + 0.2 * k, f: 4000, q: 1.2 });
      break;
    case "smash-wood":
      if (clip(c, out, "wood", 0.4 + 0.4 * k)) break;
      noise(c, out, { dur: 0.09, vol: 0.25 + 0.25 * k, f: 1400, q: 1.5 });
      tone(c, out, { f: 240, f2: 120, type: "triangle", dur: 0.12, vol: 0.12 + 0.12 * k });
      noise(c, out, { at: 0.05, dur: 0.18, vol: 0.1, f: 2500, q: 1 });
      break;
    case "smash-plastic":
      if (clip(c, out, "plastic", 0.4 + 0.4 * k, 1.1)) break;
      tone(c, out, { f: 380, f2: 200, type: "triangle", dur: 0.1, vol: 0.14 + 0.1 * k });
      noise(c, out, { dur: 0.06, vol: 0.15, f: 2200, q: 1 });
      break;
    case "smash-snow":
      if (clip(c, out, "snow", 0.5 + 0.4 * k, 0.8)) break;
      noise(c, out, { dur: 0.3, vol: 0.22 + 0.2 * k, f: 1200, f2: 500, q: 0.5, attack: 0.01 });
      break;
    case "medal":
      [784, 988, 1175, 1568].forEach((f, i) => tone(c, out, { f, type: "triangle", at: i * 0.07, dur: 0.5, vol: 0.13 }));
      noise(c, out, { at: 0.2, dur: 0.6, vol: 0.06, f: 7000, q: 0.5 });
      break;
  }
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("hexdrift.uiSound", m ? "off" : "on"); } catch { /* */ }
}

/**
 * Feedback on every press in the game's menus: buttons, links, tabs and map
 * cards click; hovering with a mouse ticks softly. Elements can choose their
 * own sound with data-sound="confirm|back|toggle|locked|none".
 */
export function wireUiSounds(root: HTMLElement): () => void {
  const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.("button, a, [role=tab], [data-sound]") as HTMLElement | null;
  const down = (e: PointerEvent) => {
    const el = target(e);
    if (!el || el.closest(".hx-touch")) return;
    const s = el.dataset.sound as UiSound | "none" | undefined;
    if (s === "none") return;
    play(s ?? (el.classList.contains("hx-back") ? "back" : "click"));
  };
  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = target(e);
    if (!el || el.contains(e.relatedTarget as Node | null)) return;
    play("hover");
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = target(e);
    if (el && !el.closest(".hx-touch")) play((el.dataset.sound as UiSound) ?? "click");
  };
  root.addEventListener("pointerdown", down);
  root.addEventListener("pointerover", over);
  root.addEventListener("keydown", key);
  return () => {
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointerover", over);
    root.removeEventListener("keydown", key);
  };
}
