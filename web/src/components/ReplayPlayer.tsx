import { motion } from "framer-motion";
import {
  Bug,
  Castle,
  ChevronsRight,
  Crosshair,
  Crown,
  Flame,
  Gem,
  Pause,
  Play,
  RotateCcw,
  Route,
  Skull,
  SkipBack,
  SkipForward,
  Swords,
  Waves,
  X,
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Replay, ReplayEvent, Side } from "../api/types";
import { iconUrl, useCatalog } from "../lib/ddragon";
import { clock } from "../lib/draft";
import { S } from "../lib/map";
import { describeEvent, frameAt, trailOf } from "../lib/replay";
import { categorize, keyEvents, nextEvent, playersAt, scoreAt, sideOfSlot, type Category, type TeamScore } from "../lib/replayStats";
import { ChampIcon, ROLE_SHORT } from "./ChampIcon";
import { MapBase } from "./MapBase";

const Rift3D = lazy(() => import("./Rift3D"));

const ROLE_ORDER = ["top", "jungle", "mid", "adc", "support", "unknown"];
const SPEEDS = [1, 2, 4, 8, 16];
const TRAIL_S = 20;
const RECENT_S = 8;

const ICON: Record<Category, (p: { size: number }) => ReactNode> = {
  kill: (p) => <Swords {...p} />,
  dragon: (p) => <Flame {...p} />,
  baron: (p) => <Crown {...p} />,
  herald: (p) => <Bug {...p} />,
  grubs: (p) => <Bug {...p} />,
  atakhan: (p) => <Skull {...p} />,
  scuttle: (p) => <Waves {...p} />,
  tower: (p) => <Castle {...p} />,
  inhibitor: (p) => <Gem {...p} />,
  nexus: (p) => <Gem {...p} />,
  other: (p) => <ChevronsRight {...p} />,
};

type Filter = "all" | "fights" | "objectives" | "structures";
const FILTERS: { id: Filter; label: string; match: (c: Category) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "fights", label: "Kills", match: (c) => c === "kill" },
  { id: "objectives", label: "Objectives", match: (c) => ["dragon", "baron", "herald", "grubs", "atakhan", "scuttle"].includes(c) },
  { id: "structures", label: "Structures", match: (c) => ["tower", "inhibitor", "nexus"].includes(c) },
];

function toMap(replay: Replay) {
  const [x0, y0, x1, y1] = replay.bounds;
  return (x: number, y: number): [number, number] => [((x - x0) / (x1 - x0)) * S, ((y - y0) / (y1 - y0)) * S];
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <span className="sb-stat" title={label}>
      {icon}
      <b>{value}</b>
    </span>
  );
}

function TeamStats({ s }: { s: TeamScore }) {
  return (
    <div className="sb-stats">
      <Stat icon={<Castle size={14} />} value={s.towers} label="Towers" />
      <Stat icon={<Gem size={14} />} value={s.inhibitors} label="Inhibitors" />
      <Stat icon={<Flame size={14} />} value={s.dragons} label="Dragons" />
      <Stat icon={<Bug size={14} />} value={s.grubs + s.heralds} label="Grubs and Herald" />
      <Stat icon={<Crown size={14} />} value={s.barons} label="Barons" />
    </div>
  );
}

function Scoreboard({ replay, t, ended }: { replay: Replay; t: number; ended: boolean }) {
  const s = scoreAt(replay, t);
  const team = (side: Side) => (
    <div className={`sb-team ${side}`}>
      <div className="sb-name">
        <span className={`side-dot ${side}`} aria-hidden />
        {side === "blue" ? replay.blue_team : replay.red_team}
        {replay.winner_side === side && ended && <span className="result us">Won</span>}
      </div>
      <TeamStats s={s[side]} />
    </div>
  );
  return (
    <div className="scoreboard" aria-label={`Score at ${clock(t)}: ${s.blue.kills} to ${s.red.kills}`}>
      {team("blue")}
      <div className="sb-center">
        <span className="sb-kills blue">{s.blue.kills}</span>
        <span className="sb-clock">{clock(t)}</span>
        <span className="sb-kills red">{s.red.kills}</span>
      </div>
      {team("red")}
    </div>
  );
}

interface Props {
  replay: Replay;
  /** Game second to start at, e.g. the trigger of a tell. */
  startAt?: number;
}

export function ReplayPlayer({ replay, startAt = 0 }: Props) {
  const catalog = useCatalog();
  const last = Math.max(replay.positions.length - 1, 1);
  const [t, setT] = useState(() => Math.min(Math.max(startAt, 0), last));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [trails, setTrails] = useState(true);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [follow, setFollow] = useState<number | null>(null);
  const [tab, setTab] = useState<"players" | "moments">("players");
  const [filter, setFilter] = useState<Filter>("all");
  const raf = useRef(0);
  const prev = useRef(0);
  const feedRef = useRef<HTMLOListElement>(null);
  const toXY = useMemo(() => toMap(replay), [replay]);
  const events = useMemo(() => keyEvents(replay), [replay]);

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

  const seek = useCallback((to: number) => setT(Math.min(Math.max(to, 0), last)), [last]);
  const frame = frameAt(replay, t);
  const states = playersAt(replay, t);
  const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]) as (typeof FILTERS)[number];
  const shown = events.filter((e) => match.match(categorize(e)));
  const currentIdx = shown.reduce((acc, e, i) => (e.t <= t ? i : acc), -1);
  const recentKills = events.filter((e) => e.kind === "kill" && e.x !== null && e.y !== null && t >= e.t && t - e.t <= RECENT_S);
  const colour = (side: string) => (side === "blue" ? "var(--side-blue)" : "var(--side-red)");
  const champOf = (slot: number | null) => replay.players.find((p) => p.slot === slot)?.champion ?? null;
  const followed = replay.players.find((p) => p.slot === follow);

  // keep the current moment in view while playing, without scrolling the page
  useEffect(() => {
    const list = feedRef.current;
    const item = list?.querySelector<HTMLElement>("[data-current='true']");
    if (list && item && tab === "moments") list.scrollTop = item.offsetTop - list.clientHeight / 2;
  }, [currentIdx, tab]);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
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
    } else if (e.key === "n") {
      const nx = nextEvent(events, t);
      if (nx) seek(Math.max(nx.t - 4, 0));
    }
  };
  const summary = `${replay.blue_team} (blue) against ${replay.red_team} (red) at ${clock(t)}`;

  return (
    <div className="rp" onKeyDown={onKey}>
      <Scoreboard replay={replay} t={t} ended={t >= last - 1} />

      <div className="rp-main">
        <div className="replay-stage" tabIndex={0} aria-label={`${summary}. Space plays or pauses, arrows move 5 seconds (shift 30), N jumps to the next moment.`}>
          {view === "3d" ? (
            <Suspense fallback={<div className="rift3d rift3d-loading">Loading the 3D Rift…</div>}>
              <Rift3D catalog={catalog} replay={replay} t={t} trails={trails} follow={follow} className="replay-3d" />
            </Suspense>
          ) : (
            <MapBase label={summary} className="rift replay-map" labels={false}>
              {trails &&
                replay.players.map((p) => {
                  const pts = trailOf(replay, p.slot, t, TRAIL_S);
                  if (pts.length < 2) return null;
                  const line = pts
                    .map((q) => {
                      const [x, y] = toXY(q.x, q.y);
                      return `${x},${S - y}`;
                    })
                    .join(" ");
                  return <polyline key={`tr-${p.slot}`} points={line} fill="none" stroke={colour(p.side)} strokeOpacity={0.45} strokeWidth={90} strokeLinecap="round" strokeLinejoin="round" />;
                })}
              {recentKills.map((e) => {
                const [x, y] = toXY(e.x as number, e.y as number);
                return <circle key={`k-${e.t}-${e.slot}`} cx={x} cy={S - y} r={520 + (t - e.t) * 70} fill="none" stroke="var(--critical)" strokeWidth={90} opacity={1 - (t - e.t) / RECENT_S} />;
              })}
              {replay.players.map((p, i) => {
                const at = frame[i];
                if (!at) return null;
                const [x, y] = toXY(at.x, at.y);
                const src = p.champion ? iconUrl(catalog, p.champion) : null;
                const dead = states[p.slot]?.dead;
                return (
                  <g key={p.slot} transform={`translate(${x} ${S - y})`} opacity={dead ? 0.35 : 1}>
                    <circle r={follow === p.slot ? 470 : 400} fill={follow === p.slot ? "#ffe066" : colour(p.side)} stroke="var(--surface)" strokeWidth={90} />
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
          {followed && (
            <div className="follow-badge">
              <Crosshair size={14} aria-hidden /> Following {followed.name}
              <button type="button" aria-label="Stop following" onClick={() => setFollow(null)}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <aside className="rp-side">
          <div className="rp-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "players"} onClick={() => setTab("players")}>
              Players
            </button>
            <button type="button" role="tab" aria-selected={tab === "moments"} onClick={() => setTab("moments")}>
              Key moments <span className="count">{events.filter((e) => e.t <= t).length}</span>
            </button>
          </div>

          {tab === "players" ? (
            <div className="rp-players">
              {(["blue", "red"] as const).map((side) => (
                <div key={side} className={`rp-team ${side}`}>
                  <div className="rp-team-head">
                    <span className={`side-dot ${side}`} aria-hidden /> {side === "blue" ? replay.blue_team : replay.red_team}
                  </div>
                  {replay.players
                    .filter((p) => p.side === side)
                    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
                    .map((p) => {
                      const st = states[p.slot];
                      const on = follow === p.slot;
                      return (
                        <div key={p.slot} className={`rp-player ${st?.dead ? "dead" : ""} ${on ? "followed" : ""}`}>
                          <span className="role-tag">{ROLE_SHORT[p.role]}</span>
                          <span className="rp-portrait">
                            <ChampIcon name={p.champion} size={36} />
                            {st?.dead && <span className="rp-respawn">{st.respawnIn ?? "†"}</span>}
                          </span>
                          <span className="rp-pname">
                            <b>{p.name}</b>
                            <small>{p.champion ?? "—"}</small>
                          </span>
                          <span className="rp-kd" title="Kills / deaths so far">
                            {st?.kills ?? 0}/{st?.deaths ?? 0}
                          </span>
                          <button
                            type="button"
                            className={`rp-follow ${on ? "on" : ""}`}
                            aria-pressed={on}
                            title={on ? "Stop following" : `Follow ${p.name}`}
                            onClick={() => {
                              setFollow(on ? null : p.slot);
                              setView("3d");
                            }}
                          >
                            <Crosshair size={15} aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="chips rp-filters">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <ol className="rp-feed" ref={feedRef}>
                {shown.map((e, i) => (
                  <Moment key={`${e.kind}-${e.t}-${e.slot}-${e.target_slot}-${e.name}`} e={e} replay={replay} past={e.t <= t} current={i === currentIdx} champOf={champOf} onSeek={() => seek(Math.max(e.t - 5, 0))} />
                ))}
                {shown.length === 0 && <li className="muted">Nothing recorded.</li>}
              </ol>
            </>
          )}
        </aside>
      </div>

      <Transport
        t={t}
        last={last}
        playing={playing}
        speed={speed}
        trails={trails}
        events={events}
        replay={replay}
        onPlay={() => (t >= last ? (seek(0), setPlaying(true)) : setPlaying((p) => !p))}
        onSeek={seek}
        onSpeed={setSpeed}
        onTrails={() => setTrails((v) => !v)}
        onNext={() => {
          const nx = nextEvent(events, t);
          if (nx) seek(Math.max(nx.t - 4, 0));
        }}
      />
    </div>
  );
}

function Moment({ e, replay, past, current, champOf, onSeek }: { e: ReplayEvent; replay: Replay; past: boolean; current: boolean; champOf: (s: number | null) => string | null; onSeek: () => void }) {
  const cat = categorize(e);
  const side = sideOfSlot(replay, e.slot);
  return (
    <li className={`moment ${past ? "past" : ""} ${current ? "current" : ""}`} data-current={current}>
      <button type="button" onClick={onSeek}>
        <span className="m-t">{clock(e.t)}</span>
        <span className={`m-icon ${side ?? ""} ${cat}`}>{ICON[cat]({ size: 14 })}</span>
        <span className="m-who">
          <ChampIcon name={champOf(e.slot)} size={24} />
          {e.kind === "kill" && (
            <>
              <span className="m-arrow">›</span>
              <ChampIcon name={champOf(e.target_slot)} size={24} state="banned" />
            </>
          )}
        </span>
        <span className="m-text">{describeEvent(replay, e)}</span>
      </button>
    </li>
  );
}

interface TransportProps {
  t: number;
  last: number;
  playing: boolean;
  speed: number;
  trails: boolean;
  events: ReplayEvent[];
  replay: Replay;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: number) => void;
  onTrails: () => void;
  onNext: () => void;
}

function Transport({ t, last, playing, speed, trails, events, replay, onPlay, onSeek, onSpeed, onTrails, onNext }: TransportProps) {
  return (
    <div className="transport">
      <div className="tp-buttons">
        <button type="button" className="tp-btn" title="Back 10 s" onClick={() => onSeek(t - 10)}>
          <SkipBack size={16} />
        </button>
        <motion.button type="button" className="tp-play" whileTap={{ scale: 0.92 }} onClick={onPlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={20} /> : t >= last ? <RotateCcw size={20} /> : <Play size={20} />}
        </motion.button>
        <button type="button" className="tp-btn" title="Forward 10 s" onClick={() => onSeek(t + 10)}>
          <SkipForward size={16} />
        </button>
        <button type="button" className="tp-btn wide" title="Next key moment (N)" onClick={onNext}>
          <ChevronsRight size={16} /> Next moment
        </button>
      </div>
      <div className="tp-track">
        <input type="range" min={0} max={last} step={1} value={Math.round(t)} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Game time" style={{ ["--p" as string]: `${(t / last) * 100}%` }} />
        <div className="tp-marks">
          {events.map((e) => {
            const cat = categorize(e);
            const side = sideOfSlot(replay, e.slot);
            const big = cat !== "kill" && cat !== "scuttle";
            return (
              <button
                key={`${e.kind}-${e.t}-${e.slot}-${e.name}`}
                type="button"
                className={`tp-mark ${side ?? ""} ${big ? "big" : ""}`}
                style={{ left: `${(e.t / last) * 100}%` }}
                title={`${clock(e.t)} · ${describeEvent(replay, e)}`}
                aria-label={`${clock(e.t)} ${describeEvent(replay, e)}`}
                onClick={() => onSeek(Math.max(e.t - 5, 0))}
              />
            );
          })}
        </div>
        <div className="tp-times">
          <span>{clock(t)}</span>
          <span>{clock(last)}</span>
        </div>
      </div>
      <div className="tp-right">
        <div className="seg" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => onSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button type="button" className={`tp-btn ${trails ? "on" : ""}`} aria-pressed={trails} title="Movement trails" onClick={onTrails}>
          <Route size={16} />
        </button>
      </div>
    </div>
  );
}
