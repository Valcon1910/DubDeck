import { useEffect, useRef, useState } from "react";
import { cropRect, cropStyle, NO_CROP, withCrop, type Crop } from "./crop";

const FRAME = 260;
const OUT = 256;
/** GIFs are kept whole (so they move); this keeps them small enough to save. */
export const MAX_GIF = 1_500_000;

const readAsDataUrl = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f);
});

/**
 * Drag to move and pinch, scroll or slide to zoom; the circle shows what
 * others will see. onDone gets a data: URL (a GIF stays animated, with its
 * crop in the address).
 */
export function AvatarCrop({ file, onDone, onCancel }: { file: File; onDone: (url: string) => void; onCancel: () => void }) {
  const [src, setSrc] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop>(NO_CROP);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const gif = file.type === "image/gif";

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);

  const setZoom = (z: number) => setCrop((c) => ({ ...c, zoom: Math.min(4, Math.max(1, z)) }));

  function move(dx: number, dy: number) {
    if (!size) return;
    setCrop((c) => {
      const side = Math.min(size.w, size.h) / c.zoom;
      const per = side / FRAME; // picture pixels per screen pixel
      const fx = size.w - side > 0.5 ? -dx * per / (size.w - side) : 0;
      const fy = size.h - side > 0.5 ? -dy * per / (size.h - side) : 0;
      return { ...c, x: Math.min(1, Math.max(0, c.x + fx)), y: Math.min(1, Math.max(0, c.y + fy)) };
    });
  }

  async function done() {
    if (!size || !img.current) return;
    setBusy(true); setErr(null);
    try {
      if (gif) {
        if (file.size > MAX_GIF) throw new Error(`That GIF is ${(file.size / 1e6).toFixed(1)} MB. Pick one under ${MAX_GIF / 1e6} MB.`);
        onDone(withCrop(await readAsDataUrl(file), crop));
        return;
      }
      const { sx, sy, side } = cropRect(size.w, size.h, crop);
      const c = document.createElement("canvas");
      c.width = c.height = OUT;
      c.getContext("2d")!.drawImage(img.current, sx, sy, side, side, 0, 0, OUT, OUT);
      onDone(file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't use that picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vx-modal vx-crop-modal" role="dialog" aria-modal="true" aria-labelledby="vx-crop-title" onClick={onCancel}>
      <div className="vx-card vx-modal-card vx-crop-card" onClick={(e) => e.stopPropagation()}>
        <header className="vx-modal-head">
          <h2 id="vx-crop-title">Crop your picture</h2>
          <button type="button" className="vx-icon-btn" aria-label="Cancel" onClick={onCancel}>×</button>
        </header>
        <div className="vx-crop-frame" style={{ width: FRAME, height: FRAME }}
          onWheel={(e) => setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
          onPointerMove={(e) => {
            const p = pts.current.get(e.pointerId);
            if (!p) return;
            const now = { x: e.clientX, y: e.clientY };
            pts.current.set(e.pointerId, now);
            if (pts.current.size >= 2) {
              const [a, b] = [...pts.current.values()];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (!pinch.current) pinch.current = { d, zoom: crop.zoom };
              else setZoom(pinch.current.zoom * d / pinch.current.d);
              return;
            }
            move(now.x - p.x, now.y - p.y);
          }}
          onPointerUp={(e) => { pts.current.delete(e.pointerId); pinch.current = null; }}
          onPointerCancel={(e) => { pts.current.delete(e.pointerId); pinch.current = null; }}>
          {src && <img ref={img} src={src} alt="" draggable={false} style={cropStyle(crop)}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setErr("That file isn't a picture this browser can open.")} />}
          <span className="vx-crop-ring" aria-hidden="true" />
        </div>
        <label className="vx-field vx-crop-zoom">
          <span>Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <p className="vx-muted vx-small">Drag to move it{gif ? ". GIFs keep moving as your picture." : "."}</p>
        {err && <p className="vx-alert vx-alert-error" role="alert">{err}</p>}
        <footer className="vx-action-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="vx-btn vx-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="vx-btn vx-btn-primary" disabled={!size || busy} onClick={() => void done()}>Use picture</button>
        </footer>
      </div>
    </div>
  );
}
