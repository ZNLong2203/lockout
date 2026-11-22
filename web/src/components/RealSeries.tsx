import { ChevronLeft, ChevronRight, History, Info, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchSeriesDraft, fetchSeriesList, isLive } from "../api/client";
import type { ContextTeam, SeriesDraft, SeriesSummary } from "../api/types";
import type { CallRate } from "../lib/copilot";
import { ORDER, pct } from "../lib/draft";
import { advanceReplay, type ReplayState } from "../lib/seriesReplay";
import { TeamBadge } from "./TeamSearch";

/** Finished real series of our team (head-to-head first) to replay in the draft room. */
export function RealSeriesPicker({ ours, opponent, onPick, onClose }: { ours: ContextTeam; opponent: ContextTeam; onPick: (d: SeriesDraft) => void; onClose: () => void }) {
  const [h2h, setH2h] = useState<SeriesSummary[] | null>(null);
  const [mine, setMine] = useState<SeriesSummary[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSeriesList(ours.team_id, opponent.team_id)
      .then((x) => alive && setH2h(x.filter((s) => s.games >= 2)))
      .catch(() => alive && setH2h([]));
    fetchSeriesList(ours.team_id)
      .then((x) => alive && setMine(x.filter((s) => s.games >= 2)))
      .catch(() => alive && setMine([]));
    return () => {
      alive = false;
    };
  }, [ours.team_id, opponent.team_id]);

  const open = (s: SeriesSummary) => {
    setLoading(s.series_id);
    setError(null);
    fetchSeriesDraft(s.series_id, ours.team_id)
      .then(onPick)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the series"))
      .finally(() => setLoading(null));
  };
  const others = (mine ?? []).filter((s) => !(h2h ?? []).some((h) => h.series_id === s.series_id)).slice(0, 12);

  return (
    <section className="card rs-picker" aria-label="Replay a real series">
      <div className="rs-head">
        <div>
          <h2>
            <History size={18} aria-hidden /> Replay a real series
          </h2>
          <p className="sub">
            Step through a finished series draft by draft. At every step the co-pilot only knows what was known before it: pools, lineups and league
            meta as of game 1. You see whether the real choice was in its top three.
          </p>
        </div>
        <button type="button" className="ghost icon" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      <SeriesList title={`${ours.name} vs ${opponent.name}`} rows={h2h} loading={loading} onOpen={open} empty="No finished series between these two teams in the data." />
      <SeriesList title={`Other series of ${ours.name}`} rows={mine === null ? null : others} loading={loading} onOpen={open} empty="No other series." />
    </section>
  );
}

function SeriesList({ title, rows, loading, onOpen, empty }: { title: string; rows: SeriesSummary[] | null; loading: string | null; onOpen: (s: SeriesSummary) => void; empty: string }) {
  return (
    <div className="rs-list">
      <h3 className="h3">{title}</h3>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((s) => {
            const [a, b] = s.teams;
            return (
              <li key={s.series_id}>
                <span className="rs-date">{s.date}</span>
                <span className="rs-teams">
                  {a && <TeamBadge team={a} size={20} />} <b>{a?.name}</b>
                  <span className="rs-score">
                    {a?.wins}–{b?.wins}
                  </span>
                  <b>{b?.name}</b> {b && <TeamBadge team={b} size={20} />}
                </span>
                <span className="muted rs-event">
                  {s.event} · Bo{s.format}
                </span>
                <button type="button" onClick={() => onOpen(s)} disabled={loading !== null}>
                  {loading === s.series_id ? "Loading…" : "Replay"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Transport for a real-series replay, with keyboard control (← → step, space play, Esc exit). */
export function RealSeriesBar({ replay, calls, onChange, onExit }: { replay: ReplayState; calls: CallRate; onChange: (r: ReplayState) => void; onExit: () => void }) {
  const { series, notes } = replay.draft;
  const [a, b] = series.teams;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") onChange(advanceReplay({ ...replay, playing: false }, 1));
      else if (e.key === "ArrowLeft") onChange(advanceReplay({ ...replay, playing: false }, -1));
      else if (e.key === " ") {
        e.preventDefault();
        onChange({ ...replay, playing: !replay.playing });
      } else if (e.key === "Escape") onExit();
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, onChange, onExit]);

  const atEnd = replay.gi === replay.truth.length - 1 && replay.step >= ORDER.length;
  return (
    <div className="rs-bar" role="region" aria-label="Real series replay">
      <div className="rs-title">
        <History size={16} aria-hidden />
        {a && <TeamBadge team={a} size={22} />}
        <b>{a?.name}</b>
        <span className="rs-score">
          {a?.wins}–{b?.wins}
        </span>
        <b>{b?.name}</b>
        {b && <TeamBadge team={b} size={22} />}
        <span className="muted">
          {series.event} · {series.date}
        </span>
        <span className="rs-info" title={notes.join("\n")}>
          <Info size={14} aria-label="How this replay avoids look-ahead" />
        </span>
      </div>
      <div className="rs-controls">
        <button type="button" className="ghost icon" title="Previous game" onClick={() => onChange({ ...replay, gi: Math.max(0, replay.gi - 1), step: 0, playing: false })} disabled={replay.gi === 0}>
          <SkipBack size={16} />
        </button>
        <button type="button" className="ghost icon" title="Step back (←)" onClick={() => onChange(advanceReplay({ ...replay, playing: false }, -1))}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="play" title="Play / pause (space)" onClick={() => onChange(atEnd ? { ...replay, gi: 0, step: 0, playing: true } : { ...replay, playing: !replay.playing })}>
          {replay.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className="ghost icon" title="Step forward (→)" onClick={() => onChange(advanceReplay({ ...replay, playing: false }, 1))} disabled={atEnd}>
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          className="ghost icon"
          title="Next game"
          onClick={() => onChange({ ...replay, gi: Math.min(replay.truth.length - 1, replay.gi + 1), step: 0, playing: false })}
          disabled={replay.gi >= replay.truth.length - 1}
        >
          <SkipForward size={16} />
        </button>
        <span className="rs-pos">
          Game {replay.gi + 1}/{replay.truth.length} · step {Math.min(replay.step, ORDER.length)}/20
        </span>
        {calls.total > 0 && (
          <span className="rs-calls" title="Revealed steps where the real choice was in the co-pilot's top three">
            Co-pilot top 3 <b>{calls.hits}</b>/{calls.total} ({pct(calls.hits / calls.total)}) · top 10 <b>{calls.hits10}</b> ({pct(calls.hits10 / calls.total)})
            {!isLive && <span className="demo-tag" title="The demo series and pools are invented, so this rate says nothing about real drafts. On real series: 40% top 3, 73% top 10 (README).">demo data</span>}
          </span>
        )}
        <button type="button" className="ghost" onClick={onExit}>
          Exit replay
        </button>
      </div>
    </div>
  );
}
