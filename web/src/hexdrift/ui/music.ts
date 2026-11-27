// Soundtracks: recorded CC0 tracks from OpenGameArt (see music/CREDITS.txt).
// A calm synthwave track in the menus; in races, one of four driving tracks,
// picked from the map so each map keeps its own. Tracks stream (an <audio>
// element, never decoded whole), so only the one playing is downloaded, and
// they fade into each other. Played through the interface sounds' context so
// the pause menu can muffle them, with its own on/off switch.

import menuUrl from "../music/menu.mp3?url";
import race1 from "../music/race1.mp3?url";
import race2 from "../music/race2.mp3?url";
import race3 from "../music/race3.mp3?url";
import race4 from "../music/race4.mp3?url";
import { musicContext } from "./sound.ts";

export type Mood = "menu" | "race" | "none";

const RACE = [race1, race2, race3, race4];
const VOL = { menu: 0.42, race: 0.34 };

let on = true;
try { on = localStorage.getItem("hexdrift.music") !== "off"; } catch { /* */ }

interface Deck { el: HTMLAudioElement; g: GainNode | null; url: string }
let cur: Deck | null = null;
let filter: BiquadFilterNode | null = null;
let want: { mood: Mood; id: string } = { mood: "none", id: "" };
let wantTimer = 0;
let playing = "";

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const urlOf = (m: Mood, id: string) => m === "menu" ? menuUrl : m === "race" ? RACE[hash(id) % RACE.length] : "";

function out(c: AudioContext) {
  if (!filter) {
    filter = c.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 20000;
    filter.connect(c.destination);
  }
  return filter;
}

/** Fades a deck to a level over a time (seconds), through WebAudio if we can, else the element's volume. */
function fade(d: Deck, to: number, sec: number) {
  const c = musicContext();
  if (d.g && c) { d.g.gain.cancelScheduledValues(c.currentTime); d.g.gain.setTargetAtTime(to, c.currentTime, sec / 3); return; }
  const from = d.el.volume, t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); d.el.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); };
  step();
}

function stop(d: Deck, sec: number) {
  fade(d, 0, sec);
  setTimeout(() => { d.el.pause(); d.el.removeAttribute("src"); d.el.load(); d.g?.disconnect(); }, sec * 1000 + 100);
}

function apply() {
  const m = on && !document.hidden ? want.mood : "none";
  const url = urlOf(m, want.id);
  if (url === playing) return;
  playing = url;
  if (cur) { stop(cur, 1.2); cur = null; }
  if (!url) return;
  const el = new Audio();
  el.src = url; el.loop = true; el.preload = "auto"; el.crossOrigin = "anonymous";
  const c = musicContext();
  let g: GainNode | null = null;
  if (c) {
    try {
      g = c.createGain(); g.gain.value = 0;
      c.createMediaElementSource(el).connect(g).connect(out(c));
    } catch { g = null; }
  }
  if (!g) el.volume = 0;
  const d: Deck = { el, g, url };
  cur = d;
  void el.play().then(() => fade(d, VOL[m as "menu" | "race"], 1.6)).catch(() => { if (cur === d) playing = ""; });
}

/** Asks for this music (the latest ask wins, after a moment, so screens can hand over without a gap). */
export function setMusic(m: Mood, id = "") {
  want = { mood: m, id };
  clearTimeout(wantTimer);
  wantTimer = window.setTimeout(apply, m === "none" ? 250 : 0);
}

/** Muffles the music (while paused) or opens it up again. */
export function muffleMusic(yes: boolean) {
  const c = musicContext();
  if (!c || !filter) return;
  filter.frequency.setTargetAtTime(yes ? 650 : 20000, c.currentTime, 0.15);
  if (cur?.g) cur.g.gain.setTargetAtTime(yes ? 0.6 * VOL.race : VOL.race, c.currentTime, 0.2);
}

export function musicOn() { return on; }
export function setMusicOn(v: boolean) {
  on = v;
  try { localStorage.setItem("hexdrift.music", v ? "on" : "off"); } catch { /* */ }
  apply();
}

if (typeof window !== "undefined") {
  // Browsers only start audio after a press: try again on the first one.
  const unlock = () => { playing = ""; apply(); };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => { playing = playing && document.hidden ? playing : ""; apply(); });
}
