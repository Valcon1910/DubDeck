import { lazy, Suspense, useEffect, useState } from "react";
import { isEditor, useVisitorEmail } from "./admins";
import { ContentContext, normalize, PUBLISHED } from "./content";
import { Downloader } from "./Downloader";
import { GamesPage, HomePage } from "./pages";
import "./vortex.css";

const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));

type Route = "home" | "games" | "downloader" | "admin";
const ROUTES: Route[] = ["games", "downloader", "admin"];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as Route;
  return ROUTES.includes(r) ? r : "home";
}

const content = normalize(PUBLISHED);

export function VortexApp() {
  const [route, setRoute] = useState<Route>(readRoute);
  const editor = isEditor(useVisitorEmail());

  useEffect(() => {
    const on = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    const page = { home: "", games: content.games.title, downloader: content.downloader.title, admin: "Editor" }[route];
    document.title = page ? `${page} · ${content.site.name}` : content.site.name;
  }, [route]);

  const s = content.sections;
  const nav: [Route, string, boolean][] = [
    ["home", "Home", true],
    ["games", s.games.title, s.games.visible],
    ["downloader", s.downloader.title, s.downloader.visible],
  ];

  return (
    <ContentContext.Provider value={content}>
      <div className="vx" style={{ ["--vx-accent" as string]: content.site.accent }}>
        <header className="vx-top">
          <a className="vx-brand" href="#/" aria-label={`${content.site.name} home`}>
            <VortexMark />
            <span>{content.site.name}</span>
          </a>
          <nav aria-label="Main">
            {nav.filter(([, , show]) => show).map(([r, label]) => (
              <a key={r} href={r === "home" ? "#/" : `#/${r}`} aria-current={route === r ? "page" : undefined}>{label}</a>
            ))}
            {(editor || route === "admin") && (
              <a className="vx-editor-btn" href="#/admin" aria-current={route === "admin" ? "page" : undefined}>Editor</a>
            )}
          </nav>
        </header>

        <main className={`vx-main ${route === "admin" ? "vx-main-wide" : ""}`}>
          {route === "home" && <HomePage />}
          {route === "games" && <GamesPage />}
          {route === "downloader" && <Downloader />}
          {route === "admin" && (
            <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><Admin /></Suspense>
          )}
        </main>

      </div>
    </ContentContext.Provider>
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
