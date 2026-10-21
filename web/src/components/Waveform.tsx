import { useId, useMemo } from "react";
import { seeded } from "../util";

interface Props {
  seed: string;
  progress: number | null; // 0..1, or null for indeterminate
  label: string;
  bars?: number;
  tone?: "accent" | "success" | "danger" | "muted";
}

/** Progress bar drawn as a tape waveform: bars fill with the accent as it advances. */
export function Waveform({ seed, progress, label, bars = 72, tone = "accent" }: Props) {
  const clip = useId().replace(/:/g, "");
  const heights = useMemo(() => {
    const rnd = seeded(seed);
    return Array.from({ length: bars }, (_, i) => {
      // Loudness envelope with a few swells, plus per-bar jitter: reads as audio, not noise.
      const env = 0.5 + 0.3 * Math.sin((i / bars) * Math.PI) + 0.2 * Math.sin(i * 0.37 + rnd() * 0.5);
      return Math.max(0.12, Math.min(1, env * (0.25 + 0.75 * rnd() ** 1.4)));
    });
  }, [seed, bars]);
  const w = bars * 4;
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  return (
    <div
      className={`waveform tone-${tone}${pct == null ? " is-indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct == null ? undefined : Math.round(pct * 100)}
      aria-valuetext={pct == null ? `${label}: working` : `${label}: ${Math.round(pct * 100)}%`}
    >
      <svg viewBox={`0 0 ${w} 24`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" height="24" width={pct == null ? w : w * pct} className="wf-clip" />
          </clipPath>
        </defs>
        <g className="wf-track">
          {heights.map((h, i) => (
            <rect key={i} x={i * 4 + 0.6} y={12 - h * 11} width="2.4" height={h * 22} rx="1.2" />
          ))}
        </g>
        <g className="wf-fill" clipPath={`url(#${clip})`}>
          {heights.map((h, i) => (
            <rect key={i} x={i * 4 + 0.6} y={12 - h * 11} width="2.4" height={h * 22} rx="1.2" />
          ))}
        </g>
      </svg>
    </div>
  );
}
