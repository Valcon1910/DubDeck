import { useState } from "react";
import { logoFor, safeUrl, useContent, type Content, type Game } from "./content";
import { Editable, useEdit } from "./editable";

export interface Welcome { name: string; avatar: string }

export function HomePage({ welcome }: { welcome?: Welcome }) {
  const c = useContent();
  const edit = useEdit();
  const s = c.sections;
  const tiles: { key: keyof Content["sections"]; href: string | null; external?: boolean }[] = [
    { key: "downloader", href: "#/downloader" },
    { key: "games", href: "#/games" },
    { key: "docs", href: null },
    { key: "slides", href: null },
  ];
  return (
    <section className="vx-page">
      {welcome && !edit && <WelcomeCard w={welcome} />}
      <header className="vx-page-head">
        <Editable as="h1" path="home.title" placeholder="Page title" />
        <Editable as="p" className="vx-muted" path="home.subtitle" placeholder="Subtitle" multiline />
      </header>
      <div className="vx-grid">
        {tiles.filter((t) => edit || s[t.key].visible).map((t) => {
          const body = (
            <>
              <Editable as="span" className="vx-eyebrow" path={`sections.${t.key}.label`} placeholder="Label" />
              <Editable as="strong" path={`sections.${t.key}.title`} placeholder="Title" />
              <Editable as="span" className="vx-muted" path={`sections.${t.key}.description`} placeholder="Description" multiline />
              {edit && (
                <button type="button" className="vx-chip-btn" aria-pressed={s[t.key].visible}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); edit.toggleSection(t.key); }}>
                  {s[t.key].visible ? "Shown" : "Hidden"}
                </button>
              )}
            </>
          );
          const cls = `vx-tile ${t.href ? "vx-tile-live" : ""} ${edit && !s[t.key].visible ? "vx-hidden-tile" : ""}`;
          return t.href && !edit
            ? <a key={t.key} className={cls} href={t.href} {...(t.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{body}</a>
            : <div key={t.key} className={cls} aria-disabled={t.href ? undefined : "true"}>{body}</div>;
        })}
      </div>
      {(edit || s.roblox.visible) && <RobloxCard />}
    </section>
  );
}

/** The Roblox group: name on top, then the logo with the description at its right. */
function RobloxCard() {
  const r = useContent().sections.roblox;
  const edit = useEdit();
  const href = safeUrl(r.url ?? "");
  const logo = r.logo?.startsWith("/") ? r.logo : safeUrl(r.logo ?? "");
  const inner = (
    <>
      <Editable as="span" className="vx-eyebrow" path="sections.roblox.label" placeholder="Label" />
      <Editable as="h2" className="vx-roblox-name" path="sections.roblox.title" placeholder="Group name" />
      <div className="vx-roblox-row">
        {logo ? <img className="vx-roblox-logo" src={logo} alt="" width={96} height={96} referrerPolicy="no-referrer" /> : <span className="vx-roblox-logo" />}
        <Editable as="p" className="vx-muted" path="sections.roblox.description" placeholder="Description" multiline />
      </div>
      {edit && (
        <div className="vx-roblox-edit">
          <label className="vx-field"><span>Group link</span>
            <input type="text" value={r.url ?? ""} onChange={(e) => edit.setText("sections.roblox.url", e.target.value)} placeholder="https://www.roblox.com/communities/…" />
          </label>
          <label className="vx-field"><span>Logo image link</span>
            <input type="text" value={r.logo ?? ""} onChange={(e) => edit.setText("sections.roblox.logo", e.target.value)} placeholder="https://…png" />
          </label>
          <button type="button" className="vx-chip-btn" aria-pressed={r.visible} onClick={() => edit.toggleSection("roblox")}>
            {r.visible ? "Shown" : "Hidden"}
          </button>
        </div>
      )}
    </>
  );
  return href && !edit
    ? <a className="vx-card vx-roblox" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
    : <div className={`vx-card vx-roblox ${edit && !r.visible ? "vx-hidden-tile" : ""}`}>{inner}</div>;
}

export function GamesPage() {
  const g = useContent().games;
  const edit = useEdit();
  const items = edit ? g.items : g.items.filter((x) => x.name.trim() && safeUrl(x.url));
  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <Editable as="h1" path="games.title" placeholder="Page title" />
        <Editable as="p" className="vx-muted" path="games.intro" placeholder="Introduction (optional)" multiline />
      </header>
      <Editable as="h2" className="vx-subtitle" path="games.subtitle" placeholder="Subtitle" />
      {items.length === 0 && !edit && <p className="vx-empty">{g.empty}</p>}
      {items.length === 0 && edit && (
        <p className="vx-empty"><Editable path="games.empty" placeholder="Text shown when there are no games" /></p>
      )}
      {(items.length > 0 || edit) && (
        <ul className="vx-games">
          {items.map((game, i) => (
            <li key={game.id} className={edit ? "vx-game-slot" : undefined}>
              {edit ? (
                <div className="vx-game vx-game-editing" role="button" tabIndex={0}
                  onClick={() => edit.editGame(game)} onKeyDown={(e) => { if (e.key === "Enter") edit.editGame(game); }}>
                  <GameCardBody game={game} />
                  <span className="vx-game-tools" onClick={(e) => e.stopPropagation()}>
                    <button type="button" aria-label="Move left" disabled={i === 0} onClick={() => edit.moveGame(game.id, -1)}>‹</button>
                    <button type="button" aria-label="Move right" disabled={i === items.length - 1} onClick={() => edit.moveGame(game.id, 1)}>›</button>
                    <button type="button" aria-label={`Remove ${game.name || "game"}`} className="danger"
                      onClick={() => { if (confirm(`Remove “${game.name || "this game"}”?`)) edit.removeGame(game.id); }}>✕</button>
                  </span>
                </div>
              ) : (
                <a className="vx-game" href={safeUrl(game.url)!} target="_blank" rel="noopener noreferrer">
                  <GameCardBody game={game} />
                </a>
              )}
            </li>
          ))}
          {edit && (
            <li>
              <button type="button" className="vx-game vx-game-add" onClick={() => edit.editGame(null)}>
                <span className="vx-logo vx-logo-add" style={{ width: 64, height: 64 }}>+</span>
                <strong>Add game</strong>
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function GameCardBody({ game }: { game: Game }) {
  const url = safeUrl(game.url);
  return (
    <>
      <GameLogo game={game} />
      <span className="vx-game-text">
        <strong>{game.name || "Untitled game"}</strong>
        {game.description && <span className="vx-muted vx-small">{game.description}</span>}
        <span className="vx-game-host">{url ? new URL(url).hostname.replace(/^www\./, "") : "No link yet"}</span>
      </span>
    </>
  );
}

export function GameLogo({ game, size = 64 }: { game: Game; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = logoFor(game);
  const initial = (game.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="vx-logo" style={{ width: size, height: size }}>
      {src && broken !== src
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(src)} />
        : <span aria-hidden="true">{initial}</span>}
    </span>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
}

/** "Good morning, Valentino!" with the person's picture. */
function WelcomeCard({ w }: { w: Welcome }) {
  const first = w.name.split(/\s+/)[0];
  return (
    <section className="vx-welcome" aria-label="Welcome">
      <span className="vx-avatar vx-welcome-pic" aria-hidden="true">
        {w.avatar ? <img src={w.avatar} alt="" referrerPolicy="no-referrer" /> : first[0]?.toUpperCase()}
      </span>
      <div className="vx-welcome-text">
        <p className="vx-welcome-hi">{greeting()},</p>
        <h2>{w.name}! 👋</h2>
        <p className="vx-muted">Welcome back to Vortex Engine. What are we doing today?</p>
      </div>
    </section>
  );
}

function Lost({ code, title, text, action }: { code: string; title: string; text: string; action: React.ReactNode }) {
  return (
    <section className="vx-lost">
      <div className="vx-lost-art" aria-hidden="true">
        <svg viewBox="0 0 200 200" width="200" height="200">
          <defs>
            <linearGradient id="lost-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--vx-accent)" /><stop offset="1" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="88" fill="url(#lost-g)" opacity="0.12" />
          <g className="vx-lost-spin" fill="none" stroke="url(#lost-g)" strokeWidth="8" strokeLinecap="round">
            <path d="M100 30a70 70 0 0 1 61 36" /><path d="M161 134a70 70 0 0 1-61 36" /><path d="M39 134a70 70 0 0 1 0-68" />
          </g>
          <text x="100" y="114" textAnchor="middle" fontSize="40" fontWeight="700" fill="url(#lost-g)" fontFamily="Space Grotesk Variable, system-ui">{code}</text>
        </svg>
      </div>
      <h1>{title}</h1>
      <p className="vx-muted">{text}</p>
      {action}
    </section>
  );
}

export function NotFound() {
  return (
    <Lost code="404" title="This page got lost in the vortex"
      text="The page you're looking for doesn't exist or was moved."
      action={<a className="vx-btn vx-btn-primary" href="/#/" onClick={() => { if (location.pathname !== "/") { location.href = "/#/"; } }}>Back to home</a>} />
  );
}

export function SignedOut({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="vx-main">
      <Lost code="Bye" title="You're signed out"
        text="See you next time! Your settings are saved on this device for when you come back."
        action={<button type="button" className="vx-btn vx-btn-primary" onClick={onSignIn}>Sign in again</button>} />
    </main>
  );
}
