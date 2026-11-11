import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContentContext, normalize, pendingLogos, safeUrl, type Content, type Game } from "./content";
import { EditContext, setTextIn, type EditApi } from "./editable";
import {
  ACCESS_PATH, commit, CONTENT_PATH, deployState, GitHubError, readJson, REPO, verify,
  type DeployState, type FileChange,
} from "./github";
import { Downloader } from "./Downloader";
import { GameLogo, GamesPage, HomePage } from "./pages";

export interface Access { emails: string[]; domains: string[] }
type Panel = "pages" | "theme" | "access";
type Page = "home" | "games" | "downloader";

const DRAFT_KEY = "vortex.admin.draft";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SWATCHES = ["#6c4ce0", "#2563eb", "#0891b2", "#059669", "#d97706", "#e4572e", "#db2777", "#111827"];
const MAX_LOGO = 512 * 1024;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function Admin() {
  const token = ""; // added by the site's /gh route, never kept in the browser
  const [user, setUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<{ content: Content; access: Access } | null>(null);

  async function connect(t: string) {
    setLoading(true); setError(null);
    try {
      const login = await verify(t);
      const [rawContent, access] = await Promise.all([
        readJson<unknown>(t, CONTENT_PATH),
        readJson<Access>(t, ACCESS_PATH),
      ]);
      setUser(login);
      setSaved({ content: normalize(rawContent), access: { emails: access.emails ?? [], domains: access.domains ?? [] } });
    } catch (e) {
      setError(e instanceof GitHubError ? e.message : "Couldn't open the editor. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) void connect(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user || !saved) {
    return <SignIn busy={loading} error={error} onRetry={() => connect(token)} />;
  }
  return (
    <Editor
      token={token} user={user} saved={saved}
      onSaved={(s) => setSaved(s)}
      onSignOut={() => { location.hash = "#/"; }}
    />
  );
}

function SignIn({ busy, error, onRetry }: { busy: boolean; error: string | null; onRetry: () => void }) {
  return (
    <section className="vx-page vx-narrow">
      <header className="vx-page-head">
        <p className="vx-eyebrow">Admin</p>
        <h1>Editor</h1>
        <p className="vx-muted">
          You're signed in with your site email, so there's nothing to type. Changes are saved to <code>{REPO}</code> and the
          site updates itself about a minute later.
        </p>
      </header>
      <div className="vx-card vx-form">
        {busy && <p className="vx-muted"><span className="vx-spinner" aria-hidden="true" />Opening the editor…</p>}
        {error && <p className="vx-alert vx-alert-error" role="alert">{error}</p>}
        {!busy && <button className="vx-btn vx-btn-primary" onClick={onRetry}>Try again</button>}
      </div>
      {error && (
        <details className="vx-card vx-help">
          <summary>Set up saving (once, by the site owner)</summary>
          <ol>
            <li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>
            <li>Repository access: <b>Only select repositories</b> → <code>{REPO}</code>. Permissions: <b>Contents: Read and write</b>, <b>Actions: Read-only</b>.</li>
            <li>In the repository, add it under <b>Settings → Secrets and variables → Actions</b> as <code>GH_EDIT_TOKEN</code>.</li>
            <li>Run <b>Actions → Publish test site to real site → Run workflow</b>.</li>
          </ol>
        </details>
      )}
    </section>
  );
}

interface EditorProps {
  token: string;
  user: string;
  saved: { content: Content; access: Access };
  onSaved: (s: { content: Content; access: Access }) => void;
  onSignOut: () => void;
}

interface Snapshot { content: Content; access: Access }

function Editor({ token, user, saved, onSaved, onSignOut }: EditorProps) {
  const initial = useMemo<Snapshot>(() => restoreDraft() ?? { content: clone(saved.content), access: clone(saved.access) }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [snap, setSnap] = useState<Snapshot>(initial);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: "", lastAt: 0 });
  const [, bump] = useState(0);
  const [uploads, setUploads] = useState<Map<string, Uint8Array>>(new Map());
  const [page, setPage] = useState<Page>("home");
  const [panel, setPanel] = useState<Panel>("pages");
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia?.("(min-width: 1000px)").matches ?? true);
  const [previewing, setPreviewing] = useState(false);
  const [dialog, setDialog] = useState<Game | null | undefined>(undefined); // undefined = closed, null = new
  const [publishing, setPublishing] = useState(false);
  const [deploy, setDeploy] = useState<{ sha: string; state: DeployState } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const draft = snap.content;
  const access = snap.access;
  const dirty = !same(draft, saved.content) || !same(access, saved.access) || uploads.size > 0;

  /** Apply a change; typing in one field within 1.5 s counts as one undo step. */
  const change = useCallback((fn: (s: Snapshot) => void, key = "") => {
    setSnap((cur) => {
      const h = history.current;
      const now = Date.now();
      if (!key || key !== h.lastKey || now - h.lastAt > 1500) { h.past.push(cur); if (h.past.length > 100) h.past.shift(); }
      h.future = []; h.lastKey = key; h.lastAt = now;
      const next = clone(cur);
      fn(next);
      return next;
    });
    bump((n) => n + 1);
  }, []);
  const set = useCallback((fn: (c: Content) => void, key = "") => change((s) => fn(s.content), key), [change]);

  function undo() {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(snap); h.lastKey = "";
    setSnap(prev); bump((n) => n + 1);
  }
  function redo() {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(snap); h.lastKey = "";
    setSnap(next); bump((n) => n + 1);
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  const api = useMemo<EditApi>(() => ({
    setText: (path, value) => set((c) => setTextIn(c, path, value), `text:${path}`),
    toggleSection: (k) => set((c) => { c.sections[k].visible = !c.sections[k].visible; }),
    editGame: (g) => setDialog(g ? clone(g) : null),
    moveGame: (id, by) => set((c) => {
      const i = c.games.items.findIndex((g) => g.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= c.games.items.length) return;
      [c.games.items[i], c.games.items[j]] = [c.games.items[j], c.games.items[i]];
    }),
    removeGame: (id) => set((c) => { c.games.items = c.games.items.filter((g) => g.id !== id); }),
  }), [set]);

  // Keep unsaved work across reloads, and warn before leaving.
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(snap));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore */ }
  }, [snap, dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Follow the deploy until the site is live.
  useEffect(() => {
    if (!deploy || deploy.state === "live" || deploy.state === "failed" || deploy.state === "unknown") return;
    const started = Date.now();
    const id = setInterval(async () => {
      const state = await deployState(token, deploy.sha);
      if (state === "unknown" || Date.now() - started > 10 * 60_000) { clearInterval(id); setDeploy({ ...deploy, state: "unknown" }); return; }
      if (state !== deploy.state) setDeploy({ ...deploy, state });
    }, 6000);
    return () => clearInterval(id);
  }, [deploy, token]);

  async function publish() {
    setPublishing(true); setMessage(null);
    const content = normalize(draft);
    content.games.items = content.games.items.map((g) => ({ ...g, name: g.name.trim(), url: g.url.trim() }));
    const bad = content.games.items.find((g) => !g.name || !safeUrl(g.url));
    if (bad) {
      setMessage({ kind: "error", text: `Every game needs a name and a link starting with https:// (check “${bad.name || "untitled"}”).` });
      setPublishing(false); setPage("games"); return;
    }
    const files: FileChange[] = [];
    const parts: string[] = [];
    if (!same(content, saved.content)) { files.push({ path: CONTENT_PATH, text: JSON.stringify(content, null, 2) + "\n" }); parts.push("content"); }
    if (!same(access, saved.access)) { files.push({ path: ACCESS_PATH, text: JSON.stringify(access, null, 2) + "\n" }); parts.push("access list"); }
    for (const [path, bytes] of uploads) {
      if (content.games.items.some((g) => g.logo === path)) files.push({ path: `web/public${path}`, bytes });
    }
    if (!files.length) { setPublishing(false); setUploads(new Map()); return; }
    try {
      const sha = await commit(token, `Edit ${parts.join(" and ") || "logos"} from the Vortex Engine editor`, files);
      onSaved({ content, access: clone(access) });
      setSnap({ content, access: clone(access) }); setUploads(new Map());
      setDeploy({ sha, state: "waiting" });
      setMessage({ kind: "ok", text: "Saved permanently. The live site updates in about a minute." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof GitHubError ? e.message : "Saving failed. Your changes are kept; try again." });
    } finally {
      setPublishing(false);
    }
  }

  function discard() {
    if (!confirm("Discard all unsaved changes?")) return;
    change((s) => { s.content = clone(saved.content); s.access = clone(saved.access); });
    setUploads(new Map());
  }

  const h = history.current;
  const pages: [Page, string][] = [["home", "Home"], ["games", draft.sections.games.title || "Games"], ["downloader", draft.sections.downloader.title || "Downloader"]];

  return (
    <div className={`vx-ed ${previewing ? "vx-ed-previewing" : ""}`}>
      <div className="vx-ed-bar">
        <div className="vx-ed-bar-left">
          <div className="vx-ed-status">
            <span className="vx-eyebrow">Editing · {user}</span>
            <strong>{dirty ? "Unsaved changes" : "All changes saved"}</strong>
            {deploy && <DeployBadge state={deploy.state} />}
          </div>
        </div>
        <div className="vx-seg vx-ed-pages" role="tablist" aria-label="Page">
          {pages.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={page === k} onClick={() => setPage(k)}>{label}</button>
          ))}
        </div>
        <div className="vx-ed-actions">
          <button className="vx-icon-btn" onClick={undo} disabled={!h.past.length} aria-label="Undo" title="Undo">↶</button>
          <button className="vx-icon-btn" onClick={redo} disabled={!h.future.length} aria-label="Redo" title="Redo">↷</button>
          <button className="vx-btn vx-btn-ghost vx-btn-sm" aria-pressed={previewing} onClick={() => setPreviewing((v) => !v)}>
            {previewing ? "Back to editing" : "Preview"}
          </button>
          <button className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
            {panelOpen ? "Hide panel" : "Panel"}
          </button>
          <button className="vx-btn vx-btn-ghost vx-btn-sm" onClick={discard} disabled={!dirty || publishing}>Discard</button>
          <button className="vx-btn vx-btn-primary vx-btn-sm" onClick={publish} disabled={!dirty || publishing}>
            {publishing ? "Saving…" : "Publish"}
          </button>
        </div>
      </div>
      {message && <p className={`vx-alert ${message.kind === "error" ? "vx-alert-error" : ""}`} role="status">{message.text}</p>}

      <div className={`vx-ed-body ${panelOpen && !previewing ? "" : "vx-ed-nopanel"}`}>
        <div className="vx-ed-canvas" style={{ ["--vx-accent" as string]: draft.site.accent }}>
          {!previewing && <p className="vx-ed-hint">Click any text to change it. Changes are saved when you press Publish.</p>}
          <div className="vx-ed-window">
            <ContentContext.Provider value={draft}>
              <EditContext.Provider value={previewing ? null : api}>
                <div className="vx-ed-site-top">
                  <span className="vx-ed-mark" aria-hidden="true" />
                  <SiteName editing={!previewing} value={draft.site.name} onChange={(v) => set((c) => { c.site.name = v; }, "text:site.name")} />
                  <nav className="vx-ed-site-nav">
                    {pages.filter(([k]) => k === "home" || draft.sections[k as "games" | "downloader"].visible).map(([k, label]) => (
                      <button key={k} aria-current={page === k ? "page" : undefined} onClick={() => setPage(k)}>{label}</button>
                    ))}
                  </nav>
                </div>
                <div className="vx-ed-site-main">
                  {page === "home" && <HomePage />}
                  {page === "games" && <GamesPage />}
                  {page === "downloader" && <Downloader />}
                </div>
              </EditContext.Provider>
            </ContentContext.Provider>
          </div>
        </div>

        {panelOpen && !previewing && (
          <aside className="vx-ed-panel" aria-label="Editor panel">
            <nav className="vx-tabs" role="tablist">
              {([["pages", "Pages"], ["theme", "Theme"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}>{label}</button>
              ))}
            </nav>
            {panel === "pages" && (
              <PagesPanel draft={draft} page={page} setPage={setPage}
                toggle={(k) => api.toggleSection(k)} addGame={() => { setPage("games"); setDialog(null); }} />
            )}
            {panel === "theme" && <LookTab draft={draft} set={(fn) => set(fn)} />}
            <footer className="vx-admin-foot">
              <span className="vx-muted vx-small">Saving to <code>{REPO}</code></span>
              <button className="vx-link" onClick={() => { if (!dirty || confirm("Close the editor? Unsaved changes stay on this device.")) onSignOut(); }}>Close editor</button>
            </footer>
          </aside>
        )}
      </div>

      {dialog !== undefined && (
        <GameDialog
          game={dialog}
          onCancel={() => setDialog(undefined)}
          onUpload={(path, bytes, url) => { pendingLogos.set(path, url); setUploads((u) => new Map(u).set(path, bytes)); }}
          onSave={(g) => {
            set((c) => {
              const i = c.games.items.findIndex((x) => x.id === g.id);
              if (i >= 0) c.games.items[i] = g; else c.games.items.push(g);
            });
            setDialog(undefined);
          }}
        />
      )}
    </div>
  );
}

function SiteName({ editing, value, onChange }: { editing: boolean; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== value) ref.current.textContent = value;
  });
  if (!editing) return <strong className="vx-ed-site-name">{value}</strong>;
  return (
    <strong ref={ref} className="vx-ed-site-name vx-editable" contentEditable="plaintext-only" suppressContentEditableWarning
      role="textbox" aria-label="Site name" data-placeholder="Site name"
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      onInput={(e) => onChange((e.currentTarget.textContent ?? "").slice(0, 40))} />
  );
}

function PagesPanel({ draft, page, setPage, toggle, addGame }: {
  draft: Content; page: Page; setPage: (p: Page) => void;
  toggle: (k: keyof Content["sections"]) => void; addGame: () => void;
}) {
  const rows: { key: keyof Content["sections"]; page: Page | null; note: string }[] = [
    { key: "downloader", page: "downloader", note: "Utility" },
    { key: "games", page: "games", note: `${draft.games.items.length} game${draft.games.items.length === 1 ? "" : "s"}` },
    { key: "roblox", page: null, note: "Roblox group link" },
    { key: "docs", page: null, note: "Coming soon" },
    { key: "slides", page: null, note: "Coming soon" },
  ];
  return (
    <div className="vx-stack">
      <button className={`vx-page-row ${page === "home" ? "on" : ""}`} onClick={() => setPage("home")}>
        <span><strong>Home</strong><em>Start page</em></span>
      </button>
      {rows.map((r) => (
        <div key={r.key} className={`vx-page-row ${r.page && page === r.page ? "on" : ""}`}>
          <button className="vx-page-open" disabled={!r.page} onClick={() => r.page && setPage(r.page)}>
            <span><strong>{draft.sections[r.key].title || "Untitled"}</strong><em>{r.note}</em></span>
          </button>
          <label className="vx-switch" title="Show on the site">
            <input type="checkbox" role="switch" checked={draft.sections[r.key].visible} onChange={() => toggle(r.key)}
              aria-label={`Show ${draft.sections[r.key].title}`} />
            <span aria-hidden="true" />
          </label>
        </div>
      ))}
      <button className="vx-btn vx-btn-primary" onClick={addGame}>+ Add a game</button>
      <p className="vx-muted vx-small">Tip: on the page, click any title or text to edit it. Use the switches to show or hide sections.</p>
    </div>
  );
}

function GameDialog({ game, onCancel, onSave, onUpload }: {
  game: Game | null;
  onCancel: () => void;
  onSave: (g: Game) => void;
  onUpload: (path: string, bytes: Uint8Array, previewUrl: string) => void;
}) {
  const [g, setG] = useState<Game>(() => game ?? { id: crypto.randomUUID(), name: "", url: "", logo: "", description: "" });
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);

  async function picked(file: File | undefined) {
    if (!file) return;
    setErr(null);
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) { setErr("Use a PNG, JPG, WebP, GIF or SVG image."); return; }
    if (file.size > MAX_LOGO) { setErr("That image is over 512 KB. Use a smaller one."); return; }
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[file.type]!;
    const path = `/logos/${g.id.slice(0, 8)}-${Date.now().toString(36)}.${ext}`;
    onUpload(path, new Uint8Array(await file.arrayBuffer()), URL.createObjectURL(file));
    setG((x) => ({ ...x, logo: path }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let url = g.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!g.name.trim()) { setErr("Give the game a name."); return; }
    if (!safeUrl(url)) { setErr("Add the game's link, like https://example.com/game."); return; }
    onSave({ ...g, name: g.name.trim(), url, description: g.description.trim() });
  }

  return (
    <div className="tut-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="tut vx-dialog" role="dialog" aria-modal="true" aria-labelledby="gd-title" onSubmit={submit}>
        <div className="tut-head">
          <h2 id="gd-title">{game ? "Edit game" : "Add a game"}</h2>
          <button type="button" className="tut-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="vx-gd-preview">
          <GameLogo game={g} size={72} />
          <div className="vx-stack" style={{ gap: 6 }}>
            <div className="vx-row">
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => input.current?.click()}>Upload logo</button>
              {g.logo && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setG({ ...g, logo: "" })}>Use site icon</button>}
            </div>
            <small className="vx-muted">{g.logo.startsWith("/logos/") ? "Using your uploaded logo." : g.logo ? "Using the logo link." : "Showing the website's own icon."}</small>
          </div>
          <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <label className="vx-field"><span>Name</span>
          <input ref={first} type="text" maxLength={80} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="e.g. Slope" />
        </label>
        <label className="vx-field"><span>Link</span>
          <input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} maxLength={500} value={g.url} onChange={(e) => setG({ ...g, url: e.target.value })} placeholder="https://…" />
        </label>
        <label className="vx-field"><span>Logo image link (optional)</span>
          <input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} maxLength={500} value={g.logo.startsWith("/logos/") ? "" : g.logo} placeholder="Paste an image link, or use Upload logo"
            onChange={(e) => setG({ ...g, logo: e.target.value.trim() })} />
        </label>
        <label className="vx-field"><span>Short description (optional)</span>
          <input type="text" maxLength={160} value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} />
        </label>
        {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
        <div className="tut-foot">
          <span />
          <div className="vx-row">
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={onCancel}>Cancel</button>
            <button className="vx-btn vx-btn-primary vx-btn-sm">{game ? "Done" : "Add game"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function restoreDraft(): Snapshot | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { content: unknown; access: Access };
    return { content: normalize(d.content), access: { emails: d.access?.emails ?? [], domains: d.access?.domains ?? [] } };
  } catch {
    return null;
  }
}

function DeployBadge({ state }: { state: DeployState }) {
  const text = {
    waiting: "Publishing: starting…", running: "Publishing: building the site…", live: "Live now",
    failed: "Publishing failed: open GitHub → Actions", unknown: "Publishing: check GitHub → Actions",
  }[state];
  return <span className={`vx-badge vx-badge-${state}`}>{text}</span>;
}

/* ---------- fields ---------- */

function Field({ label, value, onChange, multiline, hint, maxLength = 300 }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; hint?: string; maxLength?: number;
}) {
  return (
    <label className="vx-field">
      <span>{label}</span>
      {multiline
        ? <textarea rows={2} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}
      {hint && <small className="vx-muted">{hint}</small>}
    </label>
  );
}

type SetFn = (fn: (c: Content) => void) => void;

export function AccessTab({ access, setAccess }: { access: Access; setAccess: (a: Access) => void }) {
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function addEmail(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) { setErr("That isn't a valid email address."); return; }
    if (!access.emails.includes(v)) setAccess({ ...access, emails: [...access.emails, v].sort() });
    setEmail(""); setErr(null);
  }
  function addDomain(e: React.FormEvent) {
    e.preventDefault();
    const v = domain.trim().toLowerCase().replace(/^@/, "");
    if (!DOMAIN_RE.test(v)) { setErr("That isn't a valid domain, like school.edu.co."); return; }
    if (!access.domains.includes(v)) setAccess({ ...access, domains: [...access.domains, v].sort() });
    setDomain(""); setErr(null);
  }
  const removeEmail = (v: string) => {
    if (access.emails.length === 1 && !access.domains.length && !confirm("Removing the last address makes the site visible only to you (the here.now owner). Continue?")) return;
    setAccess({ ...access, emails: access.emails.filter((x) => x !== v) });
  };

  return (
    <div className="vx-stack">
      <p className="vx-muted vx-small">
        Only these people can open the site. They sign in at here.now's gate with a code sent to their email.
        They work on both the published site and the test site. Changes apply about a minute after you save.
      </p>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      <fieldset className="vx-card vx-fieldset">
        <legend>Email addresses ({access.emails.length})</legend>
        <form className="vx-row" onSubmit={addEmail}>
          <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to add" />
          <button className="vx-btn vx-btn-primary vx-btn-sm">Add</button>
        </form>
        <ul className="vx-chips">
          {access.emails.map((v) => (
            <li key={v}><span>{v}</span><button type="button" aria-label={`Remove ${v}`} onClick={() => removeEmail(v)}>×</button></li>
          ))}
        </ul>
      </fieldset>
      <fieldset className="vx-card vx-fieldset">
        <legend>Whole domains ({access.domains.length})</legend>
        <p className="vx-muted vx-small">Everyone with an address at a domain, e.g. all of <code>school.edu.co</code>.</p>
        <form className="vx-row" onSubmit={addDomain}>
          <input type="text" placeholder="school.edu.co" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain to add" />
          <button className="vx-btn vx-btn-primary vx-btn-sm">Add</button>
        </form>
        <ul className="vx-chips">
          {access.domains.map((v) => (
            <li key={v}><span>@{v}</span><button type="button" aria-label={`Remove ${v}`} onClick={() => setAccess({ ...access, domains: access.domains.filter((x) => x !== v) })}>×</button></li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

function LookTab({ draft, set }: { draft: Content; set: SetFn }) {
  const valid = useMemo(() => /^#[0-9a-f]{6}$/i.test(draft.site.accent), [draft.site.accent]);
  return (
    <div className="vx-stack">
      <fieldset className="vx-card vx-fieldset">
        <legend>Site</legend>
        <Field label="Site name (top bar and browser tab)" value={draft.site.name} maxLength={40} onChange={(v) => set((c) => { c.site.name = v; })} />
      </fieldset>
      <fieldset className="vx-card vx-fieldset">
        <legend>Accent color</legend>
        <div className="vx-swatches">
          {SWATCHES.map((s) => (
            <button key={s} type="button" aria-label={s} aria-pressed={draft.site.accent.toLowerCase() === s}
              style={{ background: s }} onClick={() => set((c) => { c.site.accent = s; })} />
          ))}
          <label className="vx-swatch-custom">
            <input type="color" value={valid ? draft.site.accent : "#6c4ce0"} onChange={(e) => set((c) => { c.site.accent = e.target.value; })} />
            <span>Custom</span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
