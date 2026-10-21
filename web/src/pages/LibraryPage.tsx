import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadFromUrl } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmModal, Modal } from "../components/Modal";
import { useLive } from "../live";
import { useToast } from "../toasts";
import type { LibraryFile, LibraryStats } from "../types";
import { clsx, formatBytes, formatDate, formatDuration, safeImg } from "../util";
import { readJSON, writeJSON } from "../storage";

type Sort = "new" | "old" | "big" | "small" | "name";
type Filter = "all" | "video" | "audio";
const VIEW_KEY = "dubdeck.libraryView";
const REFRESH_MS = 10 * 60 * 1000; // thumbnail URLs are signed for 15 minutes

export function LibraryPage() {
  const { libraryVersion } = useLive();
  const toast = useToast();
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">(() => readJSON<"grid" | "list">(VIEW_KEY) ?? "grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<LibraryFile | null>(null);
  const [renaming, setRenaming] = useState<LibraryFile | null>(null);
  const [deleting, setDeleting] = useState<LibraryFile[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([
        api<{ files: LibraryFile[] }>("/api/library"),
        api<LibraryStats>("/api/library/stats"),
      ]);
      setFiles(l.files);
      setStats(s);
      setSelected((sel) => new Set([...sel].filter((id) => l.files.some((f) => f.id === id))));
    } catch (e) {
      toast.push((e as ApiError).message, "error");
      setFiles((f) => f ?? []);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load, libraryVersion]);

  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (files ?? []).filter(
      (f) => (filter === "all" || f.kind === filter) &&
        (!q || [f.name, f.title, f.channel, f.ext, f.quality].some((v) => v?.toLowerCase().includes(q))),
    );
    const cmp: Record<Sort, (a: LibraryFile, b: LibraryFile) => number> = {
      new: (a, b) => b.createdAt - a.createdAt,
      old: (a, b) => a.createdAt - b.createdAt,
      big: (a, b) => b.size - a.size,
      small: (a, b) => a.size - b.size,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    };
    return list.sort(cmp[sort]);
  }, [files, query, sort, filter]);

  const saveToDevice = async (f: LibraryFile) => {
    try {
      const link = await api<{ url: string }>(`/api/library/${f.id}/link`, { body: { disposition: "attachment" } });
      downloadFromUrl(link.url);
    } catch (e) {
      toast.push((e as ApiError).message, "error");
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setViewPersist = (v: "grid" | "list") => {
    setView(v);
    writeJSON(VIEW_KEY, v);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <p className="muted">Files stored on your DubDeck server.</p>
        </div>
      </header>

      {stats && <StorageDashboard stats={stats} onOpen={setPlaying} />}

      <div className="toolbar card">
        <div className="search">
          <Icon name="search" size={18} />
          <label htmlFor="lib-search" className="sr-only">Search library</label>
          <input id="lib-search" ref={searchRef} type="search" placeholder="Search files  ( / )" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="segmented" role="radiogroup" aria-label="Filter by type">
          {(["all", "video", "audio"] as const).map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} className={clsx(filter === f && "is-on")} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "video" ? "Video" : "Audio"}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="lib-sort">Sort</label>
        <select id="lib-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="big">Largest first</option>
          <option value="small">Smallest first</option>
          <option value="name">Name A–Z</option>
        </select>
        <div className="segmented icon-seg" role="radiogroup" aria-label="View">
          <button role="radio" aria-checked={view === "grid"} aria-label="Grid view" className={clsx(view === "grid" && "is-on")} onClick={() => setViewPersist("grid")}><Icon name="grid" size={18} /></button>
          <button role="radio" aria-checked={view === "list"} aria-label="List view" className={clsx(view === "list" && "is-on")} onClick={() => setViewPersist("list")}><Icon name="list" size={18} /></button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar card" role="region" aria-label="Selection">
          <span className="mono">{selected.size} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(shown.map((f) => f.id)))}>Select all {shown.length}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-danger btn-sm" onClick={() => setDeleting((files ?? []).filter((f) => selected.has(f.id)))}><Icon name="trash" size={16} /> Delete</button>
        </div>
      )}

      {files === null ? (
        <div className="grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card file skeleton-card" />)}</div>
      ) : shown.length === 0 ? (
        <div className="empty card"><p>{files.length ? "No files match." : "Your library is empty. Finished downloads appear here."}</p></div>
      ) : view === "grid" ? (
        <ul className="grid">
          {shown.map((f) => (
            <li key={f.id} className={clsx("card file", selected.has(f.id) && "is-selected")}>
              <button className="file-thumb" onClick={() => setPlaying(f)} aria-label={`Play ${f.name}`}>
                <FileThumb f={f} />
                {f.duration ? <span className="thumb-badge mono">{formatDuration(f.duration)}</span> : null}
                <span className="play-overlay" aria-hidden="true"><Icon name="play" size={22} /></span>
              </button>
              <div className="file-body">
                <label className="check select-box">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`} />
                </label>
                <h3 className="clamp2" title={f.filename}>{f.name}</h3>
                <p className="file-meta mono">{[f.quality, f.ext.toUpperCase(), formatBytes(f.size), formatDate(f.createdAt)].filter(Boolean).join(" · ")}</p>
                <FileActions f={f} onSave={saveToDevice} onRename={setRenaming} onDelete={(x) => setDeleting([x])} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card table-wrap">
          <table className="file-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Select</span></th>
                <th scope="col">Name</th>
                <th scope="col" className="hide-sm">Quality</th>
                <th scope="col">Size</th>
                <th scope="col" className="hide-sm">Added</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className={clsx(selected.has(f.id) && "is-selected")}>
                  <td><input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`} /></td>
                  <td>
                    <button className="row-title" onClick={() => setPlaying(f)}>
                      <span className="row-thumb"><FileThumb f={f} /></span>
                      <span className="truncate" title={f.filename}>{f.name}</span>
                    </button>
                  </td>
                  <td className="mono hide-sm">{f.quality} · {f.ext}</td>
                  <td className="mono">{formatBytes(f.size)}</td>
                  <td className="mono hide-sm">{formatDate(f.createdAt)}</td>
                  <td><FileActions f={f} onSave={saveToDevice} onRename={setRenaming} onDelete={(x) => setDeleting([x])} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playing && <PlayerModal f={playing} onClose={() => setPlaying(null)} onSave={saveToDevice} />}
      {renaming && <RenameModal f={renaming} onClose={() => setRenaming(null)} onDone={(nf) => setFiles((l) => l?.map((x) => (x.id === nf.id ? nf : x)) ?? l)} />}
      {deleting && (
        <ConfirmModal
          title={deleting.length === 1 ? "Delete file?" : `Delete ${deleting.length} files?`}
          message={deleting.length === 1 ? `“${deleting[0].filename}” will be permanently deleted from the server.` : "These files will be permanently deleted from the server."}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              const ids = deleting.map((f) => f.id);
              await api("/api/library/delete", { body: { ids } });
              setFiles((l) => l?.filter((f) => !ids.includes(f.id)) ?? l);
              setSelected(new Set());
              toast.push(ids.length === 1 ? "File deleted" : `${ids.length} files deleted`, "success");
              void load();
            } catch (e) {
              toast.push((e as ApiError).message, "error");
            }
          }}
        />
      )}
    </div>
  );
}

function FileThumb({ f }: { f: LibraryFile }) {
  const [broken, setBroken] = useState(false);
  const src = safeImg(f.thumbUrl);
  return src && !broken
    ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
    : <span className={`thumb-fallback kind-${f.kind}`}><Icon name={f.kind === "audio" ? "music" : "film"} size={26} /></span>;
}

function FileActions({ f, onSave, onRename, onDelete }: {
  f: LibraryFile; onSave: (f: LibraryFile) => void; onRename: (f: LibraryFile) => void; onDelete: (f: LibraryFile) => void;
}) {
  return (
    <div className="file-actions">
      <button className="icon-btn" title="Save to device" aria-label={`Save ${f.name} to device`} onClick={() => onSave(f)}><Icon name="download" size={18} /></button>
      <button className="icon-btn" title="Rename" aria-label={`Rename ${f.name}`} onClick={() => onRename(f)}><Icon name="edit" size={18} /></button>
      <button className="icon-btn" title="Delete" aria-label={`Delete ${f.name}`} onClick={() => onDelete(f)}><Icon name="trash" size={18} /></button>
    </div>
  );
}

function StorageDashboard({ stats, onOpen }: { stats: LibraryStats; onOpen: (f: LibraryFile) => void }) {
  const used = stats.usedBytes;
  const quota = stats.quotaBytes;
  const pct = quota ? Math.min(1, used / quota) : 0;
  const v = stats.byKind.video.bytes;
  const a = stats.byKind.audio.bytes;
  const over = used > quota;
  return (
    <section className="dashboard" aria-label="Storage">
      <div className="card storage-card">
        <div className="storage-head">
          <h2>Storage</h2>
          <span className={clsx("mono", over && "text-danger")}>{formatBytes(used)} <span className="muted">of {formatBytes(quota)}</span></span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={quota} aria-valuenow={used} aria-label="Disk used of quota" aria-valuetext={`${Math.round(pct * 100)}% of quota used`}>
          <span className="meter-video" style={{ width: `${quota ? Math.min(100, (v / quota) * 100) : 0}%` }} />
          <span className="meter-audio" style={{ width: `${quota ? Math.min(100 - Math.min(100, (v / quota) * 100), (a / quota) * 100) : 0}%` }} />
        </div>
        <div className="legend mono">
          <span><i className="dot dot-video" /> Video {formatBytes(v)} · {stats.byKind.video.count}</span>
          <span><i className="dot dot-audio" /> Audio {formatBytes(a)} · {stats.byKind.audio.count}</span>
          {stats.disk && <span className="muted">Disk free {formatBytes(stats.disk.free)}</span>}
        </div>
        {over && <p className="hint text-danger">Over your quota. Turn on auto-cleanup in Settings or delete files.</p>}
      </div>
      <div className="card largest-card">
        <h2>Largest files</h2>
        {stats.largest.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ol className="largest">
            {stats.largest.slice(0, 5).map((f) => (
              <li key={f.id}>
                <button className="link-btn truncate" onClick={() => onOpen(f)} title={f.filename}>{f.name}</button>
                <span className="mono muted">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function PlayerModal({ f, onClose, onSave }: { f: LibraryFile; onClose: () => void; onSave: (f: LibraryFile) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ url: string }>(`/api/library/${f.id}/link`, { body: { disposition: "inline" } })
      .then((l) => setSrc(l.url))
      .catch((e: ApiError) => setError(e.message));
  }, [f.id]);
  const cover = safeImg(f.thumbUrl);
  return (
    <Modal title={f.name} onClose={onClose} wide footer={
      <>
        <span className="fine mono player-meta">{[f.quality, f.ext.toUpperCase(), f.vcodec, f.acodec, formatBytes(f.size)].filter(Boolean).join(" · ")}</span>
        <button className="btn btn-primary" onClick={() => onSave(f)}><Icon name="download" size={18} /> Save to device</button>
      </>
    }>
      {error && <p className="error-text">{error}</p>}
      {!src && !error && <div className="player-skeleton skeleton" />}
      {src && f.kind === "video" && (
        <video className="player" src={src} controls autoPlay playsInline preload="metadata" poster={cover} />
      )}
      {src && f.kind === "audio" && (
        <div className="audio-player">
          {cover ? <img src={cover} alt="" className="cover" /> : <div className="cover cover-fallback"><Icon name="music" size={40} /></div>}
          <div>
            {f.channel && <p className="muted">{f.channel}</p>}
            <audio src={src} controls autoPlay preload="metadata" />
          </div>
        </div>
      )}
      {f.sourceUrl && /^https?:/i.test(f.sourceUrl) && (
        <p className="fine"><a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">Original page <Icon name="external" size={14} /></a></p>
      )}
    </Modal>
  );
}

function RenameModal({ f, onClose, onDone }: { f: LibraryFile; onClose: () => void; onDone: (f: LibraryFile) => void }) {
  const [name, setName] = useState(f.name);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const res = await api<{ file: LibraryFile }>(`/api/library/${f.id}`, { method: "PATCH", body: { name: name.trim() } });
      onDone(res.file);
      onClose();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };
  return (
    <Modal title="Rename file" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Rename</button>
      </>
    }>
      <div className="field">
        <label htmlFor="rename">File name</label>
        <div className="row input-suffix">
          <input id="rename" autoFocus value={name} maxLength={180} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void save()} />
          <span className="mono muted">.{f.ext}</span>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
