import { useState } from "react";
import { logoFor, safeUrl, useContent, type Game } from "./content";

export function HomePage() {
  const c = useContent();
  const s = c.sections;
  const tiles = [
    { key: "downloader", sec: s.downloader, href: "#/downloader", label: "Utilities" },
    { key: "games", sec: s.games, href: "#/games", label: "Games" },
    { key: "docs", sec: s.docs, href: null, label: "Coming soon" },
    { key: "slides", sec: s.slides, href: null, label: "Coming soon" },
  ].filter((t) => t.sec.visible);
  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <h1>{c.home.title}</h1>
        <p className="vx-muted">{c.home.subtitle}</p>
      </header>
      <div className="vx-grid">
        {tiles.map((t) => t.href ? (
          <a key={t.key} className="vx-tile vx-tile-live" href={t.href}>
            <span className="vx-eyebrow">{t.label}</span>
            <strong>{t.sec.title}</strong>
            <span className="vx-muted">{t.sec.description}</span>
          </a>
        ) : (
          <div key={t.key} className="vx-tile" aria-disabled="true">
            <span className="vx-eyebrow">{t.label}</span>
            <strong>{t.sec.title}</strong>
            <span className="vx-muted">{t.sec.description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function GamesPage() {
  const g = useContent().games;
  const items = g.items.filter((x) => x.name.trim() && safeUrl(x.url));
  return (
    <section className="vx-page">
      <header className="vx-page-head">
        <h1>{g.title}</h1>
        {g.intro && <p className="vx-muted">{g.intro}</p>}
      </header>
      <h2 className="vx-subtitle">{g.subtitle}</h2>
      {items.length === 0 ? (
        <p className="vx-empty">{g.empty}</p>
      ) : (
        <ul className="vx-games">
          {items.map((game) => (
            <li key={game.id}>
              <a className="vx-game" href={safeUrl(game.url)!} target="_blank" rel="noopener noreferrer">
                <GameLogo game={game} />
                <span className="vx-game-text">
                  <strong>{game.name}</strong>
                  {game.description && <span className="vx-muted vx-small">{game.description}</span>}
                  <span className="vx-game-host">{new URL(safeUrl(game.url)!).hostname.replace(/^www\./, "")}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GameLogo({ game, size = 64 }: { game: Game; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = logoFor(game);
  const initial = (game.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="vx-logo" style={{ width: size, height: size }}>
      {src && !broken
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span aria-hidden="true">{initial}</span>}
    </span>
  );
}
