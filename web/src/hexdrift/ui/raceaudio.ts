// The race's own sound, made live with WebAudio like the interface sounds:
// nothing to download, and every part follows the car exactly.
//
//   engine    a firing-order waveform per car (V8 lope, V10/V12 scream, flat-6,
//             rally four, an electric whine), through a gearbox that shifts by
//             road speed, brighter and louder on the gas; turbo whistle and
//             blow-off, pops on the overrun
//   tyres     squeal with slip on hard surfaces, gravel crunch, sand hiss, ice
//             hiss, a steel deck's seams; road roar rising with speed
//   air       wind rising with speed (more when flying), a jet roar on boost
//   ambience  per map: surf, rain, mountain wind, desert air, high sky, a
//             space drone, and the crowd at the start
//
// Once the race sheet has loaded, recorded sounds take over: the engine from
// six CC0 recorded engine loops (idle and five rev steps, crossfaded and
// pitched to follow the revs), a recorded tyre squeal and a rush of air under
// the boost. The synthesised versions above play until then (and for the
// electric truck, which has no engine to record).
//
// It runs on the interface sounds' context and bus (one compressor for all).
// Muting the sounds mutes this too.
import { audioContext, isMuted, RACE_CLIPS, raceSheet } from "./sound.ts";
import type { BiomeId } from "../maps.ts";

export type Surface = "asphalt" | "dirt" | "ice" | "metal" | "sand" | "grass" | "air";

export interface AudioState {
  /** Forward speed (m/s) and sideways slip (m/s). */
  speed: number; slip: number;
  gas: boolean; brake: boolean;
  grounded: boolean;
  boosting: boolean;
  surface: Surface;
  /** Racing, or still on the grid (revving allowed), or done. */
  phase: "countdown" | "running" | "finished";
  /** Metres from the start line (for the crowd). */
  fromStart: number;
}

/** How each car sounds. */
interface Voice {
  cyl: number; idle: number; red: number; gears: number;
  /** Harmonic weights of the half-order waveform (1 = half order, 2 = firing frequency...). */
  harm: number[];
  /** Low-pass range (Hz) off and on the gas, and drive into the soft clipper. */
  dark: number; bright: number; drive: number;
  turbo?: boolean; pops?: number; electric?: boolean; hybrid?: boolean;
  vol: number;
}
const V8 = [0.9, 1, 0.55, 0.7, 0.3, 0.45, 0.15, 0.3, 0.1, 0.15];
const SMOOTH = [0.15, 1, 0.2, 0.55, 0.15, 0.4, 0.1, 0.3, 0.08, 0.25, 0.05, 0.18];
const FLAT6 = [0.4, 1, 0.5, 0.45, 0.3, 0.5, 0.2, 0.25, 0.15, 0.2];
const FOUR = [0.3, 1, 0.6, 0.6, 0.35, 0.3, 0.25, 0.2];
const VOICES: Record<string, Voice> = {
  coupe: { cyl: 12, idle: 800, red: 7000, gears: 6, harm: SMOOTH, dark: 500, bright: 2600, drive: 1.6, vol: 0.9 },
  furia: { cyl: 10, idle: 1000, red: 8600, gears: 7, harm: SMOOTH, dark: 700, bright: 4200, drive: 2.4, pops: 0.4, vol: 0.95 },
  rig: { cyl: 0, idle: 0, red: 0, gears: 1, harm: [], dark: 0, bright: 0, drive: 1, electric: true, vol: 0.8 },
  zenith: { cyl: 6, idle: 1000, red: 9000, gears: 7, harm: FLAT6, dark: 700, bright: 4000, drive: 2.6, pops: 0.3, vol: 0.95 },
  formula: { cyl: 10, idle: 4000, red: 12500, gears: 8, harm: SMOOTH, dark: 1200, bright: 6000, drive: 3, pops: 0.2, vol: 0.85 },
  brawler: { cyl: 8, idle: 700, red: 6200, gears: 4, harm: V8, dark: 380, bright: 1800, drive: 3.2, pops: 0.8, vol: 1 },
  kaze: { cyl: 6, idle: 900, red: 8000, gears: 6, harm: SMOOTH, dark: 550, bright: 3200, drive: 2, turbo: true, pops: 0.3, vol: 0.9 },
  scrambler: { cyl: 4, idle: 1000, red: 8000, gears: 6, harm: FOUR, dark: 600, bright: 3400, drive: 3, turbo: true, pops: 1, vol: 0.95 },
  dune: { cyl: 8, idle: 700, red: 6000, gears: 4, harm: V8, dark: 320, bright: 1500, drive: 3.6, pops: 0.5, vol: 1 },
  endura: { cyl: 8, idle: 1200, red: 9500, gears: 7, harm: FLAT6, dark: 800, bright: 4200, drive: 2.2, hybrid: true, vol: 0.9 },
};

/** The ambience of each map's world. */
interface Amb { kind: "sea" | "rain" | "wind" | "desert" | "sky" | "space" | "city" | "none"; vol: number }
const AMB: Partial<Record<BiomeId, Amb>> = {
  miami: { kind: "sea", vol: 0.12 }, storm: { kind: "rain", vol: 0.2 }, alpine: { kind: "wind", vol: 0.12 },
  baja: { kind: "desert", vol: 0.08 }, sky: { kind: "sky", vol: 0.1 }, space: { kind: "space", vol: 0.14 },
  city: { kind: "city", vol: 0.08 }, canyon: { kind: "desert", vol: 0.07 }, glacier: { kind: "wind", vol: 0.1 }, desert: { kind: "desert", vol: 0.08 },
};

const VTOP = 90; // the fastest a car goes (boosting), m/s

function noiseBuffer(c: BaseAudioContext, seconds: number, brown = false): AudioBuffer {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

/** A looping noise through a filter into a gain (gain starts silent). */
function noiseVoice(c: BaseAudioContext, buf: AudioBuffer, out: AudioNode, type: BiquadFilterType, f: number, q: number) {
  const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
  const filt = c.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
  const g = c.createGain(); g.gain.value = 0;
  s.connect(filt).connect(g).connect(out);
  s.start(0, Math.random() * buf.duration);
  return { s, filt, g };
}

const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;

export class RaceAudio {
  private c: BaseAudioContext | null = null;
  private bus: GainNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private tryAt = 0;
  private voice: Voice;
  private amb: Amb;
  private paused = false;
  private gone = false;

  // Engine.
  private eOsc: OscillatorNode[] = [];
  private eShape!: WaveShaperNode;
  private eFilt!: BiquadFilterNode;
  private eGain!: GainNode;
  private intake!: ReturnType<typeof noiseVoice>;
  private whine?: { o: OscillatorNode; o2: OscillatorNode; g: GainNode };
  private turbo?: { o: OscillatorNode; g: GainNode };
  // Tyres, road, air.
  private squeal!: ReturnType<typeof noiseVoice>;
  private squeal2!: ReturnType<typeof noiseVoice>;
  private roll!: ReturnType<typeof noiseVoice>;
  private grit!: ReturnType<typeof noiseVoice>;
  private wind!: ReturnType<typeof noiseVoice>;
  private jet!: ReturnType<typeof noiseVoice>;
  private crowd!: ReturnType<typeof noiseVoice>;
  private ambV: { g: GainNode; filt?: BiquadFilterNode; lfo?: number }[] = [];
  private white!: AudioBuffer;

  // Recorded layers (null until the race sheet is in).
  private rec: { eng: { s: AudioBufferSourceNode; g: GainNode; base: number }[]; squeal: { s: AudioBufferSourceNode; g: GainNode }; rush: { s: AudioBufferSourceNode; g: GainNode } } | null = null;

  // State.
  private gear = 0;
  private rpm = 0;
  private load = 0;
  private boostP = 0;
  private shiftCut = 0;
  private lastGas = false;
  private seam = 0;
  private t = 0;

  /** ctx: render into this context instead of the live one (for offline previews). */
  constructor(car: string, biome: BiomeId, private ctx?: { c: BaseAudioContext; out: AudioNode }) {
    this.voice = VOICES[car] ?? VOICES.coupe;
    this.amb = AMB[biome] ?? { kind: "none", vol: 0 };
    this.rpm = this.voice.idle;
  }

  /** Builds the graph once the context exists (after the first press). */
  private start(): boolean {
    if (this.c) return true;
    const now = performance.now();
    if (!this.ctx && (now < this.tryAt || isMuted())) return false;
    this.tryAt = now + 500;
    const a = this.ctx ?? audioContext();
    if (!a || (!this.ctx && a.c.state !== "running")) return false;
    const c = this.c = a.c;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(a.out);
    this.bus.gain.setTargetAtTime(1, c.currentTime, 0.3);
    this.white = noiseBuffer(c, 2);
    const brown = noiseBuffer(c, 3, true);
    const v = this.voice;

    // ── Engine ──
    this.eGain = c.createGain(); this.eGain.gain.value = 0;
    this.eFilt = c.createBiquadFilter(); this.eFilt.type = "lowpass"; this.eFilt.Q.value = 1.4; this.eFilt.frequency.value = v.dark || 500;
    this.eShape = c.createWaveShaper();
    this.eShape.curve = this.curve(v.drive);
    this.eShape.oversample = "2x";
    this.eShape.connect(this.eFilt).connect(this.eGain).connect(this.bus);
    if (!v.electric) {
      const re = new Float32Array(v.harm.length + 1), im = new Float32Array(v.harm.length + 1);
      v.harm.forEach((h, i) => { im[i + 1] = h; re[i + 1] = i % 3 === 1 ? h * 0.3 : 0; });
      const wave = c.createPeriodicWave(re, im);
      for (const det of [0, 7]) {
        const o = c.createOscillator();
        o.setPeriodicWave(wave);
        o.detune.value = det;
        const g = c.createGain(); g.gain.value = det ? 0.45 : 0.7;
        o.connect(g).connect(this.eShape);
        o.start();
        this.eOsc.push(o); this.nodes.push(o);
      }
      this.intake = noiseVoice(c, this.white, this.eShape, "bandpass", 1200, 1.2);
      this.nodes.push(this.intake.s);
    }
    if (v.electric || v.hybrid) {
      const g = c.createGain(); g.gain.value = 0;
      const o = c.createOscillator(); o.type = "sine";
      const o2 = c.createOscillator(); o2.type = "triangle";
      const g2 = c.createGain(); g2.gain.value = 0.25;
      o.connect(g); o2.connect(g2).connect(g); g.connect(this.bus);
      o.start(); o2.start(); this.nodes.push(o, o2);
      this.whine = { o, o2, g };
    }
    if (v.turbo) {
      const g = c.createGain(); g.gain.value = 0;
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = 2000;
      o.connect(g).connect(this.bus); o.start(); this.nodes.push(o);
      this.turbo = { o, g };
    }

    // ── Tyres, road and air ──
    this.squeal = noiseVoice(c, this.white, this.bus, "bandpass", 1100, 9);
    this.squeal2 = noiseVoice(c, this.white, this.bus, "bandpass", 1650, 11);
    this.roll = noiseVoice(c, brown, this.bus, "lowpass", 300, 0.7);
    this.grit = noiseVoice(c, this.white, this.bus, "bandpass", 900, 0.8);
    this.wind = noiseVoice(c, this.white, this.bus, "bandpass", 500, 0.6);
    this.jet = noiseVoice(c, this.white, this.bus, "bandpass", 900, 0.7);
    this.crowd = noiseVoice(c, brown, this.bus, "bandpass", 900, 0.8);
    this.nodes.push(this.squeal.s, this.squeal2.s, this.roll.s, this.grit.s, this.wind.s, this.jet.s, this.crowd.s);

    // ── The world ──
    const A = this.amb;
    const add = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, vol: number, lfo?: number) => {
      const n = noiseVoice(c, buf, this.bus!, type, f, q);
      n.g.gain.setTargetAtTime(vol, c.currentTime, 1);
      this.nodes.push(n.s);
      this.ambV.push({ g: n.g, filt: n.filt, lfo });
    };
    switch (A.kind) {
      case "sea": add(brown, "lowpass", 500, 0.5, A.vol, 0.09); add(this.white, "highpass", 3000, 0.5, A.vol * 0.25, 0.09); break;
      case "rain": add(this.white, "highpass", 2500, 0.4, A.vol); add(brown, "lowpass", 400, 0.5, A.vol * 0.6); break;
      case "wind": add(brown, "bandpass", 350, 0.8, A.vol, 0.05); add(this.white, "bandpass", 1400, 3, A.vol * 0.15, 0.07); break;
      case "desert": add(brown, "bandpass", 500, 0.6, A.vol, 0.04); break;
      case "sky": add(brown, "bandpass", 700, 0.5, A.vol, 0.03); add(this.white, "highpass", 4000, 0.5, A.vol * 0.12, 0.05); break;
      case "city": add(brown, "lowpass", 300, 0.5, A.vol); break;
      case "space": {
        for (const [f, vol] of [[55, 0.5], [55.6, 0.4], [82.4, 0.25], [164.8, 0.08]]) {
          const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
          const g = c.createGain(); g.gain.value = 0;
          g.gain.setTargetAtTime(A.vol * vol, c.currentTime, 2);
          o.connect(g).connect(this.bus); o.start(); this.nodes.push(o);
        }
        add(this.white, "bandpass", 2400, 6, A.vol * 0.06, 0.02);
        break;
      }
    }
    return true;
  }

  /** Switches to the recorded engine, squeal and boost rush once the sheet is loaded. */
  private record() {
    if (this.rec || this.ctx) return;
    const buf = raceSheet();
    if (!buf) return;
    const c = this.c!, now = c.currentTime;
    const loop = (key: keyof typeof RACE_CLIPS, out: AudioNode) => {
      const [t, d] = RACE_CLIPS[key];
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = t; s.loopEnd = t + d;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(g).connect(out); s.start(now, t + Math.random() * d * 0.5);
      this.nodes.push(s);
      return { s, g };
    };
    // The base pitch (Hz) of each recorded loop: idle, then five steps up.
    const BASE = [43, 60, 64.5, 70, 73, 76.6];
    const eng = this.voice.electric ? [] : (["e0", "e1", "e2", "e3", "e4", "e5"] as const).map((k, i) => ({ ...loop(k, this.eFilt), base: BASE[i] }));
    if (eng.length) { this.eShape.disconnect(); }
    this.rec = { eng, squeal: loop("squeal", this.bus!), rush: loop("rush", this.bus!) };
  }

  /** A soft clipper: more drive, more grit. */
  private curve(drive: number): Float32Array<ArrayBuffer> {
    const n = 1024, k = new Float32Array(n);
    const t = Math.tanh(drive);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; k[i] = Math.tanh(x * drive) / t; }
    return k;
  }

  /** Called every drawn frame. */
  update(s: AudioState, dt: number) {
    if (this.gone || !this.start()) return;
    const c = this.c!, now = c.currentTime;
    const v = this.voice;
    const quiet = this.paused || isMuted();
    this.bus!.gain.setTargetAtTime(quiet ? 0 : 1, now, quiet ? 0.05 : 0.2);
    if (quiet) return;
    this.record();
    this.t += dt;
    const sp = Math.abs(s.speed);
    const done = s.phase === "finished";
    const gas = s.gas && !done;
    const air = !s.grounded;
    const T = (p: AudioParam, val: number, tc = 0.05) => p.setTargetAtTime(val, now, tc);

    // ── Gearbox and revs ──
    this.load += ((gas ? 1 : 0) - this.load) * Math.min(1, dt * (gas ? 8 : 5));
    if (!v.electric) {
      const N = v.gears;
      const top = (g: number) => VTOP * Math.pow((g + 1) / N, 0.85);
      let target: number;
      if (s.phase === "countdown" || sp < 0.5 && !air) {
        // On the grid: blip with the gas.
        this.gear = 0;
        target = gas ? v.red * 0.75 : v.idle;
      } else {
        // Up at the redline, down when the revs fall away.
        while (this.gear < N - 1 && sp > top(this.gear) * 0.97) { this.gear++; this.shiftCut = 0.09; }
        while (this.gear > 0 && sp < top(this.gear - 1) * 0.62) this.gear--;
        target = Math.max(v.idle, v.red * sp / top(this.gear));
        // In the air the wheels spin free.
        if (air && gas) target = Math.max(target, v.red * 0.92);
        target = Math.min(target, v.red * (s.boosting ? 1.02 : 1));
      }
      const rise = target > this.rpm ? (air || s.phase === "countdown" ? 6 : 12) : 6;
      this.rpm += (target - this.rpm) * Math.min(1, dt * rise);
      const half = (this.rpm / 60) * (v.cyl / 4); // the half order
      for (const o of this.eOsc) T(o.frequency, half, 0.02);
      const rf = (this.rpm - v.idle) / (v.red - v.idle);
      this.shiftCut = Math.max(0, this.shiftCut - dt);
      const cut = this.shiftCut > 0 ? 0.35 : 1;
      const lv = v.vol * (0.16 + 0.18 * this.load + 0.1 * clamp(rf, 0, 1)) * cut * (done ? 0.6 : 1);
      T(this.eGain.gain, lv, 0.03);
      // Recorded engines are already shaped: the filter only takes the edge off when lifting.
      const open = 0.25 * clamp(rf, 0, 1) + 0.75 * this.load;
      T(this.eFilt.frequency, this.rec?.eng.length ? 1400 + 9000 * open : v.dark + (v.bright - v.dark) * open, 0.04);
      if (this.rec?.eng.length) {
        // The recorded engine: a pitch that climbs with the revs (deeper for
        // big lazy engines, higher for screamers), played by the two loops
        // either side of it with an equal-power crossfade.
        const tone = Math.pow(Math.max(4, v.cyl) / 8, 0.3) * Math.pow(v.red / 7000, 0.35);
        const F = 43 * tone * (1 + 2.5 * clamp(rf, 0, 1.05));
        const E = this.rec.eng;
        let i = 0;
        while (i < E.length - 1 && F >= E[i + 1].base) i++;
        const k = i < E.length - 1 ? clamp((F - E[i].base) / (E[i + 1].base - E[i].base), 0, 1) : 0;
        E.forEach((e, j) => {
          const w = j === i ? Math.cos(k * Math.PI / 2) : j === i + 1 ? Math.sin(k * Math.PI / 2) : 0;
          T(e.g.gain, w * 1.5, 0.03);
          if (w > 0 || j === i + 1) T(e.s.playbackRate, clamp(F / e.base, 0.5, 2.8), 0.02);
        });
      }
      T(this.intake.filt.frequency, half * 6, 0.05);
      T(this.intake.g.gain, 0.05 + 0.12 * this.load * clamp(rf, 0, 1), 0.05);
      // Off the gas high in the revs: crackles on the overrun.
      if (v.pops && this.lastGas && !gas && rf > 0.45) this.pops(v.pops);
      if (v.pops && !gas && rf > 0.4 && Math.random() < dt * 6 * v.pops) this.pop(0.25 * v.pops);
    }
    if (this.whine) {
      const f = 180 + sp * 38;
      T(this.whine.o.frequency, f, 0.03); T(this.whine.o2.frequency, f * 3.02, 0.03);
      const w = v.electric ? 0.05 + 0.1 * this.load + sp / VTOP * 0.06 : 0.03 * this.load;
      T(this.whine.g.gain, done ? w * 0.5 : w, 0.05);
      if (v.electric) {
        // The motor has no firing, but it has a hum under the whine.
        T(this.eGain.gain, 0, 0.1);
      }
    }
    if (this.turbo) {
      const rf = clamp((this.rpm - v.idle) / (v.red - v.idle), 0, 1);
      const want = gas ? rf : 0;
      this.boostP += (want - this.boostP) * Math.min(1, dt * (gas ? 2.5 : 8));
      T(this.turbo.o.frequency, 1800 + 5200 * this.boostP, 0.05);
      T(this.turbo.g.gain, 0.025 * this.boostP * this.boostP, 0.05);
      if (this.lastGas && !gas && this.boostP > 0.5) this.blowOff(this.boostP);
    }
    this.lastGas = gas;

    // ── Tyres and road ──
    const surf: Surface = air ? "air" : s.surface;
    const hard = surf === "asphalt" || surf === "metal";
    const slipK = clamp((Math.abs(s.slip) - 3) / 7, 0, 1);
    const brakeK = s.brake && sp > 12 ? 0.6 : 0;
    const sq = hard && !done ? Math.max(slipK, brakeK) : 0;
    T(this.squeal.g.gain, 0.22 * sq * clamp(sp / 15, 0, 1), 0.04);
    T(this.squeal2.g.gain, 0.12 * sq * clamp(sp / 15, 0, 1), 0.04);
    T(this.squeal.filt.frequency, 950 + 250 * Math.sin(this.t * 9) * sq + sp * 3, 0.05);
    if (this.rec) {
      // Recorded squeal instead of the noise one.
      T(this.squeal.g.gain, 0, 0.05); T(this.squeal2.g.gain, 0, 0.05);
      T(this.rec.squeal.g.gain, 0.55 * sq * clamp(sp / 15, 0, 1), 0.04);
      T(this.rec.squeal.s.playbackRate, 0.9 + 0.25 * sq + sp / 400, 0.1);
    }
    const vK = clamp(sp / 60, 0, 1);
    const rollVol = air ? 0 : surf === "asphalt" ? 0.18 : surf === "metal" ? 0.16 : surf === "ice" ? 0.06 : surf === "sand" ? 0.12 : 0.24;
    T(this.roll.g.gain, rollVol * vK, 0.06);
    T(this.roll.filt.frequency, (surf === "dirt" || surf === "grass" ? 500 : 250) + 500 * vK, 0.1);
    // Grit: gravel crunch (dirt, grass), sand hiss, ice hiss, a steel deck's seams.
    let gv = 0, gf = 900, gq = 0.8;
    if (surf === "dirt" || surf === "grass") { gv = (0.1 + 0.25 * slipK) * vK * (0.6 + 0.4 * Math.random()); gf = 700 + Math.random() * 900; }
    else if (surf === "sand") { gv = (0.06 + 0.2 * slipK) * vK; gf = 3500; gq = 0.5; }
    else if (surf === "ice") { gv = (0.04 + 0.1 * slipK) * vK; gf = 5500; gq = 0.5; }
    else if (surf === "metal" && sp > 3) {
      this.seam += sp * dt;
      if (this.seam > 6) { this.seam = 0; this.clank(vK); }
    }
    T(this.grit.g.gain, gv, 0.02);
    T(this.grit.filt.frequency, gf, 0.02);
    T(this.grit.filt.Q, gq, 0.1);

    // ── Air ──
    const wK = vK * vK;
    T(this.wind.g.gain, (air ? 0.22 : 0.1) * wK + (air ? 0.04 : 0), 0.15);
    T(this.wind.filt.frequency, 350 + 1400 * vK + (air ? 300 : 0), 0.2);
    T(this.jet.g.gain, s.boosting && !done ? (this.rec ? 0.1 : 0.16) : 0, s.boosting ? 0.05 : 0.3);
    if (this.rec) {
      // Under the boost: a roaring rush of air that rises with speed.
      T(this.rec.rush.g.gain, s.boosting && !done ? 0.55 : 0, s.boosting ? 0.06 : 0.35);
      T(this.rec.rush.s.playbackRate, 0.85 + 0.5 * vK, 0.2);
    }
    T(this.jet.filt.frequency, s.boosting ? 1800 + 400 * Math.sin(this.t * 3) : 700, 0.2);

    // ── The world: the crowd by the start and finish, and the map's own air ──
    const near = clamp(1 - s.fromStart / 250, 0, 1);
    const cheer = done ? 0.22 : s.phase === "countdown" ? 0.14 : 0.1 * near;
    T(this.crowd.g.gain, cheer * (0.75 + 0.25 * Math.sin(this.t * 1.3) * Math.sin(this.t * 0.7)), 0.3);
    for (const a of this.ambV) {
      if (!a.lfo) continue;
      const m = 0.55 + 0.45 * Math.sin(this.t * a.lfo * Math.PI * 2) * Math.sin(this.t * a.lfo * 1.7 + 1);
      T(a.g.gain, this.amb.vol * m * (a.filt && a.filt.type === "highpass" ? 0.25 : 1), 0.5);
    }
  }

  /** A short filtered noise hit. */
  private hit(f: number, q: number, vol: number, dur: number, type: BiquadFilterType = "bandpass", at = 0) {
    const c = this.c!;
    const t0 = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.white;
    const filt = c.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(filt).connect(g).connect(this.bus!);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.02);
  }
  private pop(vol: number) { this.hit(300 + Math.random() * 500, 1.5, vol * (0.5 + Math.random() * 0.5), 0.04 + Math.random() * 0.04, "lowpass"); }
  private pops(k: number) { for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) this.hit(400 + Math.random() * 600, 1.2, 0.3 * k, 0.05, "lowpass", 0.05 + i * (0.05 + Math.random() * 0.08)); }
  private blowOff(k: number) { this.hit(2200, 1.5, 0.18 * k, 0.35); this.hit(4500, 2, 0.08 * k, 0.25); }
  private clank(k: number) { this.hit(320 + Math.random() * 80, 6, 0.1 + 0.12 * k, 0.07); }

  /** A clap of thunder (storm lightning). */
  thunder(k = 1) {
    if (!this.c || this.paused || isMuted()) return;
    this.hit(120, 0.6, 0.5 * k, 2.2 + Math.random(), "lowpass", 0.2 + Math.random() * 0.6);
    this.hit(700, 0.5, 0.2 * k, 0.5, "lowpass", 0.15);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (this.c && this.bus) this.bus.gain.setTargetAtTime(p ? 0 : 1, this.c.currentTime, 0.05);
  }

  dispose() {
    this.gone = true;
    if (!this.c || !this.bus) return;
    const c = this.c, bus = this.bus;
    bus.gain.setTargetAtTime(0, c.currentTime, 0.08);
    const nodes = this.nodes;
    setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* */ } } bus.disconnect(); }, 500);
  }
}
