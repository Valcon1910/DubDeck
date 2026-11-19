import { useState } from "react";
import { CONTENT_PATH, commit, GitHubError, readJson } from "./github";
import { imageSrc, normalize, useContent, type Announcement, type Attachment } from "./content";
import { prepareImage } from "./images";

const TOKEN = ""; // added by the site's /gh route
/* ---------- the page ---------- */

export function AnnouncementsPage({ editor }: { editor: boolean }) {
  const c = useContent();
  const [posted, setPosted] = useState<Announcement[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [edited, setEdited] = useState<Record<string, Announcement>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const items = [...posted, ...c.announcements.items].filter((a) => !removed.includes(a.id)).map((a) => edited[a.id] ?? a);


  async function remove(a: Announcement) {
    if (!confirm(`Delete “${a.title}”?`)) return;
    try {
      const cur = normalize(await readJson(TOKEN, CONTENT_PATH));
      cur.announcements.items = cur.announcements.items.filter((x) => x.id !== a.id);
      await commit(TOKEN, "Delete an announcement", [{ path: CONTENT_PATH, text: JSON.stringify(cur, null, 2) + "\n" }]);
      setRemoved((r) => [...r, a.id]);
    } catch (e) {
      alert(e instanceof GitHubError ? e.message : "Couldn't delete it. Try again.");
    }
  }

  return (
    <section className="vx-page vx-narrow">
      <header className="vx-page-head">
        <h1>{c.announcements.title}</h1>
        <p className="vx-muted">{c.announcements.subtitle}</p>
      </header>
      {editor && <Composer onDone={(a) => setPosted((p) => [a, ...p])} />}
      {items.length === 0
        ? <p className="vx-muted">No announcements yet.</p>
        : (
          <ul className="vx-news">
            {items.map((a) => {
              const img = imageSrc(a.image);
              if (editor && editing === a.id) {
                return (
                  <li key={a.id}>
                    <Composer initial={a} onCancel={() => setEditing(null)}
                      onDone={(n) => { setEdited((e) => ({ ...e, [n.id]: n })); setEditing(null); }} />
                  </li>
                );
              }
              return (
                <li key={a.id} className="vx-card vx-news-item">
                  {img && <img src={img} alt="" loading="lazy" />}
                  <div className="vx-news-body">
                    <h2>{a.title}</h2>
                    {a.date && <time className="vx-muted vx-small" dateTime={a.date}>{new Date(a.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</time>}
                    {a.text && <p>{a.text}</p>}
                    <Attachments files={a.files} />
                    {editor && (
                      <div className="vx-row">
                        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setEditing(a.id)}>Edit</button>
                        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-danger" onClick={() => remove(a)}>Delete</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}

/** Photos and videos shown in a grid; other files as download links. */
function Attachments({ files }: { files: (Attachment & { url?: string })[] }) {
  if (!files.length) return null;
  const media = files.filter((f) => f.kind !== "file");
  const docs = files.filter((f) => f.kind === "file");
  return (
    <>
      {media.length > 0 && (
        <div className={`vx-news-media ${media.length === 1 ? "one" : ""}`}>
          {media.map((f) => f.kind === "image"
            ? <a key={f.path} href={f.url ?? f.path} target="_blank" rel="noopener noreferrer"><img src={f.url ?? f.path} alt={f.name} loading="lazy" /></a>
            : <video key={f.path} src={f.url ?? f.path} controls preload="metadata" playsInline />)}
        </div>
      )}
      {docs.length > 0 && (
        <ul className="vx-news-files">
          {docs.map((f) => <li key={f.path}><a href={f.url ?? f.path} download={f.name}>📎 {f.name}</a></li>)}
        </ul>
      )}
    </>
  );
}

const MAX_MB = 25;
// Allowed uploads (no web pages or scripts, so nothing uploaded can run on the site).
const EXTS: Record<string, Attachment["kind"]> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
  pdf: "file", doc: "file", docx: "file", ppt: "file", pptx: "file", xls: "file", xlsx: "file",
  txt: "file", csv: "file", zip: "file", mp3: "file", wav: "file",
};
const ACCEPT = Object.keys(EXTS).map((e) => `.${e}`).join(",");

/** A file in the form: already posted (path) or just chosen (blob). */
interface Pending { key: string; name: string; kind: Attachment["kind"]; ext: string; url: string; blob?: Blob; path?: string }

/** Editors: write a new announcement, or edit one (title, description, photos, videos and files). */
function Composer({ initial, onDone, onCancel }: { initial?: Announcement; onDone: (a: Announcement) => void; onCancel?: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [keepImage, setKeepImage] = useState(!!initial?.image);
  const [files, setFiles] = useState<Pending[]>(() => (initial?.files ?? []).map((f) => ({
    key: f.path, name: f.name, kind: f.kind, ext: "", url: (f as Attachment & { url?: string }).url ?? f.path, path: f.path,
  })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function pick(list: FileList | null) {
    if (!list) return;
    const added: Pending[] = [];
    for (const f of Array.from(list)) {
      let ext = (f.name.split(".").pop() ?? "").toLowerCase();
      const kind = EXTS[ext];
      if (!kind) { setMsg({ ok: false, text: `“${f.name}” can't be uploaded. Use photos, videos, PDF, Office, text, zip or audio files.` }); continue; }
      let blob: Blob = f;
      if (kind === "image") {
        const r = await prepareImage(f);
        if ("error" in r) { setMsg({ ok: false, text: `${f.name}: ${r.error}` }); continue; }
        blob = r.blob; ext = r.ext;
      }
      if (blob.size > MAX_MB * 1024 * 1024) { setMsg({ ok: false, text: `“${f.name}” is over ${MAX_MB} MB.` }); continue; }
      added.push({ key: crypto.randomUUID(), name: f.name.slice(0, 200), kind, ext, blob, url: URL.createObjectURL(blob) });
    }
    if (added.length) setFiles((p) => [...p, ...added]);
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setMsg({ ok: false, text: "Give it a title." }); return; }
    setBusy(true); setMsg(null);
    try {
      const id = initial?.id ?? crypto.randomUUID();
      const stamp = Date.now().toString(36);
      const attached = files.map((f, i) => {
        if (f.path) return { ...f, path: f.path };
        const base = f.name.replace(/\.[^.]*$/, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
        return { ...f, path: `/files/${stamp}-${i}-${base}.${f.ext}` };
      });
      const a: Announcement = {
        id, title: title.trim(), text: text.trim(), image: keepImage ? initial?.image ?? "" : "",
        date: initial?.date || new Date().toISOString(),
        files: attached.map(({ path, name, kind }) => ({ path, name, kind })),
      };
      // Start from the newest saved copy so nothing saved meanwhile is lost.
      const cur = normalize(await readJson(TOKEN, CONTENT_PATH));
      cur.announcements.items = initial
        ? (cur.announcements.items.some((x) => x.id === id) ? cur.announcements.items.map((x) => (x.id === id ? a : x)) : [a, ...cur.announcements.items])
        : [a, ...cur.announcements.items];
      const changes = [
        { path: CONTENT_PATH, text: JSON.stringify(cur, null, 2) + "\n" },
        ...(await Promise.all(attached.filter((f) => f.blob).map(async (f) => ({ path: `web/public${f.path}`, bytes: new Uint8Array(await f.blob!.arrayBuffer()) })))),
      ];
      await commit(TOKEN, `${initial ? "Edit" : "Post"} the announcement “${a.title.slice(0, 60)}”`, changes);
      onDone({ ...a, files: attached.map(({ path, name, kind, url }) => ({ path, name, kind, url })) as Attachment[] });
      if (initial) return;
      setTitle(""); setText(""); setFiles([]);
      setMsg({ ok: true, text: "Posted. Everyone sees it in about a minute." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof GitHubError ? err.message : "Couldn't post it. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="vx-card vx-stack vx-composer" onSubmit={post}>
      <h2 className="vx-card-title">{initial ? "Edit announcement" : "New announcement"}</h2>
      <input aria-label="Title" placeholder="Title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea aria-label="Description" placeholder="Description" rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      {keepImage && initial?.image && (
        <div className="vx-composer-files"><div className="vx-composer-old">
          <img src={imageSrc(initial.image) ?? ""} alt="" />
          <button type="button" aria-label="Remove picture" onClick={() => setKeepImage(false)}>×</button>
        </div></div>
      )}
      {files.length > 0 && (
        <ul className="vx-composer-files">
          {files.map((f) => (
            <li key={f.key}>
              {f.kind === "image" ? <img src={f.url} alt="" /> : f.kind === "video" ? <video src={f.url} muted /> : <span className="vx-file-icon" aria-hidden="true">📎</span>}
              <span className="vx-small">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.key !== f.key))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="vx-action-row">
        <label className="vx-btn vx-btn-ghost vx-upload">
          Upload File
          <input type="file" multiple accept={ACCEPT} hidden aria-label="Upload File" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
        </label>
        <button className="vx-btn vx-btn-primary" disabled={busy}>
          {busy && <span className="vx-spinner" aria-hidden="true" />}{busy ? "Saving…" : initial ? "Save changes" : "Post"}
        </button>
        {onCancel && <button type="button" className="vx-btn vx-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
      {msg && <p className={`vx-alert ${msg.ok ? "" : "vx-alert-error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </form>
  );
}
