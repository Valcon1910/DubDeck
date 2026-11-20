// Signs a Vortex visitor in to Chat without a second sign-in.
//
// here.now's sign-in gate already verified the visitor's email. The site's
// /chat-login proxy route calls this function with that email and a shared
// secret (VORTEX_CHAT_SECRET, saved in here.now and here by the "Set up Chat"
// workflow), so only here.now can call it and nobody can claim another email.
// Returns a Supabase session for that email if it's a Vortex member.
// No dependencies: it talks to Supabase's own REST endpoints directly.

const URL = Deno.env.get("SUPABASE_URL")!;
// Older projects have the JWT service-role key; newer ones only the new
// "sb_secret_..." keys (a JSON map in SUPABASE_SECRET_KEYS).
// Same for the public key: SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS.
function key(newKeys: string, legacy: string) {
  try {
    const keys = JSON.parse(Deno.env.get(newKeys) ?? "{}") as Record<string, string>;
    const k = keys.default ?? Object.values(keys)[0];
    if (k) return k;
  } catch { /* not set */ }
  return Deno.env.get(legacy) ?? "";
}
const SERVICE = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const ANON = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SECRET = Deno.env.get("VORTEX_CHAT_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Calls Supabase with a key (JWT-style keys also go in Authorization). */
async function call(path: string, key: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${URL}${path}`, {
    method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (SECRET.length < 32 || !same(req.headers.get("x-vortex-secret") ?? "", SECRET)) return json({ error: "Not allowed" }, 403);
  const email = (req.headers.get("x-vortex-email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Sign in to Vortex first" }, 401);

  const who = encodeURIComponent(email);
  const profile = await call(`/rest/v1/profiles?select=member&email=eq.${who}`, SERVICE);
  if (!profile.ok) {
    console.error("access list lookup failed", profile.status, JSON.stringify(profile.data).slice(0, 300));
    return json({ error: `Couldn't read the access list (HTTP ${profile.status})` }, 500);
  }
  if (!profile.data?.[0]?.member) return json({ error: "You're not on the Vortex access list" }, 403);

  // Make sure there's an account, then mint a one-time link and redeem it here.
  let link = await call("/auth/v1/admin/generate_link", SERVICE, { method: "POST", body: { type: "magiclink", email } });
  if (!link.ok) {
    await call("/auth/v1/admin/users", SERVICE, { method: "POST", body: { email, email_confirm: true } });
    link = await call("/auth/v1/admin/generate_link", SERVICE, { method: "POST", body: { type: "magiclink", email } });
  }
  const hashed = link.data?.hashed_token ?? link.data?.properties?.hashed_token;
  if (!link.ok || !hashed) return json({ error: "Couldn't start a chat session" }, 500);

  // A brand-new account comes back as a sign-up link, an existing one as a magic link.
  const type = link.data?.verification_type ?? link.data?.properties?.verification_type ?? "magiclink";
  const s = await call("/auth/v1/verify", ANON, { method: "POST", body: { type, token_hash: hashed } });
  if (!s.ok || !s.data?.access_token) return json({ error: "Couldn't start a chat session" }, 500);

  await call(`/rest/v1/profiles?email=eq.${who}`, SERVICE, { method: "PATCH", body: { last_seen: new Date().toISOString() } });
  return json({
    url: Deno.env.get("VORTEX_PUBLIC_URL") || URL, anonKey: ANON,
    access_token: s.data.access_token, refresh_token: s.data.refresh_token, expires_at: s.data.expires_at,
  });
});
