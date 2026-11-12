// YouTube downloads. The "YouTube" API (youtube138, /ys route) gives the title
// and picture; the YouTube Info & Download API (/sn route) makes each file.
// here.now's proxy routes add the RapidAPI key, so it never reaches the browser.

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
  /** Came from the "YouTube" API and its links download straight to this browser. */
  direct?: boolean;
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

/** A Google link whose target is coded (google.com/goto?url=CAES…), so it must be asked. */
export function isOpaqueRedirect(input: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    return /^(?:www\.)?google\.[a-z.]+$/.test(u.hostname) && /^\/(?:goto|url)$/.test(u.pathname);
  } catch { return false; }
}

/** Ask Google (through the site's /gg route) where the link goes, and read the video from it. */
export async function resolveRedirect(input: string, signal?: AbortSignal): Promise<string | null> {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const res = await fetch(`/gg${u.pathname}${u.search}`, { signal, redirect: "follow" }).catch(() => null);
  if (!res) return null;
  const fromUrl = res.url && !res.url.includes("/gg/") ? parseVideoId(res.url) : null;
  if (fromUrl) return fromUrl;
  const body = await res.text().catch(() => "");
  const link = body.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^"'<>\s]+/)?.[0];
  if (link) return parseVideoId(link.replace(/&amp;/g, "&"));
  return body.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1] ?? null;
}

export class StreamError extends Error {}

type Json = Record<string, unknown>;

/**
 * The video's title, picture and length from the "YouTube" API (youtube138, /ys
 * route). The files themselves are made by the download server (prepareServer).
 */
export async function fetchInfo(id: string, signal?: AbortSignal): Promise<{ info: StreamInfo; remaining: number | null }> {
  let res: Response;
  try {
    res = await fetch(`/ys/video/details/?id=${encodeURIComponent(id)}&hl=en&gl=${COUNTRY}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new StreamError("You're offline, or Vortex Engine can't be reached.");
  }
  const left = res.headers.get("x-ratelimit-requests-remaining");
  const remaining = left !== null && left !== "" && !Number.isNaN(Number(left)) ? Number(left) : null;
  if (res.status === 429) throw new StreamError("The free quota is used up, or too many requests. Try again later.");
  const d = (res.ok ? await res.json().catch(() => null) : null) as Json | null;
  // Without details (API not set up or busy) the video can still be downloaded.
  const thumbs = (Array.isArray(d?.thumbnails) ? d!.thumbnails : []) as { url: string; width: number; height: number }[];
  return {
    remaining,
    info: {
      status: "OK", id,
      title: (typeof d?.title === "string" && d.title) || "YouTube video",
      lengthSeconds: d?.lengthSeconds != null ? String(d.lengthSeconds) : undefined,
      channelTitle: ((d?.author as Json | undefined)?.title as string | undefined) ?? undefined,
      thumbnail: thumbs.map((t) => ({ ...t, url: t.url.startsWith("//") ? `https:${t.url}` : t.url })),
    },
  };
}

/** Every choice is made into one file on the download server, then saved. */
export function buildPresets(info: StreamInfo): Preset[] {
  const url = `https://www.youtube.com/watch?v=${info.id}`;
  const video = ["1080", "720", "480", "360"].map((f): Preset => ({
    key: `s${f}`, kind: "video", label: `Video ${f}p`, detail: f === "360" ? "MP4 with sound · smallest, fastest" : "MP4 with sound",
    ext: "mp4", url, bytes: null, server: f,
  }));
  return [
    ...video,
    { key: "am4a", kind: "audio", label: "Audio · best for iPad", detail: "M4A (AAC)", ext: "m4a", url, bytes: null, server: "m4a" },
    { key: "amp3", kind: "audio", label: "Audio · MP3", detail: "MP3 · plays everywhere", ext: "mp3", url, bytes: null, server: "mp3" },
  ];
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
  if (res.status === 429) throw new StreamError("The free monthly download quota is used up. Try again later.");
  if (res.status === 401 || res.status === 403) {
    const why = (await res.text().catch(() => "")).slice(0, 200);
    throw new StreamError(`The downloader isn't connected (HTTP ${res.status}${why ? `: ${why}` : ""}). Check that the RAPIDAPI_KEY secret is the key of the app subscribed to YouTube Info & Download API.`);
  }
  const start = await res.json().catch(() => null) as { success?: boolean; progress_url?: string; message?: string } | null;
  if (!res.ok || !start?.success || !start.progress_url) throw new StreamError(`The downloader refused this video${start?.message ? `: ${start.message}` : ""}.`);
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2500));
    const p = await fetch(start.progress_url, { signal }).then((r) => r.json()).catch(() => null) as
      { download_url?: string | null; progress?: number; success?: number; text?: string } | null;
    if (!p) continue;
    if (p.download_url && (p.progress ?? 0) >= 1000) return p.download_url;
    if (p.text && /error|fail/i.test(p.text)) throw new StreamError(`The downloader couldn't make this video: ${p.text}`);
    onProgress(Math.min(1, (p.progress ?? 0) / 1000));
  }
  throw new StreamError("Preparing the video took too long. Try again.");
}
