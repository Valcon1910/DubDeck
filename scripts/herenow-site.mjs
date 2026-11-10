// The Vortex Engine Site's slug, so every deploy updates the same Site and the
// address never changes.
//
// Order: HERENOW_SLUG (repository variable) → config/site.json (written by the
// deploy workflow the first time it creates the Site) → the newest Site in the
// account named "Vortex Engine" → null (a new Site is created).

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const SITE_NAME = "Vortex Engine";
export const SITE_FILE = "config/site.json";

export function savedSlug() {
  if (!existsSync(SITE_FILE)) return "";
  try {
    return String(JSON.parse(readFileSync(SITE_FILE, "utf8")).slug ?? "").trim();
  } catch {
    return "";
  }
}

export function saveSlug(slug) {
  writeFileSync(SITE_FILE, JSON.stringify({ slug }, null, 2) + "\n");
}

export async function findSlug({ api, key, client }) {
  const fromVar = (process.env.HERENOW_SLUG ?? "").trim();
  if (fromVar) return fromVar;
  const fromFile = savedSlug();
  if (fromFile) return fromFile;
  const res = await fetch(`${api}/api/v1/publishes`, {
    headers: { Authorization: `Bearer ${key}`, "X-HereNow-Client": client },
  });
  if (!res.ok) {
    console.warn(`Couldn't list Sites (${res.status}).`);
    return null;
  }
  const { publishes = [] } = await res.json();
  console.log(`Sites in the account: ${publishes.map((p) => `${p.slug} "${p.displayName ?? ""}"`).join(", ") || "none"}`);
  const site = publishes
    .filter((p) => (p.displayName ?? "").trim() === SITE_NAME)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (site) console.log(`Using the existing Site ${site.slug}.`);
  return site?.slug ?? null;
}
