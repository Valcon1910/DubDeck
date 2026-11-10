import { useEffect, useMemo, useRef, useState } from "react";
import { ContentContext, normalize, pendingLogos, safeUrl, type Content, type Game, type SectionText } from "./content";
import {
  ACCESS_PATH, commit, CONTENT_PATH, deployState, GitHubError, readJson, REPO, tokenStore, verify,
  type DeployState, type FileChange,
} from "./github";
import { Downloader } from "./Downloader";
import { GameLogo, GamesPage, HomePage } from "./pages";

interface Access { emails: string[]; domains: string[] }
type Tab = "texts" | "games" | "access" | "look";
type PreviewPage = "home" | "games" | "downloader";

const DRAFT_KEY = "vortex.admin.draft";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SWATCHES = ["#6c4ce0", "#2563eb", "#0891b2", "#059669", "#d97706", "#e4572e", "#db2777", "#111827"];
const MAX_LOGO = 512 * 1024;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function Admin() {
  const [token, setToken] = useState(tokenStore.get());
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
      tokenStore.set(t);
      setToken(t); setUser(login);
      setSaved({ content: normalize(rawContent), access: { emails: access.emails ?? [], domains: access.domains ?? [] } });
    } catch (e) {
      setError(e instanceof GitHubError ? e.message : "Couldn't open the editor. Try again.");
      if (e instanceof GitHubError && e.status === 401) tokenStore.clear();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && !user) void connect(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user || !saved) {
    return <SignIn busy={loading} error={error} onConnect={(t) => connect(t.trim())} />;
  }
  return (
    <Editor
      token={token} user={user} saved={saved}
      onSaved={(s) => setSaved(s)}
      onSignOut={() => { tokenStore.clear(); setUser(null); setSaved(null); setToken(""); }}
    />
  );
}

function SignIn({ busy, error, onConnect }: { busy: boolean; error: string | null; onConnect: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <section className="vx-page vx-narrow">
      <header className="vx-page-head">
        <p className="vx-eyebrow">Admin</p>
        <h1>Sign in to edit</h1>
        <p className="vx-muted">
          The editor saves changes to your GitHub repository <code>{REPO}</code>, and the site updates itself about a minute later.
          It needs a GitHub access token that only you have.
        </p>
      </header>
      <form className="vx-card vx-form" onSubmit={(e) => { e.preventDefault(); if (t.trim()) onConnect(t); }}>
        <label className="vx-field">
          <span>GitHub token</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…" value={t} onChange={(e) => setT(e.target.value)} />
        </label>
        {error && <p className="vx-alert vx-alert-error" role="alert">{error}</p>}
        <button className="vx-btn vx-btn-primary" disabled={busy || !t.trim()}>{busy ? "Checking…" : "Open editor"}</button>
        <p className="vx-muted vx-small">The token is stored only in this browser. Use “Sign out” in the editor to remove it.</p>
      </form>
      <details className="vx-card vx-help">
        <summary>How to create the token (once)</summary>
        <ol>
          <li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>Name it “Vortex Engine editor” and choose an expiration (for example 1 year).</li>
          <li>Under <b>Repository access</b> choose <b>Only select repositories</b> → <code>{REPO}</code>.</li>
          <li>Under <b>Permissions → Repository permissions</b> set <b>Contents: Read and write</b> and <b>Actions: Read-only</b>.</li>
          <li>Generate, copy the token, and paste it above. Don't share it with anyone.</li>
        </ol>
      </details>
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

function Editor({ token, user, saved, onSaved, onSignOut }: EditorProps) {
  const [draft, setDraft] = useState<Content>(() => restoreDraft()?.content ?? clone(saved.content));
  const [access, setAccess] = useState<Access>(() => restoreDraft()?.access ?? clone(saved.access));
  const [uploads, setUploads] = useState<Map<string, Uint8Array>>(new Map());
  const [tab, setTab] = useState<Tab>("texts");
  const [preview, setPreview] = useState<PreviewPage>("home");
  const [showPreview, setShowPreview] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [deploy, setDeploy] = useState<{ sha: string; state: DeployState } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = !same(draft, saved.content) || !same(access, saved.access) || uploads.size > 0;

  // Keep unsaved work across reloads.
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ content: draft, access }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore */ }
  }, [draft, access, dirty]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Follow the deploy until the site is live.
  useEffect(() => {
    if (!deploy || deploy.state === "live" || deploy.state === "failed") return;
    const started = Date.now();
    const id = setInterval(async () => {
      const state = await deployState(token, deploy.sha);
      if (state === "unknown" || Date.now() - started > 10 * 60_000) { clearInterval(id); setDeploy({ ...deploy, state: "unknown" }); return; }
      if (state !== deploy.state) setDeploy({ ...deploy, state });
    }, 6000);
    return () => clearInterval(id);
  }, [deploy, token]);

  const set = (fn: (c: Content) => void) => setDraft((d) => { const n = clone(d); fn(n); return n; });

  async function publish() {
    setPublishing(true); setMessage(null);
    const content = normalize(draft);
    content.games.items = content.games.items.map((g) => ({ ...g, name: g.name.trim(), url: g.url.trim() }));
    const bad = content.games.items.find((g) => !g.name || !safeUrl(g.url));
    if (bad) {
      setMessage({ kind: "error", text: `Every game needs a name and a link starting with https:// (check “${bad.name || "untitled"}”).` });
      setPublishing(false); setTab("games"); return;
    }
    const files: FileChange[] = [];
    const parts: string[] = [];
    if (!same(content, saved.content)) { files.push({ path: CONTENT_PATH, text: JSON.stringify(content, null, 2) + "\n" }); parts.push("content"); }
    if (!same(access, saved.access)) {
      files.push({ path: ACCESS_PATH, text: JSON.stringify(access, null, 2) + "\n" }); parts.push("access list");
    }
    for (const [path, bytes] of uploads) {
      if (content.games.items.some((g) => g.logo === path)) files.push({ path: `web/public${path}`, bytes });
    }
    if (!files.length) { setPublishing(false); return; }
    try {
      const sha = await commit(token, `Edit ${parts.join(" and ") || "logos"} from the Vortex Engine editor`, files);
      onSaved({ content, access: clone(access) });
      setDraft(content); setUploads(new Map());
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
    setDraft(clone(saved.content)); setAccess(clone(saved.access)); setUploads(new Map());
  }

  return (
    <div className="vx-admin">
      <div className="vx-admin-bar">
        <div>
          <p className="vx-eyebrow">Admin · {user}</p>
          <strong>{dirty ? "Unsaved changes" : "All changes saved"}</strong>
          {deploy && <DeployBadge state={deploy.state} />}
        </div>
        <div className="vx-admin-actions">
          <button className="vx-btn vx-btn-ghost vx-hide-wide" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <button className="vx-btn vx-btn-ghost" onClick={discard} disabled={!dirty || publishing}>Discard</button>
          <button className="vx-btn vx-btn-primary" onClick={publish} disabled={!dirty || publishing}>
            {publishing ? "Saving…" : "Publish"}
          </button>
        </div>
      </div>
      {message && <p className={`vx-alert ${message.kind === "error" ? "vx-alert-error" : ""}`} role="status">{message.text}</p>}

      <div className={`vx-admin-body ${showPreview ? "" : "vx-no-preview"}`}>
        <div className="vx-admin-edit">
          <nav className="vx-tabs" role="tablist">
            {([["texts", "Texts"], ["games", "Games"], ["access", "Access"], ["look", "Look"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </nav>

          {tab === "texts" && <TextsTab draft={draft} set={set} />}
          {tab === "games" && (
            <GamesTab
              draft={draft} set={set}
              onUpload={(path, bytes, url) => {
                pendingLogos.set(path, url);
                setUploads((u) => new Map(u).set(path, bytes));
              }}
              onFocusPreview={() => setPreview("games")}
            />
          )}
          {tab === "access" && <AccessTab access={access} setAccess={setAccess} />}
          {tab === "look" && <LookTab draft={draft} set={set} />}

          <footer className="vx-admin-foot">
            <span className="vx-muted vx-small">Saving to <code>{REPO}</code></span>
            <button className="vx-link" onClick={() => { if (!dirty || confirm("Sign out? Unsaved changes stay on this device.")) onSignOut(); }}>Sign out</button>
          </footer>
        </div>

        {showPreview && (
          <aside className="vx-admin-preview" aria-label="Live preview">
            <div className="vx-preview-head">
              <span className="vx-eyebrow">Live preview</span>
              <div className="vx-seg">
                {(["home", "games", "downloader"] as const).map((p) => (
                  <button key={p} aria-pressed={preview === p} onClick={() => setPreview(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="vx-preview-frame" style={{ ["--vx-accent" as string]: draft.site.accent }} inert>
              <ContentContext.Provider value={draft}>
                <div className="vx-preview-top"><strong>{draft.site.name}</strong></div>
                <div className="vx-preview-main">
                  {preview === "home" && <HomePage />}
                  {preview === "games" && <GamesPage />}
                  {preview === "downloader" && <Downloader />}
                </div>
              </ContentContext.Provider>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function restoreDraft(): { content: Content; access: Access } | null {
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="vx-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

type SetFn = (fn: (c: Content) => void) => void;

function TextsTab({ draft, set }: { draft: Content; set: SetFn }) {
  const sections: [keyof Content["sections"], string][] = [
    ["downloader", "Downloader card"], ["games", "Games card"], ["docs", "Docs card"], ["slides", "Slides card"],
  ];
  return (
    <div className="vx-stack">
      <fieldset className="vx-card vx-fieldset">
        <legend>Home page</legend>
        <Field label="Title" value={draft.home.title} onChange={(v) => set((c) => { c.home.title = v; })} />
        <Field label="Subtitle" multiline value={draft.home.subtitle} onChange={(v) => set((c) => { c.home.subtitle = v; })} />
      </fieldset>
      {sections.map(([k, label]) => {
        const s: SectionText = draft.sections[k];
        return (
          <fieldset key={k} className="vx-card vx-fieldset">
            <legend>{label}</legend>
            <Toggle label="Show on the home page" checked={s.visible} onChange={(v) => set((c) => { c.sections[k].visible = v; })} />
            <Field label="Title" value={s.title} onChange={(v) => set((c) => { c.sections[k].title = v; })} />
            <Field label="Description" multiline value={s.description} onChange={(v) => set((c) => { c.sections[k].description = v; })} />
          </fieldset>
        );
      })}
      <fieldset className="vx-card vx-fieldset">
        <legend>Games page</legend>
        <Field label="Title" value={draft.games.title} onChange={(v) => set((c) => { c.games.title = v; })} />
        <Field label="Subtitle" value={draft.games.subtitle} onChange={(v) => set((c) => { c.games.subtitle = v; })} />
        <Field label="Introduction" multiline value={draft.games.intro} onChange={(v) => set((c) => { c.games.intro = v; })} />
        <Field label="Text when there are no games" value={draft.games.empty} onChange={(v) => set((c) => { c.games.empty = v; })} />
      </fieldset>
      <fieldset className="vx-card vx-fieldset">
        <legend>Downloader page</legend>
        <Field label="Title" value={draft.downloader.title} onChange={(v) => set((c) => { c.downloader.title = v; })} />
        <Field label="Introduction" multiline value={draft.downloader.intro} onChange={(v) => set((c) => { c.downloader.intro = v; })} />
        <Field label="Footer note" value={draft.downloader.footer} onChange={(v) => set((c) => { c.downloader.footer = v; })} />
      </fieldset>
    </div>
  );
}

function GamesTab({ draft, set, onUpload, onFocusPreview }: {
  draft: Content; set: SetFn;
  onUpload: (path: string, bytes: Uint8Array, previewUrl: string) => void;
  onFocusPreview: () => void;
}) {
  const items = draft.games.items;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileFor = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(onFocusPreview, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, fn: (g: Game) => void) => set((c) => {
    const g = c.games.items.find((x) => x.id === id);
    if (g) fn(g);
  });
  const move = (i: number, d: number) => set((c) => {
    const j = i + d;
    if (j < 0 || j >= c.games.items.length) return;
    [c.games.items[i], c.games.items[j]] = [c.games.items[j], c.games.items[i]];
  });

  async function picked(file: File | undefined) {
    const id = fileFor.current;
    if (!file || !id) return;
    setUploadError(null);
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) { setUploadError("Use a PNG, JPG, WebP, GIF or SVG image."); return; }
    if (file.size > MAX_LOGO) { setUploadError("That image is over 512 KB. Use a smaller one."); return; }
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[file.type]!;
    const path = `/logos/${id.slice(0, 8)}-${Date.now().toString(36)}.${ext}`;
    onUpload(path, new Uint8Array(await file.arrayBuffer()), URL.createObjectURL(file));
    update(id, (g) => { g.logo = path; });
  }

  return (
    <div className="vx-stack">
      <p className="vx-muted vx-small">
        Games listed under “{draft.games.subtitle}”. Each opens the game's website in a new tab. Without a logo, the website's own icon is shown.
      </p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
        onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }} />
      {uploadError && <p className="vx-alert vx-alert-error" role="alert">{uploadError}</p>}
      {items.length === 0 && <p className="vx-empty">No games yet. Add the first one below.</p>}
      {items.map((g, i) => (
        <fieldset key={g.id} className="vx-card vx-fieldset vx-game-edit">
          <legend>{g.name || "New game"}</legend>
          <div className="vx-game-edit-head">
            <GameLogo game={g} size={56} />
            <div className="vx-row">
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => { fileFor.current = g.id; input.current?.click(); }}>Upload logo</button>
              {g.logo && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => update(g.id, (x) => { x.logo = ""; })}>Use site icon</button>}
            </div>
          </div>
          <Field label="Name" value={g.name} maxLength={80} onChange={(v) => update(g.id, (x) => { x.name = v; })} />
          <Field label="Link" value={g.url} maxLength={500} hint={g.url && !safeUrl(g.url) ? "Must start with https://" : undefined}
            onChange={(v) => update(g.id, (x) => { x.url = v; })} />
          <Field label="Logo image link (optional)" value={g.logo.startsWith("/logos/") ? "" : g.logo} maxLength={500}
            hint={g.logo.startsWith("/logos/") ? "Using the uploaded logo." : "Paste an image link, or use Upload logo."}
            onChange={(v) => update(g.id, (x) => { x.logo = v.trim(); })} />
          <Field label="Short description (optional)" value={g.description} maxLength={160} onChange={(v) => update(g.id, (x) => { x.description = v; })} />
          <div className="vx-row">
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
            <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}>Move down</button>
            <button type="button" className="vx-btn vx-btn-danger vx-btn-sm"
              onClick={() => { if (confirm(`Remove “${g.name || "this game"}”?`)) set((c) => { c.games.items.splice(i, 1); }); }}>Remove</button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="vx-btn vx-btn-primary"
        onClick={() => set((c) => { c.games.items.push({ id: crypto.randomUUID(), name: "", url: "", logo: "", description: "" }); })}>
        + Add game
      </button>
    </div>
  );
}

function AccessTab({ access, setAccess }: { access: Access; setAccess: (a: Access) => void }) {
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
        Changes apply about a minute after you publish.
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
