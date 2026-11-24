// Pictures, GIFs, videos and files inside chat messages: a GIF player that can
// pause, a video player with its own controls, a full-screen viewer, and a
// download button on everything. Media keeps its space while loading (from the
// size saved when it was sent) so the conversation doesn't jump.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "./store";

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const downloadUrl = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

/** Picture/video size, read before upload (null if the browser can't tell quickly). */
export async function mediaSize(f: File): Promise<{ w: number; h: number } | null> {
  try {
    if (f.type.startsWith("image/")) {
      const b = await createImageBitmap(f);
      const r = { w: b.width, h: b.height };
      b.close();
      return r;
    }
    if (f.type.startsWith("video/")) {
      const url = URL.createObjectURL(f);
      try {
        return await new Promise((ok) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () => ok(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
          v.onerror = () => ok(null);
          window.setTimeout(() => ok(null), 3000);
          v.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
    }
  } catch { /* unknown format */ }
  return null;
}

/** Keeps the right shape while loading: up to 320 px on the long side. */
function box(f: Attachment): CSSProperties {
  if (!f.w || !f.h) return { width: 240, aspectRatio: f.type.startsWith("video/") ? "16 / 9" : "4 / 3" };
  const k = Math.min(1, 320 / Math.max(f.w, f.h));
  return { width: Math.max(80, Math.round(f.w * k)), aspectRatio: `${f.w} / ${f.h}` };
}

const isGif = (f: Attachment) => f.type === "image/gif";

export function Files({ files, urls }: { files: Attachment[]; urls: (path: string) => string | undefined }) {
  const [view, setView] = useState<Attachment | null>(null);
  return (
    <span className="vx-msg-files">
      {files.map((f) => {
        const url = urls(f.path);
        if (f.type.startsWith("image/")) {
          return (
            <span key={f.path} className="vx-media" style={box(f)}>
              {!url ? <span className="vx-media-wait" aria-label={`Loading ${f.name}`} />
                : isGif(f) ? <GifPlayer url={url} name={f.name} onOpen={() => setView(f)} />
                : <button type="button" className="vx-media-open" aria-label={`Open ${f.name}`} onClick={(e) => { stop(e); setView(f); }}><img src={url} alt={f.name} loading="lazy" decoding="async" /></button>}
              {url && <Download url={url} name={f.name} />}
            </span>
          );
        }
        if (f.type.startsWith("video/")) {
          return (
            <span key={f.path} className="vx-media vx-media-video" style={box(f)}>
              {url ? <VideoPlayer url={url} name={f.name} /> : <span className="vx-media-wait" aria-label={`Loading ${f.name}`} />}
            </span>
          );
        }
        if (f.type.startsWith("audio/")) return url ? <audio key={f.path} src={url} controls preload="metadata" onClick={stop} /> : null;
        return (
          <a key={f.path} className="vx-msg-file" href={url ? downloadUrl(url, f.name) : undefined} download={f.name} onClick={stop}>
            <FileIcon />
            <span>{f.name}<em>{size(f.size)} · Download</em></span>
          </a>
        );
      })}
      {view && urls(view.path) && <Viewer f={view} url={urls(view.path)!} onClose={() => setView(null)} />}
    </span>
  );
}

function Download({ url, name }: { url: string; name: string }) {
  return (
    <a className="vx-media-dl" href={downloadUrl(url, name)} download={name} aria-label={`Download ${name}`} title="Download" onClick={stop}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
    </a>
  );
}

function FileIcon() {
  return (
    <svg className="vx-file-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5" />
    </svg>
  );
}

/**
 * GIFs play while on screen and can be paused (a snapshot of the current frame
 * covers the moving picture). Paused at the start for people who asked their
 * device for less motion.
 */
function GifPlayer({ url, name, onOpen }: { url: string; name: string; onOpen: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(() => matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const i = img.current, c = still.current;
    if (!paused || !ready || !i || !c) return;
    c.width = i.naturalWidth; c.height = i.naturalHeight;
    try { c.getContext("2d")?.drawImage(i, 0, 0); } catch { /* */ }
  }, [paused, ready]);

  return (
    <span className="vx-gif">
      <button type="button" className="vx-media-open" aria-label={`Open ${name}`} onClick={(e) => { stop(e); onOpen(); }}>
        <img ref={img} src={url} alt={name} decoding="async" onLoad={() => setReady(true)} />
        <canvas ref={still} hidden={!paused} aria-hidden="true" />
      </button>
      <button type="button" className={`vx-gif-btn ${paused ? "" : "vx-gif-playing"}`} aria-label={paused ? "Play GIF" : "Pause GIF"} onClick={(e) => { stop(e); setPaused((p) => !p); }}>
        {paused ? <PlayIcon /> : "GIF"}
      </button>
    </span>
  );
}

const PlayIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>;

function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

/** A video with a big play button, a seek bar, mute, full screen and download. */
function VideoPlayer({ url, name }: { url: string; name: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [buf, setBuf] = useState(0);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (el.paused) { setStarted(true); void el.play().catch(() => undefined); } else el.pause();
  };
  const full = () => {
    const el = v.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const host = wrap.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (host?.requestFullscreen) void host.requestFullscreen().catch(() => undefined);
    else el?.webkitEnterFullscreen?.(); // iPhone: the system player
  };

  return (
    <span ref={wrap} className={`vx-vp ${playing ? "vx-vp-playing" : ""} ${started ? "vx-vp-started" : ""}`} onClick={stop}>
      <video ref={v} src={`${url}#t=0.001`} preload="metadata" playsInline muted={muted}
        onClick={toggle}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuf(b.end(b.length - 1)); }} />
      {!playing && <button type="button" className="vx-vp-big" aria-label={`Play ${name}`} onClick={toggle}><PlayIcon /></button>}
      <span className="vx-vp-bar">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
        <span className="vx-vp-time">{fmt(t)} / {fmt(dur)}</span>
        <span className="vx-vp-seek" style={{ "--buf": `${dur ? (buf / dur) * 100 : 0}%` } as CSSProperties}>
          <input type="range" min={0} max={dur || 0} step={0.05} value={t} aria-label="Seek"
            onChange={(e) => { const el = v.current; if (el) { el.currentTime = Number(e.target.value); setT(el.currentTime); } }} />
        </span>
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M16 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />}
          </svg>
        </button>
        <button type="button" aria-label="Full screen" onClick={full}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
        <a href={downloadUrl(url, name)} download={name} aria-label={`Download ${name}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
        </a>
      </span>
    </span>
  );
}

/** Full-screen picture viewer: Escape, a tap outside or × closes it. */
function Viewer({ f, url, onClose }: { f: Attachment; url: string; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", on); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="vx-viewer" role="dialog" aria-modal="true" aria-label={f.name} onClick={onClose}>
      <img src={url} alt={f.name} onClick={stop} />
      <div className="vx-viewer-bar" onClick={stop}>
        <span>{f.name} · {size(f.size)}</span>
        <a className="vx-btn vx-btn-primary vx-btn-sm" href={downloadUrl(url, f.name)} download={f.name}>Download</a>
        <button type="button" className="vx-icon-btn" aria-label="Close" onClick={onClose}>×</button>
      </div>
    </div>,
    document.body,
  );
}

export function size(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
