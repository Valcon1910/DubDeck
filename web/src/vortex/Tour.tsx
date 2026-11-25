import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

// A spotlight tour: dims the page, lights up one button at a time and explains
// it in a small card next to it.

export interface TourStep {
  /** CSS selector of the thing to light up (the card sits in the middle if it isn't on screen). */
  target: string;
  title: string;
  text: string;
  /** Runs before this step shows (to open a dialog, say). */
  before?: () => void;
}

interface Box { x: number; y: number; w: number; h: number }
const PAD = 6;

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps[i]!;

  useLayoutEffect(() => { step.before?.(); }, [step]);

  // Follow the target as the page moves (dialogs opening, scrolling, resizing).
  useEffect(() => {
    let raf = 0, tries = 0;
    const tick = () => {
      const el = document.querySelector(step.target);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) {
        if (tries++ === 0) el!.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        setBox((b) => (b && Math.abs(b.x - r.x) < 0.5 && Math.abs(b.y - r.y) < 0.5 && b.w === r.width && b.h === r.height ? b : { x: r.x, y: r.y, w: r.width, h: r.height }));
      } else setBox(null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onDone(); }
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });

  const last = i === steps.length - 1;
  function next() { if (last) onDone(); else setI(i + 1); }

  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(320, vw - 32);
  let cardStyle: CSSProperties;
  if (box) {
    const below = box.y + box.h + PAD + 12;
    const room = vh - below;
    const left = Math.min(Math.max(16, box.x + box.w / 2 - cardW / 2), vw - cardW - 16);
    cardStyle = room > 190 ? { top: below, left, width: cardW } : { bottom: vh - box.y + PAD + 12, left, width: cardW };
  } else {
    cardStyle = { top: "50%", left: "50%", width: cardW, transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="vx-tour" role="dialog" aria-modal="true" aria-labelledby="vx-tour-title" onClick={(e) => e.stopPropagation()}>
      <div className={`vx-tour-hole ${box ? "" : "vx-tour-nohole"}`} aria-hidden="true"
        style={box ? { left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 } : undefined} />
      <div className="vx-card vx-tour-card" style={cardStyle} key={i}>
        <span className="vx-muted vx-small">Step {i + 1} of {steps.length}</span>
        <h2 id="vx-tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="vx-tour-dots" aria-hidden="true">{steps.map((_, n) => <i key={n} className={n === i ? "on" : ""} />)}</div>
        <footer className="vx-action-row">
          <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={onDone}>Skip</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button type="button" className="vx-btn vx-btn-ghost vx-btn-sm" onClick={() => setI(i - 1)}>Back</button>}
          <button type="button" className="vx-btn vx-btn-primary vx-btn-sm" onClick={next} autoFocus>{last ? "Got it" : "Next"}</button>
        </footer>
      </div>
    </div>
  );
}

/** Opens or closes the Settings dialog from anywhere (VortexApp listens). */
export const openSettings = (open = true) => window.dispatchEvent(new CustomEvent("vortex:settings", { detail: open }));
