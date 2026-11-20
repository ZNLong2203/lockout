import type { JungleBridge } from "../api/types";
import { pct, type Side } from "../lib/draft";
import { CAMPS, LANES, LANE_LABEL, P, S, TOP_SIDE, mirror } from "../lib/map";
import { MapBase } from "./MapBase";

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
      <MapBase label={bridge ? `Map: ${bridge.champion} opens ${pct(bridge.start_top)} top-side` : "Map"}>
        {bridge &&
          Object.entries(LANES).map(([lane, pts]) => {
            const share = bridge.first_lane[lane] ?? 0;
            return share > 0 ? (
              <polyline key={`hl-${lane}`} points={pts.map(P).join(" ")} fill="none" stroke="var(--side-them)" strokeOpacity={0.25 + share} strokeWidth={250 + share * 900} strokeLinecap="round" strokeLinejoin="round" />
            ) : null;
          })}
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
      </MapBase>
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
