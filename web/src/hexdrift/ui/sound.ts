// Interface sounds, made live with WebAudio: no files to download, nothing to
// credit, and they play instantly even offline. Each sound is a few short
// oscillators and filtered noise bursts through one master bus with a soft
// compressor, so they sit together like one designed set.
//
// Browsers only allow audio after a user gesture, so the context is created
// on the first press and everything before that is silent.

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let bus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem("hexdrift.uiSound") === "off"; } catch { /* */ }

function audio(): { c: Ctx; out: GainNode } | null {
  if (muted) return null;
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
  return ctx.state === "closed" ? null : { c: ctx, out: bus! };
}

/** The audio context, once a gesture has unlocked it (shared with the game's sounds). */
export function audioContext(): { c: Ctx; out: GainNode } | null { return audio(); }

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

export type UiSound = "hover" | "click" | "confirm" | "back" | "whoosh" | "toggle" | "locked" | "tick" | "count" | "go" | "reveal" | "medal";

let lastHover = 0;
/** Plays one interface sound. Cheap enough to call on every press. */
export function play(s: UiSound) {
  const a = audio();
  if (!a) return;
  const { c, out } = a;
  switch (s) {
    case "hover": {
      const now = performance.now();
      if (now - lastHover < 45) return;
      lastHover = now;
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
