// Built-in maps' card pictures, made ahead (scripts/hexdrift-thumbs.mjs): no 3D needed to show them.
const THUMBS = Object.fromEntries(Object.entries(import.meta.glob<string>("./thumbs/*.webp", { eager: true, query: "?url", import: "default" }))
  .map(([k, v]) => [k.slice(9, -5), v]));
export const thumbOf = (id: string): string | undefined => THUMBS[id];

// And their clips (scripts/hexdrift-clips.mjs): a few seconds of the autopilot driving the map.
const CLIPS = Object.fromEntries(Object.entries(import.meta.glob<string>("./clips/*.mp4", { eager: true, query: "?url", import: "default" }))
  .map(([k, v]) => [k.slice(8, -4), v]));
export const clipOf = (id: string): string | undefined => CLIPS[id];
