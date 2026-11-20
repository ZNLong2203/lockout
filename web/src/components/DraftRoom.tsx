import { ArrowLeftRight, ChevronDown } from "lucide-react";
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
import type { Matchup } from "./MatchupPicker";
import { TeamBadge, TeamSearch } from "./TeamSearch";
import { TrustPanel } from "./Panels";
import { PlayerPools } from "./PlayerPools";
import { RecentForm } from "./RecentForm";
import { RiftMap } from "./RiftMap";
import { SeriesStrip } from "./SeriesStrip";
import { Tendencies } from "./Tendencies";


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

  const picker = isLive && teams.length > 0 ? <MatchupBar teams={teams} value={matchup} onChange={onMatchup} /> : null;
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
      <header className="draft-head">
        <div className="app draft-head-inner">
          <div>
            <span className="eyebrow">Fearless draft room</span>
            <div className="scoreline" aria-label="Series score">
              <span className={`side-dot ${sideOf(game, "us")}`} aria-hidden />
              <TeamBadge team={{ team_id: ctx.ours.name, name: ctx.ours.name }} size={28} />
              <b>{ctx.ours.name}</b>
              <span className="score-num">
                {usWins} – {themWins}
              </span>
              <b>{ctx.opponent.name}</b>
              <TeamBadge team={{ team_id: ctx.opponent.name, name: ctx.opponent.name }} size={28} />
              <span className={`side-dot ${sideOf(game, "them")}`} aria-hidden />
              <span className="muted">
                Game {game.number} · Bo{ctx.format}
              </span>
            </div>
          </div>
          {picker}
          {!isLive && <span className="badge demo">Demo: synthetic teams and numbers</span>}
        </div>
      </header>

      <main className="app">

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

        <details className="more">
          <summary>
            <span>More detail: comfort pools, their draft habits, recent games, how far to trust this</span>
            <ChevronDown size={18} aria-hidden />
          </summary>
        <div className="grid2">
          <PlayerPools title={`${ctx.opponent.name}: comfort picks left`} accent="var(--side-them)" states={view.them} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
          <PlayerPools title={`${ctx.ours.name}: comfort picks left`} accent="var(--side-us)" states={view.us} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
        </div>

        <Tendencies teamId={ctx.opponent.team_id} teamName={ctx.opponent.name} />

        <RecentForm team={ctx.opponent.name} games={ctx.opponent_recent} />

        {backtest && <TrustPanel data={backtest} />}
        </details>

      </main>
    </>
  );
}

/** Our team and the opponent, chosen with the type-ahead search. */
function MatchupBar({ teams, value, onChange }: { teams: TeamSummary[]; value: Matchup; onChange: (m: Matchup) => void }) {
  const [editing, setEditing] = useState<"ours" | "opponent" | null>(null);
  const slot = (key: "ours" | "opponent", label: string) => {
    const t = teams.find((x) => x.team_id === value[key]);
    return (
      <div className="matchup-slot">
        <span className="slot-label">{label}</span>
        {editing === key ? (
          <TeamSearch
            teams={teams}
            autoFocus
            exclude={[key === "ours" ? value.opponent : value.ours]}
            placeholder={`Search ${label.toLowerCase()}…`}
            onSelect={(x) => {
              onChange({ ...value, [key]: x.team_id });
              setEditing(null);
            }}
          />
        ) : (
          <button type="button" className="slot-team" onClick={() => setEditing(key)}>
            {t && <TeamBadge team={t} size={26} />}
            <b>{t?.name ?? "Choose…"}</b>
            <span className="muted">change</span>
          </button>
        )}
      </div>
    );
  };
  return (
    <div className="matchup-bar" aria-label="Choose the matchup">
      {slot("ours", "Us")}
      <button type="button" className="swap" title="Swap teams" onClick={() => onChange({ ours: value.opponent, opponent: value.ours })}>
        <ArrowLeftRight size={16} aria-hidden />
      </button>
      {slot("opponent", "Opponent")}
    </div>
  );
}
