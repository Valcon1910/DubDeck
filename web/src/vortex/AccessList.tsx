import { useState } from "react";
import { isOwner, OWNER_EMAILS } from "./admins";

const PRIMARY = OWNER_EMAILS[0];

export interface Access { emails: string[]; domains: string[] }
export interface Roles { admins: string[] }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const toggle = (list: string[], v: string, on: boolean) =>
  on ? [...new Set([...list, v])].sort() : list.filter((x) => x !== v);

/**
 * Who can open the published site, the test site, and who is Admin. Tap an
 * email to see and change what it can do. The owner and the signed-in person
 * can't remove themselves.
 */
export function AccessList({ site, setSite, test, setTest, roles, setRoles, me }: {
  site: Access; setSite: (a: Access) => void;
  test: Access; setTest: (a: Access) => void;
  roles: Roles; setRoles: (r: Roles) => void;
  me: string | null;
}) {
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const people = [...new Set([...site.emails, ...test.emails, ...roles.admins])].sort();
  const locked = (v: string) => v === PRIMARY || v === me;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) { setErr("That isn't a valid email address."); return; }
    setSite({ ...site, emails: toggle(site.emails, v, true) });
    setEmail(""); setErr(null); setOpen(v);
  }
  function addDomain(e: React.FormEvent) {
    e.preventDefault();
    const v = domain.trim().toLowerCase().replace(/^@/, "");
    if (!DOMAIN_RE.test(v)) { setErr("That isn't a valid domain, like school.edu.co."); return; }
    setSite({ ...site, domains: toggle(site.domains, v, true) });
    setDomain(""); setErr(null);
  }
  function remove(v: string) {
    if (locked(v)) return;
    if (!confirm(`Remove ${v} from both sites and from Admin?`)) return;
    setSite({ ...site, emails: toggle(site.emails, v, false) });
    setTest({ ...test, emails: toggle(test.emails, v, false) });
    setRoles({ admins: toggle(roles.admins, v, false) });
    setOpen(null);
  }

  return (
    <div className="vx-stack">
      <p className="vx-muted vx-small">
        People sign in at here.now's gate with a code sent to their email. Tap someone to choose what they can open.
        Changes apply about a minute after you save; Admin changes apply after the next publish.
      </p>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
      <fieldset className="vx-card vx-fieldset">
        <legend>People ({people.length})</legend>
        <form className="vx-row" onSubmit={add}>
          <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to add" />
          <button className="vx-btn vx-btn-primary vx-btn-sm">Add</button>
        </form>
        <ul className="vx-people">
          {people.map((v) => {
            const owner = isOwner(v);
            const admin = owner || roles.admins.includes(v);
            const onSite = site.emails.includes(v);
            const onTest = test.emails.includes(v);
            const isOpen = open === v;
            return (
              <li key={v} className={isOpen ? "open" : ""}>
                <button type="button" className="vx-person" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v)}>
                  <span className="vx-person-email">{v}</span>
                  <span className="vx-person-tags">
                    {owner && <span className="vx-tag vx-tag-owner">Owner</span>}
                    {v === me && <span className="vx-tag">You</span>}
                    {admin && !owner && <span className="vx-tag vx-tag-admin">Admin</span>}
                    {onTest && <span className="vx-tag vx-tag-test">Test site</span>}
                    {!onSite && <span className="vx-tag vx-tag-off">Can't open the site</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="vx-person-panel" role="group" aria-label={`What ${v} can do`}>
                    <label className="vx-check">
                      <input type="checkbox" checked={onSite} disabled={locked(v)}
                        onChange={(e) => setSite({ ...site, emails: toggle(site.emails, v, e.target.checked) })} />
                      <span>Can open the site</span>
                    </label>
                    <label className="vx-check">
                      <input type="checkbox" checked={onTest} disabled={v === PRIMARY || (v === me && onTest)}
                        onChange={(e) => setTest({ ...test, emails: toggle(test.emails, v, e.target.checked) })} />
                      <span>Can open the test site</span>
                    </label>
                    <label className="vx-check">
                      <input type="checkbox" checked={admin} disabled={owner || v === me}
                        onChange={(e) => setRoles({ admins: toggle(roles.admins, v, e.target.checked) })} />
                      <span>Admin (sees Admin and Editor)</span>
                    </label>
                    {locked(v)
                      ? <p className="vx-muted vx-small">{v === me ? "You" : "The owner"} can't be removed.</p>
                      : <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-danger" onClick={() => remove(v)}>Remove {v}</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset className="vx-card vx-fieldset">
        <legend>Whole domains ({site.domains.length})</legend>
        <p className="vx-muted vx-small">Everyone with an address at a domain can open the site (not the test site), e.g. all of <code>school.edu.co</code>.</p>
        <form className="vx-row" onSubmit={addDomain}>
          <input type="text" placeholder="school.edu.co" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain to add" />
          <button className="vx-btn vx-btn-primary vx-btn-sm">Add</button>
        </form>
        <ul className="vx-chips">
          {site.domains.map((v) => (
            <li key={v}><span>@{v}</span><button type="button" aria-label={`Remove ${v}`} onClick={() => setSite({ ...site, domains: site.domains.filter((x) => x !== v) })}>×</button></li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

/** The owner and the signed-in person always stay on the site's list, and on the test site's. */
export function protect(site: Access, test: Access, me: string | null): { site: Access; test: Access } {
  const keep = (a: Access, extra: string[]) => ({ ...a, emails: [...new Set([...a.emails, ...extra])].sort() });
  const mine = me ? [me] : [];
  return { site: keep(site, [...mine, PRIMARY]), test: keep(test, [...(me && test.emails.includes(me) ? mine : []), PRIMARY]) };
}
