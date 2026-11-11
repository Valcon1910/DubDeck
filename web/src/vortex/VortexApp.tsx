import { lazy, Suspense, useEffect, useState } from "react";
import { isEditor, useVisitorEmail } from "./admins";
import { isSignedOut, logout, nameFromEmail, signBackIn, useApplyAppearance, useGravatar, usePrefs } from "./account";
import { Avatar, Icon, type IconName, Settings } from "./Settings";
import { ContentContext, normalize, PUBLISHED } from "./content";
import { Downloader } from "./Downloader";
import { GamesPage, HomePage, NotFound, SignedOut } from "./pages";
import "@fontsource-variable/space-grotesk";
import "./vortex.css";

const Manage = lazy(() => import("./Manage").then((m) => ({ default: m.Manage })));
const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));

type Route = "home" | "games" | "downloader" | "admin" | "manage" | "notfound";
const ROUTES: Route[] = ["games", "downloader", "admin", "manage"];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as Route;
  if (!/^\/(index\.html)?$/.test(location.pathname)) return "notfound"; // e.g. /something-wrong
  if (!r || r === "home") return "home";
  return ROUTES.includes(r) ? r : "notfound";
}

const content = normalize(PUBLISHED);

/** The test site links to the published site, and the published site to the test site. */
const IS_TEST = __VORTEX_BRANCH__ === "test";
const OTHER_SITE = IS_TEST
  ? { label: "Published site", url: __VORTEX_SITES__.real }
  : { label: "Test site", url: __VORTEX_SITES__.test };

export function VortexApp() {
  const [route, setRoute] = useState<Route>(readRoute);
  const email = useVisitorEmail();
  const editor = isEditor(email);
  const [prefs, setPrefs] = usePrefs(email);
  useApplyAppearance(prefs);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const gravatar = useGravatar(email);
  const [sideHidden, setSideHidden] = useState(() => { try { return localStorage.getItem("vortex.sideHidden") === "1"; } catch { return false; } });
  const toggleSide = (hide: boolean) => {
    setSideHidden(hide);
    try { localStorage.setItem("vortex.sideHidden", hide ? "1" : "0"); } catch { /* ignore */ }
  };

  useEffect(() => {
    const on = () => { setRoute(readRoute()); setDrawer(false); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    const page = { home: "", games: content.games.title, downloader: content.downloader.title, admin: "Editor", manage: "Admin", notfound: "Page not found" }[route];
    document.title = page ? `${page} · ${content.site.name}` : content.site.name;
  }, [route]);

  const s = content.sections;
  const nav: { r: Route; label: string; icon: IconName; show: boolean }[] = [
    { r: "home", label: "Home", icon: "home", show: true },
    { r: "games", label: s.games.title, icon: "games", show: s.games.visible },
    { r: "downloader", label: s.downloader.title, icon: "download", show: s.downloader.visible },
  ];
  const name = prefs.name.trim() || nameFromEmail(email);
  const accent = prefs.accent || content.site.accent;
  const avatar = prefs.avatar || gravatar || "";

  if (isSignedOut()) {
    return (
      <ContentContext.Provider value={content}>
        <div className="vx" style={{ ["--vx-accent" as string]: accent }}><SignedOut onSignIn={signBackIn} /></div>
      </ContentContext.Provider>
    );
  }

  return (
    <ContentContext.Provider value={content}>
      <div className={`vx vx-shell ${sideHidden ? "vx-side-hidden" : ""}`} style={{ ["--vx-accent" as string]: accent }}>
        <aside className={`vx-side ${drawer ? "open" : ""}`} aria-label="Main">
          <div className="vx-side-head">
            <a className="vx-brand" href="#/" aria-label={`${content.site.name} home`}>
              <VortexMark />
              <BrandName name={content.site.name} />
            </a>
            <button type="button" className="vx-side-hide" aria-label="Hide menu" title="Hide menu"
              onClick={() => { if (window.matchMedia("(max-width: 860px)").matches) setDrawer(false); else toggleSide(true); }}><Icon name="chevron-left" /></button>
          </div>
          <nav className="vx-side-nav">
            <p className="vx-side-label">Browse</p>
            {nav.filter((n) => n.show).map((n) => (
              <a key={n.r} href={n.r === "home" ? "#/" : `#/${n.r}`} aria-current={route === n.r ? "page" : undefined}>
                <Icon name={n.icon} />{n.label}
              </a>
            ))}
            {OTHER_SITE.url && (
              <a href={OTHER_SITE.url} className="vx-side-switch"><Icon name="flask" />{OTHER_SITE.label}</a>
            )}
            {(editor || route === "manage" || route === "admin") && (
              <>
                <p className="vx-side-label">Manage</p>
                <a href="#/manage" aria-current={route === "manage" ? "page" : undefined}><Icon name="shield" />Admin</a>
                <a href="#/admin" aria-current={route === "admin" ? "page" : undefined}><Icon name="pen" />Editor</a>
              </>
            )}
          </nav>
        </aside>
        {drawer && <div className="vx-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

        <div className="vx-body">
          <header className="vx-top">
            <button type="button" className="vx-menu-btn" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <Icon name="menu" />
            </button>
            <a className="vx-brand vx-brand-mobile" href="#/" aria-label={`${content.site.name} home`}><VortexMark /></a>
            {sideHidden && (
              <button type="button" className="vx-side-show" aria-label="Show menu" title="Show menu" onClick={() => toggleSide(false)}>
                <Icon name="chevron-right" /><span>Menu</span>
              </button>
            )}
            <div className="vx-account">
              <button type="button" className="vx-user" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <span className="vx-user-name">{name}</span>
                <Avatar src={avatar} name={name} />
              </button>
              {menu && (
                <>
                  <div className="vx-menu-catch" onClick={() => setMenu(false)} aria-hidden="true" />
                  <div className="vx-menu" role="menu">
                    <div className="vx-menu-head">
                      <Avatar src={avatar} name={name} size={40} />
                      <span><strong>{name}</strong><em>{email ?? "Not signed in"}</em></span>
                    </div>
                    <button role="menuitem" onClick={() => { setMenu(false); setSettings(true); }}><Icon name="gear" />Settings</button>
                    <button role="menuitem" onClick={logout}><Icon name="logout" />Log out</button>
                  </div>
                </>
              )}
            </div>
          </header>

          <main className={`vx-main ${route === "admin" ? "vx-main-wide" : ""}`}>
            {route === "home" && <HomePage welcome={{ name, avatar, needsName: !prefs.name.trim(), setName: (n) => setPrefs({ name: n }) }} />}
            {route === "notfound" && <NotFound />}
            {route === "games" && <GamesPage />}
            {route === "downloader" && <Downloader />}
            {route === "manage" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><Manage /></Suspense>
            )}
            {route === "admin" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><Admin /></Suspense>
            )}
          </main>
        </div>
        {settings && <Settings prefs={prefs} update={setPrefs} email={email} gravatar={gravatar} siteAccent={content.site.accent} onClose={() => setSettings(false)} />}
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
