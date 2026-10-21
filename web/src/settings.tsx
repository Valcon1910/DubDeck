import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { defaultSettings } from "./defaults";
import { readJSON, writeJSON } from "./storage";
import type { Settings } from "./types";
import { ensureContrast, textOn } from "./util";

// Settings live on the backend (/api/settings) so they follow you across
// devices. localStorage is only a fast-start cache and offline fallback.

const CACHE_KEY = "dubdeck.settings";
type SyncState = "loading" | "synced" | "saving" | "offline" | "error";
type Mutation = (s: Settings) => Settings;

interface SettingsApi {
  settings: Settings;
  sync: SyncState;
  update(fn: Mutation): void;
  reloadFromServer(): Promise<void>;
  updatedAt: number;
}

const Ctx = createContext<SettingsApi | null>(null);

interface Cached {
  settings: Settings;
  updatedAt: number;
}

function merge(s: Partial<Settings> | null | undefined): Settings {
  return {
    appearance: { ...defaultSettings.appearance, ...s?.appearance },
    defaults: { ...defaultSettings.defaults, ...s?.defaults },
    storage: { ...defaultSettings.storage, ...s?.storage },
    presets: s?.presets?.length ? s.presets : defaultSettings.presets,
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const cached = readJSON<Cached>(CACHE_KEY);
  const [settings, setSettings] = useState<Settings>(() => merge(cached?.settings));
  const [sync, setSync] = useState<SyncState>("loading");
  const updatedAt = useRef(cached?.updatedAt ?? 0);
  const pending = useRef<Mutation[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(settings);
  latest.current = settings;

  const remember = (s: Settings, at: number) => {
    updatedAt.current = at;
    writeJSON(CACHE_KEY, { settings: s, updatedAt: at });
  };

  const reloadFromServer = useCallback(async () => {
    try {
      const res = await api<{ settings: Settings; updatedAt: number }>("/api/settings");
      const s = merge(res.settings);
      setSettings(s);
      remember(s, res.updatedAt);
      setSync("synced");
    } catch (e) {
      setSync((e as ApiError).code === "offline" ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    void reloadFromServer();
  }, [reloadFromServer]);

  const flush = useCallback(async () => {
    const count = pending.current.length;
    if (!count) return;
    setSync("saving");
    const body = latest.current;
    try {
      const res = await api<{ settings: Settings; updatedAt: number }>("/api/settings", {
        method: "PUT",
        body: { settings: body, baseUpdatedAt: updatedAt.current || null },
      });
      pending.current = pending.current.slice(count);
      remember(body, res.updatedAt);
      setSync(pending.current.length ? "saving" : "synced");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body && typeof err.body === "object") {
        // Another device saved first: replay our edits on top of its copy.
        const b = err.body as { settings: Settings; updatedAt: number };
        updatedAt.current = b.updatedAt;
        const rebased = pending.current.reduce((s, fn) => fn(s), merge(b.settings));
        setSettings(rebased);
        latest.current = rebased;
        void flush();
        return;
      }
      writeJSON(CACHE_KEY, { settings: body, updatedAt: updatedAt.current });
      setSync(err.code === "offline" ? "offline" : "error");
    }
  }, []);

  const update = useCallback(
    (fn: Mutation) => {
      setSettings((prev) => {
        const next = fn(prev);
        latest.current = next;
        return next;
      });
      pending.current.push(fn);
      setSync("saving");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 500);
    },
    [flush],
  );

  // Retry unsaved edits when the connection comes back.
  useEffect(() => {
    const online = () => pending.current.length && void flush();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  useApplyAppearance(settings);

  const value = useMemo<SettingsApi>(
    () => ({ settings, sync, update, reloadFromServer, updatedAt: updatedAt.current }),
    [settings, sync, update, reloadFromServer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}

/** Called from the SSE stream: another device saved settings. */
export function useRemoteSettingsListener() {
  const { reloadFromServer, updatedAt, sync } = useSettings();
  return useCallback(
    (remoteUpdatedAt: number) => {
      if (remoteUpdatedAt > updatedAt + 1e-6 && sync !== "saving") void reloadFromServer();
    },
    [reloadFromServer, updatedAt, sync],
  );
}

// -- appearance --------------------------------------------------------------

const SURFACES = { light: "#ffffff", dark: "#1a1b1f" };
const BACKGROUNDS = { light: "#f6f5f2", dark: "#111214" };

function useSystemDark() {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const fn = () => setDark(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return dark;
}

function useApplyAppearance(s: Settings) {
  const systemDark = useSystemDark();
  const { theme, accent, density, fontSize, reducedMotion } = s.appearance;
  useEffect(() => {
    const root = document.documentElement;
    const mode = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    root.dataset.theme = mode;
    root.dataset.density = density;
    root.dataset.motion = reducedMotion;
    root.style.fontSize = `${fontSize}px`;
    // Accent as fill (buttons) and as ink (links, focus rings), both kept at AA contrast.
    const fill = ensureContrast(accent, BACKGROUNDS[mode], 3);
    root.style.setProperty("--accent", fill);
    root.style.setProperty("--accent-contrast", textOn(fill));
    root.style.setProperty("--accent-ink", ensureContrast(accent, SURFACES[mode], 4.5));
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${fill} 14%, transparent)`);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", BACKGROUNDS[mode]));
  }, [theme, accent, density, fontSize, reducedMotion, systemDark]);
}
