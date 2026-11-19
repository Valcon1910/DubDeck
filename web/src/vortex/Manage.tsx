import { useCallback, useEffect, useState } from "react";
import { ApplicationsCard, ApplyPageCard, EmailCard } from "./Applications";
import { AccessList, protect, type Access, type Roles } from "./AccessList";
import { useVisitorEmail } from "./admins";
import { ACCESS_PATH, ACCESS_TEST_PATH, ACTIONS, commit, GitHubError, readJson, recentRuns, runAction, ROLES_PATH, type FileChange, type Run } from "./github";

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
      <ApplicationsCard />
      <ApplyPageCard />
      <EmailCard />
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

interface Lists { site: Access; test: Access; roles: Roles }
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function AccessCard() {
  const me = useVisitorEmail();
  const [saved, setSaved] = useState<Lists | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const acc = (a: Partial<Access> | null): Access => ({ emails: a?.emails ?? [], domains: a?.domains ?? [] });
    Promise.all([
      readJson<Access>(TOKEN, ACCESS_PATH, "main"),
      readJson<Access>(TOKEN, ACCESS_TEST_PATH, "main").catch(() => null),
      readJson<Roles>(TOKEN, ROLES_PATH, "main").catch(() => null),
    ]).then(([site, test, roles]) => {
      const v = { site: acc(site), test: acc(test), roles: { admins: roles?.admins ?? [] } };
      setSaved(v); setLists(v);
    }).catch((e) => setErr(e instanceof GitHubError ? e.message : "Couldn't load the access list."));
  }, []);

  const dirty = !!lists && JSON.stringify(lists) !== JSON.stringify(saved);
  async function save() {
    if (!lists || !saved) return;
    setState("saving"); setErr(null);
    const safe = { ...lists, ...protect(lists.site, lists.test, me) };
    const files: FileChange[] = [];
    if (JSON.stringify(safe.site) !== JSON.stringify(saved.site)) files.push({ path: ACCESS_PATH, text: json(safe.site) });
    if (JSON.stringify(safe.test) !== JSON.stringify(saved.test)) files.push({ path: ACCESS_TEST_PATH, text: json(safe.test) });
    if (JSON.stringify(safe.roles) !== JSON.stringify(saved.roles)) files.push({ path: ROLES_PATH, text: json(safe.roles) });
    try {
      if (files.length) await commit(TOKEN, "Update who can open the sites (from the Admin page)", files, "main");
      setSaved(safe); setLists(safe); setState("saved");
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again."); setState("idle");
    }
  }
  const upd = (patch: Partial<Lists>) => { setLists((l) => (l ? { ...l, ...patch } : l)); setState("idle"); };

  return (
    <div className="vx-card vx-stack">
      <h2 className="vx-card-title">Who can open the sites</h2>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      {!lists && !err && <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p>}
      {lists && (
        <>
          <AccessList me={me}
            site={lists.site} setSite={(site) => upd({ site })}
            test={lists.test} setTest={(test) => upd({ test })}
            roles={lists.roles} setRoles={(roles) => upd({ roles })} />
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
