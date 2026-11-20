import { Suspense, lazy, useState } from "react";
import type { JungleBridge } from "../api/types";
import { useCatalog } from "../lib/ddragon";
import { clock, pct, type Side } from "../lib/draft";
import { Eye, Lock } from "lucide-react";
import { ChampIcon } from "./ChampIcon";
import { CAMPS, LANES, LANE_LABEL, P, S, TOP_SIDE, mirror } from "../lib/map";
import { MapBase } from "./MapBase";

const Rift3D = lazy(() => import("./Rift3D"));

interface Props {
  bridge: JungleBridge | undefined;
  side: Side; // the opponent's side in the game being drafted
  jungleOptions: string[];
  bridges: Record<string, JungleBridge>;
  onChoose: (champion: string) => void;
  /** The jungle champion the opponent has locked in this draft, if any. */
  locked?: string | null;
  jungler?: string;
}

export function RiftMap({ bridge, side, jungleOptions, bridges, onChoose, locked, jungler }: Props) {
  const catalog = useCatalog();
  const [view, setView] = useState<"3d" | "2d">("3d");
  const lane = bridge ? (Object.entries(bridge.first_lane).sort((a, b) => b[1] - a[1])[0] ?? null) : null;
  const options = locked && !jungleOptions.includes(locked) && bridges[locked] ? [locked, ...jungleOptions] : jungleOptions;
  return (
    <section className="card jungle-card" aria-label="Jungle opening on the map">
      <div className="jungle-head">
        <div>
          <h2>Their jungler on the map</h2>
          <p className="sub">
            {jungler ? `${jungler}'s` : "The jungler's"} opening with each champion still open to them. {locked ? "Following their pick." : "Pick a champion."}
          </p>
        </div>
        {locked && bridge?.champion === locked && (
          <span className="locked-chip">
            <Lock size={12} aria-hidden /> Locked in this draft
          </span>
        )}
      </div>
      <div className="jg-chips" role="radiogroup" aria-label="Jungle champion">
        {options.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={bridge?.champion === c} className={`jg-chip ${bridge?.champion === c ? "on" : ""}`} onClick={() => onChoose(c)}>
            <ChampIcon name={c} size={24} />
            <span>{c}</span>
            <small>n={bridges[c]?.n ?? 0}</small>
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
      {bridge && lane ? (
        <>
          <OpeningTimeline bridge={bridge} lane={lane} />
          <p className="map-caption">
            <b>{bridge.champion}</b>: starts {bridge.start_bot >= bridge.start_top ? "bot-side" : "top-side"} in {pct(Math.max(bridge.start_bot, bridge.start_top))} of
            games and shows up first in <b>{lane[0]}</b> ({pct(lane[1])}). Bigger camp dots = the side they start on; brighter lane = where they were seen
            first. <span className="muted">n = {bridge.n}, {bridge.scope === "team" ? "this team" : "league-wide"}{bridge.n < 10 ? ", small sample" : ""}.</span>
          </p>
        </>
      ) : (
        <p className="muted">No history for this champion.</p>
      )}
    </section>
  );
}

/** The first four minutes on one line: start, first lane appearance and a ward window just before it. */
function OpeningTimeline({ bridge, lane }: { bridge: JungleBridge; lane: [string, number] }) {
  const END = 300;
  const t = bridge.median_first_lane_t;
  const ward = t !== null ? Math.max(t - 30, 95) : null;
  const x = (s: number) => `${(Math.min(s, END) / END) * 100}%`;
  const startSide = bridge.start_bot >= bridge.start_top ? "bot" : "top";
  return (
    <div className="opening" aria-label="Opening timeline">
      <div className="op-track">
        <span className="op-tick" style={{ left: x(90) }}>
          <i />
          <em>1:30 camps</em>
          <small>
            starts {startSide} {pct(Math.max(bridge.start_bot, bridge.start_top))}
          </small>
        </span>
        {ward !== null && (
          <span className="op-tick ward" style={{ left: x(ward) }}>
            <i />
            <em>
              <Eye size={11} aria-hidden /> ward by {clock(ward)}
            </em>
            <small>{lane[0]} river</small>
          </span>
        )}
        {t !== null && (
          <span className="op-tick hit" style={{ left: x(t) }}>
            <i />
            <em>~{clock(t)}</em>
            <small>
              first seen {lane[0]} {pct(lane[1])}
            </small>
          </span>
        )}
      </div>
      <div className="op-scale" aria-hidden>
        {[0, 60, 120, 180, 240, 300].map((s) => (
          <span key={s} style={{ left: x(s) }}>
            {clock(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
