// Hexdrift's own icon set: drawn by hand on a 24-unit grid with one stroke
// weight, rounded joins and a few solid accents, so every icon reads as part
// of one family (no emoji anywhere in the game).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="hx-ico" {...rest}>
      {children}
    </svg>
  );
}

export const IconBack = (p: P) => <Svg {...p}><path d="M15 5 8 12l7 7" /></Svg>;
export const IconNext = (p: P) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>;

/** A spanner: the garage. */
export const IconGarage = (p: P) => (
  <Svg {...p}>
    <path d="M14.8 3.6a5 5 0 0 0-5.7 6.6L3.5 15.8a2.1 2.1 0 0 0 3 3l5.6-5.6a5 5 0 0 0 6.6-5.7l-2.9 2.9-2.6-.4-.4-2.6z" fill="currentColor" fillOpacity={0.18} />
    <circle cx="5.2" cy="17.1" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

/** A controller, for Gaming Mode. */
export const IconGamepad = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.9a2.4 2.4 0 0 1-4.1 2.1L15.5 15h-7l-2.2 2.6a2.4 2.4 0 0 1-4.1-2.1l.9-4.9A4.5 4.5 0 0 1 7.5 7z" />
    <path d="M7.5 9.5v3M6 11h3" />
    <circle cx="15.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconFullscreen = (p: P) => <Svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>;

export const IconCrown = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8.5 7.5 12 12 5l4.5 7 4-3.5-1.8 9.5H5.3z" fill="currentColor" fillOpacity={0.25} />
    <path d="M5.5 21h13" />
  </Svg>
);

export const IconTrophy = (p: P) => (
  <Svg {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor" fillOpacity={0.2} />
    <path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v3.5M8.5 21h7M9.5 21l.7-3.5h3.6l.7 3.5" />
  </Svg>
);

export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" fillOpacity={0.2} />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
  </Svg>
);

export const IconRestart = (p: P) => <Svg {...p}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9" /></Svg>;

export const IconCamera = (p: P) => (
  <Svg {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.5-2h6.4l1.5 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const IconPause = (p: P) => <Svg {...p}><path d="M8.5 5v14M15.5 5v14" strokeWidth={3} /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></Svg>;

/** A chequered flag. */
export const IconFlag = (p: P) => (
  <Svg {...p}>
    <path d="M5 21V4" />
    <path d="M5 4.5c4-2 6.5 2 11 0v9c-4.5 2-7-2-11 0z" />
    <path d="M8.5 3.9v4.5M12 5.4v4.5M15.5 4.5V9M5 9c4-2 6.5 2 11 0" strokeWidth={1.4} />
  </Svg>
);

export const IconMedal = (p: P) => (
  <Svg {...p}>
    <path d="m8 3 4 6 4-6M5.5 3 9 9M18.5 3 15 9" />
    <circle cx="12" cy="15" r="5.5" fill="currentColor" fillOpacity={0.2} />
    <path d="m12 12.3.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSound = (p: P) => <Svg {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.2} /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></Svg>;
export const IconMute = (p: P) => <Svg {...p}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.2} /><path d="m16 9.5 5 5m0-5-5 5" /></Svg>;

export const IconTimer = (p: P) => <Svg {...p}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5V9.5M10 2.5h4M18.5 6.5l1.5-1.5" /></Svg>;
export const IconUsers = (p: P) => <Svg {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14a6.5 6.5 0 0 1 3.5 6" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.1" /></Svg>;
export const IconRespawn = (p: P) => <Svg {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><path d="M9.5 10a2.5 2.5 0 1 0 .8-1.8M9.5 6.8v1.6h1.6" strokeWidth={1.6} /></Svg>;
export const IconDrift = (p: P) => <Svg {...p}><path d="M4 18c3-1 4-5 8-6s6 2 8-1" /><path d="M5 13c2-.7 3-3 5.5-3.8M14 6l3 1-1 3" /></Svg>;
export const IconSpark = (p: P) => <Svg {...p}><path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5L10 14l-7.5-2L10 10z" fill="currentColor" fillOpacity={0.25} /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
/** A map pin over a road: "maps". */
export const IconRoute = (p: P) => <Svg {...p}><path d="M5 21c0-5 14-4 14-10" /><circle cx="18" cy="6" r="2.5" /><path d="M4 21h3" /></Svg>;
