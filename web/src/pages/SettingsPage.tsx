import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api";
import { useAuth, useUser } from "../auth";
import { Icon } from "../components/Icon";
import { ConfirmModal } from "../components/Modal";
import { ACCENTS, describeOptions, TEMPLATE_TOKENS } from "../defaults";
import { useSettings } from "../settings";
import { useToast } from "../toasts";
import type { Preset, Settings } from "../types";
import { clsx } from "../util";

function Section({ id, title, children, desc }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card settings-section" aria-labelledby={id}>
      <header>
        <h2 id={id}>{title}</h2>
        {desc && <p className="muted">{desc}</p>}
      </header>
      <div className="settings-body">{children}</div>
    </section>
  );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="label">{label}</span>}
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={clsx(value === o.value && "is-on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({ onShortcuts }: { onShortcuts: () => void }) {
  const { settings, update, sync } = useSettings();
  const user = useUser();
  const { signOut } = useAuth();
  const set = <S extends keyof Settings>(section: S, patch: Partial<Settings[S]>) =>
    update((s) => ({ ...s, [section]: { ...(s[section] as object), ...patch } }));
  const a = settings.appearance;
  const d = settings.defaults;
  const st = settings.storage;

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Saved to your server and synced across your devices.</p>
        </div>
        <SyncBadge sync={sync} />
      </header>

      <Section id="s-account" title="Account">
        <Row label="Signed in as">
          <span className="mono">{user.email}</span>
        </Row>
        <Row label="Sessions" hint="Signing out everywhere ends sessions on all devices.">
          <div className="row wrap">
            <button className="btn btn-ghost" onClick={() => void signOut()}><Icon name="logout" size={18} /> Sign out</button>
            <button className="btn btn-ghost" onClick={() => void signOut(true)}>Sign out everywhere</button>
          </div>
        </Row>
      </Section>

      <Section id="s-appearance" title="Appearance">
        <Row label="Theme">
          <Segmented label="Theme" value={a.theme} onChange={(theme) => set("appearance", { theme })}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
        </Row>
        <Row label="Accent color" hint="Text and focus colors are adjusted automatically to keep AA contrast.">
          <div className="swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((c) => (
              <button key={c.value} role="radio" aria-checked={a.accent === c.value} aria-label={c.name} title={c.name}
                className={clsx("swatch", a.accent === c.value && "is-on")} style={{ background: c.value }}
                onClick={() => set("appearance", { accent: c.value })} />
            ))}
            <label className="swatch swatch-custom" title="Custom color">
              <span className="sr-only">Custom accent color</span>
              <input type="color" value={a.accent} onChange={(e) => set("appearance", { accent: e.target.value })} />
            </label>
          </div>
        </Row>
        <Row label="Density">
          <Segmented label="Density" value={a.density} onChange={(density) => set("appearance", { density })}
            options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </Row>
        <Row label="Font size" htmlFor="font-size">
          <div className="row">
            <input id="font-size" type="range" min={13} max={18} step={1} value={a.fontSize} onChange={(e) => set("appearance", { fontSize: Number(e.target.value) })} />
            <span className="mono">{a.fontSize}px</span>
          </div>
        </Row>
        <Row label="Reduced motion" hint="System follows your device's accessibility setting.">
          <Segmented label="Reduced motion" value={a.reducedMotion} onChange={(reducedMotion) => set("appearance", { reducedMotion })}
            options={[{ value: "system", label: "System" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
        </Row>
      </Section>

      <Section id="s-defaults" title="Download defaults">
        <Row label="Default preset" htmlFor="def-preset">
          <select id="def-preset" value={d.presetId} onChange={(e) => set("defaults", { presetId: e.target.value })}>
            {settings.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Row>
        <Row label="Audio format" hint="Used when you switch a download to Audio.">
          <div className="row wrap">
            <Segmented label="Audio format" value={d.audioFormat} onChange={(audioFormat) => set("defaults", { audioFormat })}
              options={[{ value: "mp3", label: "MP3" }, { value: "m4a", label: "M4A" }, { value: "opus", label: "Opus" }, { value: "wav", label: "WAV" }]} />
            {d.audioFormat === "mp3" && (
              <select aria-label="MP3 bitrate" value={d.audioBitrate} onChange={(e) => set("defaults", { audioBitrate: Number(e.target.value) as Settings["defaults"]["audioBitrate"] })}>
                {[320, 256, 192, 128].map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            )}
          </div>
        </Row>
        <Row label="Filename template" htmlFor="def-tpl" hint={`Fields: ${TEMPLATE_TOKENS.map((t) => `{${t}}`).join(" ")}`}>
          <TemplateInput value={d.filenameTemplate} onCommit={(filenameTemplate) => set("defaults", { filenameTemplate })} />
        </Row>
        <Row label="Downloads at once" htmlFor="def-conc">
          <div className="row">
            <input id="def-conc" type="range" min={1} max={6} value={d.concurrentDownloads} onChange={(e) => set("defaults", { concurrentDownloads: Number(e.target.value) })} />
            <span className="mono">{d.concurrentDownloads}</span>
          </div>
        </Row>
        <Row label="MP4 compatibility" hint="Strict re-encodes to H.264/AAC when the site only offers VP9/AV1 (slow for 4K). Fast keeps the original codec.">
          <Segmented label="MP4 compatibility" value={d.mp4Compat} onChange={(mp4Compat) => set("defaults", { mp4Compat })}
            options={[{ value: "strict", label: "Strict (H.264)" }, { value: "fast", label: "Fast" }]} />
        </Row>
        <Row label="Cover art & tags">
          <label className="check"><input type="checkbox" checked={d.embedCover} onChange={(e) => set("defaults", { embedCover: e.target.checked })} /> Embed cover art and tags</label>
        </Row>
      </Section>

      <PresetsSection />

      <Section id="s-storage" title="Storage & cleanup">
        <Row label="Quota" htmlFor="quota" hint="Shown on the Library dashboard; also the limit for over-quota cleanup.">
          <div className="row">
            <NumberInput id="quota" value={st.quotaGB} min={0.1} max={100000} step={1} onCommit={(quotaGB) => quotaGB != null && set("storage", { quotaGB })} />
            <span className="mono">GB</span>
          </div>
        </Row>
        <Row label="Auto-cleanup">
          <label className="check"><input type="checkbox" checked={st.autoCleanup} onChange={(e) => set("storage", { autoCleanup: e.target.checked })} /> Delete files automatically</label>
        </Row>
        <Row label="Delete after" htmlFor="max-age" hint="Leave empty to keep files regardless of age.">
          <div className="row">
            <NumberInput id="max-age" value={st.maxAgeDays} min={1} max={3650} step={1} allowEmpty disabled={!st.autoCleanup}
              onCommit={(v) => set("storage", { maxAgeDays: v == null ? null : Math.round(v) })} />
            <span className="mono">days</span>
          </div>
        </Row>
        <Row label="Over quota">
          <label className="check"><input type="checkbox" disabled={!st.autoCleanup} checked={st.deleteOverQuota} onChange={(e) => set("storage", { deleteOverQuota: e.target.checked })} /> Delete oldest files when over quota</label>
        </Row>
        <Row label="Run now" hint="Applies the rules above immediately.">
          <CleanupNow />
        </Row>
      </Section>

      <SystemSection />

      <Section id="s-keys" title="Keyboard">
        <Row label="Shortcuts">
          <button className="btn btn-ghost" onClick={onShortcuts}><Icon name="keyboard" size={18} /> Show shortcuts</button>
        </Row>
      </Section>
      <p className="fine center">DubDeck is for personal use with content you have the right to download.</p>
    </div>
  );
}

function SyncBadge({ sync }: { sync: string }) {
  const map: Record<string, [string, string]> = {
    loading: ["Loading…", "muted"],
    synced: ["Synced", "ok"],
    saving: ["Saving…", "muted"],
    offline: ["Offline · saved on this device", "warn"],
    error: ["Couldn't sync", "warn"],
  };
  const [label, tone] = map[sync] ?? map.loading;
  return <span className={`sync-badge sync-${tone}`} role="status"><i />{label}</span>;
}

function TemplateInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input id="def-tpl" className="mono" value={v} maxLength={200} onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim() || "{title}")} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function NumberInput({ id, value, min, max, step, onCommit, allowEmpty, disabled }: {
  id: string; value: number | null; min: number; max: number; step: number; onCommit: (v: number | null) => void; allowEmpty?: boolean; disabled?: boolean;
}) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    if (v.trim() === "" && allowEmpty) return onCommit(null);
    const n = Number(v);
    if (!isFinite(n)) return setV(value == null ? "" : String(value));
    onCommit(Math.max(min, Math.min(max, n)));
  };
  return (
    <input id={id} className="mono num" type="number" inputMode="decimal" min={min} max={max} step={step} value={v} disabled={disabled}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function CleanupNow() {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setConfirm(true)}>Run cleanup now</button>
      {confirm && (
        <ConfirmModal title="Run cleanup now?" danger confirmLabel="Run cleanup" onClose={() => setConfirm(false)}
          message="Files matching your cleanup rules are permanently deleted."
          onConfirm={async () => {
            try {
              const r = await api<{ deleted: number }>("/api/library/cleanup", { body: {} });
              toast.push(r.deleted ? `Deleted ${r.deleted} file(s)` : "Nothing to clean up", "success");
            } catch (e) {
              toast.push((e as ApiError).message, "error");
            }
          }} />
      )}
    </>
  );
}

function PresetsSection() {
  const { settings, update } = useSettings();
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Preset | null>(null);
  const presets = settings.presets;
  const setPresets = (fn: (p: Preset[]) => Preset[]) => update((s) => ({ ...s, presets: fn(s.presets) }));
  const move = (id: string, delta: number) =>
    setPresets((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const dropOn = (targetId: string) =>
    setPresets((list) => {
      if (!dragId || dragId === targetId) return list;
      const from = list.findIndex((p) => p.id === dragId);
      const to = list.findIndex((p) => p.id === targetId);
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  return (
    <Section id="s-presets" title="Presets" desc="Save new presets from the Download page. Drag or use the arrows to reorder.">
      <ol className="presets">
        {presets.map((p, i) => (
          <li key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(p.id)} onDragEnd={() => setDragId(null)}
            className={clsx("preset", dragId === p.id && "is-dragging")}>
            <span className="grip" aria-hidden="true">⋮⋮</span>
            {editing === p.id ? (
              <input autoFocus defaultValue={p.name} maxLength={60} aria-label="Preset name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name) setPresets((l) => l.map((x) => (x.id === p.id ? { ...x, name } : x)));
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }} />
            ) : (
              <span className="preset-name">
                {p.name}
                {settings.defaults.presetId === p.id && <span className="chip">default</span>}
              </span>
            )}
            <span className="mono muted preset-desc">{describeOptions(p.options)}</span>
            <span className="preset-actions">
              <button className="icon-btn" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(p.id, -1)}><Icon name="up" size={16} /></button>
              <button className="icon-btn" aria-label={`Move ${p.name} down`} disabled={i === presets.length - 1} onClick={() => move(p.id, 1)}><Icon name="down" size={16} /></button>
              <button className="icon-btn" aria-label={`Rename ${p.name}`} onClick={() => setEditing(p.id)}><Icon name="edit" size={16} /></button>
              <button className="icon-btn" aria-label={`Delete ${p.name}`} disabled={presets.length <= 1} onClick={() => setDeleting(p)}><Icon name="trash" size={16} /></button>
            </span>
          </li>
        ))}
      </ol>
      {deleting && (
        <ConfirmModal title="Delete preset?" danger confirmLabel="Delete" message={`“${deleting.name}” will be removed from all your devices.`}
          onClose={() => setDeleting(null)}
          onConfirm={() => update((s) => {
            const presets = s.presets.filter((x) => x.id !== deleting.id);
            const presetId = s.defaults.presetId === deleting.id ? presets[0].id : s.defaults.presetId;
            return { ...s, presets, defaults: { ...s.defaults, presetId } };
          })} />
      )}
    </Section>
  );
}

function SystemSection() {
  const toast = useToast();
  const [info, setInfo] = useState<{ ytdlpVersion: string; publicUrl: string; cookies: boolean } | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    api<typeof info>("/api/system").then(setInfo).catch(() => {});
  }, []);
  return (
    <Section id="s-system" title="Server">
      <Row label="yt-dlp" hint="Sites change often. Update when downloads start failing.">
        <div className="row wrap">
          <span className="mono">{info?.ytdlpVersion ?? "…"}</span>
          <button className="btn btn-ghost" disabled={updating} onClick={async () => {
            setUpdating(true);
            try {
              const r = await api<{ ok: boolean; version: string }>("/api/system/update-ytdlp", { body: {} });
              setInfo((i) => (i ? { ...i, ytdlpVersion: r.version } : i));
              toast.push(r.ok ? `yt-dlp is now ${r.version}` : "Update failed. Check the server logs.", r.ok ? "success" : "error");
            } catch (e) {
              toast.push((e as ApiError).message, "error");
            } finally {
              setUpdating(false);
            }
          }}><Icon name="retry" size={18} /> {updating ? "Updating…" : "Update yt-dlp"}</button>
        </div>
      </Row>
      <Row label="Backend" hint="Large files download directly from here using 15-minute signed links.">
        <span className="mono truncate">{info?.publicUrl ?? "…"}</span>
      </Row>
      <Row label="Cookies file">
        <span className="mono">{info ? (info.cookies ? "Configured" : "Not configured") : "…"}</span>
      </Row>
    </Section>
  );
}
