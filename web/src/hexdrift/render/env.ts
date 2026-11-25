// The studio's sky settings: time of day, fog and weather, laid over a
// theme's own look. Only the pictures change (never the driving).
import * as THREE from "three";
import type { Env } from "../sim/custom.ts";
import type { Biome, BiomeId } from "../maps.ts";
import type { Look } from "./roadworld.ts";
import { WEATHER, type Spec } from "./weather.ts";

type Sky = Pick<Look, "skyTop" | "skyHorizon" | "skyLow" | "sunColor" | "sunI" | "hemiSky" | "hemiGround" | "hemiI" | "sunDisc">;
const NIGHT: Sky = { skyTop: "#02040c", skyHorizon: "#121a36", skyLow: "#121a36", sunColor: "#9fb4ff", sunI: 0.45, hemiSky: "#2c3c70", hemiGround: "#0c0a14", hemiI: 0.8, sunDisc: "#dfe6ff" };
const DUSK: Sky = { skyTop: "#3d4fa8", skyHorizon: "#ff9a62", skyLow: "#ffb98a", sunColor: "#ffc48a", sunI: 2.6, hemiSky: "#ffcfb8", hemiGround: "#6a4a64", hemiI: 0.95, sunDisc: "#fff0c8" };
const DAY: Sky = { skyTop: "#3a8be0", skyHorizon: "#d2e7f7", skyLow: "#e8f2fa", sunColor: "#fff6e8", sunI: 2.2, hemiSky: "#cfe4ff", hemiGround: "#6a6450", hemiI: 1.3, sunDisc: "#ffffff" };

const c1 = new THREE.Color(), c2 = new THREE.Color();
const mixC = (a: string, b: string, t: number) => "#" + c1.set(a).lerp(c2.set(b), t).getHexString();
function mixSky(a: Sky, b: Sky, t: number): Sky {
  return {
    skyTop: mixC(a.skyTop, b.skyTop, t), skyHorizon: mixC(a.skyHorizon, b.skyHorizon, t), skyLow: mixC(a.skyLow, b.skyLow, t),
    sunColor: mixC(a.sunColor, b.sunColor, t), sunI: a.sunI + (b.sunI - a.sunI) * t,
    hemiSky: mixC(a.hemiSky, b.hemiSky, t), hemiGround: mixC(a.hemiGround, b.hemiGround, t), hemiI: a.hemiI + (b.hemiI - a.hemiI) * t,
    sunDisc: mixC(a.sunDisc, b.sunDisc, t),
  };
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface EnvLook { look: Look; biome: Biome; weather: Spec; storm: boolean }

/** A theme's look with the map's sky settings laid over it. */
export function lookWith(id: BiomeId, look: Look, biome: Biome, env: Env | undefined): EnvLook {
  const out: EnvLook = { look, biome, weather: WEATHER[id], storm: id === "storm" };
  if (!env) return out;
  const L: Look = { ...look };
  const B: Biome = { ...biome };
  if (env.time !== undefined && id !== "space") {
    // The sun goes round from 6 (rising in the east) to 18 (setting in the west).
    const a = ((env.time - 6) / 12) * Math.PI;
    const up = Math.sin(a);
    L.sun = [Math.cos(a) * 0.8, Math.max(0.08, Math.abs(up)), 0.45];
    const sky = up < 0 ? mixSky(DUSK, NIGHT, smooth(-0.02, 0.2, -up)) : mixSky(DUSK, DAY, smooth(0.05, 0.45, up));
    Object.assign(L, sky);
    L.night = up < -0.03;
    L.stars = smooth(0, 0.25, -up);
    B.fog = L.skyHorizon; B.sky = L.skyTop;
  }
  if (env.weather) {
    const w = env.weather;
    out.storm = w === "storm";
    out.weather = w === "clear" ? { ...WEATHER[id], count: 0 } : w === "rain" ? WEATHER.city : w === "storm" ? WEATHER.storm : WEATHER.glacier;
    if (w === "clear") { L.wet = 0; L.clouds = Math.min(L.clouds, 0.3); }
    else {
      L.wet = w === "snow" ? 0.25 : 1;
      L.clouds = Math.max(L.clouds, w === "storm" ? 0.95 : 0.8);
      // Grey the sky under the cloud.
      const k = w === "storm" ? 0.6 : 0.35;
      for (const key of ["skyTop", "skyHorizon", "skyLow", "hemiSky"] as const) L[key] = mixC(L[key], w === "snow" ? "#c9d2de" : "#4a5260", k);
      L.sunI *= w === "storm" ? 0.35 : 0.6;
      if (w === "snow") L.ground = L.ground.map((g, j) => (j === 5 ? g : mixC(g, "#f4f8ff", 0.65)));
      B.fog = L.skyHorizon;
    }
  }
  if (env.fog !== undefined) {
    const f = env.fog;
    B.fogNear = biome.fogNear + (10 - biome.fogNear) * f;
    B.fogFar = biome.fogFar + (140 - biome.fogFar) * f * f * (2 - f);
  }
  out.look = L; out.biome = B;
  return out;
}
