import { useEffect, useRef, useState } from "react";
import { nameFromEmail, squareAvatar, type Prefs, type TextSize, type ThemePref } from "./account";

const ACCENTS = ["#6c4ce0", "#2563eb", "#0891b2", "#059669", "#d97706", "#e4572e", "#db2777", "#111827"];

/** Profile and appearance, for this person only (saved on this device). */
export function Settings({ prefs, update, email, siteAccent, onClose }: {
  prefs: Prefs; update: (p: Partial<Prefs>) => void; email: string | null; siteAccent: string; onClose: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try { update({ avatar: await squareAvatar(f) }); } catch { setErr("That file isn't a picture this browser can open."); }
  }

  const name = prefs.name.trim() || nameFromEmail(email);
  return (
    <div className="vx-modal" role="dialog" aria-modal="true" aria-labelledby="vx-settings-title" onClick={onClose}>
      <div className="vx-card vx-modal-card vx-settings" onClick={(e) => e.stopPropagation()}>
        <header className="vx-modal-head">
          <h2 id="vx-settings-title">Settings</h2>
          <button type="button" className="vx-icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p className="vx-muted vx-small">These only change the app for you, on this device.</p>

        <section className="vx-set-group">
          <h3>Profile</h3>
          <div className="vx-set-profile">
            <Avatar src={prefs.avatar} name={name} size={72} />
            <div className="vx-action-row">
              <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => file.current?.click()}>Change picture</button>
              {prefs.avatar && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => update({ avatar: "" })}>Remove</button>}
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </div>
          {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
          <label className="vx-field">
            <span>Name</span>
            <input type="text" maxLength={40} value={prefs.name} placeholder={nameFromEmail(email)} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <p className="vx-muted vx-small">Signed in as {email ?? "—"}</p>
        </section>

        <section className="vx-set-group">
          <h3>Appearance</h3>
          <Segmented<ThemePref> label="Theme" value={prefs.theme} onChange={(theme) => update({ theme })}
            options={[["system", "Automatic"], ["light", "Light"], ["dark", "Dark"]]} />
          <Segmented<TextSize> label="Text size" value={prefs.textSize} onChange={(textSize) => update({ textSize })}
            options={[["small", "Small"], ["normal", "Normal"], ["large", "Large"]]} />
          <div className="vx-field">
            <span>Accent color</span>
            <div className="vx-swatches">
              <button type="button" className={`vx-swatch vx-swatch-site ${prefs.accent === "" ? "on" : ""}`} style={{ background: siteAccent }}
                aria-label="Site color" aria-pressed={prefs.accent === ""} onClick={() => update({ accent: "" })}>A</button>
              {ACCENTS.filter((c) => c !== siteAccent).map((c) => (
                <button key={c} type="button" className={`vx-swatch ${prefs.accent === c ? "on" : ""}`} style={{ background: c }}
                  aria-label={`Color ${c}`} aria-pressed={prefs.accent === c} onClick={() => update({ accent: c })} />
              ))}
            </div>
          </div>
          <label className="vx-check">
            <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} />
            <span>Reduce motion</span>
          </label>
        </section>

        <footer className="vx-action-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="vx-btn vx-btn-primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="vx-field">
      <span>{label}</span>
      <div className="vx-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Avatar({ src, name, size = 34 }: { src: string; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span className="vx-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

export type IconName = "home" | "games" | "download" | "flask" | "shield" | "pen" | "menu" | "gear" | "logout";
const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  games: "M7 9v4M5 11h4M15.5 10.5h.01M17.5 12.5h.01M6.5 6h11A4.5 4.5 0 0 1 22 10.5v3a3.5 3.5 0 0 1-6.3 2.1L15 15H9l-.7.6A3.5 3.5 0 0 1 2 13.5v-3A4.5 4.5 0 0 1 6.5 6z",
  download: "M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 14h9",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z",
  pen: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  menu: "M4 6h16M4 12h16M4 18h16",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H3",
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="vx-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
