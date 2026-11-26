// Hexdrift multiplayer: relay credentials for a room. Players' cars travel
// peer to peer over WebRTC, but only through Cloudflare's TURN relay (the
// browsers are set to relay-only), so no player ever sees another's IP.
// This asks Cloudflare for short-lived credentials with the long-lived key,
// which stays here: the browser only gets credentials that expire.

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY_ID = Deno.env.get("CF_TURN_KEY_ID") ?? "";
const TOKEN = Deno.env.get("CF_TURN_API_TOKEN") ?? "";

/** How long credentials last (seconds): longer than any party session. */
const TTL = 2 * 60 * 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function call(path: string, key: string, token: string) {
  const res = await fetch(`${URL}${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

// A little per-instance limit, so one player can't make a flood of credentials.
const recent = new Map<string, number[]>();
function tooMany(email: string) {
  const now = Date.now(), list = (recent.get(email) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  recent.set(email, list);
  return list.length > 30;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!KEY_ID || !TOKEN) return json({ error: "Multiplayer isn't set up yet" }, 503);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = token ? await call("/auth/v1/user", ANON, token) : { ok: false, data: null };
  const email = String(user.data?.email ?? "").toLowerCase();
  if (!user.ok || !email) return json({ error: "Sign in to Vortex first" }, 401);
  const member = await call(`/rest/v1/profiles?select=member&email=eq.${encodeURIComponent(email)}`, SERVICE, SERVICE);
  if (!member.ok || !member.data?.[0]?.member) return json({ error: "You're not on the Vortex access list" }, 403);
  if (tooMany(email)) return json({ error: "Too many tries: wait a few minutes" }, 429);

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(KEY_ID)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: TTL }),
  }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) as { iceServers?: unknown } | null : null;
  const raw = data?.iceServers;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { urls?: string | string[]; username?: string; credential?: string }[];
  // Only the relay (turn:/turns:) addresses, and not port 53, which browsers time out on.
  const iceServers = list.flatMap((s) => {
    const urls = (Array.isArray(s.urls) ? s.urls : s.urls ? [s.urls] : []).filter((u) => /^turns?:/.test(u) && !/:53(\?|$)/.test(u));
    return urls.length && s.username && s.credential ? [{ urls, username: s.username, credential: s.credential }] : [];
  });
  if (!iceServers.length) return json({ error: "The relay isn't answering. Try again in a minute." }, 502);
  return json({ iceServers, ttl: TTL });
});

export {};
