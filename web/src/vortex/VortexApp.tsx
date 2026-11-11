import { lazy, Suspense, useEffect, useState } from "react";
import { isEditor, useVisitorEmail } from "./admins";
import { ContentContext, normalize, PUBLISHED } from "./content";
import { Downloader } from "./Downloader";
import { GamesPage, HomePage } from "./pages";
import "@fontsource-variable/space-grotesk";
import "./vortex.css";

const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));

type Route = "home" | "games" | "downloader" | "admin";
const ROUTES: Route[] = ["games", "downloader", "admin"];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as Route;
  return ROUTES.includes(r) ? r : "home";
}

const content = normalize(PUBLISHED);

/** The test site links to the published site, and the published site to the test site. */
const IS_TEST = __VORTEX_BRANCH__ === "test";
const OTHER_SITE = IS_TEST
  ? { label: "Published site", url: __VORTEX_SITES__.real }
  : { label: "Test site", url: __VORTEX_SITES__.test };

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
            <BrandName name={content.site.name} />
          </a>
          <nav aria-label="Main">
            {nav.filter(([, , show]) => show).map(([r, label]) => (
              <a key={r} href={r === "home" ? "#/" : `#/${r}`} aria-current={route === r ? "page" : undefined}>{label}</a>
            ))}
            {OTHER_SITE.url && (
              <a className="vx-site-switch" href={OTHER_SITE.url}>{OTHER_SITE.label}</a>
            )}
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
  // A hexagon (tech) with three blades swirling around a core: one engine,
  // many uses (games, docs, utilities).
  return (
    <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" className="vx-mark">
      <defs>
        <linearGradient id="vx-g" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--vx-accent)" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path d="M24 2.5 42.6 13.25v21.5L24 45.5 5.4 34.75v-21.5Z" fill="url(#vx-g)" stroke="url(#vx-g)" strokeWidth="3" strokeLinejoin="round" />
      <g fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round">
        <path d="M24 12.5a11.5 11.5 0 0 1 10 5.8" />
        <path d="M34 29.7a11.5 11.5 0 0 1-10 5.8" transform="rotate(0 24 24)" />
        <path d="M14 29.7A11.5 11.5 0 0 1 14 18.3" />
      </g>
      <g fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round">
        <path d="M24 17.5a6.5 6.5 0 0 1 6.5 6.5" />
        <path d="M24 30.5a6.5 6.5 0 0 1-6.5-6.5" />
      </g>
      <circle cx="24" cy="24" r="2.8" fill="#fff" />
      <circle cx="34" cy="18.3" r="1.8" fill="#fff" />
      <circle cx="24" cy="35.5" r="1.8" fill="#fff" />
      <circle cx="14" cy="18.3" r="1.8" fill="#fff" />
    </svg>
  );
}

/** "Vortex Engine" → bold gradient first word, lighter second word. */
function BrandName({ name }: { name: string }) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return (
    <span className="vx-brand-name">
      <b>{first}</b>{rest.length > 0 && <> <span>{rest.join(" ")}</span></>}
    </span>
  );
}
