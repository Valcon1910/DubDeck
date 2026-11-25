// Profile pictures can be cropped. Still pictures are cropped for real when
// chosen; animated GIFs keep every frame, so their crop travels with the
// picture's address as "#c=x,y,zoom" and is applied when shown:
//   object-fit: cover; object-position: x y; transform: scale(zoom) around x y.
// x and y run 0–1 (where the window sits across the picture), zoom 1–4.
import type { CSSProperties } from "react";

export interface Crop { x: number; y: number; zoom: number }

export const NO_CROP: Crop = { x: 0.5, y: 0.5, zoom: 1 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function readCrop(src: string): Crop | null {
  const m = src.match(/#c=([\d.]+),([\d.]+),([\d.]+)$/);
  if (!m) return null;
  return { x: clamp(Number(m[1]), 0, 1), y: clamp(Number(m[2]), 0, 1), zoom: clamp(Number(m[3]), 1, 4) };
}

export const stripCrop = (src: string) => src.replace(/#c=[\d.,]+$/, "");

export const withCrop = (src: string, c: Crop) =>
  `${stripCrop(src)}#c=${c.x.toFixed(3)},${c.y.toFixed(3)},${c.zoom.toFixed(3)}`;

/** Style for an <img> filling a square frame (the frame clips). */
export function cropStyle(c: Crop | null): CSSProperties {
  const k = c ?? NO_CROP;
  const pos = `${(k.x * 100).toFixed(1)}% ${(k.y * 100).toFixed(1)}%`;
  return { objectFit: "cover", objectPosition: pos, ...(k.zoom > 1.001 ? { transform: `scale(${k.zoom})`, transformOrigin: pos } : {}) };
}

/** The part of the picture (in its own pixels) a crop shows. */
export function cropRect(w: number, h: number, c: Crop) {
  const side = Math.min(w, h) / c.zoom;
  return { sx: c.x * (w - side), sy: c.y * (h - side), side };
}
