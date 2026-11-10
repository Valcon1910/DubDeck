import { createContext, useContext, useLayoutEffect, useRef, type ElementType } from "react";
import { useContent, type Content, type Game } from "./content";

// Page text that becomes click-to-edit inside the admin editor (like Google
// Sites). Outside the editor it renders as plain text.

export interface EditApi {
  /** Set a text field, e.g. ("home.title", "Hi"). */
  setText: (path: string, value: string) => void;
  toggleSection: (key: keyof Content["sections"]) => void;
  editGame: (game: Game | null) => void; // null = add a new game
  moveGame: (id: string, by: number) => void;
  removeGame: (id: string) => void;
}

export const EditContext = createContext<EditApi | null>(null);
export const useEdit = () => useContext(EditContext);

export function getText(content: Content, path: string): string {
  let v: unknown = content;
  for (const k of path.split(".")) v = (v as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v : "";
}

export function setTextIn(content: Content, path: string, value: string): void {
  const keys = path.split(".");
  let o = content as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

interface EditableProps {
  path: string;
  as?: ElementType;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}

export function Editable({ path, as: Tag = "span", className, placeholder = "Type here…", multiline }: EditableProps) {
  const content = useContent();
  const edit = useEdit();
  const value = getText(content, path);
  const ref = useRef<HTMLElement>(null);

  // Uncontrolled while focused (keeps the caret in place); synced otherwise (undo, discard).
  // React never renders the text itself here (that would move the caret while typing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  });

  if (!edit) return value ? <Tag className={className}>{value}</Tag> : null;

  return (
    <Tag
      ref={ref}
      className={`${className ?? ""} vx-editable`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder}
      data-placeholder={placeholder}
      spellCheck
      onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter" && !multiline) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") e.currentTarget.blur();
      }}
      onInput={(e: React.FormEvent<HTMLElement>) => edit.setText(path, (e.currentTarget.textContent ?? "").replace(/\n+$/, ""))}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        // Plain text only, even where "plaintext-only" isn't supported.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}
