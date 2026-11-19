import { useState } from "react";
import { CONTENT_PATH, commit, GitHubError, readJson } from "./github";
import { normalize, useContent, type Update } from "./content";
import { Editable, useEdit } from "./editable";

const TOKEN = ""; // added by the site's /gh route
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** Bottom of the home page: what changed in each publish. The owner writes the notes. */
export function UpdateLog({ owner }: { owner: boolean }) {
  const all = useContent().updates;
  const edit = useEdit();
  if (edit) return <UpdateLogEditing />;
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const items = all.map((u) => (u.id in saved ? { ...u, text: saved[u.id] } : u)).filter((u) => owner || u.text.trim());
  if (!items.length) return null;
  return (
    <section className="vx-updates" aria-labelledby="vx-updates-h">
      <h2 id="vx-updates-h">Update log</h2>
      <ol>
        {items.map((u) => (
          <li key={u.id}>
            <time dateTime={u.date}>{fmt(u.date)}</time>
            {editing === u.id
              ? <EditEntry u={u} onDone={(text) => { if (text !== null) setSaved((s) => ({ ...s, [u.id]: text })); setEditing(null); }} />
              : (
                <>
                  {u.text.trim() ? <p>{u.text}</p> : <p className="vx-muted vx-small">No notes for this publish yet.</p>}
                  {owner && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setEditing(u.id)}>Edit</button>}
                </>
              )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EditEntry({ u, onDone }: { u: Update; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(u.text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const cur = normalize(await readJson(TOKEN, CONTENT_PATH));
      cur.updates = cur.updates.some((x) => x.id === u.id)
        ? cur.updates.map((x) => (x.id === u.id ? { ...x, text: text.trim() } : x))
        : [{ ...u, text: text.trim() }, ...cur.updates];
      await commit(TOKEN, `Update log notes for ${u.date.slice(0, 10)}`, [{ path: CONTENT_PATH, text: JSON.stringify(cur, null, 2) + "\n" }]);
      onDone(text.trim());
    } catch (e) {
      setErr(e instanceof GitHubError ? e.message : "Couldn't save. Try again."); setBusy(false);
    }
  }
  return (
    <div className="vx-stack">
      <textarea aria-label="What changed" rows={4} maxLength={5000} value={text} placeholder="What changed in this publish?" onChange={(e) => setText(e.target.value)} />
      <div className="vx-row">
        <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={busy} onClick={() => onDone(null)}>Cancel</button>
      </div>
      {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
    </div>
  );
}

/** In the Editor: type the notes right on the page, add or remove entries; saved with Publish. */
function UpdateLogEditing() {
  const all = useContent().updates;
  const edit = useEdit()!;
  return (
    <section className="vx-updates" aria-labelledby="vx-updates-h">
      <div className="vx-row vx-row-between">
        <h2 id="vx-updates-h">Update log</h2>
        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => edit.addUpdate()}>Add entry</button>
      </div>
      {all.length === 0 && <p className="vx-muted vx-small">No entries yet. Every real publish adds one; you can also add one here.</p>}
      <ol>
        {all.map((u, i) => (
          <li key={u.id}>
            <div className="vx-row vx-row-between">
              <time dateTime={u.date}>{fmt(u.date)}</time>
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm vx-danger" aria-label={`Remove the ${fmt(u.date)} entry`} onClick={() => edit.removeUpdate(u.id)}>Remove</button>
            </div>
            <Editable as="p" path={`updates.${i}.text`} placeholder="What changed in this publish?" multiline />
          </li>
        ))}
      </ol>
    </section>
  );
}
