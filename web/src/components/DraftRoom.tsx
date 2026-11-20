import { useEffect, useMemo, useState } from "react";
import { fetchBacktest, fetchContext, isLive } from "../api/client";
import type { DraftBacktest, TeamSummary } from "../api/types";
import {
  ORDER,
  analyseTeam,
  emptyDraft,
  lockedBefore,
  nextStep,
  sideOf,
  usedIn,
  type GameDraft,
  type SeriesContext,
} from "../lib/draft";
import { DraftBoard } from "./DraftBoard";
import { Insights } from "./Insights";
import { MatchupPicker, type Matchup } from "./MatchupPicker";
import { TrustPanel } from "./Panels";
import { PlayerPools } from "./PlayerPools";
import { RecentForm } from "./RecentForm";
import { RiftMap } from "./RiftMap";
import { SeriesStrip } from "./SeriesStrip";
import { Tendencies } from "./Tendencies";

const STEPS = [
  ["Series so far", "Champions picked in earlier games are locked for both teams."],
  ["Draft this game", "Click champions in order. Every ban and pick updates the analysis."],
  ["Read what it means", "Bans that bite, picks to protect, and their jungler on the map."],
];

interface Props {
  teams: TeamSummary[];
  matchup: Matchup;
  onMatchup: (m: Matchup) => void;
}

/** The interactive Fearless draft room for one matchup. Kept mounted while other pages are open, so a draft in progress is never lost. */
export function DraftRoom({ teams, matchup, onMatchup }: Props) {
  const [ctx, setCtx] = useState<SeriesContext | null>(null);
  const [games, setGames] = useState<GameDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [jungler, setJungler] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<DraftBacktest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    setError(null);
    fetchContext(matchup.ours, matchup.opponent)
      .then((c) => {
        if (!alive) return;
        setCtx(c);
        const g = c.games.length ? c.games : [emptyDraft(1, "blue")];
        setGames(g);
        setIndex(g.length - 1);
        setJungler(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the series"));
    return () => {
      alive = false;
    };
  }, [matchup.ours, matchup.opponent]);

  useEffect(() => {
    fetchBacktest().then(setBacktest).catch(() => setBacktest(null));
  }, []);

  const game = games[index];
  const view = useMemo(() => {
    if (!ctx || !game) return null;
    const locked = lockedBefore(games, index);
    const used = usedIn(game);
    const bannedNow = new Set(ORDER.map((o, i) => (o.action === "ban" ? game.steps[i] : null)).filter(Boolean) as string[]);
    const unavailable = new Set([...locked, ...used]);
    const them = analyseTeam(ctx.opponent, unavailable);
    const us = analyseTeam(ctx.ours, unavailable);
    const jg = them.find((s) => s.player.role === "jungle");
    const jungleOptions = (jg?.available ?? []).slice(0, 5).map((e) => e.champion).filter((c) => ctx.jungle_bridges[c]);
    return { locked, used, bannedNow, them, us, jungleOptions };
  }, [ctx, games, index, game]);

  const picker = isLive && teams.length > 0 ? <MatchupPicker teams={teams} value={matchup} onChange={onMatchup} /> : null;
  if (error) return <main className="app">{picker}<p className="err card" role="alert">{error}</p></main>;
  if (!ctx || !game || !view) return <main className="app">{picker}<p className="muted">Loading series…</p></main>;

  const update = (g: GameDraft) => setGames(games.map((x, i) => (i === index ? g : x)));
  const onPick = (c: string) => {
    const s = nextStep(game);
    if (s < 0) return;
    const steps = [...game.steps];
    steps[s] = c;
    update({ ...game, steps });
  };
  const onUndo = () => {
    const filled = game.steps.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const last = filled[filled.length - 1];
    if (last === undefined) return;
    const steps = [...game.steps];
    steps[last] = null;
    update({ ...game, steps });
  };
  const onFinish = (winner: "us" | "them") => {
    const done = { ...game, winner };
    const next = emptyDraft(game.number + 1, game.ourSide === "blue" ? "red" : "blue");
    setGames([...games.map((x, i) => (i === index ? done : x)), next]);
    setIndex(games.length);
  };
  const activeJungler = jungler && view.jungleOptions.includes(jungler) ? jungler : (view.jungleOptions[0] ?? null);
  const usWins = games.filter((g) => g.winner === "us").length;
  const themWins = games.filter((g) => g.winner === "them").length;

  return (
    <>
      <header className="hero">
        <div className="app hero-inner">
          <div>
            <div className="brand">Lockout</div>
            <h1>Fearless draft room</h1>
            <p className="hero-sub">Plan a whole series: who runs out of champions first, what to ban, what to save.</p>
          </div>
          <div className="matchup" aria-label="Matchup">
            <div className="matchup-team">
              <span className={`side-dot ${sideOf(game, "us")}`} aria-hidden />
              <b>{ctx.ours.name}</b>
            </div>
            <div className="matchup-score">
              {usWins} – {themWins}
              <span>Game {game.number} · Bo{ctx.format}</span>
            </div>
            <div className="matchup-team">
              <b>{ctx.opponent.name}</b>
              <span className={`side-dot ${sideOf(game, "them")}`} aria-hidden />
            </div>
          </div>
          {!isLive && <span className="badge demo">Demo: synthetic teams and numbers</span>}
        </div>
      </header>

      <main className="app">
        {picker}
        <ol className="how" aria-label="How to use">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="how-n">{i + 1}</span>
              <div>
                <b>{t}</b>
                <div className="muted">{d}</div>
              </div>
            </li>
          ))}
        </ol>

        <SeriesStrip
          ctx={ctx}
          games={games}
          index={index}
          onSelect={setIndex}
          onFinish={onFinish}
          onSwapSide={() => update({ ...game, ourSide: game.ourSide === "blue" ? "red" : "blue" })}
        />

        <DraftBoard ctx={ctx} games={games} index={index} onPick={onPick} onUndo={onUndo} onClear={() => update(emptyDraft(game.number, game.ourSide))} />

        <div className="grid2">
          <Insights ctx={ctx} them={view.them} us={view.us} gameNumber={game.number} jungler={activeJungler} />
          <RiftMap bridge={activeJungler ? ctx.jungle_bridges[activeJungler] : undefined} side={sideOf(game, "them")} jungleOptions={view.jungleOptions} onChoose={setJungler} />
        </div>

        <div className="grid2">
          <PlayerPools title={`${ctx.opponent.name}: comfort picks left`} accent="var(--side-them)" states={view.them} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
          <PlayerPools title={`${ctx.ours.name}: comfort picks left`} accent="var(--side-us)" states={view.us} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
        </div>

        <Tendencies teamId={ctx.opponent.team_id} teamName={ctx.opponent.name} />

        <RecentForm team={ctx.opponent.name} games={ctx.opponent_recent} />

        {backtest && <TrustPanel data={backtest} />}

      </main>
    </>
  );
}
