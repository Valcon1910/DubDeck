// YouTube downloads through the YTStream API (RapidAPI). The browser calls
// /yt/dl on the Vortex Engine site; the here.now proxy route forwards it to
// ytstream-download-youtube-videos.p.rapidapi.com and adds the RapidAPI key,
// so the key never reaches the browser.

export const COUNTRY = "CO"; // links are generated for the end user's country (cgeo)

export interface StreamFormat {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  contentLength?: string;
  qualityLabel?: string;
  fps?: number;
  audioQuality?: string;
  audioTrack?: { displayName?: string; id?: string; audioIsDefault?: boolean };
  isDrc?: boolean;
}

export interface StreamInfo {
  status: string;
  msg?: string;
  id: string;
  title: string;
  lengthSeconds?: string;
  channelTitle?: string;
  thumbnail?: { url: string; width: number; height: number }[];
  formats?: StreamFormat[];
  adaptiveFormats?: StreamFormat[];
}

export type PresetKind = "video" | "audio";

export interface Preset {
  key: string;
  kind: PresetKind;
  label: string;
  detail: string;
  ext: string;
  url: string;
  bytes: number | null;
  /** Separate audio to combine with the video on this device (higher qualities). */
  audio?: { url: string; bytes: number | null };
  /** Made into one MP4 with sound on the downloader's servers (format name, e.g. "720"). */
  server?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Hosts whose links just forward to another address (Google search results, etc.). */
const REDIRECTORS = /^(?:www\.)?(?:google\.[a-z.]+|l\.facebook\.com|lm\.facebook\.com|l\.instagram\.com|t\.co|out\.reddit\.com)$/;

/** Extract the 11-character video ID from any common YouTube link (or a bare ID). */
export function parseVideoId(input: string, depth = 0): string | null {
  const text = input.trim();
  if (ID_RE.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // google.com/url?url=… or ?q=… (and similar forwarders): follow the real link inside.
  if (depth < 3 && (REDIRECTORS.test(url.hostname) || url.pathname === "/url")) {
    for (const key of ["url", "q", "u", "target"]) {
      const inner = url.searchParams.get(key);
      if (inner) {
        const id = parseVideoId(inner, depth + 1);
        if (id) return id;
      }
    }
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (!id && m) id = m[1];
  }
  return id && ID_RE.test(id) ? id : null;
}

export class StreamError extends Error {}

export async function fetchInfo(id: string, signal?: AbortSignal): Promise<{ info: StreamInfo; remaining: number | null }> {
  let res: Response;
  try {
    res = await fetch(`/yt/dl?id=${encodeURIComponent(id)}&cgeo=${COUNTRY}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new StreamError("You're offline, or Vortex Engine can't be reached.");
  }
  const left = res.headers.get("x-ratelimit-requests-remaining");
  const remaining = left !== null && left !== "" && !Number.isNaN(Number(left)) ? Number(left) : null;
  if (res.status === 429) throw new StreamError("The free monthly quota is used up, or too many requests. Try again later.");
  if (res.status === 401 || res.status === 403) {
    throw new StreamError("The downloader isn't connected: the RapidAPI key is missing or not subscribed.");
  }
  if (res.status === 404) throw new StreamError("The downloader route isn't set up on this site yet.");
  let info: StreamInfo;
  try {
    info = (await res.json()) as StreamInfo;
  } catch {
    throw new StreamError(`The downloader answered with an error (${res.status}). Try again.`);
  }
  if (!res.ok || info.status !== "OK") {
    throw new StreamError(info.msg ? `YouTube: ${info.msg}` : "That video couldn't be loaded. It may be private, age-restricted or removed.");
  }
  return { info, remaining };
}

const size = (f: StreamFormat) => (f.contentLength ? Number(f.contentLength) : null);
const isAudio = (f: StreamFormat) => f.mimeType.startsWith("audio/");
const isH264 = (f: StreamFormat) => /avc1/.test(f.mimeType);
/** Original-language track (or the only one); dubbed tracks and loudness-compressed copies are skipped. */
const isMainAudio = (f: StreamFormat) => (!f.audioTrack || f.audioTrack.audioIsDefault) && !f.isDrc;

/** Turn the API's formats into the presets the page offers, best first within each group. */
export function buildPresets(info: StreamInfo): Preset[] {
  const out: Preset[] = [];

  for (const f of [...(info.formats ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))) {
    if (!f.url) continue;
    out.push({
      key: `v${f.itag}`, kind: "video", label: `Video ${f.qualityLabel ?? ""}`.trim(),
      detail: "MP4 with sound · plays everywhere", ext: "mp4", url: f.url, bytes: size(f),
    });
  }

  const audio = (info.adaptiveFormats ?? []).filter((f) => f.url && isAudio(f) && isMainAudio(f));
  const best = (pred: (f: StreamFormat) => boolean) =>
    audio.filter(pred).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const m4a = best((f) => f.mimeType.startsWith("audio/mp4"));
  const opus = best((f) => f.mimeType.startsWith("audio/webm"));
  if (m4a) out.push({
    key: `a${m4a.itag}`, kind: "audio", label: "Audio · best for iPad",
    detail: `M4A (AAC) · ~${Math.round((m4a.bitrate ?? 0) / 1000)} kbps`, ext: "m4a", url: m4a.url!, bytes: size(m4a),
  });
  if (opus) out.push({
    key: `a${opus.itag}`, kind: "audio", label: "Audio · highest quality",
    detail: `WebM (Opus) · ~${Math.round((opus.bitrate ?? 0) / 1000)} kbps · may not play in Apple apps`, ext: "webm", url: opus.url!, bytes: size(opus),
  });

  // 720p/1080p with sound: joined on the YouTube Info & Download API's servers.
  if (!hdEnabled()) {
    const vids = out.filter((p) => p.kind === "video");
    const rest = out.filter((p) => p.kind !== "video");
    // Expected size: YouTube's own picture file at that height (H.264 when listed) plus the M4A sound.
    const est = (h: number) => {
      const v = (info.adaptiveFormats ?? []).filter((f) => !isAudio(f) && f.height === h && f.contentLength)
        .sort((a, b) => Number(isH264(b)) - Number(isH264(a)))[0];
      return v ? size(v)! + (m4a ? size(m4a) ?? 0 : 0) : null;
    };
    const server: Preset[] = ["1080", "720"].map((f) => ({
      key: `s${f}`, kind: "video", label: `Video ${f}p`, detail: "MP4 with sound · prepared online, may take a minute",
      ext: "mp4", url: `https://www.youtube.com/watch?v=${info.id}`, bytes: est(Number(f)), server: f,
    }));
    return [...server, ...vids, ...rest];
  }

  // Higher qualities: YouTube keeps picture and sound apart, so each is paired
  // with the best M4A audio and combined on this device. H.264 plays everywhere.
  if (m4a && hdEnabled()) {
    const seen = new Set<string>(out.filter((p) => p.kind === "video").map((p) => p.label));
    const combos: Preset[] = [];
    for (const f of (info.adaptiveFormats ?? [])
      .filter((f) => f.url && !isAudio(f) && isH264(f))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0))) {
      const label = `Video ${f.qualityLabel ?? `${f.height}p`}`;
      if (seen.has(label)) continue;
      seen.add(label);
      const v = size(f), a = size(m4a);
      combos.push({
        key: `c${f.itag}`, kind: "video", label,
        detail: "MP4 with sound · combined on this device", ext: "mp4", url: f.url!,
        bytes: v && a ? v + a : null, audio: { url: m4a.url!, bytes: a },
      });
    }
    const progressive = out.filter((p) => p.kind === "video");
    const rest = out.filter((p) => p.kind !== "video");
    const height = (p: Preset) => parseInt(p.label.replace(/\D+/, ""), 10) || 0;
    return [...[...combos, ...progressive].sort((a, b) => height(b) - height(a)), ...rest];
  }
  return out;
}

/**
 * 720p/1080p (combined on the device) are hidden for now: YouTube refuses
 * these links when the site's relay fetches them (HTTP 403), and the browser
 * may not read them directly. Add ?hd to the address (e.g. #/downloader?hd) (or set
 * localStorage "vortex.hd" = "1") to show them for testing.
 */
export function hdEnabled(): boolean {
  try {
    return /[?&]hd\b/.test(location.hash) || localStorage.getItem("vortex.hd") === "1";
  } catch {
    return false;
  }
}

export function formatBytes(n: number | null): string {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDuration(sec?: string): string {
  const s = Number(sec ?? 0);
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/**
 * The video's exact title as the file name. Only "/" and "\\" (which can't be in
 * any file name) and invisible control characters are changed; the browser
 * handles the rest (Safari keeps the title as is).
 */
export function safeFilename(title: string, ext: string): string {
  const base = title.replace(/[\\/]/g, "-").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/^\.+/, "").slice(0, 200) || "video";
  return `${base}.${ext}`;
}

const RELAY_HOST = "https://redirector.googlevideo.com/";
/** The same file through the site's /gv proxy route (same origin), when possible. */
export function relayUrl(url: string): string | null {
  return url.startsWith(RELAY_HOST) ? `/gv/${url.slice(RELAY_HOST.length)}` : null;
}

export function bestThumb(info: StreamInfo): string | undefined {
  const t = [...(info.thumbnail ?? [])].sort((a, b) => b.width - a.width);
  return (t.find((x) => x.width <= 720) ?? t[0])?.url ?? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
}

/** Ask the server to make one MP4 with sound, wait until it's ready, return its link. */
export async function prepareServer(id: string, format: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const yt = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const res = await fetch(`/sn/ajax/download.php?format=${format}&url=${yt}`, { signal });
  if (res.status === 429) throw new StreamError("The free monthly quota for HD is used up. Try again later, or pick 360p.");
  if (res.status === 401 || res.status === 403) {
    const why = (await res.text().catch(() => "")).slice(0, 200);
    throw new StreamError(`The HD downloader isn't connected (HTTP ${res.status}${why ? `: ${why}` : ""}). Check that the RAPIDAPI_KEY secret is the key of the app subscribed to YouTube Info & Download API.`);
  }
  const start = await res.json().catch(() => null) as { success?: boolean; progress_url?: string; message?: string } | null;
  if (!res.ok || !start?.success || !start.progress_url) throw new StreamError(`The HD downloader refused this video${start?.message ? `: ${start.message}` : ""}.`);
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2500));
    const p = await fetch(start.progress_url, { signal }).then((r) => r.json()).catch(() => null) as
      { download_url?: string | null; progress?: number; success?: number; text?: string } | null;
    if (!p) continue;
    if (p.download_url && (p.progress ?? 0) >= 1000) return p.download_url;
    if (p.text && /error|fail/i.test(p.text)) throw new StreamError(`The HD downloader couldn't make this video: ${p.text}`);
    onProgress(Math.min(1, (p.progress ?? 0) / 1000));
  }
  throw new StreamError("Preparing the video took too long. Try again.");
}
