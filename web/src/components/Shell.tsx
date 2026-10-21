import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth, useUser } from "../auth";
import { useLive } from "../live";
import { ROUTES, useRouter, type Route } from "../router";
import { safeImg } from "../util";
import { Icon } from "./Icon";
import { Logo, LogoMark } from "./Logo";

const NAV: { route: Route; label: string; icon: string; key: string }[] = [
  { route: "download", label: "Download", icon: "download", key: "1" },
  { route: "queue", label: "Queue", icon: "queue", key: "2" },
  { route: "library", label: "Library", icon: "library", key: "3" },
  { route: "settings", label: "Settings", icon: "settings", key: "4" },
];

function Avatar({ size = 28 }: { size?: number }) {
  const user = useUser();
  const [broken, setBroken] = useState(false);
  const src = safeImg(user.picture);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return src && !broken ? (
    <img className="avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="avatar avatar-initial" style={{ width: size, height: size }} aria-hidden="true">{initial}</span>
  );
}

export function UserChip({ compact }: { compact?: boolean }) {
  const user = useUser();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`user-chip${compact ? " is-compact" : ""}`} ref={ref}>
      <button className="user-chip-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar />
        {!compact && (
          <span className="user-chip-text">
            <span className="user-chip-label">Signed in as</span>
            <span className="user-chip-email" title={user.email}>{user.email}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="user-chip-label">Signed in as</span>
            <strong title={user.email}>{user.email}</strong>
          </div>
          <button role="menuitem" className="menu-item" onClick={() => void signOut()}>
            <Icon name="logout" size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children, onShortcuts }: { children: ReactNode; onShortcuts: () => void }) {
  const { route, go } = useRouter();
  const { jobs, connection } = useLive();
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const [offline, setOffline] = useState(false);

  // Only show the banner if the stream stays down for a few seconds.
  useEffect(() => {
    if (connection === "open") {
      setOffline(false);
      return;
    }
    const t = window.setTimeout(() => setOffline(true), 6000);
    return () => window.clearTimeout(t);
  }, [connection]);

  const link = (n: (typeof NAV)[number], cls: string) => (
    <a
      key={n.route}
      href={ROUTES[n.route]}
      className={`${cls}${route === n.route ? " is-active" : ""}`}
      aria-current={route === n.route ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        go(n.route);
      }}
    >
      <Icon name={n.icon} />
      <span className="nav-label">{n.label}</span>
      {n.route === "queue" && active > 0 && <span className="badge" aria-label={`${active} active`}>{active}</span>}
    </a>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand"><Logo /></div>
        <nav className="sidebar-nav">{NAV.map((n) => link(n, "nav-item"))}</nav>
        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm shortcut-btn" onClick={onShortcuts}>
            <Icon name="keyboard" size={16} /> <span className="nav-label">Shortcuts</span> <kbd>?</kbd>
          </button>
          <UserChip />
        </div>
      </aside>
      <header className="topbar">
        <span className="topbar-brand"><LogoMark size={28} /><span className="logo-word">Dub<span className="logo-accent">Deck</span></span></span>
        <UserChip compact />
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {offline && (
          <div className="banner" role="status">
            <Icon name="info" size={18} />
            Live updates paused — reconnecting to your DubDeck server…
          </div>
        )}
        {children}
      </main>
      <nav className="bottombar" aria-label="Main navigation">{NAV.map((n) => link(n, "tab-item"))}</nav>
    </div>
  );
}

export { NAV };
