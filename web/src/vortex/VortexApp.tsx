import { useEffect, useState } from "react";
import { Downloader } from "./Downloader";
import "./vortex.css";

type Route = "home" | "downloader";

function readRoute(): Route {
  return location.hash.replace(/^#\/?/, "") === "downloader" ? "downloader" : "home";
}

const SECTIONS = [
  { name: "Games", text: "Quick browser games.", soon: true },
  { name: "Docs", text: "Notes and documents.", soon: true },
  { name: "Slides", text: "Presentations.", soon: true },
] as const;

export function VortexApp() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    document.title = route === "downloader" ? "Downloader · Vortex Engine" : "Vortex Engine";
  }, [route]);

  return (
    <div className="vx">
      <header className="vx-top">
        <a className="vx-brand" href="#/" aria-label="Vortex Engine home">
          <VortexMark />
          <span>Vortex <em>Engine</em></span>
        </a>
        <nav aria-label="Main">
          <a href="#/" aria-current={route === "home" ? "page" : undefined}>Home</a>
          <a href="#/downloader" aria-current={route === "downloader" ? "page" : undefined}>Downloader</a>
        </nav>
      </header>

      <main className="vx-main">
        {route === "downloader" ? <Downloader /> : (
          <section className="vx-page">
            <header className="vx-page-head">
              <h1>Vortex Engine</h1>
              <p className="vx-muted">Games, docs, slides and utilities in one place.</p>
            </header>
            <div className="vx-grid">
              <a className="vx-tile vx-tile-live" href="#/downloader">
                <span className="vx-eyebrow">Utilities</span>
                <strong>Downloader</strong>
                <span className="vx-muted">Save YouTube videos and audio.</span>
              </a>
              {SECTIONS.map((s) => (
                <div key={s.name} className="vx-tile" aria-disabled="true">
                  <span className="vx-eyebrow">Coming soon</span>
                  <strong>{s.name}</strong>
                  <span className="vx-muted">{s.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function VortexMark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--vx-accent)" />
      <path d="M16 7a9 9 0 1 0 9 9 6 6 0 0 0-6-6 3.5 3.5 0 0 0-3.5 3.5A2 2 0 0 0 17.5 15.5"
        fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
