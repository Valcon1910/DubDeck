export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g stroke="var(--accent-contrast)" fill="none">
        <rect x="9" y="15" width="46" height="32" rx="6" strokeWidth="3.5" />
        <circle cx="21.5" cy="29" r="5.5" strokeWidth="3" />
        <circle cx="42.5" cy="29" r="5.5" strokeWidth="3" />
        <path d="M30 27.4v3.2M32 25.2v7.6M34 27.4v3.2" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M18 47l3.5-5.5h21L46 47" strokeWidth="3" strokeLinejoin="round" />
      </g>
      <circle cx="21.5" cy="29" r="1.7" fill="var(--accent-contrast)" />
      <circle cx="42.5" cy="29" r="1.7" fill="var(--accent-contrast)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">
        Dub<span className="logo-accent">Deck</span>
      </span>
    </span>
  );
}
