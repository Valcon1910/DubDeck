// Search YouTube and browse channels through the "YouTube" API on RapidAPI
// (youtube138.p.rapidapi.com). The browser calls /ys/... on this site; the
// here.now proxy route adds the RapidAPI key, so it never reaches the browser.

export interface VideoItem {
  kind: "video";
  id: string;
  title: string;
  thumb: string;
  channelId?: string;
  channelTitle?: string;
  channelAvatar?: string;
  duration?: string;
  views?: string;
  published?: string;
}
export interface ChannelItem {
  kind: "channel";
  id: string;
  title: string;
  avatar: string;
  subscribers?: string;
  description?: string;
}
export type Item = VideoItem | ChannelItem;

export interface ChannelInfo {
  id: string;
  title: string;
  avatar: string;
  banner: string;
  subscribers?: string;
  videos?: string;
  description?: string;
}

export type ChannelTab = "videos_latest" | "shorts_latest" | "streams_latest";

export class SearchError extends Error {}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);

/** The biggest picture in a thumbnails list (fixing "//host/..." links). */
function bestUrl(list: unknown): string {
  const arr = Array.isArray(list) ? list.map(obj) : [];
  const best = arr.sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0];
  const url = str(best?.url) ?? "";
  return url.startsWith("//") ? `https:${url}` : url;
}

function compact(n: unknown): string | undefined {
  const v = typeof n === "number" ? n : typeof n === "string" && /^\d+$/.test(n) ? Number(n) : NaN;
  if (Number.isNaN(v)) return str(n);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

function duration(sec: unknown): string | undefined {
  const s = Number(sec);
  if (!s) return undefined;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(r).padStart(2, "0")}`;
}

function toItem(raw: unknown): Item | null {
  const entry = obj(raw);
  const v = obj(entry.video);
  const c = obj(entry.channel);
  const type = str(entry.type);
  if ((type === "video" || type === "short" || str(v.videoId)) && str(v.videoId ?? entry.videoId)) {
    const src = str(v.videoId) ? v : entry;
    const author = obj(src.author);
    const id = str(src.videoId)!;
    return {
      kind: "video", id,
      title: str(src.title) ?? "Untitled video",
      thumb: bestUrl(src.thumbnails) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channelId: str(author.channelId), channelTitle: str(author.title), channelAvatar: bestUrl(author.avatar),
      duration: duration(src.lengthSeconds) ?? str(src.lengthText),
      views: compact(obj(src.stats).views ?? src.viewCount),
      published: str(src.publishedTimeText),
    };
  }
  if ((type === "channel" || str(c.channelId)) && str(c.channelId)) {
    return {
      kind: "channel", id: str(c.channelId)!, title: str(c.title) ?? "Channel",
      avatar: bestUrl(c.avatar), subscribers: compact(obj(c.stats).subscribers) ?? str(c.subscriberCountText),
      description: str(c.description),
    };
  }
  return null;
}

async function call(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Json> {
  const qs = new URLSearchParams({ hl: "en", gl: "CO", ...params });
  let res: Response;
  try {
    res = await fetch(`/ys/${path}/?${qs}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new SearchError("You're offline, or Vortex Engine can't be reached.");
  }
  if (res.status === 429) throw new SearchError("The free search quota is used up for now. Try again later, or paste a link.");
  if (res.status === 401 || res.status === 403) {
    const why = (await res.text().catch(() => "")).slice(0, 160);
    throw new SearchError(`Search isn't connected: subscribe to the "YouTube" API on RapidAPI with the same app${why ? ` (${why})` : ""}.`);
  }
  if (res.status === 404) throw new SearchError("Search isn't set up on this site yet.");
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new SearchError(`Search answered with an error (${res.status}). Try again.`);
  return obj(data);
}

const shallow = (d: Json) => (Array.isArray(d.contents) ? d.contents : Array.isArray(d.videos) ? d.videos : []).map(toItem).filter((x): x is Item => !!x);

/** Any object with a videoId anywhere in the answer (the API's layout differs per tab). */
function deep(d: unknown, out: Item[] = [], seen = new Set<string>(), depth = 0): Item[] {
  if (depth > 8 || !d || typeof d !== "object") return out;
  if (Array.isArray(d)) { d.forEach((x) => deep(x, out, seen, depth + 1)); return out; }
  const o = d as Json;
  if (str(o.videoId) && str(o.title ?? obj(o.title).text)) {
    const it = toItem({ type: "video", video: o });
    if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
    return out;
  }
  Object.values(o).forEach((x) => deep(x, out, seen, depth + 1));
  return out;
}

const items = (d: Json) => { const a = shallow(d); return a.length ? a : deep(d); };

/** YouTube's public feed of a channel's latest uploads (through the site's /yf route). */
async function feedVideos(id: string, signal?: AbortSignal): Promise<VideoItem[]> {
  const res = await fetch(`/yf/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { signal }).catch(() => null);
  if (!res?.ok) return [];
  const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
  const author = xml.querySelector("feed > title")?.textContent ?? undefined;
  return [...xml.getElementsByTagName("entry")].map((e) => {
    const vid = e.getElementsByTagName("yt:videoId")[0]?.textContent ?? "";
    const views = e.getElementsByTagName("media:statistics")[0]?.getAttribute("views");
    const when = e.getElementsByTagName("published")[0]?.textContent;
    return {
      kind: "video" as const, id: vid, title: e.getElementsByTagName("title")[0]?.textContent ?? "Untitled video",
      thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, channelId: id, channelTitle: author,
      views: views ? compact(views) : undefined, published: when ? new Date(when).toLocaleDateString() : undefined,
    };
  }).filter((v) => v.id);
}

export async function searchVideos(q: string, signal?: AbortSignal): Promise<{ items: Item[]; cursor?: string }> {
  const d = await call("search", { q }, signal);
  return { items: items(d), cursor: str(d.cursor) };
}

export async function channelInfo(id: string, signal?: AbortSignal): Promise<ChannelInfo> {
  const d = await call("channel/details", { id }, signal);
  const banner = obj(d.banner);
  return {
    id: str(d.channelId) ?? id,
    title: str(d.title) ?? "Channel",
    avatar: bestUrl(d.avatar),
    banner: bestUrl(banner.desktop ?? banner.tv ?? banner.mobile ?? d.banner),
    subscribers: compact(obj(d.stats).subscribers),
    videos: compact(obj(d.stats).videos),
    description: str(d.description),
  };
}

export async function channelVideos(id: string, filter: ChannelTab, cursor?: string, signal?: AbortSignal): Promise<{ items: VideoItem[]; cursor?: string }> {
  const vids = (d: Json) => items(d).filter((x): x is VideoItem => x.kind === "video");
  const d = await call("channel/videos", { id, filter, ...(cursor ? { cursor } : {}) }, signal);
  let list = vids(d);
  if (list.length || cursor) return { items: list, cursor: str(d.cursor) };
  // Some channels come back empty for a filter: ask again without it, then use the public feed.
  if (filter === "videos_latest") {
    const plain = await call("channel/videos", { id }, signal).catch(() => null);
    list = plain ? vids(plain) : [];
    if (list.length) return { items: list, cursor: str(plain!.cursor) };
    return { items: await feedVideos(id, signal) };
  }
  if (filter !== "streams_latest") return { items: [] };
  const live = await call("channel/videos", { id, filter: "live_now" }, signal).catch(() => null);
  return { items: live ? vids(live) : [] };
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
