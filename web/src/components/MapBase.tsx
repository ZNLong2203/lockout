import { useId, type ReactNode } from "react";
import { mapUrl, useCatalog } from "../lib/ddragon";
import { CAMPS, LANES, PITS, RIVER, S, SUM, structures, type Structure } from "../lib/map";
import { MAP_EXTENT } from "../lib/terrain";

interface Props {
  label: string;
  /** Drawn on top of the map, in game units (y is flipped). */
  children?: ReactNode;
  className?: string;
  /** Camp and pit names. */
  labels?: boolean;
}

const CAMP_LABEL: Record<string, string> = { blue_buff: "Blue", gromp: "Gromp", wolves: "Wolves", raptors: "Raptors", red_buff: "Red", krugs: "Krugs" };
const sideColor = (s: "blue" | "red") => (s === "blue" ? "var(--side-blue)" : "var(--side-red)");

function StructureIcon({ st }: { st: Structure }) {
  const cx = st.x;
  const cy = S - st.y;
  const c = sideColor(st.side);
  if (st.kind === "nexus") {
    const r = 620;
    const pts = Array.from({ length: 6 }, (_, i) => `${cx + r * Math.cos((Math.PI / 3) * i + Math.PI / 6)},${cy + r * Math.sin((Math.PI / 3) * i + Math.PI / 6)}`).join(" ");
    return (
      <g>
        <polygon points={pts} fill={c} stroke="#0b1220" strokeWidth={110} />
        <polygon points={`${cx},${cy - 300} ${cx + 220},${cy} ${cx},${cy + 300} ${cx - 220},${cy}`} fill="#fff" opacity={0.9} />
      </g>
    );
  }
  if (st.kind === "inhibitor") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={330} fill="#0b1220" stroke={c} strokeWidth={90} />
        <polygon points={`${cx},${cy - 230} ${cx + 150},${cy} ${cx},${cy + 230} ${cx - 150},${cy}`} fill={c} />
      </g>
    );
  }
  // turret (and nexus turret): a small shield
  const w = st.kind === "nexus_turret" ? 230 : 200;
  return (
    <path
      d={`M ${cx - w} ${cy - w} L ${cx + w} ${cy - w} L ${cx + w} ${cy + w * 0.2} L ${cx} ${cy + w * 1.25} L ${cx - w} ${cy + w * 0.2} Z`}
      fill={c}
      stroke="#0b1220"
      strokeWidth={80}
    />
  );
}

/** Summoner's Rift in 2D: Riot's minimap (Data Dragon, loaded at runtime) under our own markers; a drawn fallback offline. */
export function MapBase({ label, children, className = "rift", labels = true }: Props) {
  const gid = useId();
  const url = mapUrl(useCatalog());
  const list = structures();
  return (
    <svg className={className} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${gid}-bg`} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#16202e" />
          <stop offset="100%" stopColor="#0a0f18" />
        </radialGradient>
        <filter id={`${gid}-map`}>
          <feColorMatrix type="saturate" values="0.75" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.72" />
            <feFuncG type="linear" slope="0.78" />
            <feFuncB type="linear" slope="0.86" />
          </feComponentTransfer>
        </filter>
      </defs>
      <rect width={S} height={S} rx={900} fill={`url(#${gid}-bg)`} />
      {url ? (
        <image href={url} x={0} y={S - MAP_EXTENT[1]} width={MAP_EXTENT[0]} height={MAP_EXTENT[1]} preserveAspectRatio="none" filter={`url(#${gid}-map)`} />
      ) : (
        <>
          <polyline points={RIVER.map(([x, y]) => `${x},${S - y}`).join(" ")} fill="none" stroke="var(--river)" strokeWidth={1500} strokeLinecap="round" />
          {Object.entries(LANES).map(([lane, pts]) => (
            <polyline key={lane} points={pts.map(([x, y]) => `${x},${S - y}`).join(" ")} fill="none" stroke="var(--lane)" strokeWidth={650} strokeLinecap="round" />
          ))}
        </>
      )}
      {(["blue", "red"] as const).flatMap((sd) =>
        Object.entries(CAMPS).map(([name, [x, y]]) => {
          const [gx, gy] = sd === "blue" ? [x, y] : [SUM[0] - x, SUM[1] - y];
          const buff = name === "blue_buff" || name === "red_buff";
          return (
            <g key={`${sd}-${name}`} className="camp2d">
              <circle cx={gx} cy={S - gy} r={buff ? 230 : 170} fill={buff ? (name === "blue_buff" ? "#4aa3ff" : "#ff7a45") : "#e8c46a"} stroke="#0b1220" strokeWidth={70} />
              {labels && (
                <text x={gx} y={S - gy - 330} className="map-camp" textAnchor="middle">
                  {CAMP_LABEL[name]}
                </text>
              )}
            </g>
          );
        }),
      )}
      {(["dragon", "baron"] as const).map((pit) => (
        <g key={pit}>
          <circle cx={PITS[pit][0]} cy={S - PITS[pit][1]} r={520} fill="none" stroke="#c79bff" strokeWidth={110} />
          {labels && (
            <text x={PITS[pit][0]} y={S - PITS[pit][1] + (pit === "dragon" ? 1050 : -720)} className="map-pit" textAnchor="middle">
              {pit === "dragon" ? "Dragon" : "Baron"}
            </text>
          )}
        </g>
      ))}
      {list.map((st, i) => (
        <StructureIcon key={i} st={st} />
      ))}
      {children}
    </svg>
  );
}
