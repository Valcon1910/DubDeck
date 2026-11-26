import { lazy, Suspense, useEffect, useState } from "react";
import { isEditor, isOwner, useVisitorEmail } from "./admins";
import { isSignedOut, logout, nameFromEmail, signBackIn, useApplyAppearance, useGravatar, usePrefs, type Prefs } from "./account";
import { Avatar, Icon, type IconName, Settings } from "./Settings";
import { ContentContext, normalize, PUBLISHED } from "./content";
import { Downloader } from "./Downloader";
import { GamesPage, HomePage, NotFound, SignedOut } from "./pages";
import { AnnouncementsPage } from "./Announcements";
import { CHAT_ON, ChatProvider, UnreadBadge, useChat } from "./chat/store";
import { isGaming } from "../hexdrift/gaming";
import { setPartyClient, useParty } from "../hexdrift/partyhub";
import "@fontsource-variable/space-grotesk";
import "./vortex.css";

const Manage = lazy(() => import("./Manage").then((m) => ({ default: m.Manage })));
const ChatPage = lazy(() => import("./chat/Chat").then((m) => ({ default: m.ChatPage })));
const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));
const ProfilePage = lazy(() => import("./Profile").then((m) => ({ default: m.ProfilePage })));
const PartyDock = lazy(() => import("../hexdrift/partydock").then((m) => ({ default: m.PartyDock })));
const Hexdrift = lazy(() => import("../hexdrift/Hexdrift").then((m) => ({ default: m.Hexdrift })));

type Route = "home" | "games" | "downloader" | "announcements" | "chat" | "admin" | "manage" | "hexdrift" | "profile" | "notfound";
const ROUTES: Route[] = ["games", "downloader", "announcements", "chat", "admin", "manage", "hexdrift", "profile"];

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
  const email = useVisitorEmail();
  const [prefs, setPrefs] = usePrefs(email);
  const gravatar = useGravatar(email);
  return (
    <ChatProvider email={isSignedOut() ? null : email} owner={isOwner(email ?? "")}
      name={prefs.name.trim() || nameFromEmail(email)} avatar={prefs.avatar || gravatar || ""}>
      <Shell email={email} prefs={prefs} setPrefs={setPrefs} gravatar={gravatar} />
    </ChatProvider>
  );
}

function Shell({ email, prefs, setPrefs, gravatar }: { email: string | null; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; gravatar: string | null }) {
  const [route, setRoute] = useState<Route>(readRoute);
  const editor = isEditor(email);
  const chat = useChat();
  const unread = chat?.unread ?? 0;
  // The Hexdrift party you're in stays open on every page (its card is top right).
  const party = useParty();
  const chatSb = chat?.status === "ready" ? chat.sb : null;
  useEffect(() => { setPartyClient(chatSb); }, [chatSb]);
  useApplyAppearance(prefs);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setSettings((e as CustomEvent<boolean>).detail !== false);
    window.addEventListener("vortex:settings", on);
    return () => window.removeEventListener("vortex:settings", on);
  }, []);
  const [drawer, setDrawer] = useState(false);
  const [sideHidden, setSideHidden] = useState(() => { try { return localStorage.getItem("vortex.sideHidden") === "1"; } catch { return false; } });
  const toggleSide = (hide: boolean) => {
    setSideHidden(hide);
    try { localStorage.setItem("vortex.sideHidden", hide ? "1" : "0"); } catch { /* ignore */ }
  };

  useEffect(() => {
    let lastUrl = location.href;
    const on = () => {
      const next = readRoute();
      // Gaming Mode: links and Back can't leave the game.
      if (isGaming() && next !== "hexdrift") { history.replaceState(history.state, "", lastUrl); return; }
      lastUrl = location.href;
      setRoute((was) => { if (was !== next) window.scrollTo(0, 0); return next; });
      setDrawer(false);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const s0 = content.sections;
  useEffect(() => {
    const page = { home: "", games: content.games.title, downloader: content.downloader.title, announcements: content.announcements.title, chat: s0.chat.title, admin: "Editor", manage: "Admin", hexdrift: "Hexdrift", profile: "Profile", notfound: "Page not found" }[route];
    const base = page ? `${page} · ${content.site.name}` : content.site.name;
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [route, unread]);

  const s = content.sections;
  const nav: { r: Route; label: string; icon: IconName; show: boolean }[] = [
    { r: "home", label: "Home", icon: "home", show: true },
    { r: "games", label: s.games.title, icon: "games", show: s.games.visible },
    { r: "downloader", label: s.downloader.title, icon: "download", show: s.downloader.visible },
    { r: "announcements", label: s.announcements.title, icon: "megaphone", show: s.announcements.visible },
    { r: "chat", label: s.chat.title, icon: "chat", show: CHAT_ON && s.chat.visible },
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
            <a className="vx-brand vx-brand-side" href="#/" aria-label={`${content.site.name} home`}>
              <VortexMark size={46} />
              <BrandName name={content.site.name} />
            </a>
            <button type="button" className="vx-side-hide" aria-label="Hide menu" title="Hide menu"
              onClick={() => { if (window.matchMedia("(max-width: 860px)").matches) setDrawer(false); else toggleSide(true); }}><Icon name="chevron-left" /></button>
          </div>
          <nav className="vx-side-nav">
            <p className="vx-side-label">Browse</p>
            {nav.filter((n) => n.show).map((n) => (
              <a key={n.r} href={n.r === "home" ? "#/" : `#/${n.r}`} aria-current={route === n.r ? "page" : undefined}>
                <Icon name={n.icon} />{n.label}{n.r === "chat" && <UnreadBadge count={unread} label="unread messages" />}
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
              <a className="vx-brand vx-brand-top" href="#/" aria-label={`${content.site.name} home`}>
                <VortexMark size={40} /><BrandName name={content.site.name} />
              </a>
            )}
            {sideHidden && (
              <nav className="vx-topnav" aria-label="Main">
                <button type="button" className="vx-side-show" aria-label="Show side menu" title="Show side menu" onClick={() => toggleSide(false)}>
                  <Icon name="chevron-right" />
                </button>
                {nav.filter((n) => n.show).map((n) => (
                  <a key={n.r} href={n.r === "home" ? "#/" : `#/${n.r}`} aria-current={route === n.r ? "page" : undefined}>{n.label}{n.r === "chat" && <UnreadBadge count={unread} label="unread messages" />}</a>
                ))}
                {OTHER_SITE.url && <a href={OTHER_SITE.url} className="vx-site-switch">{OTHER_SITE.label}</a>}
                {(editor || route === "manage" || route === "admin") && (
                  <>
                    <a className="vx-editor-btn vx-admin-btn" href="#/manage" aria-current={route === "manage" ? "page" : undefined}>Admin</a>
                    <a className="vx-editor-btn" href="#/admin" aria-current={route === "admin" ? "page" : undefined}>Editor</a>
                  </>
                )}
              </nav>
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

          <main className={`vx-main ${route === "admin" ? "vx-main-wide" : ""} ${route === "chat" ? "vx-main-chat" : ""}`}>
            {route === "home" && <HomePage welcome={{ name, avatar }} />}
            {route === "notfound" && <NotFound />}
            {route === "games" && <GamesPage />}
            {route === "downloader" && <Downloader />}
            {route === "announcements" && <AnnouncementsPage editor={isOwner(email ?? "")} />}
            {route === "chat" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><ChatPage /></Suspense>
            )}
            {route === "profile" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><ProfilePage /></Suspense>
            )}
            {route === "manage" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><Manage /></Suspense>
            )}
            {route === "admin" && (
              <Suspense fallback={<div className="vx-card vx-skeleton" aria-hidden="true" />}><Admin /></Suspense>
            )}
          </main>
        </div>
        {route === "hexdrift" && (
          <Suspense fallback={<div className="vx-game-loading" role="status">Loading Hexdrift…</div>}><Hexdrift /></Suspense>
        )}
        {party && <Suspense fallback={null}><PartyDock /></Suspense>}
        {settings && <Settings prefs={prefs} update={setPrefs} email={email} gravatar={gravatar} siteAccent={content.site.accent} onClose={() => setSettings(false)} />}
      </div>
    </ContentContext.Provider>
  );
}

function VortexMark({ size = 34 }: { size?: number }) {
  // A hexagon (tech) with three blades swirling around a core: one engine,
  // many uses (games, docs, utilities). Dark outline, inner bevel and a soft
  // highlight give it depth at small sizes.
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="vx-mark">
      <defs>
        <linearGradient id="vx-g" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--vx-accent)" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="vx-shine" x1="24" y1="3" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* outline + body */}
      <path d="M24 2 43.05 13v22L24 46 4.95 35V13Z" fill="#1e1b4b" />
      <path d="M24 4.3 41.05 14.15v19.7L24 43.7 6.95 33.85v-19.7Z" fill="url(#vx-g)" />
      {/* highlight on the upper half and an inner bevel line */}
      <path d="M24 4.3 41.05 14.15V24H6.95v-9.85Z" fill="url(#vx-shine)" />
      <path d="M24 7.6 38.2 15.8v16.4L24 40.4 9.8 32.2V15.8Z" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1" strokeLinejoin="round" />
      {/* blades: dark shadow first, then white */}
      <g fill="none" strokeLinecap="round" strokeWidth="3.4">
        <g stroke="#1e1b4b" strokeOpacity="0.35" transform="translate(0.6 0.9)">
          <path d="M24 12.5a11.5 11.5 0 0 1 10 5.8" /><path d="M34 29.7a11.5 11.5 0 0 1-10 5.8" /><path d="M14 29.7A11.5 11.5 0 0 1 14 18.3" />
        </g>
        <g stroke="#fff">
          <path d="M24 12.5a11.5 11.5 0 0 1 10 5.8" /><path d="M34 29.7a11.5 11.5 0 0 1-10 5.8" /><path d="M14 29.7A11.5 11.5 0 0 1 14 18.3" />
        </g>
      </g>
      <g fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.2" strokeLinecap="round">
        <path d="M24 17.5a6.5 6.5 0 0 1 6.5 6.5" />
        <path d="M24 30.5a6.5 6.5 0 0 1-6.5-6.5" />
      </g>
      {/* core and blade tips */}
      <circle cx="24" cy="24" r="3.6" fill="#1e1b4b" fillOpacity="0.35" />
      <circle cx="24" cy="24" r="2.8" fill="#fff" />
      <circle cx="24" cy="24" r="1.1" fill="url(#vx-g)" />
      <g fill="#fff" stroke="#1e1b4b" strokeOpacity="0.35" strokeWidth="0.8">
        <circle cx="34" cy="18.3" r="2" /><circle cx="24" cy="35.5" r="2" /><circle cx="14" cy="18.3" r="2" />
      </g>
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
