import { useCallback, useEffect, useState } from "react";
import { AccessTab, type Access } from "./Admin";
import { ACCESS_PATH, ACTIONS, commit, GitHubError, readJson, recentRuns, runAction, type Run } from "./github";

const TOKEN = ""; // added by the site's /gh route

// The Admin page: start the two publish actions and choose who can open the sites.
export function Manage() {
  return (
    <section className="vx-page vx-narrow">
      <header className="vx-page-head">
        <p className="vx-eyebrow">Admin</p>
        <h1>Admin</h1>
        <p className="vx-muted">Publish changes and choose who can open the sites.</p>
      </header>
      <Actions />
      <AccessCard />
    </section>
  );
}

function Actions() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => { recentRuns(TOKEN).then(setRuns).catch(() => setRuns([])); }, []);
  useEffect(() => { load(); }, [load]);
  const running = runs?.some((r) => r.status !== "completed");
  useEffect(() => {
    if (!running && !busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, busy, load]);

  async function start(key: keyof typeof ACTIONS) {
    if (key === "real" && !confirm("Copy everything from the test site to the published site?")) return;
    setBusy(key); setMsg(null);
    try {
      await runAction(key);
      setMsg({ ok: true, text: `Started “${ACTIONS[key].name}”. It takes about a minute.` });
      setTimeout(load, 3000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof GitHubError ? e.message : "Couldn't start it. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="vx-card vx-stack">
      <h2 className="vx-card-title">Publish</h2>
      <div className="vx-action-row">
        <button className="vx-btn vx-btn-ghost" disabled={!!busy} onClick={() => start("test")}>
          {busy === "test" && <span className="vx-spinner" aria-hidden="true" />}Publish code to test site
        </button>
        <button className="vx-btn vx-btn-primary" disabled={!!busy} onClick={() => start("real")}>
          {busy === "real" && <span className="vx-spinner" aria-hidden="true" />}Publish test site to real site
        </button>
      </div>
      {msg && <p className={`vx-alert ${msg.ok ? "" : "vx-alert-error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      <h3 className="vx-small vx-muted">Recent</h3>
      {runs === null ? <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p>
        : runs.length === 0 ? <p className="vx-muted vx-small">Nothing yet.</p>
        : (
          <ul className="vx-runs">
            {runs.map((r) => (
              <li key={r.id}>
                <span className={`vx-run-dot ${r.status !== "completed" ? "running" : r.conclusion === "success" ? "ok" : "bad"}`} aria-hidden="true" />
                <a href={r.html_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                <span className="vx-muted vx-small">
                  {r.status !== "completed" ? "running…" : r.conclusion === "success" ? "done" : "failed"} · {new Date(r.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function AccessCard() {
  const [saved, setSaved] = useState<Access | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    readJson<Access>(TOKEN, ACCESS_PATH, "main")
      .then((a) => { const v = { emails: a.emails ?? [], domains: a.domains ?? [] }; setSaved(v); setAccess(v); })
      .catch((e) => setErr(e instanceof GitHubError ? e.message : "Couldn't load the access list."));
  }, []);

  const dirty = !!access && JSON.stringify(access) !== JSON.stringify(saved);
  async function save() {
    if (!access) return;
    setState("saving"); setErr(null);
    try {
      await commit(TOKEN, "Update who can open the site (from the Admin page)",
        [{ path: ACCESS_PATH, text: JSON.stringify(access, null, 2) + "\n" }], "main");
      setSaved(access); setState("saved");
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again."); setState("idle");
    }
  }

  return (
    <div className="vx-card vx-stack">
      <h2 className="vx-card-title">Who can open the site</h2>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      {!access && !err && <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p>}
      {access && (
        <>
          <AccessTab access={access} setAccess={(a) => { setAccess(a); setState("idle"); }} />
          <div className="vx-action-row">
            <button className="vx-btn vx-btn-primary" disabled={!dirty || state === "saving"} onClick={save}>
              {state === "saving" && <span className="vx-spinner" aria-hidden="true" />}{state === "saving" ? "Saving…" : "Save access list"}
            </button>
            {state === "saved" && !dirty && <span className="vx-muted vx-small" role="status">Saved. Applies to both sites in about a minute.</span>}
          </div>
        </>
      )}
    </div>
  );
}
