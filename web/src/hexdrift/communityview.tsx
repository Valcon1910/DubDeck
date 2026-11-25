// Community Maps screens: browsing, a map's page, and moderation.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { amOwner, getMap, listMaps, mapDefFrom, moderate, myLikes, myReport, REASONS, reportMap, reportsOf, setLike, takeDown, type CMap, type ModAction, type Reason, type Sort } from "./community.ts";
import { medalsOf, THEMES } from "./sim/custom.ts";
import { formatTime } from "./sim/race.ts";
import { BIOMES, medalFor } from "./maps.ts";
import { bestTimeNow, allTimes } from "./records.ts";
import { IconBack, IconPlay, IconTrophy } from "./ui/icons.tsx";

export interface CommunityProps { sb: SupabaseClient | null; me: string; who: (email: string) => string; offline: React.ReactNode }

const TABS: [Sort, string][] = [["featured", "Featured"], ["popular", "Popular"], ["played", "Most played"], ["new", "New"], ["mine", "Mine"]];

function Heart({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.5.7-1.3 2.2-2.5 4.3-2.5 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill={on ? "#ff4fa3" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
}

export function Community({ sb, me, who, offline }: CommunityProps) {
  const [tab, setTab] = useState<Sort>(() => (new URLSearchParams(location.hash.split("?")[1]).get("tab") as Sort) || "featured");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [maps, setMaps] = useState<CMap[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [owner, setOwner] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { if (sb) void amOwner(sb).then(setOwner); }, [sb]);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    setMaps(null); setError("");
    void listMaps(sb, tab, me, q).then(async (m) => {
      if (!alive) return;
      setMaps(m);
      setLiked(await myLikes(sb, me, m.map((x) => x.id)).catch(() => new Set<string>()));
    }).catch(() => { if (alive) setError("Couldn't load the maps. Check your connection."); });
    return () => { alive = false; };
  }, [sb, me, tab, q]);
  const pick = (t: Sort) => { setTab(t); history.replaceState(null, "", `#/hexdrift/community?tab=${t}`); };
  return (
    <div className="hx-menu">
      <header className="hx-menu-head">
        <a className="hx-back" href="#/hexdrift"><IconBack /> Back</a>
        <h1 className="hx-title">Community Maps</h1>
        <p className="hx-sub">Roads made by players. Like the good ones, chase the maker's time, and make your own in <a href="#/hexdrift/editor">My maps</a>.</p>
      </header>
      {!sb ? <p className="hx-dim hx-center">{offline}</p> : <>
        <div className="hx-cm-bar">
          <div className="hx-tabs hx-cm-tabs" role="tablist">
            {[...TABS, ...(owner ? [["hidden", "Reported"] as [Sort, string]] : [])].map(([t, l]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => pick(t)}>{l}</button>
            ))}
          </div>
          <input className="hx-cm-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search maps by name" />
        </div>
        {error ? <p className="hx-dim hx-center">{error}</p>
          : maps === null ? <p className="hx-dim hx-center">Loading…</p>
          : maps.length === 0 ? <p className="hx-dim hx-center">{tab === "mine" ? "You haven't published a map yet. Open one in My maps, drive it, then Publish." : tab === "featured" ? "Nothing featured yet. Try Popular or New." : "No maps here yet."}</p>
          : <ul className="hx-maps">{maps.map((m) => <Card key={m.id} m={m} who={who} liked={liked.has(m.id)} />)}</ul>}
      </>}
    </div>
  );
}

function Card({ m, who, liked }: { m: CMap; who: (e: string) => string; liked: boolean }) {
  const b = BIOMES[THEMES[m.theme].biome];
  return (
    <li>
      <a className="hx-map" href={`#/hexdrift/c/${m.id}`} style={{ "--hx-sky": b.sky, "--hx-g": b.ground, "--hx-a": b.accent } as React.CSSProperties}>
        <div className="hx-map-art"><span />{m.featured_at && <em className="hx-cm-badge">Featured</em>}{m.hidden && <em className="hx-cm-badge hx-cm-hidden">Hidden</em>}</div>
        <div className="hx-map-text">
          <strong>{m.name}</strong>
          <span className="hx-dim">by {who(m.author)}</span>
          <div className="hx-map-tags"><em>{THEMES[m.theme].name}</em><em>{(m.length_m / 1000).toFixed(1)} km</em></div>
          <span className="hx-cm-stats"><Heart on={liked} />{m.likes}<IconPlay size={13} />{m.plays}<span className="hx-dim">Author {formatTime(m.author_ticks)}</span></span>
        </div>
      </a>
    </li>
  );
}

export function CommunityMap({ id, sb, me, who, offline }: CommunityProps & { id: string }) {
  const [m, setM] = useState<CMap | null | undefined>(undefined);
  const [liked, setLiked] = useState(false);
  const [owner, setOwner] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<Reason>("broken");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [reports, setReports] = useState<Awaited<ReturnType<typeof reportsOf>>>([]);
  const [rev, setRev] = useState(0);
  const [, setTimes] = useState(0);
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    void getMap(sb, id).then((x) => { if (alive) setM(x); }).catch(() => { if (alive) { setM(null); setMsg("Couldn't load the map. Check your connection."); } });
    void myLikes(sb, me, [id]).then((s) => { if (alive) setLiked(s.has(id)); });
    void myReport(sb, me, id).then((r) => { if (alive) setReported(r); });
    void amOwner(sb).then((o) => { if (alive) setOwner(o); if (o) void reportsOf(sb, id).then((r) => { if (alive) setReports(r); }); });
    void allTimes().then(() => { if (alive) setTimes((n) => n + 1); });
    return () => { alive = false; };
  }, [sb, me, id, rev]);
  const def = useMemo(() => (m ? mapDefFrom(m, who(m.author)) : null), [m, who]);
  if (!sb) return <div className="hx-menu"><a className="hx-back" href="#/hexdrift/community"><IconBack /> Community Maps</a><p className="hx-dim">{offline}</p></div>;
  if (m === undefined) return <div className="hx-menu"><p className="hx-dim hx-center">Loading…</p></div>;
  if (!m || !def) return <div className="hx-menu"><a className="hx-back" href="#/hexdrift/community"><IconBack /> Community Maps</a><p>{msg || "This map isn't available any more."}</p></div>;
  const mine = m.author === me;
  const medals = medalsOf(m.author_ticks);
  const best = bestTimeNow(def.id);
  const b = BIOMES[THEMES[m.theme].biome];
  const like = async () => {
    const on = !liked;
    setLiked(on); setM({ ...m, likes: m.likes + (on ? 1 : -1) });
    await setLike(sb, me, m.id, on).catch(() => { setLiked(!on); setM(m); setMsg("Couldn't save that. Check your connection."); });
  };
  const report = async () => {
    try { await reportMap(sb, me, m.id, reason, note); setReported(true); setReporting(false); setMsg("Thanks. The site owners will take a look."); }
    catch { setMsg("Couldn't send the report. Check your connection."); }
  };
  const mod = async (a: ModAction) => {
    try { await moderate(sb, m.id, a); setRev((n) => n + 1); } catch { setMsg("That didn't work."); }
  };
  const remove = async () => {
    if (!confirm(mine ? `Take “${m.name}” down? Its likes and leaderboard go with it.` : `Delete “${m.name}” by ${who(m.author)} for good?`)) return;
    try { await takeDown(sb, m.id); location.hash = "#/hexdrift/community?tab=mine"; } catch { setMsg("Couldn't take it down."); }
  };
  return (
    <div className="hx-menu">
      <header className="hx-menu-head">
        <a className="hx-back" href="#/hexdrift/community"><IconBack /> Community Maps</a>
      </header>
      <section className="hx-cm-page" style={{ "--hx-sky": b.sky, "--hx-g": b.ground, "--hx-a": b.accent } as React.CSSProperties}>
        <div className="hx-map-art hx-cm-art"><span />{m.featured_at && <em className="hx-cm-badge">Featured</em>}{m.hidden && <em className="hx-cm-badge hx-cm-hidden">Hidden</em>}</div>
        <h1 className="hx-h1">{m.name}</h1>
        <p className="hx-dim">by {mine ? "you" : who(m.author)} · {THEMES[m.theme].name} · {(m.length_m / 1000).toFixed(2)} km · {m.checkpoints} checkpoint{m.checkpoints === 1 ? "" : "s"}</p>
        <div className="hx-row hx-cm-actions">
          <a className="hx-btn hx-btn-main" href={`#/hexdrift/c/${m.id}/race`} data-sound="confirm">Race</a>
          <a className="hx-btn" href={`#/hexdrift/c/${m.id}/records`}><IconTrophy size={16} /> Leaderboard</a>
          {!mine && <button type="button" className={`hx-btn ${liked ? "on" : ""}`} aria-pressed={liked} onClick={() => void like()}><Heart on={liked} /> {m.likes}</button>}
          {mine && <span className="hx-chip-static"><Heart on={false} /> {m.likes}</span>}
          <span className="hx-chip-static"><IconPlay size={14} /> {m.plays} player{m.plays === 1 ? "" : "s"}</span>
        </div>
        <ul className="hx-medals">
          {(["vortex", "gold", "silver", "bronze"] as const).map((k) => (
            <li key={k} className={best && best.t <= medals[k] ? "got" : ""}>{k === "vortex" ? "Author" : k[0].toUpperCase() + k.slice(1)}<span>{formatTime(medals[k])}</span></li>
          ))}
        </ul>
        {best && <p>Your best {formatTime(best.t)}{medalFor(def, best.t) ? "" : " · no medal yet"}</p>}
        {msg && <p className="hx-dim" role="status">{msg}</p>}
        {!mine && (reported ? <p className="hx-dim hx-small">You reported this map.</p>
          : reporting ? (
            <div className="hx-cm-report">
              <p>What's wrong with it?</p>
              <div className="hx-ed-chips">{REASONS.map(([r, l]) => <button key={r} type="button" className={`hx-chip-btn ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{l}</button>)}</div>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Anything to add (optional)" aria-label="Note" />
              <div className="hx-row"><button type="button" className="hx-btn hx-btn-main" onClick={() => void report()}>Send report</button><button type="button" className="hx-btn" onClick={() => setReporting(false)}>Cancel</button></div>
            </div>
          ) : <button type="button" className="hx-linkbtn" onClick={() => setReporting(true)}>Report this map</button>)}
        {mine && <div className="hx-row"><a className="hx-btn" href="#/hexdrift/editor">Edit in My maps</a><button type="button" className="hx-btn hx-danger" onClick={() => void remove()}>Take down</button></div>}
        {owner && (
          <div className="hx-cm-mod">
            <h2 className="hx-h2">Site owner</h2>
            <div className="hx-row">
              {m.featured_at ? <button type="button" className="hx-btn" onClick={() => void mod("unfeature")}>Unfeature</button> : <button type="button" className="hx-btn" onClick={() => void mod("feature")}>Feature</button>}
              {m.hidden ? <button type="button" className="hx-btn" onClick={() => void mod("unhide")}>Unhide and clear reports</button> : <button type="button" className="hx-btn" onClick={() => void mod("hide")}>Hide</button>}
              {!mine && <button type="button" className="hx-btn hx-danger" onClick={() => void remove()}>Delete</button>}
            </div>
            {reports.length > 0 && <ul className="hx-cm-reports">{reports.map((r) => <li key={r.email}><strong>{REASONS.find(([k]) => k === r.reason)?.[1]}</strong> · {who(r.email)}{r.note ? `: ${r.note}` : ""}</li>)}</ul>}
          </div>
        )}
      </section>
    </div>
  );
}
