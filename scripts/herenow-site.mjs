// Find the Vortex Engine Site's slug so every deploy updates the same Site
// (and keeps the same address), even without the HERENOW_SLUG variable.
//
// Order: HERENOW_SLUG if set → the newest Site in the account named
// "Vortex Engine" (or the older name "DubDeck") → null (a new Site is created).

export const SITE_NAME = "Vortex Engine";
const OLD_NAMES = ["DubDeck"];

export async function findSlug({ api, key, client }) {
  const fromVar = (process.env.HERENOW_SLUG ?? "").trim();
  if (fromVar) return fromVar;
  const res = await fetch(`${api}/api/v1/publishes`, {
    headers: { Authorization: `Bearer ${key}`, "X-HereNow-Client": client },
  });
  if (!res.ok) {
    console.warn(`Couldn't list Sites (${res.status}); a new Site may be created.`);
    return null;
  }
  const { publishes = [] } = await res.json();
  const live = publishes.filter((p) => !p.expiresAt && p.status !== "deleted");
  const byName = (names) => live
    .filter((p) => names.includes((p.displayName ?? "").trim()))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const site = byName([SITE_NAME]) ?? byName(OLD_NAMES);
  if (site) console.log(`Using the existing Site "${site.displayName}" (${site.slug}).`);
  return site?.slug ?? null;
}
