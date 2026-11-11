import { createContext, useContext } from "react";
import published from "../../content.json";

// Everything the admin editor can change. The published copy lives in
// web/content.json; the editor commits a new version to GitHub, which
// redeploys the site, so edits are permanent.

export interface SectionText { label: string; title: string; description: string; visible: boolean; url?: string; logo?: string }

export interface Game {
  id: string;
  name: string;
  url: string;
  /** Image URL, a site path like /logos/x.png, or "" to use the site's own icon. */
  logo: string;
  description: string;
}

export interface Content {
  site: { name: string; accent: string };
  home: { title: string; subtitle: string };
  sections: { games: SectionText; docs: SectionText; slides: SectionText; downloader: SectionText; roblox: SectionText };
  games: { title: string; subtitle: string; intro: string; empty: string; items: Game[] };
  downloader: { title: string; intro: string; footer: string };
}

export const PUBLISHED = published as Content;

/** Fill missing keys from the published defaults, so older or partial files still load. */
export function normalize(raw: unknown): Content {
  const r = (raw ?? {}) as Partial<Content>;
  const d = PUBLISHED;
  const sec = (k: keyof Content["sections"]) => ({ ...d.sections[k], ...(r.sections?.[k] ?? {}) });
  return {
    site: { ...d.site, ...(r.site ?? {}) },
    home: { ...d.home, ...(r.home ?? {}) },
    sections: { games: sec("games"), docs: sec("docs"), slides: sec("slides"), downloader: sec("downloader"), roblox: sec("roblox") },
    games: {
      ...d.games, ...(r.games ?? {}),
      items: (r.games?.items ?? d.games.items).map((g) => ({
        id: String(g.id || crypto.randomUUID()), name: String(g.name ?? ""), url: String(g.url ?? ""),
        logo: String(g.logo ?? ""), description: String(g.description ?? ""),
      })),
    },
    downloader: { ...d.downloader, ...(r.downloader ?? {}) },
  };
}

export const ContentContext = createContext<Content>(normalize(PUBLISHED));
export const useContent = () => useContext(ContentContext);

/** Only http(s) links may be used for games and logos. */
export function safeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Logos uploaded in the editor but not published yet: site path → local preview URL. */
export const pendingLogos = new Map<string, string>();

/** The logo to show for a game: its own logo, else the website's icon. */
export function logoFor(g: Game): string | null {
  if (pendingLogos.has(g.logo)) return pendingLogos.get(g.logo)!;
  if (/^\/logos\/[\w.-]+$/.test(g.logo)) return g.logo;
  if (g.logo) return safeUrl(g.logo);
  const site = safeUrl(g.url);
  return site ? `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(new URL(site).origin)}` : null;
}
