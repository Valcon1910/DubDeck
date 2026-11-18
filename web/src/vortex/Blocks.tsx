import { useRef, useState } from "react";
import { imageSrc, safeUrl, useContent, type Block } from "./content";
import { Editable, useEdit, type EditApi } from "./editable";

/** Text, boxes and pictures added in the editor, side by side when they fit. */
export function Blocks() {
  const blocks = useContent().home.blocks;
  const edit = useEdit();
  if (!blocks.length && !edit) return null;
  return (
    <section className="vx-blocks-wrap" aria-label="More">
      <div className="vx-blocks">
        {blocks.map((b, i) => <BlockView key={b.id} b={b} i={i} last={i === blocks.length - 1} />)}
      </div>
      {edit && (
        <div className="vx-block-add" role="group" aria-label="Add to the page">
          <span className="vx-muted vx-small">Add:</span>
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => edit.addBlock("text")}>+ Text</button>
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => edit.addBlock("box")}>+ Box</button>
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => edit.addBlock("image")}>+ Image</button>
        </div>
      )}
    </section>
  );
}

function BlockView({ b, i, last }: { b: Block; i: number; last: boolean }) {
  const edit = useEdit();
  const src = imageSrc(b.image);
  const href = safeUrl(b.link);
  // Width minus its share of the 16 px gaps, so e.g. two 50% blocks fit side by side.
  const style = { flexBasis: `calc(${b.width}% - ${(16 * (1 - b.width / 100)).toFixed(2)}px)`, ...(b.height ? { height: b.height } : {}) };
  const p = `home.blocks.${i}`;
  const body = (
    <>
      {b.kind === "image" && (src ? <img className="vx-block-img" src={src} alt={b.title} referrerPolicy="no-referrer" /> : edit && <span className="vx-block-noimg">No picture yet</span>)}
      {b.kind === "box" && (
        <>
          <Editable as="h2" className="vx-block-title" path={`${p}.title`} placeholder="Title" />
          <div className="vx-block-row">
            {src && <img className="vx-block-thumb" src={src} alt="" referrerPolicy="no-referrer" />}
            <Editable as="p" className="vx-muted" path={`${p}.text`} placeholder="Text" multiline />
          </div>
        </>
      )}
      {b.kind === "text" && <Editable as="p" className="vx-block-text" path={`${p}.text`} placeholder="Text" multiline />}
    </>
  );
  const cls = `vx-block vx-block-${b.kind}`;
  if (!edit) {
    return href
      ? <a className={cls} style={style} href={href} target="_blank" rel="noopener noreferrer">{body}</a>
      : <div className={cls} style={style}>{body}</div>;
  }
  return (
    <div className={`${cls} vx-block-editing`} style={style}>
      {body}
      <BlockTools b={b} first={i === 0} last={last} edit={edit} />
    </div>
  );
}

function BlockTools({ b, first, last, edit }: { b: Block; first: boolean; last: boolean; edit: EditApi }) {
  const [open, setOpen] = useState(false);
  const up = (patch: Partial<Block>) => edit.updateBlock(b.id, patch);
  return (
    <div className="vx-block-tools">
      <div className="vx-game-tools">
        <button type="button" aria-label="Move earlier" disabled={first} onClick={() => edit.moveBlock(b.id, -1)}>‹</button>
        <button type="button" aria-label="Move later" disabled={last} onClick={() => edit.moveBlock(b.id, 1)}>›</button>
        <button type="button" aria-label="Block settings" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⚙</button>
        <button type="button" aria-label="Remove block" className="danger" onClick={() => { if (confirm("Remove this block?")) edit.removeBlock(b.id); }}>✕</button>
      </div>
      {open && (
        <div className="vx-block-panel">
          <SizeFields width={b.width} height={b.height} onChange={up} />
          {b.kind !== "text" && <ImageField value={b.image} onChange={(image) => up({ image })} edit={edit} />}
          {b.kind === "image" && (
            <label className="vx-field"><span>Description (for screen readers)</span>
              <input type="text" maxLength={120} value={b.title} onChange={(e) => up({ title: e.target.value })} />
            </label>
          )}
          <label className="vx-field"><span>Opens this link (optional)</span>
            <input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://…" value={b.link} onChange={(e) => up({ link: e.target.value.trim() })} />
          </label>
        </div>
      )}
    </div>
  );
}

/** Width in % of the page and height in px (0 = fits the content). */
export function SizeFields({ width, height, onChange }: { width: number; height: number; onChange: (p: { width?: number; height?: number }) => void }) {
  return (
    <div className="vx-size">
      <label className="vx-field"><span>Width: {width}%</span>
        <input type="range" min={10} max={100} step={5} value={width} onChange={(e) => onChange({ width: Number(e.target.value) })} />
      </label>
      <label className="vx-field"><span>Height (px, 0 = automatic)</span>
        <input type="number" min={0} max={2000} step={10} value={height} onChange={(e) => onChange({ height: Math.max(0, Math.min(2000, Number(e.target.value) || 0)) })} />
      </label>
    </div>
  );
}

export function ImageField({ value, onChange, edit }: { value: string; onChange: (v: string) => void; edit: EditApi }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function picked(f: File | undefined) {
    if (!f) return;
    setErr(null); setBusy(true);
    const r = await edit.uploadImage(f);
    setBusy(false);
    if ("error" in r) setErr(r.error); else onChange(r.path);
  }
  return (
    <div className="vx-field">
      <span>Picture</span>
      <div className="vx-row">
        <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Preparing…" : "Upload image"}</button>
        {value && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => onChange("")}>Remove picture</button>}
      </div>
      <input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="…or paste an image link"
        value={value.startsWith("/") ? "" : value} onChange={(e) => onChange(e.target.value.trim())} aria-label="Image link" />
      {value.startsWith("/") && <small className="vx-muted">Using your uploaded picture.</small>}
      {err && <small className="vx-alert vx-alert-error" role="alert">{err}</small>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
