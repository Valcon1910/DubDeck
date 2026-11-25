// Small textures made on the spot (no downloads): a tiling value noise used
// for the grain of asphalt, sand, grass and rock, for clouds and for water.
import * as THREE from "three";

let noise: THREE.DataTexture | null = null;

/** A 256² tiling noise (red: fine fbm, green: coarse, blue: cells, alpha: ripples). */
export function noiseTex(): THREE.DataTexture {
  if (noise) return noise;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const rnd = (x: number, y: number, s: number) => {
    let h = Math.imul(x & 255, 374761393) ^ Math.imul(y & 255, 668265263) ^ Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  // Value noise that wraps at period p (p divides 256).
  const vn = (x: number, y: number, p: number, s: number) => {
    const fx = (x / N) * p, fy = (y / N) * p;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const a = rnd(ix % p, iy % p, s), b = rnd((ix + 1) % p, iy % p, s), c = rnd(ix % p, (iy + 1) % p, s), d = rnd((ix + 1) % p, (iy + 1) % p, s);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fine = vn(x, y, 32, 1) * 0.45 + vn(x, y, 64, 2) * 0.3 + vn(x, y, 128, 3) * 0.25;
      const coarse = vn(x, y, 4, 4) * 0.5 + vn(x, y, 8, 5) * 0.3 + vn(x, y, 16, 6) * 0.2;
      // Cell-ish pattern (pebbles, cracks).
      const cx = (x / N) * 24, cy = (y / N) * 24;
      let md = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = Math.floor(cx) + ox, gy = Math.floor(cy) + oy;
        const px = gx + rnd(((gx % 24) + 24) % 24, ((gy % 24) + 24) % 24, 7), py = gy + rnd(((gx % 24) + 24) % 24, ((gy % 24) + 24) % 24, 8);
        const d = (px - cx) ** 2 + (py - cy) ** 2;
        if (d < md) md = d;
      }
      const ripple = vn(x, y, 16, 9) * 0.6 + vn(x, y, 32, 10) * 0.4;
      const k = (y * N + x) * 4;
      data[k] = fine * 255; data[k + 1] = coarse * 255; data[k + 2] = Math.min(1, Math.sqrt(md)) * 255; data[k + 3] = ripple * 255;
    }
  }
  noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.anisotropy = 4;
  noise.needsUpdate = true;
  return noise;
}

/**
 * Adds world-space grain to a vertex-coloured material, so big surfaces
 * (ground, rock, walls) don't look flat up close or from afar.
 */
export function addGrain(m: THREE.Material, fine = 0.22, coarse = 0.035, amount = 1) {
  const tex = noiseTex();
  m.onBeforeCompile = (s) => {
    s.uniforms.uNoise = { value: tex };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrainP;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 grainW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          grainW = instanceMatrix * grainW;
        #endif
        vGrainP = (modelMatrix * grainW).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrainP;\nuniform sampler2D uNoise;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec2 gp = vGrainP.xz + vGrainP.y * vec2(0.37, 0.61);
          float g1 = texture2D(uNoise, gp * ${fine.toFixed(3)}).r;
          float g2 = texture2D(uNoise, gp * ${coarse.toFixed(4)}).g;
          float g3 = texture2D(uNoise, gp * ${(fine * 4.1).toFixed(3)}).b;
          diffuseColor.rgb *= 1.0 + ${amount.toFixed(2)} * ((g1 - 0.5) * 0.34 + (g2 - 0.5) * 0.42 + (g3 - 0.5) * 0.12);
        }`);
  };
  m.customProgramCacheKey = () => `grain${fine}-${coarse}-${amount}`;
}
