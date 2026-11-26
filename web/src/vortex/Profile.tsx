// A member's Vortex profile: their picture and name, the Hexdrift maps they've
// made, the world records they hold, their favourite car, and a button to
// message them in Chat. Opened from Community Maps (makers and record holders).
import { useEffect, useMemo, useRef, useState } from "react";
import { emailFrom, pidOf, playerHref } from "./profileLink.ts";
import { Avatar, Icon } from "./Settings";
import { CHAT_ON, displayName, useChat } from "./chat/store";
import { difficultyOf, listMaps, pictureUrl, recordsHeld, type CMap } from "../hexdrift/community.ts";
import { ALL_MAPS } from "../hexdrift/maps.ts";
import { BODIES, type Look } from "../hexdrift/garage.ts";
import { parseLook } from "../hexdrift/online.ts";
import { formatTime } from "../hexdrift/sim/race.ts";
import { Preview } from "../hexdrift/render/preview.ts";

/** The member the link names: a profile ID, or an email on old links. */
const paramOf = () => location.hash.replace(/^#\/?profile\/?/, "").split(/[/?]/)[0] ?? "";

interface Held { map: string; name: string; href: string; ticks: number }

export function ProfilePage() {
  const chat = useChat();
  const [param, setParam] = useState(paramOf);
  useEffect(() => { const on = () => setParam(paramOf()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const sb = chat?.status === "ready" ? chat.sb : null;
  const me = chat?.me ?? "";
  // Known once the member list is in (IDs live there).
  const email = useMemo(() => emailFrom(param), [param, chat?.profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // An old email link: show the short one instead.
    const pid = email && decodeURIComponent(param).includes("@") ? pidOf(email) : undefined;
    if (pid) history.replaceState(null, "", `#/profile/${pid}`);
  }, [param, email]);
  const p = chat?.profiles.get(email);
  const name = displayName(p, email);
  const [maps, setMaps] = useState<CMap[] | null>(null);
  const [held, setHeld] = useState<Held[] | null>(null);
  const [car, setCar] = useState<{ look: Look; runs: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sb || !email) return;
    let alive = true;
    setMaps(null); setHeld(null); setCar(null); setError("");
    void listMaps(sb, "author", "", email).then((m) => { if (alive) setMaps(m); }).catch(() => { if (alive) setError("Couldn't load this profile. Check your connection."); });
    void (async () => {
      const rows = await recordsHeld(sb, email);
      const ids = [...new Set(rows.map((r) => r.map.split("-")[0]).filter((id) => /^c[0-9a-z]{8}$/.test(id)))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data } = await sb.from("hexdrift_maps").select("id,name").in("id", ids);
        for (const r of (data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
      }
      const out: Held[] = [];
      for (const r of rows) {
        const built = ALL_MAPS.find((m) => m.id === r.map);
        if (built) { out.push({ map: r.map, name: built.name, href: `#/hexdrift/map/${built.id}`, ticks: r.ticks }); continue; }
        const id = r.map.split("-")[0];
        if (names.has(id)) out.push({ map: r.map, name: names.get(id)!, href: `#/hexdrift/c/${id}`, ticks: r.ticks });
      }
      if (alive) setHeld(out);
    })().catch(() => { if (alive) setHeld([]); });
    // Favourite car: the one they've set the most records in (their latest look of it).
    void Promise.resolve(sb.from("hexdrift_records").select("look,set_at").eq("email", email).not("look", "is", null).order("set_at", { ascending: false }).limit(200)).then(({ data }) => {
      const count = new Map<string, { look: Look; runs: number }>();
      for (const r of (data ?? []) as { look: string }[]) {
        const l = parseLook(r.look);
        if (!l) continue;
        const c = count.get(l.body);
        if (c) c.runs++; else count.set(l.body, { look: l, runs: 1 });
      }
      const fav = [...count.values()].sort((a, b) => b.runs - a.runs)[0] ?? null;
      if (alive) setCar(fav);
    });
    return () => { alive = false; };
  }, [sb, email]);

  const message = async () => {
    if (!sb) return;
    setBusy(true);
    const { data, error: e } = await sb.rpc("create_conversation", { p_kind: "dm", p_members: [email], p_name: "", p_icon: "" });
    setBusy(false);
    if (e || !data) { setError("Couldn't open a chat with them."); return; }
    chat?.reload();
    location.hash = `#/chat/${data as string}`;
  };

  if (!CHAT_ON) return <section className="vx-page"><p className="vx-muted">Profiles open once Chat is switched on.</p></section>;
  if (!sb) return <section className="vx-page"><div className="vx-card vx-skeleton" aria-hidden="true" /><p className="vx-muted">{chat?.status === "error" ? "Couldn't connect. Profiles need Chat to be online." : "Connecting…"}</p></section>;
  if (!email && !chat?.profiles.size) return <section className="vx-page"><div className="vx-card vx-skeleton" aria-hidden="true" /><p className="vx-muted">Loading…</p></section>;
  if (!email || (!p && chat?.profiles.size)) return <section className="vx-page"><h1>Profile not found</h1><p className="vx-muted">There's no Vortex member with that link.</p></section>;
  const bodyName = car ? BODIES.find((b) => b.id === car.look.body)?.name ?? "" : "";
  return (
    <section className="vx-page vx-profile">
      <header className="vx-profile-head">
        <Avatar src={p?.avatar ?? ""} name={name} size={88} />
        <div className="vx-profile-id">
          <h1>{name}{email === me && <span className="vx-muted"> (you)</span>}</h1>
          <div className="vx-profile-actions">
            {email !== me && <button type="button" className="vx-btn vx-btn-primary" disabled={busy} onClick={() => void message()}><Icon name="chat" />Message</button>}
            <a className="vx-btn vx-btn-ghost" href={playerHref(email)}>Hexdrift times</a>
          </div>
        </div>
      </header>
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="vx-profile-grid">
        <section className="vx-card vx-profile-car">
          <h2>Favourite car</h2>
          {car ? <><CarView look={car.look} /><p><strong>{bodyName}</strong> <span className="vx-muted">· {car.runs} record{car.runs === 1 ? "" : "s"} in it</span></p></>
            : <p className="vx-muted">{car === null && held !== null ? "No Hexdrift records yet." : "Loading…"}</p>}
        </section>
        <section className="vx-card">
          <h2>World records</h2>
          {held === null ? <p className="vx-muted">Loading…</p> : held.length === 0 ? <p className="vx-muted">None yet.</p> : (
            <ul className="vx-profile-held">
              {held.map((h) => <li key={h.map}><a href={h.href}>{h.name}</a><span>{formatTime(h.ticks)}</span></li>)}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2>Maps {email === me ? "you've" : "they've"} made</h2>
        {maps === null ? <p className="vx-muted">Loading…</p> : maps.length === 0 ? <p className="vx-muted">No published maps yet.</p> : (
          <ul className="vx-profile-maps">
            {maps.map((m) => {
              const url = pictureUrl(sb, m);
              return (
                <li key={m.id}>
                  <a href={`#/hexdrift/c/${m.id}`}>
                    <span className="vx-profile-pic">{url ? <img src={url} alt="" loading="lazy" decoding="async" /> : null}</span>
                    <strong>{m.name}</strong>
                    <span className="vx-muted">{m.likes} like{m.likes === 1 ? "" : "s"} · {m.plays} player{m.plays === 1 ? "" : "s"} · {difficultyOf(m.difficulty)}{m.hidden ? " · hidden" : ""}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

/** The car in 3D (drag to turn it). */
function CarView({ look }: { look: Look }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<Preview | null>(null);
  const [no3d, setNo3d] = useState(false);
  useEffect(() => {
    try { view.current = new Preview(host.current!); } catch { setNo3d(true); }
    return () => { view.current?.dispose(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.setLook(look); }, [look]);
  return <div className="vx-profile-carview" ref={host}>{no3d && <span className="vx-muted">This device can't show 3D.</span>}</div>;
}
