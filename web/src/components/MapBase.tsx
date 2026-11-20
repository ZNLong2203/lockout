import { useId, type ReactNode } from "react";
import { LANES, NEXUS, P, PITS, RIVER, S } from "../lib/map";

interface Props {
  label: string;
  /** Drawn on top of the map, in game units (y is flipped with `P`). */
  children?: ReactNode;
  className?: string;
}

/** Our own stylised Summoner's Rift: river, lanes, both bases and the two objective pits. */
export function MapBase({ label, children, className = "rift" }: Props) {
  const gid = useId();
  return (
    <svg className={className} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${gid}-bg`} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="var(--map-1)" />
          <stop offset="100%" stopColor="var(--map-2)" />
        </radialGradient>
      </defs>
      <rect width={S} height={S} rx={900} fill={`url(#${gid}-bg)`} />
      <polyline points={RIVER.map(P).join(" ")} fill="none" stroke="var(--river)" strokeWidth={1500} strokeLinecap="round" strokeLinejoin="round" />
      {Object.entries(LANES).map(([lane, pts]) => (
        <polyline key={lane} points={pts.map(P).join(" ")} fill="none" stroke="var(--lane)" strokeWidth={650} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {children}
      <circle cx={NEXUS.blue[0]} cy={S - NEXUS.blue[1]} r={1100} fill="var(--side-blue)" opacity={0.85} />
      <circle cx={NEXUS.red[0]} cy={S - NEXUS.red[1]} r={1100} fill="var(--side-red)" opacity={0.85} />
      <circle cx={PITS.dragon[0]} cy={S - PITS.dragon[1]} r={650} fill="var(--pit)" />
      <circle cx={PITS.baron[0]} cy={S - PITS.baron[1]} r={700} fill="var(--pit)" />
      <text x={PITS.dragon[0]} y={S - PITS.dragon[1] + 1300} className="map-text" textAnchor="middle">Dragon</text>
      <text x={PITS.baron[0]} y={S - PITS.baron[1] - 950} className="map-text" textAnchor="middle">Baron</text>
    </svg>
  );
}
