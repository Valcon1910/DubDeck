import { useRef, useState, type RefObject } from "react";
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
  return <EditingBlock b={b} i={i} last={last} edit={edit} cls={cls} style={style} body={body} />;
}

function EditingBlock({ b, i, last, edit, cls, style, body }: {
  b: Block; i: number; last: boolean; edit: EditApi; cls: string; style: React.CSSProperties; body: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const on = edit.selected === b.id;
  return (
    <div ref={ref} id={`block-${b.id}`} className={`${cls} vx-block-editing ${on ? "vx-block-on" : ""}`} style={style}
      onClick={() => { if (!on) edit.select(b.id); }}>
      {body}
      {on && <BlockTools b={b} first={i === 0} last={last} edit={edit} />}
      {on && <ResizeHandles target={ref} width={b.width} onChange={(p) => edit.updateBlock(b.id, p)} />}
    </div>
  );
}

/** The small toolbar on the selected block, like Google Sites. */
function BlockTools({ b, first, last, edit }: { b: Block; first: boolean; last: boolean; edit: EditApi }) {
  const up = (patch: Partial<Block>) => edit.updateBlock(b.id, patch);
  return (
    <div className="vx-block-tools" onClick={(e) => e.stopPropagation()}>
      <div className="vx-block-bar" role="toolbar" aria-label="Block tools">
        <button type="button" aria-label="Move earlier" title="Move earlier" disabled={first} onClick={() => edit.moveBlock(b.id, -1)}>‹</button>
        <button type="button" aria-label="Move later" title="Move later" disabled={last} onClick={() => edit.moveBlock(b.id, 1)}>›</button>
        {b.kind !== "text" && <PictureButton edit={edit} has={!!b.image} onChange={(image) => up({ image })} />}
        <LinkButton value={b.link} onChange={(link) => up({ link })} />
        <button type="button" aria-label="Remove block" title="Delete" className="danger" onClick={() => { if (confirm("Remove this block?")) edit.removeBlock(b.id); }}>🗑</button>
      </div>
    </div>
  );
}

export function PictureButton({ edit, has, onChange }: { edit: EditApi; has: boolean; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function picked(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    const r = await edit.uploadImage(f);
    setBusy(false);
    if ("error" in r) alert(r.error); else onChange(r.path);
  }
  return (
    <>
      <button type="button" aria-label={has ? "Change picture" : "Add picture"} title={has ? "Change picture" : "Add picture"} disabled={busy}
        onClick={() => input.current?.click()}>{busy ? "…" : "🖼"}</button>
      <input ref={input} type="file" hidden aria-label="Picture file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
}

export function LinkButton({ value, onChange, label = "Link" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <button type="button" aria-label={label} title={value ? `${label}: ${value}` : `Add ${label.toLowerCase()}`} aria-pressed={!!value}
      onClick={() => {
        const v = prompt(`${label} (leave empty to remove):`, value);
        if (v === null) return;
        let u = v.trim();
        if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
        if (u && !safeUrl(u)) { alert("That isn't a valid link."); return; }
        onChange(u);
      }}>🔗</button>
  );
}

/**
 * Drag handles on the selected item's frame: the right edge sets the width
 * (in % of the page, steps of 5), the bottom edge the height (px), the corner both.
 * Double-click the bottom edge to make the height automatic again.
 */
export function ResizeHandles({ target, width, onChange }: {
  target: RefObject<HTMLElement | null>; width: number; onChange: (p: { width?: number; height?: number }) => void;
}) {
  function start(e: React.PointerEvent, dir: "x" | "y" | "xy") {
    const el = target.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const w0 = el.getBoundingClientRect().width, h0 = el.getBoundingClientRect().height;
    const full = box.getBoundingClientRect().width || 1;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("vx-resizing");
    const move = (ev: PointerEvent) => {
      const p: { width?: number; height?: number } = {};
      if (dir !== "y") p.width = Math.max(10, Math.min(100, Math.round(((w0 + ev.clientX - x0) / full) * 20) * 5));
      if (dir !== "x") p.height = Math.max(40, Math.min(2000, Math.round((h0 + ev.clientY - y0) / 10) * 10));
      if ((p.width === undefined || p.width === width) && p.height === undefined) return;
      onChange(p);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("vx-resizing");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  return (
    <>
      <span className="vx-rs vx-rs-x" role="separator" aria-orientation="vertical" aria-label="Drag to change the width" title="Drag to change the width"
        onPointerDown={(e) => start(e, "x")} onClick={(e) => e.stopPropagation()} />
      <span className="vx-rs vx-rs-y" role="separator" aria-orientation="horizontal" aria-label="Drag to change the height" title="Drag to change the height (double-click: automatic)"
        onPointerDown={(e) => start(e, "y")} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); onChange({ height: 0 }); }} />
      <span className="vx-rs vx-rs-xy" aria-label="Drag to change the size" title="Drag to change the size"
        onPointerDown={(e) => start(e, "xy")} onClick={(e) => e.stopPropagation()} />
      <span className="vx-rs-size" aria-hidden="true">{width}%</span>
    </>
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
