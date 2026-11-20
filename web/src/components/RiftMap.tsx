import { Suspense, lazy, useState } from "react";
import type { JungleBridge } from "../api/types";
import { useCatalog } from "../lib/ddragon";
import { pct, type Side } from "../lib/draft";
import { CAMPS, LANES, LANE_LABEL, P, S, TOP_SIDE, mirror } from "../lib/map";
import { MapBase } from "./MapBase";

const Rift3D = lazy(() => import("./Rift3D"));

interface Props {
  bridge: JungleBridge | undefined;
  side: Side; // the opponent's side in the game being drafted
  jungleOptions: string[];
  onChoose: (champion: string) => void;
}

export function RiftMap({ bridge, side, jungleOptions, onChoose }: Props) {
  const catalog = useCatalog();
  const [view, setView] = useState<"3d" | "2d">("3d");
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
      <div className="replay-stage">
        {view === "3d" ? (
          <Suspense fallback={<div className="rift3d rift3d-loading">Loading the 3D Rift…</div>}>
            <Rift3D
              catalog={catalog}
              ambient
              laneGlow={bridge?.first_lane}
              glowSide={bridge ? side : undefined}
              startTop={bridge?.start_top}
              className="jungle-3d"
            />
          </Suspense>
        ) : (
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
        )}
        <div className="view-toggle" role="radiogroup" aria-label="Map view">
          {(["3d", "2d"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={`chip ${view === v ? "on" : ""}`} onClick={() => setView(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        {bridge && view === "3d" && (
          <div className="lane-legend" aria-hidden>
            {(["top", "mid", "bot"] as const).map((l) => (
              <span key={l}>
                {l} <b>{pct(bridge.first_lane[l] ?? 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
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
