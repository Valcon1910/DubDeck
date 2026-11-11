import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  channelInfo, channelVideos, SearchError, searchVideos,
  type ChannelInfo, type ChannelTab, type Item, type VideoItem,
} from "./ytsearch";

type View =
  | { kind: "search"; q: string }
  | { kind: "channel"; id: string; title?: string };

export interface Selection { on: boolean; ids: Set<string>; toggle: (v: VideoItem) => void; setOn: (on: boolean) => void }

/** Search results and channel pages. Picking a video hands its id to the downloader. */
export function Browse({ request, onPick: pickOne, select }: { request: { q: string; n: number } | null; onPick: (v: VideoItem) => void; select: Selection }) {
  const onPick = select.on ? select.toggle : pickOne;
  const [stack, setStack] = useState<View[]>([]);
  useEffect(() => { setStack(request ? [{ kind: "search", q: request.q }] : []); }, [request]);
  const view = stack[stack.length - 1];
  if (!view) return null;
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const openChannel = (id: string, title?: string) => setStack((s) => [...s, { kind: "channel", id, title }]);
  return (
    <Sel.Provider value={select}>
      <div className="vx-select-row">
        <button type="button" className={`vx-btn vx-btn-sm ${select.on ? "vx-btn-primary" : "vx-btn-ghost"}`} aria-pressed={select.on} onClick={() => select.setOn(!select.on)}>
          {select.on ? "Done selecting" : "Select videos"}
        </button>
        {select.on && <span className="vx-muted vx-small">Tap videos to add them, then press Download all.</span>}
      </div>
      {view.kind === "search"
        ? <SearchResults key={view.q} q={view.q} onPick={onPick} onChannel={openChannel} />
        : <ChannelPage key={view.id} id={view.id} onBack={back} onPick={onPick} />}
    </Sel.Provider>
  );
}

const Sel = createContext<Selection | null>(null);

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setError(null);
    load(ctrl.signal).then(setData).catch((e) => {
      if ((e as Error).name !== "AbortError") setError(e instanceof SearchError ? e.message : "Something went wrong. Try again.");
    });
    return () => ctrl.abort();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

function SearchResults({ q, onPick, onChannel }: { q: string; onPick: (v: VideoItem) => void; onChannel: (id: string, title?: string) => void }) {
  const { data, error } = useLoad((s) => searchVideos(q, s), [q]);
  return (
    <section className="vx-browse" aria-label={`Results for ${q}`}>
      <h2 className="vx-browse-title">Results for “{q}”</h2>
      {error && <p className="vx-alert vx-alert-error" role="alert">{error}</p>}
      {!data && !error && <GridSkeleton />}
      {data && data.items.length === 0 && <p className="vx-muted">No videos found. Try other words.</p>}
      {data && data.items.length > 0 && (
        <ul className="vx-vgrid">
          {data.items.map((it: Item) => it.kind === "channel" ? (
            <li key={`c${it.id}`} className="vx-vchannel">
              <button type="button" onClick={() => onChannel(it.id, it.title)}>
                <img src={it.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <strong>{it.title}</strong>
                {it.subscribers && <span className="vx-muted vx-small">{it.subscribers} subscribers</span>}
                <span className="vx-chip-btn">View channel</span>
              </button>
            </li>
          ) : (
            <li key={`v${it.id}`}><VideoCard v={it} onPick={onPick} onChannel={onChannel} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TABS: [ChannelTab, string][] = [["videos_latest", "Videos"], ["shorts_latest", "Shorts"], ["streams_latest", "Live"]];

function ChannelPage({ id, onBack, onPick }: { id: string; onBack?: () => void; onPick: (v: VideoItem) => void }) {
  const info = useLoad<ChannelInfo>((s) => channelInfo(id, s), [id]);
  const [tab, setTab] = useState<ChannelTab>("videos_latest");
  const [list, setList] = useState<VideoItem[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setList(null); setError(null); setCursor(undefined);
    channelVideos(id, tab, undefined, c.signal)
      .then((r) => { setList(r.items); setCursor(r.cursor); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError(e instanceof SearchError ? e.message : "Couldn't load the videos."); });
    return () => c.abort();
  }, [id, tab]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const r = await channelVideos(id, tab, cursor);
      setList((l) => [...(l ?? []), ...r.items.filter((v) => !l?.some((x) => x.id === v.id))]);
      setCursor(r.cursor);
    } catch (e) {
      setError(e instanceof SearchError ? e.message : "Couldn't load more.");
    } finally {
      setMore(false);
    }
  }

  const ch = info.data;
  return (
    <section className="vx-browse vx-channel" aria-label={ch?.title ?? "Channel"}>
      {onBack && <button type="button" className="vx-link vx-back" onClick={onBack}>‹ Back to results</button>}
      {info.error && <p className="vx-alert vx-alert-error" role="alert">{info.error}</p>}
      <div className="vx-channel-banner" style={ch?.banner ? { backgroundImage: `url("${ch.banner}")` } : undefined} />
      <div className="vx-channel-head">
        {ch?.avatar ? <img className="vx-channel-avatar" src={ch.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="vx-channel-avatar" />}
        <div>
          <h2>{ch?.title ?? "Loading…"}</h2>
          <p className="vx-muted vx-small">{[ch?.subscribers && `${ch.subscribers} subscribers`, ch?.videos && `${ch.videos} videos`].filter(Boolean).join(" · ")}</p>
          {ch?.description && <p className="vx-muted vx-small vx-clamp">{ch.description}</p>}
        </div>
      </div>
      <div className="vx-seg" role="tablist" aria-label="Channel content">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-checked={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {error && <p className="vx-alert vx-alert-error" role="alert">{error}</p>}
      {!list && !error && <GridSkeleton />}
      {list && list.length === 0 && <p className="vx-muted">Nothing here yet.</p>}
      {list && list.length > 0 && (
        <ul className={`vx-vgrid ${tab === "shorts_latest" ? "vx-vgrid-shorts" : ""}`}>
          {list.map((v) => <li key={v.id}><VideoCard v={v} onPick={onPick} /></li>)}
        </ul>
      )}
      {cursor && list && (
        <button type="button" className="vx-btn vx-btn-ghost" disabled={more} onClick={loadMore}>
          {more && <span className="vx-spinner" aria-hidden="true" />}Load more
        </button>
      )}
    </section>
  );
}

function VideoCard({ v, onPick, onChannel }: { v: VideoItem; onPick: (v: VideoItem) => void; onChannel?: (id: string, title?: string) => void }) {
  const sel = useContext(Sel);
  const picked = !!sel?.ids.has(v.id);
  return (
    <article className={`vx-vcard ${picked ? "vx-picked" : ""}`}>
      <button type="button" className="vx-vthumb" onClick={() => onPick(v)}
        aria-label={sel?.on ? `Select ${v.title}` : `Download ${v.title}`} aria-pressed={sel?.on ? picked : undefined}>
        <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
        {v.duration && <span className="vx-vdur">{v.duration}</span>}
        {sel?.on && <span className="vx-vcheck" aria-hidden="true">{picked ? "✓" : ""}</span>}
      </button>
      <div className="vx-vmeta">
        <button type="button" className="vx-vtitle" onClick={() => onPick(v)}>{v.title}</button>
        {v.channelTitle && (onChannel && v.channelId
          ? <button type="button" className="vx-vchan" onClick={() => onChannel(v.channelId!, v.channelTitle)}>
              {v.channelAvatar && <img src={v.channelAvatar} alt="" referrerPolicy="no-referrer" />}{v.channelTitle}
            </button>
          : <span className="vx-vchan">{v.channelTitle}</span>)}
        <span className="vx-muted vx-small">{[v.views && `${v.views} views`, v.published].filter(Boolean).join(" · ")}</span>
      </div>
    </article>
  );
}

function GridSkeleton() {
  return (
    <ul className="vx-vgrid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <li key={i}><div className="vx-vthumb vx-skeleton" /></li>)}
    </ul>
  );
}
