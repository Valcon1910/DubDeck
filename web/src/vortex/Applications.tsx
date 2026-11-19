import { useCallback, useEffect, useState } from "react";
import { ACCESS_PATH, ACCESS_TEST_PATH, APPLICATIONS_PATH, BRANCH, commit, dispatch, GitHubError, readJson } from "./github";
import { useVisitorEmail } from "./admins";
import type { Access } from "./AccessList";

const TOKEN = ""; // added by the site's /gh route
export const APPLY_URL: string = __VORTEX_APPLY_URL__;

export interface Application { id: string; email: string; name: string; reason: string; at: string }
interface Decided { accepted: string[]; declined: string[]; testAccepted?: string[]; names?: Record<string, string> }

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Turn here.now's Site Data list response into applications (newest first, one per email). */
export function parseApplications(body: unknown): Application[] {
  const b = body as Record<string, unknown> | null;
  const rows = (Array.isArray(body) ? body : (b?.records ?? b?.items ?? b?.data ?? [])) as Record<string, unknown>[];
  const seen = new Set<string>();
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const d = (r?.data && typeof r.data === "object" ? r.data : r) as Record<string, unknown>;
      return { id: String(r?.id ?? ""), email: str(d.email, 200).toLowerCase(), name: str(d.name, 80), reason: str(d.reason, 500), at: str(r?.created_at ?? r?.createdAt, 40) };
    })
    .filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email))
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((a) => (seen.has(a.email) ? false : (seen.add(a.email), true)));
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const add = (l: string[], v: string) => [...new Set([...l, v])].sort();

/** Admin → Applications: people who asked for access on the Apply page. */
export function ApplicationsCard() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Test mode: Accept lets people into the test site only, and its email links there.
  const [testMode, setTestMode] = useState(BRANCH === "test");
  const me = useVisitorEmail();

  const load = useCallback(async (test: boolean) => {
    setErr(null);
    try {
      const res = await fetch("/ap", { cache: "no-store" });
      if (res.status === 404) throw new Error("The Applications list turns on after the next publish to this site.");
      if (!res.ok) throw new Error(`Couldn't load applications (${res.status}).`);
      const all = parseApplications(await res.json());
      const [site, decided] = await Promise.all([
        readJson<Access>(TOKEN, test ? ACCESS_TEST_PATH : ACCESS_PATH, "main"),
        readJson<Decided>(TOKEN, APPLICATIONS_PATH, "main").catch((): Decided => ({ accepted: [], declined: [] })),
      ]);
      const done = new Set(test
        ? [...site.emails, ...(decided.testAccepted ?? [])]
        : [...site.emails, ...(decided.accepted ?? []), ...(decided.declined ?? [])]);
      setApps(all.filter((a) => !done.has(a.email)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load applications."); setApps([]);
    }
  }, []);
  useEffect(() => { setApps(null); void load(testMode); }, [load, testMode]);

  async function decide(a: Application, accept: boolean) {
    if (!accept && !confirm(`Decline ${a.email}?`)) return;
    setBusy(a.email); setErr(null); setNote(null);
    try {
      // Read the newest copies so nothing saved meanwhile is lost.
      const path = testMode ? ACCESS_TEST_PATH : ACCESS_PATH;
      const [site, d] = await Promise.all([
        readJson<Access>(TOKEN, path, "main"),
        readJson<Decided>(TOKEN, APPLICATIONS_PATH, "main").catch((): Decided => ({ accepted: [], declined: [] })),
      ]);
      const decided: Decided = { ...d, accepted: d.accepted ?? [], declined: d.declined ?? [] };
      // The name goes into the "you got in" email.
      if (a.name) decided.names = { ...(d.names ?? {}), [a.email]: a.name };
      const files = testMode
        ? [
          { path: APPLICATIONS_PATH, text: json({ ...decided, testAccepted: add(decided.testAccepted ?? [], a.email) }) },
          { path, text: json({ ...site, emails: add(site.emails, a.email) }) },
        ]
        : accept
        ? [
          { path: APPLICATIONS_PATH, text: json({ ...decided, accepted: add(decided.accepted, a.email), declined: decided.declined.filter((x) => x !== a.email) }) },
          { path: ACCESS_PATH, text: json({ ...site, emails: add(site.emails, a.email) }) },
        ]
        : [{ path: APPLICATIONS_PATH, text: json({ ...decided, declined: add(decided.declined, a.email) }) }];
      if (testMode && !accept) { setApps((l) => l?.filter((x) => x.email !== a.email) ?? l); return; }
      await commit(TOKEN, testMode ? "Test: accept an application onto the test site (from the Admin page)" : accept ? "Accept an application (from the Admin page)" : "Decline an application (from the Admin page)", files, "main");
      setApps((l) => l?.filter((x) => x.email !== a.email) ?? l);
      setNote(testMode
        ? `Test: ${a.email} can now open the test site, and gets the "you got in" email for it in about a minute. Remove them from the test site in "Who can open the sites" when you're done.`
        : accept ? `${a.email} is in. They'll get an email with the site's address in about a minute.` : `Declined ${a.email}.`);
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!me) return;
    setBusy("email"); setErr(null); setNote(null);
    try {
      await dispatch("test-email.yml", { email: me, site: testMode ? "test" : "real" });
      setNote(`Sending the "you got in" email for the ${testMode ? "test" : "real"} site to ${me}. Check your inbox in about a minute.`);
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't send it. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="vx-card vx-stack">
      <div className="vx-row vx-row-between">
        <h2 className="vx-card-title">Applications{apps && apps.length > 0 && <span className="vx-tag vx-tag-admin"> {apps.length}</span>}</h2>
        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => { setApps(null); void load(testMode); }}>Refresh</button>
      </div>
      {APPLY_URL
        ? <p className="vx-muted vx-small">People who can't sign in can ask for access at <a href={APPLY_URL} target="_blank" rel="noopener noreferrer">{APPLY_URL.replace("https://", "")}</a>. Share that link. Accepting someone lets them in and emails them the site's address.</p>
        : <p className="vx-muted vx-small">The Apply page goes live with the next publish.</p>}
      <fieldset className="vx-fieldset vx-test-mode">
        <legend>Testing</legend>
        <label className="vx-check">
          <input type="checkbox" checked={testMode} onChange={(e) => { setTestMode(e.target.checked); setNote(null); }} />
          <span>Test mode: Accept lets people into the <strong>test site</strong> only (the real site isn't touched)</span>
        </label>
        <p className="vx-muted vx-small">To try it: open the Apply page, send a request with another email of yours, press Refresh, then Accept. That email gets the "you got in" email.</p>
        <div className="vx-row">
          {APPLY_URL && <a className="vx-btn vx-btn-ghost vx-btn-sm" href={APPLY_URL} target="_blank" rel="noopener noreferrer">Open the Apply page</a>}
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={!me || busy === "email"} onClick={sendTest}>
            {busy === "email" && <span className="vx-spinner" aria-hidden="true" />}Send me the "you got in" email
          </button>
        </div>
      </fieldset>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      {note && <p className="vx-alert" role="status">{note}</p>}
      {apps === null ? <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p>
        : apps.length === 0 ? (!err && <p className="vx-muted vx-small">No new applications.</p>)
        : (
          <ul className="vx-apps">
            {apps.map((a) => (
              <li key={a.email} className="vx-app">
                <div className="vx-app-who">
                  <strong>{a.name || a.email}</strong>
                  <span className="vx-muted vx-small">{a.email}{a.at && ` · ${new Date(a.at).toLocaleString()}`}</span>
                  {a.reason && <span className="vx-small">“{a.reason}”</span>}
                </div>
                <div className="vx-row">
                  <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" disabled={!!busy} onClick={() => decide(a, true)}>
                    {busy === a.email && <span className="vx-spinner" aria-hidden="true" />}Accept
                  </button>
                  <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={!!busy} onClick={() => decide(a, false)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export const APPLY_TEXT_PATH = "config/apply.json";
const APPLY_FIELDS: [key: string, label: string, long?: boolean][] = [
  ["title", "Title"], ["intro", "Welcome text", true], ["enterButton", "Enter button"],
  ["applyTitle", "Apply heading"], ["applyIntro", "Apply text", true],
  ["emailLabel", "Email label"], ["nameLabel", "Name label"], ["reasonLabel", "Reason label"],
  ["applyButton", "Apply button"], ["success", "Message after applying", true],
];

/** Admin → Apply page: change the entry page's texts and colour. */
export function ApplyPageCard() {
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const [text, setText] = useState<Record<string, string> | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    readJson<Record<string, string>>(TOKEN, APPLY_TEXT_PATH, "main").catch(() => ({}))
      .then((t) => { setSaved(t); setText(t); });
  }, []);
  const dirty = !!text && JSON.stringify(text) !== JSON.stringify(saved);
  async function save() {
    if (!text) return;
    setState("saving"); setErr(null);
    try {
      await commit(TOKEN, "Update the Apply page (from the Admin page)", [{ path: APPLY_TEXT_PATH, text: json(text) }], "main");
      setSaved(text); setState("saved");
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again."); setState("idle");
    }
  }
  const set = (k: string, v: string) => { setText((t) => ({ ...(t ?? {}), [k]: v })); setState("idle"); };
  return (
    <div className="vx-card vx-stack">
      <h2 className="vx-card-title">Apply page</h2>
      <p className="vx-muted vx-small">The public page people see before signing in: an Enter button for the real site and the Apply form. Share its link instead of the site's.</p>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      {!text ? <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p> : (
        <>
          {APPLY_FIELDS.map(([k, label, long]) => (
            <label key={k} className="vx-field">
              <span className="vx-small">{label}</span>
              {long
                ? <textarea rows={2} maxLength={1000} value={text[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
                : <input maxLength={200} value={text[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}
            </label>
          ))}
          <label className="vx-field vx-row">
            <span className="vx-small">Colour</span>
            <input type="color" aria-label="Colour" value={/^#[0-9a-f]{6}$/i.test(text.accent ?? "") ? text.accent : "#7c5cff"} onChange={(e) => set("accent", e.target.value)} />
          </label>
          <div className="vx-action-row">
            <button className="vx-btn vx-btn-primary" disabled={!dirty || state === "saving"} onClick={save}>
              {state === "saving" && <span className="vx-spinner" aria-hidden="true" />}{state === "saving" ? "Saving…" : "Save Apply page"}
            </button>
            {APPLY_URL && <a className="vx-btn vx-btn-ghost" href={APPLY_URL} target="_blank" rel="noopener noreferrer">Open it</a>}
            {state === "saved" && !dirty && <span className="vx-muted vx-small" role="status">Saved. The page updates in about two minutes.</span>}
          </div>
        </>
      )}
    </div>
  );
}

export const EMAIL_PATH = "config/email.json";

/** Admin → Email: the "you got in" email accepted people get. */
export function EmailCard() {
  const [saved, setSaved] = useState<{ subject?: string; body?: string } | null>(null);
  const [t, setT] = useState<{ subject?: string; body?: string } | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    readJson<{ subject?: string; body?: string }>(TOKEN, EMAIL_PATH, "main").catch(() => ({})).then((v) => { setSaved(v); setT(v); });
  }, []);
  const dirty = !!t && JSON.stringify(t) !== JSON.stringify(saved);
  async function save() {
    if (!t) return;
    setState("saving"); setErr(null);
    try {
      await commit(TOKEN, "Update the welcome email (from the Admin page)", [{ path: EMAIL_PATH, text: json(t) }], "main");
      setSaved(t); setState("saved");
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again."); setState("idle");
    }
  }
  const preview = (s: string) => s.replace(/\{name\}/g, "Ana").replace(/\{email\}/g, "ana@school.edu.co").replace(/\{site\}/g, "https://your-site.here.now/");
  return (
    <div className="vx-card vx-stack">
      <h2 className="vx-card-title">"You got in" email</h2>
      <p className="vx-muted vx-small">
        Sent from your Gmail when you accept someone. Use <code>{"{name}"}</code>, <code>{"{email}"}</code> and <code>{"{site}"}</code> (the site's address).
        Until the Gmail secrets are added, here.now's own invite email goes out instead.
      </p>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      {!t ? <p className="vx-muted vx-small"><span className="vx-spinner" aria-hidden="true" />Loading…</p> : (
        <>
          <label className="vx-field"><span className="vx-small">Subject</span>
            <input maxLength={200} value={t.subject ?? ""} onChange={(e) => { setT({ ...t, subject: e.target.value }); setState("idle"); }} /></label>
          <label className="vx-field"><span className="vx-small">Message</span>
            <textarea rows={8} maxLength={5000} value={t.body ?? ""} onChange={(e) => { setT({ ...t, body: e.target.value }); setState("idle"); }} /></label>
          <details><summary className="vx-small">Preview</summary>
            <div className="vx-email-preview"><strong>{preview(t.subject ?? "")}</strong><p>{preview(t.body ?? "")}</p></div>
          </details>
          <div className="vx-action-row">
            <button className="vx-btn vx-btn-primary" disabled={!dirty || state === "saving"} onClick={save}>
              {state === "saving" && <span className="vx-spinner" aria-hidden="true" />}{state === "saving" ? "Saving…" : "Save email"}
            </button>
            {state === "saved" && !dirty && <span className="vx-muted vx-small" role="status">Saved. Used for the next person you accept.</span>}
          </div>
        </>
      )}
    </div>
  );
}
