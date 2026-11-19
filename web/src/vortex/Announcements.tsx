import { useEffect, useState, useSyncExternalStore } from "react";
import { CONTENT_PATH, commit, GitHubError, readJson } from "./github";
import { imageSrc, normalize, useContent, type Announcement } from "./content";
import { prepareImage } from "./images";

const TOKEN = ""; // added by the site's /gh route
const SEEN_KEY = "vortex.seenAnnouncements";

/* ---------- unread count (kept in this browser) ---------- */

const listeners = new Set<() => void>();
function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); } catch { return []; }
}
let seenCache = JSON.stringify(readSeen());
function markSeen(ids: string[]) {
  const next = JSON.stringify([...new Set([...readSeen(), ...ids])]);
  try { localStorage.setItem(SEEN_KEY, next); } catch { /* private window: counts reset next visit */ }
  seenCache = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

/** How many announcements this person hasn't opened yet. */
export function useUnread(): number {
  const items = useContent().announcements.items;
  const seen = useSyncExternalStore(subscribe, () => seenCache);
  const s = new Set<string>(JSON.parse(seen));
  return items.filter((a) => !s.has(a.id)).length;
}

/** The red circle with the number of unread announcements. */
export function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (!count) return null;
  return <span className={`vx-unread ${className}`} aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span>;
}

/* ---------- the page ---------- */

export function AnnouncementsPage({ editor }: { editor: boolean }) {
  const c = useContent();
  const [posted, setPosted] = useState<Announcement[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const items = [...posted, ...c.announcements.items].filter((a) => !removed.includes(a.id));

  // Opening the page reads them all.
  useEffect(() => { markSeen(items.map((a) => a.id)); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {editor && <Composer onPosted={(a) => setPosted((p) => [a, ...p])} />}
      {items.length === 0
        ? <p className="vx-muted">No announcements yet.</p>
        : (
          <ul className="vx-news">
            {items.map((a) => {
              const img = imageSrc(a.image);
              return (
                <li key={a.id} className="vx-card vx-news-item">
                  {img && <img src={img} alt="" loading="lazy" />}
                  <div className="vx-news-body">
                    <h2>{a.title}</h2>
                    {a.date && <time className="vx-muted vx-small" dateTime={a.date}>{new Date(a.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</time>}
                    {a.text && <p>{a.text}</p>}
                    {editor && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-danger" onClick={() => remove(a)}>Delete</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}

/** Editors: write and post an announcement (title, picture, description). */
function Composer({ onPosted }: { onPosted: (a: Announcement) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ blob: Blob; ext: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    const r = await prepareImage(f);
    if ("error" in r) { setMsg({ ok: false, text: r.error }); return; }
    setImage({ ...r, url: URL.createObjectURL(r.blob) }); setMsg(null);
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setMsg({ ok: false, text: "Give it a title." }); return; }
    setBusy(true); setMsg(null);
    try {
      const id = crypto.randomUUID();
      const path = image ? `/logos/news-${Date.now().toString(36)}.${image.ext}` : "";
      const a: Announcement = { id, title: title.trim(), text: text.trim(), image: path, date: new Date().toISOString() };
      // Start from the newest saved copy so nothing saved meanwhile is lost.
      const cur = normalize(await readJson(TOKEN, CONTENT_PATH));
      cur.announcements.items = [a, ...cur.announcements.items];
      const files = [{ path: CONTENT_PATH, text: JSON.stringify(cur, null, 2) + "\n" }];
      const withImage = image ? [...files, { path: `web/public${path}`, bytes: new Uint8Array(await image.blob.arrayBuffer()) }] : files;
      await commit(TOKEN, `Post the announcement “${a.title.slice(0, 60)}”`, withImage);
      onPosted({ ...a, image: image ? image.url : "" });
      markSeen([id]);
      setTitle(""); setText(""); setImage(null);
      setMsg({ ok: true, text: "Posted. Everyone sees it in about a minute." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof GitHubError ? err.message : "Couldn't post it. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="vx-card vx-stack vx-composer" onSubmit={post}>
      <h2 className="vx-card-title">New announcement</h2>
      <input aria-label="Title" placeholder="Title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea aria-label="Description" placeholder="Description" rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      {image && (
        <div className="vx-composer-img">
          <img src={image.url} alt="" />
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setImage(null)}>Remove picture</button>
        </div>
      )}
      <div className="vx-action-row">
        <label className="vx-btn vx-btn-ghost">
          {image ? "Change picture" : "Add picture"}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden aria-label="Picture" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <button className="vx-btn vx-btn-primary" disabled={busy}>
          {busy && <span className="vx-spinner" aria-hidden="true" />}{busy ? "Posting…" : "Post"}
        </button>
      </div>
      {msg && <p className={`vx-alert ${msg.ok ? "" : "vx-alert-error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </form>
  );
}
