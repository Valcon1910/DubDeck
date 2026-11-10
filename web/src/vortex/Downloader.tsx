import { useRef, useState } from "react";
import { useContent } from "./content";
import { combine, preloadMerger } from "./merge";
import { Tutorial } from "./Tutorial";
import { Editable, useEdit } from "./editable";
import {
  bestThumb, buildPresets, fetchInfo, formatBytes, formatDuration, parseVideoId, relayUrl, safeFilename,
  StreamError, type Preset, type StreamInfo,
} from "./youtube";

// Download in pieces so no single request through the site's proxy is too large.
const CHUNK = 8 * 1024 * 1024;
// Received data is packed into Blobs every 32 MB, which the browser can keep
// out of the page's memory, so large videos don't run the tab out of memory.
const PACK = 32 * 1024 * 1024;

class BlockedError extends Error {}

type SaveState = { key: string; progress: number | null; stage: string } | null;

/** Download the whole file as a Blob, in ranged pieces when the server supports them. */
async function download(url: string, total: number | null, type: string, onProgress: (p: number | null) => void, chunk = CHUNK): Promise<Blob> {
  const packed: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let got = 0;
  const pack = () => {
    if (pending.length) packed.push(new Blob(pending as BlobPart[]));
    pending = []; pendingBytes = 0;
  };
  for (;;) {
    const start = got;
    const end = total ? Math.min(start + chunk, total) - 1 : start + chunk - 1;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    } catch {
      throw new Error("blocked by the browser (no permission to read the file)");
    }
    if (res.status === 416 && start > 0) break; // nothing left
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}${res.redirected ? ` after a redirect to ${new URL(res.url).hostname}` : ""}`);
    if (/text\/html|application\/json/.test(res.headers.get("content-type") ?? "")) {
      throw new Error(`got a web page instead of the video (HTTP ${res.status}, ${res.headers.get("content-type")})`);
    }
    const ranged = res.status === 206;
    if (!ranged && start > 0) throw new Error("range ignored");
    const fromRange = Number(res.headers.get("content-range")?.split("/")[1]);
    if (!total) total = (ranged ? fromRange : Number(res.headers.get("content-length"))) || null;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value);
      pendingBytes += value.length;
      got += value.length;
      if (pendingBytes >= PACK) pack();
      onProgress(total ? Math.min(got / total, 1) : null);
    }
    if (!ranged) break; // the whole file came at once
    if (got === start) break;
    if (total ? got >= total : got - start < end - start + 1) break;
  }
  pack();
  if (!got) throw new Error("empty");
  return new Blob(packed, { type });
}

export function Downloader() {
  const c = useContent().downloader;
  const edit = useEdit();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState<SaveState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [tutorial, setTutorial] = useState(false);
  const [fallback, setFallback] = useState<Preset | null>(null);

  async function lookUp(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null); setNotice(null);
    const id = parseVideoId(link);
    if (!id) { setError("That doesn't look like a YouTube link. Paste the whole link from the Share button."); return; }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setInfo(null); setPresets([]);
    try {
      const { info, remaining } = await fetchInfo(id, ctrl.signal);
      setInfo(info); setPresets(buildPresets(info)); setRemaining(remaining);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof StreamError ? err.message : "Something went wrong. Try again.");
      }
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setLink(text.trim());
    } catch {
      setNotice("Paste isn't allowed here. Tap the box and paste with the keyboard.");
    }
  }

  function openDirect(p: Preset) {
    window.open(p.url, "_blank", "noopener,noreferrer");
    setNotice(
      "The file opened in a new tab. To keep it: tap Share → Save to Files. " +
      "Or come back, press and hold the button, and choose “Download Linked File”.",
    );
  }

  /** Fetch one file: through the site's own address first, then straight from YouTube. */
  async function fetchFile(url: string, bytes: number | null, type: string, onProgress: (p: number | null) => void): Promise<Blob> {
    const reasons: string[] = [];
    const relay = relayUrl(url);
    const attempts: [string, string, number][] = [
      ...(relay ? [["site relay", relay, CHUNK], ["site relay, small pieces", relay, 1024 * 1024]] as [string, string, number][] : []),
      ["YouTube directly", url, CHUNK],
    ];
    for (const [label, u, size] of attempts) {
      try { return await download(u, bytes, type, onProgress, size); } catch (e) { reasons.push(`${label}: ${(e as Error).message}`); }
    }
    throw new BlockedError(reasons.join(" · "));
  }

  function hand(file: Blob, name: string) {
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10 * 60_000);
    setNotice(`Saved as “${name}”. On iPad it's in the Files app → Downloads. Tap “How to save to Files” for help.`);
  }

  async function save(p: Preset) {
    if (!info || saving) return;
    setNotice(null); setError(null); setFallback(null);
    const name = safeFilename(info.title, p.ext);
    if (p.audio) {
      // Picture + sound → one MP4 with sound, made on this device.
      preloadMerger();
      const vBytes = (p.bytes ?? 0) - (p.audio.bytes ?? 0) || null;
      const share = p.bytes && p.audio.bytes ? (p.bytes - p.audio.bytes) / p.bytes : 0.9;
      setSaving({ key: p.key, progress: 0, stage: "Downloading video" });
      let step = "download";
      try {
        const video = await fetchFile(p.url, vBytes, "video/mp4", (x) => setSaving({ key: p.key, progress: x === null ? null : x * share * 0.95, stage: "Downloading video" }));
        const audio = await fetchFile(p.audio.url, p.audio.bytes, "audio/mp4", (x) => setSaving({ key: p.key, progress: x === null ? null : (share + x * (1 - share)) * 0.95, stage: "Downloading sound" }));
        step = "combine";
        setSaving({ key: p.key, progress: 0.95, stage: "Combining" });
        const out = await combine(video, audio, (x) => setSaving({ key: p.key, progress: 0.95 + x * 0.05, stage: "Combining" }));
        hand(out, name);
      } catch (e) {
        if (e instanceof BlockedError) setFallback(presets.find((x) => x.kind === "video" && !x.audio) ?? null);
        setError(e instanceof BlockedError
          ? `This quality couldn't be downloaded through the site. “Video 360p” and the audio still work. Details: ${e.message}`
          : step === "combine"
            ? "This device ran out of memory while combining such a large video. Close other tabs and apps and try again, or choose a lower quality."
            : "The download stopped. Check the connection and try again.");
      } finally {
        setSaving(null);
      }
      return;
    }
    setSaving({ key: p.key, progress: 0, stage: "Downloading" });
    try {
      const type = p.kind === "audio" ? (p.ext === "m4a" ? "audio/mp4" : "audio/webm") : "video/mp4";
      hand(await fetchFile(p.url, p.bytes, type, (progress) => setSaving({ key: p.key, progress, stage: "Downloading" })), name);
    } catch {
      // The video host didn't allow a direct save (or the link expired): open it instead.
      openDirect(p);
    } finally {
      setSaving(null);
    }
  }

  const groups: { kind: Preset["kind"]; title: string; note?: string }[] = [
    { kind: "video", title: "Video with sound", note: "Qualities above 360p are combined from YouTube's separate picture and sound files on this device. It takes a few extra seconds." },
    { kind: "audio", title: "Audio only" },
  ];

  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <p className="vx-eyebrow">Utilities</p>
        <Editable as="h1" path="downloader.title" placeholder="Page title" />
        <Editable as="p" className="vx-muted" path="downloader.intro" placeholder="Introduction" multiline />
        <button type="button" inert={!!edit} className="vx-btn vx-btn-ghost vx-btn-sm vx-tutorial-btn" onClick={() => setTutorial(true)}>
          How to save to Files
        </button>
      </header>
      {tutorial && <Tutorial onClose={() => setTutorial(false)} />}

      <form className="vx-search" onSubmit={lookUp} inert={!!edit}>
        <label className="sr-only" htmlFor="vx-link">YouTube link</label>
        <input
          id="vx-link" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
          placeholder="https://youtu.be/…" value={link} onChange={(e) => setLink(e.target.value)}
        />
        <button type="button" className="vx-btn vx-btn-ghost" onClick={paste}>Paste</button>
        <button type="submit" className="vx-btn vx-btn-primary" disabled={busy || !link.trim()}>
          {busy ? "Loading…" : "Get formats"}
        </button>
      </form>

      {error && (
        <div className="vx-alert vx-alert-error" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          {fallback && (
            <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" style={{ marginTop: 10 }}
              onClick={() => { const f = fallback; setFallback(null); setError(null); void save(f); }}>
              Download {fallback.label} instead
            </button>
          )}
        </div>
      )}
      {notice && <p className="vx-alert" role="status">{notice}</p>}

      {busy && <div className="vx-card vx-skeleton" aria-hidden="true" />}

      {info && (
        <article className="vx-card vx-result">
          <div className="vx-video">
            <img src={bestThumb(info)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <div>
              <h2>{info.title}</h2>
              <p className="vx-muted">
                {[info.channelTitle, formatDuration(info.lengthSeconds)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {groups.map((g) => {
            const items = presets.filter((p) => p.kind === g.kind);
            if (!items.length) return null;
            return (
              <div key={g.kind} className="vx-group">
                <h3>{g.title}</h3>
                {g.note && <p className="vx-muted vx-small">{g.note}</p>}
                <ul className="vx-presets">
                  {items.map((p) => {
                    const active = saving?.key === p.key;
                    return (
                      <li key={p.key}>
                        <a
                          className={`vx-preset vx-kind-${p.kind}`}
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-busy={active}
                          onClick={(e) => { e.preventDefault(); void save(p); }}
                        >
                          <span className="vx-preset-main">
                            <strong>{p.label}</strong>
                            <span className="vx-muted vx-small">{p.detail}</span>
                          </span>
                          <span className="vx-preset-side">
                            {active
                              ? `${saving!.stage}${saving!.progress != null ? ` ${Math.round(saving!.progress * 100)}%` : "…"}`
                              : formatBytes(p.bytes) || "Save"}
                          </span>
                          {active && saving?.progress != null && (
                            <span className="vx-progress" style={{ width: `${saving.progress * 100}%` }} />
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <p className="vx-muted vx-small">
            Links work for about 6 hours.
            {remaining !== null && <> {remaining} lookups left this month.</>}
          </p>
        </article>
      )}

      {(c.footer || edit) && <Editable as="p" className="vx-fine" path="downloader.footer" placeholder="Footer note (optional)" />}
    </section>
  );
}
