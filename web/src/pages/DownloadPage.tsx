import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { baseOptions, describeOptions, QUALITIES, TEMPLATE_TOKENS } from "../defaults";
import { useLive } from "../live";
import { useRouter } from "../router";
import { useSettings } from "../settings";
import { useToast } from "../toasts";
import type { DownloadOptions, Job, PlaylistPreview, Preset, PresetOptions, Preview, Settings, VideoPreview } from "../types";
import { clsx, extractUrls, formatBytes, formatDuration, safeImg } from "../util";

interface Item {
  key: string;
  url: string;
  status: "loading" | "ready" | "error";
  preview?: Preview;
  error?: { code: string; message: string };
  include: boolean;
  selected: Set<string>; // playlist entry URLs
}

const PREVIEW_CONCURRENCY = 4;
const ERROR_TITLES: Record<string, string> = {
  unsupported_site: "Unsupported site",
  private: "Private video",
  age_restricted: "Age-restricted",
  region_blocked: "Blocked in this region",
  bot_check: "Site wants verification",
  login_required: "Sign-in required",
  removed: "Unavailable",
  blocked_host: "Not allowed",
  invalid_url: "Invalid link",
};

function optionsFromPreset(p: Preset | undefined, s: Settings): DownloadOptions {
  const o: PresetOptions = { ...baseOptions, ...(p?.options ?? {}) };
  return {
    ...o,
    mp4Compat: s.defaults.mp4Compat,
    embedCover: s.defaults.embedCover,
    filenameTemplate: o.filenameTemplate && o.filenameTemplate !== "{title}" ? o.filenameTemplate : s.defaults.filenameTemplate,
    subtitles: o.subtitles ?? null,
    trimStart: null,
    trimEnd: null,
    tags: null,
  };
}

function renderTemplate(template: string, p: VideoPreview | undefined, o: DownloadOptions): string {
  const date = p?.uploadDate && p.uploadDate.length === 8 ? `${p.uploadDate.slice(0, 4)}-${p.uploadDate.slice(4, 6)}-${p.uploadDate.slice(6)}` : "";
  const quality = o.kind === "audio" ? describeOptions(o) : o.quality === "best" ? `${p?.heights[0] ?? 1080}p` : `${o.quality}p`;
  const values: Record<string, string> = {
    title: o.tags?.title || p?.title || "Video title",
    channel: p?.channel ?? "Channel",
    artist: o.tags?.artist || p?.artist || p?.channel || "Artist",
    album: o.tags?.album || p?.album || "",
    id: p?.id ?? "abc123",
    date,
    quality,
    format: o.kind === "audio" ? o.audioFormat : o.container,
    site: p?.site ?? "Site",
  };
  const out = template.replace(/\{([a-z]+)\}/g, (m, k: string) => (k in values ? values[k] : m));
  return `${out.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim() || "download"}.${o.kind === "audio" ? o.audioFormat : o.container}`;
}

export function DownloadPage({ intake }: { intake: { urls: string[]; nonce: number } | null }) {
  const { settings, update } = useSettings();
  const { upsert } = useLive();
  const { go } = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [presetId, setPresetId] = useState(settings.defaults.presetId);
  const [opts, setOpts] = useState<DownloadOptions>(() =>
    optionsFromPreset(settings.presets.find((p) => p.id === settings.defaults.presetId), settings));
  const [submitting, setSubmitting] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const queue = useRef<Item[]>([]);
  const running = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const patchItem = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const pump = useCallback(() => {
    while (running.current < PREVIEW_CONCURRENCY && queue.current.length) {
      const item = queue.current.shift()!;
      running.current++;
      api<Preview>("/api/preview", { body: { url: item.url } })
        .then((preview) => {
          const selected = new Set(preview.type === "playlist" ? preview.entries.map((e) => e.url) : []);
          patchItem(item.key, { status: "ready", preview, selected });
        })
        .catch((e: ApiError) => patchItem(item.key, { status: "error", error: { code: e.code, message: e.message } }))
        .finally(() => {
          running.current--;
          pump();
        });
    }
  }, []);

  const addUrls = useCallback(
    (urls: string[]) => {
      setItems((list) => {
        const have = new Set(list.map((i) => i.url));
        const fresh = urls.filter((u) => !have.has(u)).map<Item>((url) => ({
          key: `${url}#${Math.random().toString(36).slice(2, 8)}`, url, status: "loading", include: true, selected: new Set(),
        }));
        queue.current.push(...fresh);
        setTimeout(pump, 0);
        return [...list, ...fresh];
      });
    },
    [pump],
  );

  useEffect(() => {
    if (!intake) return;
    setText(intake.urls.join("\n"));
    addUrls(intake.urls);
  }, [intake, addUrls]);

  const submitText = () => {
    const urls = extractUrls(text);
    if (!urls.length) {
      toast.push("Paste a link that starts with http:// or https://", "error");
      return;
    }
    addUrls(urls);
  };

  const ready = items.filter((i) => i.status === "ready" && i.include);
  const videos = ready.map((i) => i.preview).filter((p): p is VideoPreview => p?.type === "video");
  const single = ready.length === 1 && videos.length === 1 ? videos[0] : undefined;
  const jobItems = useMemo(
    () =>
      ready.flatMap((it) => {
        const p = it.preview!;
        if (p.type === "video") {
          return [{ url: p.url || it.url, title: p.title, channel: p.channel, thumbnail: p.thumbnail, duration: p.duration }];
        }
        return p.entries.filter((e) => it.selected.has(e.url)).map((e) => ({
          url: e.url, title: e.title, channel: e.channel ?? p.channel, thumbnail: e.thumbnail, duration: e.duration,
        }));
      }),
    [ready],
  );

  const setPreset = (id: string) => {
    setPresetId(id);
    const p = settings.presets.find((x) => x.id === id);
    setOpts((prev) => ({ ...optionsFromPreset(p, settings), trimStart: prev.trimStart, trimEnd: prev.trimEnd, tags: prev.tags }));
  };
  const set = <K extends keyof DownloadOptions>(k: K, v: DownloadOptions[K]) => {
    setOpts((o) => ({ ...o, [k]: v }));
    setPresetId("");
  };

  const submit = async () => {
    if (!jobItems.length) return;
    setSubmitting(true);
    const payload: DownloadOptions = {
      ...opts,
      trimStart: opts.trimStart?.trim() || null,
      trimEnd: opts.trimEnd?.trim() || null,
      tags: opts.kind === "audio" && single && opts.tags ? opts.tags : null,
      subtitles: opts.kind === "video" ? opts.subtitles || null : null,
    };
    try {
      let total = 0;
      for (let i = 0; i < jobItems.length; i += 200) {
        const res = await api<{ jobs: Job[] }>("/api/jobs", { body: { items: jobItems.slice(i, i + 200), options: payload } });
        res.jobs.forEach(upsert);
        total += res.jobs.length;
      }
      toast.push(`${total} ${total === 1 ? "download" : "downloads"} added to the queue`, "success", { label: "View queue", run: () => go("queue") });
      setItems([]);
      setText("");
      setOpts((o) => ({ ...o, trimStart: null, trimEnd: null, tags: null }));
    } catch (e) {
      toast.push((e as ApiError).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const subtitleLangs = useMemo(() => {
    const langs = new Set<string>();
    videos.forEach((v) => {
      v.subtitles.forEach((l) => langs.add(l));
      if (opts.autoSubs) v.autoSubtitles.forEach((l) => langs.add(l));
    });
    return [...langs].sort();
  }, [videos, opts.autoSubs]);

  const maxHeight = single?.heights[0];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Download</h1>
          <p className="muted">Paste links to videos, songs or playlists. Press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere on the page to paste and preview.</p>
        </div>
      </header>

      <section className="card intake">
        <label htmlFor="urls" className="sr-only">Links</label>
        <textarea
          id="urls"
          ref={inputRef}
          className="url-input mono"
          rows={Math.min(6, Math.max(2, text.split("\n").length))}
          placeholder={"https://www.youtube.com/watch?v=…\nhttps://soundcloud.com/…"}
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !text.includes("\n"))) {
              e.preventDefault();
              submitText();
            }
          }}
          onPaste={(e) => {
            const urls = extractUrls(e.clipboardData.getData("text"));
            if (urls.length) {
              e.preventDefault();
              setText((t) => (t.trim() ? `${t.trim()}\n${urls.join("\n")}` : urls.join("\n")));
              addUrls(urls);
            }
          }}
        />
        <div className="intake-actions">
          <span className="fine">One link per line · Enter to preview</span>
          <div className="row">
            {items.length > 0 && <button className="btn btn-ghost" onClick={() => { setItems([]); setText(""); }}>Clear</button>}
            <button className="btn btn-primary" onClick={submitText}><Icon name="search" size={18} /> Preview</button>
          </div>
        </div>
      </section>

      {items.length > 0 && (
        <div className="download-grid">
          <section className="previews" aria-label="Previews">
            {items.map((it) => (
              <PreviewCard
                key={it.key}
                item={it}
                onToggle={(include) => patchItem(it.key, { include })}
                onRemove={() => setItems((l) => l.filter((x) => x.key !== it.key))}
                onRetry={() => {
                  patchItem(it.key, { status: "loading", error: undefined });
                  queue.current.push(it);
                  pump();
                }}
                onSelect={(selected) => patchItem(it.key, { selected })}
              />
            ))}
          </section>

          <aside className="card options" aria-label="Download options">
            <div className="field">
              <label htmlFor="preset">Preset</label>
              <select id="preset" value={presetId} onChange={(e) => setPreset(e.target.value)}>
                {!presetId && <option value="">Custom</option>}
                {settings.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="field">
              <span className="label" id="kind-label">Type</span>
              <div className="segmented" role="radiogroup" aria-labelledby="kind-label">
                {(["video", "audio"] as const).map((k) => (
                  <button key={k} role="radio" aria-checked={opts.kind === k} className={clsx(opts.kind === k && "is-on")}
                    onClick={() => {
                      set("kind", k);
                      if (k === "audio") setOpts((o) => ({ ...o, kind: k, audioFormat: settings.defaults.audioFormat, audioBitrate: settings.defaults.audioBitrate }));
                    }}>
                    <Icon name={k === "video" ? "film" : "music"} size={16} /> {k === "video" ? "Video" : "Audio"}
                  </button>
                ))}
              </div>
            </div>

            {opts.kind === "video" ? (
              <>
                <div className="field">
                  <label htmlFor="quality">Quality</label>
                  <select id="quality" value={opts.quality} onChange={(e) => set("quality", e.target.value as DownloadOptions["quality"])}>
                    {QUALITIES.map((q) => (
                      <option key={q.value} value={q.value}>
                        {q.label}{maxHeight && q.value !== "best" && Number(q.value) > maxHeight ? ` — up to ${maxHeight}p here` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span className="label" id="container-label">Container</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="container-label">
                    {(["mp4", "webm"] as const).map((c) => (
                      <button key={c} role="radio" aria-checked={opts.container === c} className={clsx(opts.container === c && "is-on")} onClick={() => set("container", c)}>
                        {c === "mp4" ? "MP4" : "WebM"}
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    {opts.container === "mp4"
                      ? opts.mp4Compat === "strict"
                        ? "H.264 + AAC: plays everywhere. Above 1080p, most sites only offer VP9/AV1, so DubDeck re-encodes (slow)."
                        : "Fast mode: keeps the site's codec (may be AV1/VP9) inside MP4."
                      : "VP9 + Opus. Smaller files; not supported by some older devices."}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="subs">Subtitles</label>
                  {videos.length === 1 ? (
                    <select id="subs" value={opts.subtitles ?? ""} onChange={(e) => set("subtitles", e.target.value || null)}>
                      <option value="">None</option>
                      {subtitleLangs.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  ) : (
                    <input id="subs" className="mono" placeholder="Language code, e.g. en" value={opts.subtitles ?? ""}
                      onChange={(e) => set("subtitles", e.target.value.trim() || null)} maxLength={32} />
                  )}
                  <label className="check">
                    <input type="checkbox" checked={opts.autoSubs} onChange={(e) => set("autoSubs", e.target.checked)} /> Include auto-generated captions
                  </label>
                  {videos.length === 1 && !subtitleLangs.length && <p className="hint">No subtitles found for this video.</p>}
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <span className="label" id="afmt-label">Format</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="afmt-label">
                    {(["mp3", "m4a", "opus", "wav"] as const).map((f) => (
                      <button key={f} role="radio" aria-checked={opts.audioFormat === f} className={clsx(opts.audioFormat === f && "is-on")} onClick={() => set("audioFormat", f)}>
                        {f === "m4a" ? "M4A" : f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {opts.audioFormat === "mp3" && (
                  <div className="field">
                    <label htmlFor="bitrate">Bitrate</label>
                    <select id="bitrate" value={opts.audioBitrate} onChange={(e) => set("audioBitrate", Number(e.target.value) as DownloadOptions["audioBitrate"])}>
                      {[320, 256, 192, 128].map((b) => <option key={b} value={b}>{b} kbps</option>)}
                    </select>
                  </div>
                )}
                {single && (
                  <fieldset className="field tags">
                    <legend>Tags</legend>
                    {(["title", "artist", "album"] as const).map((k) => (
                      <div key={k} className="tag-row">
                        <label htmlFor={`tag-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
                        <input id={`tag-${k}`} maxLength={300}
                          value={opts.tags?.[k] ?? (k === "title" ? single.title : k === "artist" ? single.artist ?? single.channel ?? "" : single.album ?? "")}
                          onChange={(e) => setOpts((o) => ({ ...o, tags: { ...o.tags, [k]: e.target.value } }))} />
                      </div>
                    ))}
                  </fieldset>
                )}
              </>
            )}

            <label className="check">
              <input type="checkbox" checked={opts.embedCover} onChange={(e) => set("embedCover", e.target.checked)} /> Embed cover art{opts.kind === "audio" ? " and tags" : ""}
            </label>

            <div className="field">
              <span className="label">Trim <span className="muted">(optional)</span></span>
              <div className="row trim">
                <input aria-label="Trim start" className="mono" placeholder="0:00" value={opts.trimStart ?? ""} onChange={(e) => set("trimStart", e.target.value)} maxLength={16} />
                <span aria-hidden="true">→</span>
                <input aria-label="Trim end" className="mono" placeholder={single?.duration ? formatDuration(single.duration) : "end"} value={opts.trimEnd ?? ""} onChange={(e) => set("trimEnd", e.target.value)} maxLength={16} />
              </div>
              {jobItems.length > 1 && (opts.trimStart || opts.trimEnd) && <p className="hint">Trim applies to every item.</p>}
            </div>

            <div className="field">
              <label htmlFor="tpl">Filename</label>
              <input id="tpl" className="mono" value={opts.filenameTemplate} maxLength={200} onChange={(e) => set("filenameTemplate", e.target.value || "{title}")} />
              <div className="tokens" aria-label="Insert a field">
                {TEMPLATE_TOKENS.map((t) => (
                  <button key={t} className="token" onClick={() => set("filenameTemplate", `${opts.filenameTemplate}${opts.filenameTemplate.endsWith(" ") ? "" : " "}{${t}}`)}>{`{${t}}`}</button>
                ))}
              </div>
              <p className="hint mono example" title="Example filename">{renderTemplate(opts.filenameTemplate, videos[0], opts)}</p>
            </div>

            <div className="options-foot">
              <button className="btn btn-ghost btn-sm" onClick={() => setSavingPreset(true)}><Icon name="plus" size={16} /> Save as preset</button>
              <button className="btn btn-primary btn-lg" disabled={!jobItems.length || submitting} onClick={submit}>
                <Icon name="download" size={18} />
                {submitting ? "Adding…" : jobItems.length ? `Download ${jobItems.length} ${jobItems.length === 1 ? "item" : "items"}` : "Nothing selected"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {items.length === 0 && <EmptyHints />}

      {savingPreset && (
        <SavePresetModal
          suggestion={describeOptions(opts)}
          onClose={() => setSavingPreset(false)}
          onSave={(name) => {
            const id = `p${Date.now().toString(36)}`;
            const { trimStart: _a, trimEnd: _b, tags: _c, ...presetOpts } = opts;
            update((s) => ({ ...s, presets: [...s.presets, { id, name, options: presetOpts }] }));
            setPresetId(id);
            toast.push(`Preset “${name}” saved`, "success");
          }}
        />
      )}
    </div>
  );
}

function EmptyHints() {
  return (
    <section className="empty">
      <div className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 40">{Array.from({ length: 30 }, (_, i) => {
          const h = 6 + Math.abs(Math.sin(i * 0.7) * 26);
          return <rect key={i} x={i * 4} y={20 - h / 2} width="2.4" height={h} rx="1.2" />;
        })}</svg>
      </div>
      <ul className="hints">
        <li><strong>Batch</strong> Paste several links at once, one per line.</li>
        <li><strong>Playlists</strong> Paste a playlist link to choose which items to download.</li>
        <li><strong>Presets</strong> Save your favorite format combos in Settings → Presets.</li>
      </ul>
      <p className="fine">Only download content you have the right to download.</p>
    </section>
  );
}

function PreviewCard({ item, onToggle, onRemove, onRetry, onSelect }: {
  item: Item;
  onToggle: (v: boolean) => void;
  onRemove: () => void;
  onRetry: () => void;
  onSelect: (s: Set<string>) => void;
}) {
  if (item.status === "loading") {
    return (
      <article className="card preview is-loading" aria-busy="true">
        <div className="thumb skeleton" />
        <div className="preview-body">
          <div className="skeleton line w70" />
          <div className="skeleton line w40" />
          <p className="fine mono truncate">{item.url}</p>
        </div>
      </article>
    );
  }
  if (item.status === "error") {
    return (
      <article className="card preview is-error" role="alert">
        <div className="preview-body">
          <h3><Icon name="info" size={18} /> {ERROR_TITLES[item.error!.code] ?? "Can't preview this link"}</h3>
          <p>{item.error!.message}</p>
          <p className="fine mono truncate">{item.url}</p>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={onRetry}><Icon name="retry" size={16} /> Retry</button>
            <button className="btn btn-ghost btn-sm" onClick={onRemove}>Remove</button>
          </div>
        </div>
      </article>
    );
  }
  const p = item.preview!;
  return p.type === "playlist"
    ? <PlaylistCard p={p} item={item} onToggle={onToggle} onRemove={onRemove} onSelect={onSelect} />
    : <VideoCard p={p} item={item} onToggle={onToggle} onRemove={onRemove} />;
}

function Thumb({ src, duration }: { src: string | null; duration?: number | null }) {
  const [broken, setBroken] = useState(false);
  const url = safeImg(src);
  return (
    <div className="thumb">
      {url && !broken ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <Icon name="film" size={28} />}
      {duration ? <span className="thumb-badge mono">{formatDuration(duration)}</span> : null}
    </div>
  );
}

function VideoCard({ p, item, onToggle, onRemove }: { p: VideoPreview; item: Item; onToggle: (v: boolean) => void; onRemove: () => void }) {
  return (
    <article className={clsx("card preview", !item.include && "is-off")}>
      <Thumb src={p.thumbnail} duration={p.duration} />
      <div className="preview-body">
        <div className="preview-title-row">
          <h3 className="clamp2" title={p.title}>{p.title}</h3>
          <label className="check include" title="Include in this download">
            <input type="checkbox" checked={item.include} onChange={(e) => onToggle(e.target.checked)} aria-label={`Include ${p.title}`} />
          </label>
        </div>
        <p className="muted">{p.channel ?? "Unknown channel"}{p.site ? <span className="site"> · {p.site}</span> : null}</p>
        <div className="chips mono">
          {p.heights.slice(0, 7).map((h) => <span key={h} className="chip">{h}p</span>)}
          {!p.heights.length && p.hasVideo && <span className="chip">video</span>}
          {p.audioBitrates.length > 0 && <span className="chip">♪ {p.audioBitrates[0]}k</span>}
          {p.subtitles.length > 0 && <span className="chip">CC {p.subtitles.length}</span>}
          {p.ageLimit >= 18 && <span className="chip chip-warn">18+</span>}
          {p.isLive && <span className="chip chip-warn">live</span>}
        </div>
        {p.formats.length > 0 && (
          <details className="formats">
            <summary>Available formats ({p.formats.length})</summary>
            <div className="table-wrap">
              <table className="mono">
                <thead><tr><th>ID</th><th>Ext</th><th>Res</th><th>FPS</th><th>Video</th><th>Audio</th><th>Size</th></tr></thead>
                <tbody>
                  {[...p.formats].reverse().map((f) => (
                    <tr key={f.id}>
                      <td>{f.id}</td><td>{f.ext}</td><td>{f.height ? `${f.height}p` : "—"}</td><td>{f.fps ?? "—"}</td>
                      <td>{f.vcodec === "none" ? "—" : f.vcodec ?? "?"}</td>
                      <td>{f.acodec === "none" ? "—" : `${f.acodec ?? "?"}${f.abr ? ` ${Math.round(f.abr)}k` : ""}`}</td>
                      <td>{formatBytes(f.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
      <button className="icon-btn card-x" aria-label={`Remove ${p.title}`} onClick={onRemove}><Icon name="x" size={18} /></button>
    </article>
  );
}

function PlaylistCard({ p, item, onToggle, onRemove, onSelect }: {
  p: PlaylistPreview; item: Item; onToggle: (v: boolean) => void; onRemove: () => void; onSelect: (s: Set<string>) => void;
}) {
  const all = item.selected.size === p.entries.length;
  return (
    <article className={clsx("card preview playlist", !item.include && "is-off")}>
      <Thumb src={p.thumbnail ?? p.entries[0]?.thumbnail ?? null} />
      <div className="preview-body">
        <div className="preview-title-row">
          <h3 className="clamp2" title={p.title}><span className="chip">Playlist</span> {p.title}</h3>
          <label className="check include">
            <input type="checkbox" checked={item.include} onChange={(e) => onToggle(e.target.checked)} aria-label={`Include playlist ${p.title}`} />
          </label>
        </div>
        <p className="muted">{p.channel ?? "Unknown"} · <span className="mono">{p.entries.length}{p.truncated ? "+" : ""} items</span></p>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => onSelect(all ? new Set() : new Set(p.entries.map((e) => e.url)))}>
            {all ? "Select none" : "Select all"}
          </button>
          <span className="fine mono">{item.selected.size} selected</span>
        </div>
        <ol className="entries">
          {p.entries.map((e, i) => (
            <li key={e.url}>
              <label className="check">
                <input type="checkbox" checked={item.selected.has(e.url)}
                  onChange={(ev) => {
                    const s = new Set(item.selected);
                    if (ev.target.checked) s.add(e.url);
                    else s.delete(e.url);
                    onSelect(s);
                  }} />
                <span className="mono idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{e.title}</span>
                <span className="mono muted dur">{formatDuration(e.duration)}</span>
              </label>
            </li>
          ))}
        </ol>
      </div>
      <button className="icon-btn card-x" aria-label={`Remove ${p.title}`} onClick={onRemove}><Icon name="x" size={18} /></button>
    </article>
  );
}

function SavePresetModal({ suggestion, onSave, onClose }: { suggestion: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(suggestion);
  return (
    <Modal
      title="Save preset"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => { onSave(name.trim().slice(0, 60)); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="preset-name">Name</label>
        <input id="preset-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && (onSave(name.trim()), onClose())} />
      </div>
      <p className="hint">Saved presets sync to all your devices. Rename and reorder them in Settings.</p>
    </Modal>
  );
}
