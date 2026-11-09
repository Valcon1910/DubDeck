import { useRef, useState } from "react";
import {
  bestThumb, buildPresets, fetchInfo, formatBytes, formatDuration, parseVideoId, safeFilename,
  StreamError, type Preset, type StreamInfo,
} from "./youtube";

// Files above this are opened directly instead of being buffered in memory,
// which an iPad can't do for very large videos.
const BUFFER_LIMIT = 400 * 1024 * 1024;

type SaveState = { key: string; progress: number | null } | null;

export function Downloader() {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState<SaveState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

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

  async function save(p: Preset) {
    if (!info || saving) return;
    setNotice(null);
    if (p.bytes && p.bytes > BUFFER_LIMIT) { openDirect(p); return; }
    setSaving({ key: p.key, progress: 0 });
    try {
      const res = await fetch(p.url);
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const total = p.bytes ?? Number(res.headers.get("content-length") ?? 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        setSaving({ key: p.key, progress: total ? got / total : null });
      }
      const type = p.kind === "audio" ? (p.ext === "m4a" ? "audio/mp4" : "audio/webm") : "video/mp4";
      const href = URL.createObjectURL(new Blob(chunks as BlobPart[], { type }));
      const a = document.createElement("a");
      a.href = href;
      a.download = safeFilename(info.title, p.ext);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setNotice("Saved. On iPad it's in the Files app → Downloads (or tap the download icon in Safari's toolbar).");
    } catch {
      // The video host didn't allow a direct save (or the link expired): open it instead.
      openDirect(p);
    } finally {
      setSaving(null);
    }
  }

  const groups: { kind: Preset["kind"]; title: string; note?: string }[] = [
    { kind: "video", title: "Video with sound" },
    { kind: "audio", title: "Audio only" },
    { kind: "silent", title: "Higher quality, picture only", note: "YouTube keeps sound separate above 360p. These files have no sound." },
  ];

  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <p className="vx-eyebrow">Utilities</p>
        <h1>Downloader</h1>
        <p className="vx-muted">Paste a YouTube link, choose a format and save it to this device.</p>
      </header>

      <form className="vx-search" onSubmit={lookUp}>
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

      {error && <p className="vx-alert vx-alert-error" role="alert">{error}</p>}
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
                              ? saving?.progress != null ? `${Math.round(saving.progress * 100)}%` : "Saving…"
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
            Links work for about 6 hours. Need 1080p or 4K with sound?{" "}
            <a href="https://cobalt.tools" target="_blank" rel="noopener noreferrer">Use cobalt.tools</a>.
            {remaining !== null && <> · {remaining} lookups left this month.</>}
          </p>
        </article>
      )}

      <p className="vx-fine">Only download videos you have the right to keep.</p>
    </section>
  );
}
