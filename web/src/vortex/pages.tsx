import { useState } from "react";
import { logoFor, safeUrl, useContent, type Content, type Game } from "./content";
import { Editable, useEdit } from "./editable";

export function HomePage() {
  const c = useContent();
  const edit = useEdit();
  const s = c.sections;
  const tiles: { key: keyof Content["sections"]; href: string | null; label: string }[] = [
    { key: "downloader", href: "#/downloader", label: "Utilities" },
    { key: "games", href: "#/games", label: "Games" },
    { key: "docs", href: null, label: "Coming soon" },
    { key: "slides", href: null, label: "Coming soon" },
  ];
  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <Editable as="h1" path="home.title" placeholder="Page title" />
        <Editable as="p" className="vx-muted" path="home.subtitle" placeholder="Subtitle" multiline />
      </header>
      <div className="vx-grid">
        {tiles.filter((t) => edit || s[t.key].visible).map((t) => {
          const body = (
            <>
              <span className="vx-eyebrow">{t.label}</span>
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
            ? <a key={t.key} className={cls} href={t.href}>{body}</a>
            : <div key={t.key} className={cls} aria-disabled={t.href ? undefined : "true"}>{body}</div>;
        })}
      </div>
    </section>
  );
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
