import { createContext, useContext } from "react";
import published from "../../content.json";

// Everything the admin editor can change. The published copy lives in
// web/content.json; the editor commits a new version to GitHub, which
// redeploys the site, so edits are permanent.

export interface SectionText { label: string; title: string; description: string; visible: boolean; url?: string; logo?: string; width?: number; height?: number }

/** Something added on the home page in the editor. */
export interface Block {
  id: string;
  kind: "text" | "box" | "image";
  title: string;
  text: string;
  /** Uploaded (/logos/…) or linked picture; "" = none. */
  image: string;
  /** Optional link the block opens. */
  link: string;
  /** Width in % of the page (10–100). */
  width: number;
  /** Height in px; 0 = as tall as its content. */
  height: number;
}

export const newBlock = (kind: Block["kind"]): Block => ({
  id: crypto.randomUUID(), kind, link: "", image: "", height: kind === "image" ? 240 : 0, width: kind === "text" ? 100 : 50,
  title: kind === "box" ? "New box" : "", text: kind === "image" ? "" : "Write something here.",
});

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
  home: { title: string; subtitle: string; blocks: Block[] };
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
    home: {
      ...d.home, ...(r.home ?? {}),
      blocks: (r.home?.blocks ?? d.home.blocks ?? []).map((b) => ({
        id: String(b.id || crypto.randomUUID()), kind: (["text", "box", "image"].includes(b.kind) ? b.kind : "box") as Block["kind"],
        title: String(b.title ?? ""), text: String(b.text ?? ""), image: String(b.image ?? ""), link: String(b.link ?? ""),
        width: clamp(Number(b.width) || 100, 10, 100), height: clamp(Number(b.height) || 0, 0, 2000),
      })),
    },
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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** A picture to show: an upload waiting to be published, an uploaded file, or an https link. */
export function imageSrc(v: string | undefined): string | null {
  if (!v) return null;
  if (pendingLogos.has(v)) return pendingLogos.get(v)!;
  if (/^\/[\w./-]+$/.test(v) && !v.includes("..")) return v;
  return safeUrl(v);
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
  return site ? `/gg/s2/favicons?sz=128&domain_url=${encodeURIComponent(new URL(site).origin)}` : null;
}
