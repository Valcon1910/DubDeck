export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${units[i]}`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Extract http(s) URLs from pasted text (one per line, or anywhere in it). */
export function extractUrls(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"'`]+/gi) ?? [];
  const bare = text
    .split(/\s+/)
    .filter((t) => /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(t) && !/^https?:/i.test(t))
    .map((t) => `https://${t}`);
  const all = [...found, ...bare].map((u) => u.replace(/[),.;]+$/, ""));
  return [...new Set(all)].slice(0, 50);
}

/** Only allow http(s) image URLs into <img src>. */
export function safeImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, window.location.href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Deterministic pseudo-random generator so each job keeps the same waveform. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- color / contrast (WCAG) -------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Darken/lighten `color` toward black/white until it reaches `ratio` against `bg`. */
export function ensureContrast(color: string, bg: string, ratio = 4.5): string {
  if (contrast(color, bg) >= ratio) return color;
  const target = luminance(bg) > 0.5 ? "#000000" : "#ffffff";
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(color, target, t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return target;
}

/** Black or white text, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return contrast("#ffffff", bg) >= contrast("#111111", bg) ? "#ffffff" : "#111111";
}

export function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
