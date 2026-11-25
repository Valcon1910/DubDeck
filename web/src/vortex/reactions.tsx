import { useEffect, useRef, useState } from "react";

// Emoji reactions, shared by Chat messages and Announcements: a row of chips
// ("👍 3", your own highlighted) plus a small picker. Tap a chip to add or
// take back that reaction.

export const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "💯", "🙏", "😡", "👎"];

export interface ReactionCount { emoji: string; count: number; mine: boolean; who?: string[] }

/** Rows of { emoji, who } → chips in first-used order. */
export function tallyReactions(rows: { emoji: string; who: string }[], me: string, name: (who: string) => string = (w) => w): ReactionCount[] {
  const by = new Map<string, ReactionCount>();
  for (const r of rows) {
    const c = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, who: [] };
    c.count++;
    if (r.who === me) c.mine = true;
    c.who!.push(name(r.who));
    by.set(r.emoji, c);
  }
  return [...by.values()];
}

export function ReactionBar({ counts, onToggle, busy, label = "Add a reaction", always = false }: {
  counts: ReactionCount[]; onToggle: (emoji: string) => void; busy?: boolean; label?: string;
  /** Show the add button even with no reactions yet (announcements). */
  always?: boolean;
}) {
  if (!counts.length && !always) return null;
  return (
    <div className="vx-reacts" onClick={(e) => e.stopPropagation()}>
      {counts.map((c) => (
        <button key={c.emoji} type="button" className={`vx-react ${c.mine ? "mine" : ""}`} disabled={busy}
          aria-pressed={c.mine} title={c.who?.join(", ")}
          aria-label={`${c.emoji} ${c.count}${c.mine ? ", including you. Tap to remove yours" : ". Tap to add yours"}`}
          onClick={() => onToggle(c.emoji)}>
          <span className="vx-react-emoji" aria-hidden="true">{c.emoji}</span><span className="vx-react-n">{c.count}</span>
        </button>
      ))}
      {always && <EmojiPicker onPick={onToggle} label={label} chosen={counts.filter((c) => c.mine).map((c) => c.emoji)} />}
    </div>
  );
}

/** A "+😊" button that opens a small grid of emoji. */
export function EmojiPicker({ onPick, label = "Add a reaction", chosen = [], className = "" }: {
  onPick: (emoji: string) => void; label?: string; chosen?: string[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span className={`vx-react-pick ${className}`} ref={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="vx-react vx-react-add" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="12" r="8" /><path d="M8 14.5c1.6 1.8 4.4 1.8 6 0M8.5 9.5h.01M13.5 9.5h.01M20 3v5M17.5 5.5h5" />
        </svg>
      </button>
      {open && (
        <span className="vx-react-menu" role="menu" aria-label={label}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="menuitem" className={chosen.includes(e) ? "mine" : ""} aria-label={e}
              onClick={() => { onPick(e); setOpen(false); }}>{e}</button>
          ))}
        </span>
      )}
    </span>
  );
}
