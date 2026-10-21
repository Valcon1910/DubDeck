// Minimal stroke icon set (24px grid, 1.8 stroke), drawn for DubDeck.
const PATHS: Record<string, string> = {
  download: "M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14",
  queue: "M4 6h12M4 12h16M4 18h9M19 15v6m-3-3h6",
  library: "M4 5h6v14H4zM14 5l5 1.5-3.5 13L11 18z",
  settings: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.7 7.7 0 01-2.2 1.3L14.6 21h-4l-.3-2.3a7.7 7.7 0 01-2.2-1.3l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 010-2.6L4.2 9.3l2-3.4 1.9.7a7.7 7.7 0 012.2-1.3L10.6 3h4l.3 2.3c.8.3 1.6.8 2.2 1.3l1.9-.7 2 3.4-1.6 1.2c.2.9.2 1.7 0 2.6z",
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M8 5v14M16 5v14",
  x: "M6 6l12 12M18 6L6 18",
  retry: "M4 12a8 8 0 0113.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.7L4 15.5M4 20v-4.5h4.5",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  logout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4",
  music: "M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  external: "M14 5h5v5M19 5l-8 8M18 14v5H5V6h5",
  keyboard: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
  wave: "M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function Icon({ name, size = 20, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className="icon"
    >
      <path d={PATHS[name] ?? PATHS.info} fill={name === "play" ? "currentColor" : "none"} />
    </svg>
  );
}
