import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Replay } from "../api/types";
import { clock } from "../lib/draft";
import { P, S } from "../lib/map";
import { EVENT_KIND_LABEL, KEY_EVENTS, describeEvent, frameAt, trailOf } from "../lib/replay";
import { iconUrl, useCatalog } from "../lib/ddragon";
import { ChampIcon, ROLE_SHORT } from "./ChampIcon";
import { MapBase } from "./MapBase";

const Rift3D = lazy(() => import("./Rift3D"));

const ROLE_ORDER = ["top", "jungle", "mid", "adc", "support", "unknown"];

const SPEEDS = [1, 2, 4, 8, 16];
const TRAIL_S = 20;
const RECENT_S = 8; // how long a kill ring stays on the map

interface Props {
  replay: Replay;
  /** Game second to start at, e.g. the trigger of a tell. */
  startAt?: number;
}

/** Scale the replay's own bounds onto the map square, so a different frame still lines up. */
function toMap(replay: Replay) {
  const [x0, y0, x1, y1] = replay.bounds;
  return (x: number, y: number): [number, number] => [((x - x0) / (x1 - x0)) * S, ((y - y0) / (y1 - y0)) * S];
}

export function ReplayPlayer({ replay, startAt = 0 }: Props) {
  const last = Math.max(replay.positions.length - 1, 1);
  const [t, setT] = useState(() => Math.min(Math.max(startAt, 0), last));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [trails, setTrails] = useState(true);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const raf = useRef(0);
  const prev = useRef(0);
  const toXY = useMemo(() => toMap(replay), [replay]);

  useEffect(() => setT(Math.min(Math.max(startAt, 0), last)), [startAt, last, replay]);

  useEffect(() => {
    if (!playing) return;
    prev.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev.current) / 1000;
      prev.current = now;
      setT((cur) => {
        const next = cur + dt * speed;
        if (next >= last) {
          setPlaying(false);
          return last;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, last]);

  const seek = useCallback((s: number) => setT(Math.min(Math.max(s, 0), last)), [last]);
  const frame = useMemo(() => frameAt(replay, t), [replay, t]);
  const keyEvents = useMemo(() => replay.events.filter((e) => KEY_EVENTS.has(e.kind)), [replay]);
  const recentKills = keyEvents.filter((e) => e.kind === "kill" && e.x !== null && e.y !== null && t >= e.t && t - e.t <= RECENT_S);
  const colour = (side: string) => (side === "blue" ? "var(--side-blue)" : "var(--side-red)");

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === " ") {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seek(t + step);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seek(t - step);
    }
  };

  const catalog = useCatalog();
  const summary = `${replay.blue_team} (blue) against ${replay.red_team} (red) at ${clock(t)}`;
  // The feed has no video. For a real game, search the official broadcast on YouTube; nothing is embedded.
  const vodQuery = [replay.blue_team, "vs", replay.red_team, replay.event ?? "", replay.started_at?.slice(0, 10) ?? "", replay.game_number ? `game ${replay.game_number}` : ""]
    .filter(Boolean)
    .join(" ");
  const vodUrl = replay.game_id.startsWith("demo") ? null : `https://www.youtube.com/results?search_query=${encodeURIComponent(vodQuery)}`;
  return (
    <div className="replay">
      <div className="replay-stage" tabIndex={0} onKeyDown={onKey} aria-label={`${summary}. Space plays or pauses, arrow keys move 5 seconds, shift 30 seconds.`}>
        {view === "3d" ? (
          <Suspense fallback={<div className="rift3d rift3d-loading">Loading the 3D Rift…</div>}>
            <Rift3D catalog={catalog} replay={replay} t={t} trails={trails} className="replay-3d" />
          </Suspense>
        ) : (
        <MapBase label={summary} className="rift replay-map" labels={false}>
            {trails &&
              replay.players.map((p) => {
                const pts = trailOf(replay, p.slot, t, TRAIL_S);
                if (pts.length < 2) return null;
                return (
                  <polyline
                    key={`tr-${p.slot}`}
                    points={pts.map((q) => P(toXY(q.x, q.y))).join(" ")}
                    fill="none"
                    stroke={colour(p.side)}
                    strokeOpacity={0.35}
                    strokeWidth={90}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
            {recentKills.map((e) => {
              const [x, y] = toXY(e.x as number, e.y as number);
              return <circle key={`k-${e.t}`} cx={x} cy={S - y} r={520 + (t - e.t) * 70} fill="none" stroke="var(--critical)" strokeWidth={90} opacity={1 - (t - e.t) / RECENT_S} />;
            })}
            {replay.players.map((p) => {
              const at = frame[p.slot];
              if (!at) return null;
              const [x, y] = toXY(at.x, at.y);
              const src = p.champion ? iconUrl(catalog, p.champion) : null;
              return (
                <g key={p.slot} transform={`translate(${x} ${S - y})`}>
                  <circle r={400} fill={colour(p.side)} stroke="var(--surface)" strokeWidth={90} />
                  {src ? (
                    <>
                      <clipPath id={`rp-clip-${p.slot}`} clipPathUnits="userSpaceOnUse">
                        <circle r={320} />
                      </clipPath>
                      <image href={src} x={-320} y={-320} width={640} height={640} clipPath={`url(#rp-clip-${p.slot})`} preserveAspectRatio="xMidYMid slice" />
                    </>
                  ) : (
                    <text className="replay-tag" textAnchor="middle" dy={150}>
                      {ROLE_SHORT[p.role]?.[0] ?? "?"}
                    </text>
                  )}
                  <title>{`${p.name}${p.champion ? ` (${p.champion})` : ""}`}</title>
                </g>
              );
            })}
          </MapBase>
        )}
        <div className="view-toggle" role="radiogroup" aria-label="Map view">
          {(["3d", "2d"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={`chip ${view === v ? "on" : ""}`} onClick={() => setView(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="replay-clock" aria-hidden>
          {clock(t)}
        </div>
      </div>

      <div className="replay-controls">
        <button type="button" onClick={() => (t >= last ? (seek(0), setPlaying(true)) : setPlaying((p) => !p))} aria-pressed={playing}>
          {playing ? "Pause" : t >= last ? "Replay" : "Play"}
        </button>
        <label className="replay-speed">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} /> Trails
        </label>
        <div className="replay-scrub">
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={Math.floor(t)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Game time"
            aria-valuetext={clock(t)}
          />
          <div className="replay-ticks" aria-hidden>
            {keyEvents.map((e) => (
              <i key={`${e.kind}-${e.t}-${e.slot}`} className={`tick ${e.kind}`} style={{ left: `${(e.t / last) * 100}%` }} />
            ))}
          </div>
        </div>
        <span className="replay-time">
          {clock(t)} / {clock(last)}
        </span>
      </div>

      <div className="replay-side">
        <div className="roster" aria-label="Players">
          {(["blue", "red"] as const).map((side) => (
            <div key={side} className={`roster-team ${side}`}>
              <b>
                <span className={`side-dot ${side}`} aria-hidden /> {side === "blue" ? replay.blue_team : replay.red_team}
                {replay.winner_side === side && <span className="result us">Won</span>}
              </b>
              <ul>
                {replay.players
                  .filter((p) => p.side === side)
                  .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
                  .map((p) => (
                    <li key={p.slot}>
                      <span className="role-tag">{ROLE_SHORT[p.role]}</span>
                      <ChampIcon name={p.champion} size={26} />
                      <span>{p.name}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
        {vodUrl && (
          <a className="vod-link" href={vodUrl} target="_blank" rel="noreferrer noopener">
            ▶ Find the official broadcast of this game on YouTube ↗
          </a>
        )}
        <div className="feed">
          <h3 className="h3">Key moments</h3>
          {keyEvents.length === 0 && <p className="muted">No kills or objectives were recorded for this game.</p>}
          <ol>
            {keyEvents.map((e) => (
              <li key={`${e.kind}-${e.t}-${e.slot}-${e.target_slot}`} className={t >= e.t ? "past" : ""}>
                <button type="button" className="link" onClick={() => seek(Math.max(e.t - 5, 0))}>
                  <span className="feed-t">{clock(e.t)}</span>
                  <span className={`feed-k ${e.kind}`}>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</span>
                  {describeEvent(replay, e)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
