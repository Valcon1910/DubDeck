// Soundtracks, played live with WebAudio: no files to download, nothing to
// license. A small step sequencer schedules a little ahead of the clock
// (drums, bass, pad, arpeggio and lead), so timing stays exact even when a
// frame runs long. Two moods: a calm one for the menus and a driving one for
// races, each map picking its own key, chords and arpeggio from its id.
//
// It shares the interface sounds' audio context but has its own switch.

import { musicContext } from "./sound.ts";

export type Mood = "menu" | "race" | "none";

let on = true;
try { on = localStorage.getItem("hexdrift.music") !== "off"; } catch { /* */ }

let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let noise: AudioBuffer | null = null;
let timer = 0;
let mood: Mood = "none";
let seed = "";
let want: { mood: Mood; seed: string } = { mood: "none", seed: "" };
let wantTimer = 0;
let step = 0;
let nextAt = 0;
let song: Song | null = null;

interface Song { bpm: number; root: number; prog: number[][]; arp: number[]; drums: boolean; lead: number[]; swing: number }

// Chords as scale degrees of a natural minor key (0 = the root).
const PROGS = [
  [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3]], // i VI III VII
  [[0, 2, 4], [3, 5, 0], [5, 0, 2], [4, 6, 1]], // i iv VI v
  [[5, 0, 2], [6, 1, 3], [0, 2, 4], [0, 2, 4]], // VI VII i i
  [[0, 2, 4], [6, 1, 3], [5, 0, 2], [6, 1, 3]], // i VII VI VII
];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const ARPS = [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1]];

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

function makeSong(m: Mood, id: string): Song {
  const h = hash(m + id);
  const pick = <T,>(a: T[], k: number) => a[(h >>> k) % a.length];
  const prog = pick(PROGS, 3);
  // A short lead line per bar (scale degrees, -1 = rest).
  const lead: number[] = [];
  for (let i = 0; i < 16; i++) { const r = hash(id + i + m); lead.push(r % 5 < 2 ? -1 : [0, 2, 4, 6, 7][r % 5]); }
  return {
    bpm: m === "menu" ? 92 + (h % 8) : 116 + (h % 14),
    root: 45 + ((h >>> 7) % 7), // A2 .. D#3
    prog, arp: pick(ARPS, 11), drums: m === "race", lead, swing: m === "menu" ? 0.08 : 0,
  };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const deg = (s: Song, d: number, oct = 0) => s.root + MINOR[((d % 7) + 7) % 7] + 12 * (oct + Math.floor(d / 7));

function setup(c: AudioContext) {
  if (master) return;
  master = c.createGain();
  master.gain.value = 0;
  filter = c.createBiquadFilter();
  filter.type = "lowpass"; filter.frequency.value = 18000;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  master.connect(filter).connect(comp).connect(c.destination);
  noise = c.createBuffer(1, c.sampleRate / 2, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function env(c: AudioContext, at: number, a: number, dur: number, vol: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + a);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(master!);
  return g;
}

function osc(c: AudioContext, type: OscillatorType, f: number, at: number, dur: number, out: AudioNode, detune = 0) {
  const o = c.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  o.connect(out); o.start(at); o.stop(at + dur + 0.05);
}

function kick(c: AudioContext, at: number) {
  const o = c.createOscillator();
  o.frequency.setValueAtTime(140, at);
  o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
  o.connect(env(c, at, 0.002, 0.32, 0.55)); o.start(at); o.stop(at + 0.35);
}
function hiss(c: AudioContext, at: number, dur: number, vol: number, type: BiquadFilterType, f: number) {
  const s = c.createBufferSource(); s.buffer = noise;
  const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f;
  s.connect(b).connect(env(c, at, 0.002, dur, vol)); s.start(at); s.stop(at + dur + 0.02);
}

/** Schedules one sixteenth note. */
function play16(c: AudioContext, s: Song, i: number, at: number) {
  const beat = 60 / s.bpm, six = beat / 4;
  const inBar = i % 16, bar = Math.floor(i / 16);
  const chord = s.prog[bar % s.prog.length];
  const race = s.drums;
  // Pad: a soft detuned chord at the start of each bar.
  if (inBar === 0) {
    const len = six * 16;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = race ? 1400 : 900;
    lp.connect(env(c, at, len * 0.3, len * 1.05, race ? 0.05 : 0.075));
    for (const d of chord) { osc(c, "sawtooth", hz(deg(s, d, 1)), at, len, lp, -7); osc(c, "sawtooth", hz(deg(s, d, 1)), at, len, lp, 7); }
  }
  // Bass: eighths on the root in races, a long note per half bar in menus.
  if (race ? inBar % 2 === 0 : inBar % 8 === 0) {
    const len = race ? six * 1.8 : six * 7;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = race ? 520 : 320; lp.Q.value = 6;
    lp.connect(env(c, at, 0.005, len, race ? 0.22 : 0.18));
    osc(c, "sawtooth", hz(deg(s, chord[0], -1) + (race && inBar % 4 === 2 ? 12 : 0)), at, len, lp);
  }
  // Arpeggio.
  if (race || inBar % 2 === 0) {
    const n = chord[s.arp[(race ? inBar : inBar / 2) % s.arp.length] % chord.length] + (s.arp[inBar % 4] === 3 ? 7 : 0);
    osc(c, race ? "square" : "triangle", hz(deg(s, n, 2)), at, six * 0.9, env(c, at, 0.004, six * (race ? 0.9 : 2.5), race ? 0.035 : 0.05));
  }
  // Lead: every other pair of bars.
  if (bar % 4 >= 2 && inBar % 2 === 0) {
    const d = s.lead[(inBar / 2 + bar * 3) % 16];
    if (d >= 0) osc(c, "triangle", hz(deg(s, d + chord[0], 2)), at, six * 1.8, env(c, at, 0.01, six * 3, race ? 0.06 : 0.05));
  }
  if (race) {
    if (inBar % 4 === 0) kick(c, at);
    if (inBar % 8 === 4) hiss(c, at, 0.18, 0.2, "bandpass", 1800);
    if (inBar % 2 === 1) hiss(c, at, 0.04, 0.06, "highpass", 8000);
    if (bar % 8 === 7 && inBar >= 12) hiss(c, at, 0.1, 0.12, "bandpass", 2400); // a fill into the next phrase
  } else if (inBar % 8 === 6) hiss(c, at, 0.05, 0.03, "highpass", 9000);
}

function tick() {
  const c = musicContext();
  if (!c || !song || !master) return;
  if (c.state !== "running") { nextAt = 0; return; }
  if (nextAt < c.currentTime) nextAt = c.currentTime + 0.05;
  const six = 60 / song.bpm / 4;
  while (nextAt < c.currentTime + 0.25) {
    play16(c, song, step, nextAt + (step % 2 ? song.swing * six : 0));
    step++;
    nextAt += six;
  }
}

function apply() {
  const target = on ? want : { mood: "none" as Mood, seed: "" };
  if (target.mood === mood && target.seed === seed) return;
  const c = musicContext();
  if (!c) return;
  setup(c);
  const g = master!.gain, now = c.currentTime;
  g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
  if (target.mood === "none") {
    g.linearRampToValueAtTime(0, now + 0.6);
    clearInterval(timer); timer = 0;
    window.setTimeout(() => { if (mood === "none") song = null; }, 700);
  } else {
    g.linearRampToValueAtTime(0, now + 0.25);
    g.linearRampToValueAtTime(target.mood === "race" ? 0.5 : 0.6, now + 1.6);
    window.setTimeout(() => { song = makeSong(target.mood, target.seed); step = 0; nextAt = 0; }, mood === "none" ? 0 : 260);
    if (!timer) timer = window.setInterval(tick, 90);
  }
  mood = target.mood; seed = target.seed;
}

/** Asks for this music (the latest ask wins, after a moment, so screens can hand over without a gap). */
export function setMusic(m: Mood, id = "") {
  want = { mood: m, seed: id };
  clearTimeout(wantTimer);
  wantTimer = window.setTimeout(apply, m === "none" ? 250 : 0);
}

/** Muffles the music (while paused) or opens it up again. */
export function muffleMusic(yes: boolean) {
  const c = musicContext();
  if (!c || !filter) return;
  filter.frequency.setTargetAtTime(yes ? 700 : 18000, c.currentTime, 0.15);
}

export function musicOn() { return on; }
export function setMusicOn(v: boolean) {
  on = v;
  try { localStorage.setItem("hexdrift.music", v ? "on" : "off"); } catch { /* */ }
  apply();
}

// Before the first press the context can't start: try again on the first one.
if (typeof window !== "undefined") {
  const unlock = () => { mood = "none"; seed = ""; apply(); };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    const c = musicContext();
    if (c && master) master.gain.setTargetAtTime(document.hidden || !on || mood === "none" ? 0 : mood === "race" ? 0.5 : 0.6, c.currentTime, 0.2);
  });
}
