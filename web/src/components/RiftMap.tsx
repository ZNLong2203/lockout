import type { JungleBridge } from "../api/types";
import { pct, type Side } from "../lib/draft";

// Our own stylised Summoner's Rift, drawn from geometry measured in the GRID data (src/macrodna/geometry.py).
// No Riot map art is used.
const S = 15000;
const LANES: Record<string, [number, number][]> = {
  top: [[1444, 3768], [1374, 4450], [1472, 7032], [1254, 10615], [1500, 13300], [4171, 13608], [7670, 13457], [10320, 13541], [10964, 13363]],
  mid: [[3205, 3342], [3681, 3785], [5191, 5147], [6295, 6666], [8583, 8156], [9649, 9729], [11101, 11053], [11710, 11451]],
  bot: [[3701, 1453], [4409, 1366], [7193, 1426], [10650, 1293], [13300, 1500], [13596, 4368], [13385, 7906], [13464, 10392], [13327, 11049]],
};
const CAMPS: Record<string, [number, number]> = {
  blue_buff: [3800, 7900], gromp: [2100, 8400], wolves: [3800, 6500],
  raptors: [6900, 5400], red_buff: [7800, 4000], krugs: [8400, 2700],
};
const TOP_SIDE = new Set(["blue_buff", "gromp", "wolves"]);
const SUM: [number, number] = [14848, 14688];
const LANE_LABEL: Record<string, [number, number]> = { top: [2300, 12600], mid: [7900, 7000], bot: [12500, 2300] };

const P = ([x, y]: [number, number]) => `${x},${S - y}`;
const mirror = ([x, y]: [number, number], side: Side): [number, number] => (side === "blue" ? [x, y] : [SUM[0] - x, SUM[1] - y]);

interface Props {
  bridge: JungleBridge | undefined;
  side: Side; // the opponent's side in the game being drafted
  jungleOptions: string[];
  onChoose: (champion: string) => void;
}

export function RiftMap({ bridge, side, jungleOptions, onChoose }: Props) {
  return (
    <section className="card" aria-label="Jungle opening on the map">
      <h2>Their jungler on the map</h2>
      <p className="sub">Where they opened and which lane saw them first, for the champion you choose.</p>
      <div className="chips">
        {jungleOptions.map((c) => (
          <button key={c} type="button" className={`chip ${bridge?.champion === c ? "on" : ""}`} onClick={() => onChoose(c)}>
            {c}
          </button>
        ))}
      </div>
      <svg className="rift" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={bridge ? `Map: ${bridge.champion} opens ${pct(bridge.start_top)} top-side` : "Map"}>
        <defs>
          <radialGradient id="rift-bg" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="var(--map-1)" />
            <stop offset="100%" stopColor="var(--map-2)" />
          </radialGradient>
        </defs>
        <rect width={S} height={S} rx={900} fill="url(#rift-bg)" />
        <polyline points={[[1900, 12500], [4900, 10000], [7400, 7350], [10000, 4800], [12900, 2200]].map((p) => P(p as [number, number])).join(" ")} fill="none" stroke="var(--river)" strokeWidth={1500} strokeLinecap="round" strokeLinejoin="round" />
        {Object.entries(LANES).map(([lane, pts]) => (
          <polyline key={lane} points={pts.map(P).join(" ")} fill="none" stroke="var(--lane)" strokeWidth={650} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {bridge &&
          Object.entries(LANES).map(([lane, pts]) => {
            const share = bridge.first_lane[lane] ?? 0;
            return share > 0 ? (
              <polyline key={`hl-${lane}`} points={pts.map(P).join(" ")} fill="none" stroke="var(--side-them)" strokeOpacity={0.25 + share} strokeWidth={250 + share * 900} strokeLinecap="round" strokeLinejoin="round" />
            ) : null;
          })}
        <circle cx={1774} cy={S - 1598} r={1100} fill="var(--side-blue)" opacity={0.85} />
        <circle cx={13074} cy={S - 13090} r={1100} fill="var(--side-red)" opacity={0.85} />
        <circle cx={10020} cy={S - 4790} r={650} fill="var(--pit)" />
        <circle cx={4970} cy={S - 10290} r={700} fill="var(--pit)" />
        <text x={10020} y={S - 4790 + 1300} className="map-text" textAnchor="middle">Dragon</text>
        <text x={4970} y={S - 10290 - 950} className="map-text" textAnchor="middle">Baron</text>
        {Object.entries(CAMPS).map(([camp, xy]) => {
          const [x, y] = mirror(xy, side);
          const onStart = bridge ? (TOP_SIDE.has(camp) ? bridge.start_top : bridge.start_bot) : 0;
          return <circle key={camp} cx={x} cy={S - y} r={260 + onStart * 420} fill="var(--side-them)" opacity={0.3 + onStart * 0.7} stroke="var(--map-2)" strokeWidth={120} />;
        })}
        {bridge &&
          Object.entries(LANE_LABEL).map(([lane, xy]) => (
            <g key={`lbl-${lane}`}>
              <rect x={xy[0] - 1150} y={S - xy[1] - 620} width={2300} height={900} rx={300} fill="var(--surface)" opacity={0.92} />
              <text x={xy[0]} y={S - xy[1]} className="map-label" textAnchor="middle">
                {lane} {pct(bridge.first_lane[lane] ?? 0)}
              </text>
            </g>
          ))}
      </svg>
      {bridge ? (
        <p className="map-caption">
          <b>{bridge.champion}</b>: opened top-side {pct(bridge.start_top)} · bot-side {pct(bridge.start_bot)}. Bigger camp dots = the side they
          start on; thicker lane = where they were seen first. <span className="muted">n = {bridge.n}, {bridge.scope === "team" ? "this team" : "league-wide"}.</span>
        </p>
      ) : (
        <p className="muted">No history for this champion.</p>
      )}
    </section>
  );
}
