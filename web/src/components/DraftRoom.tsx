import { ArrowLeftRight, ChevronDown, History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBacktest, fetchChampions, fetchContext, fetchWinModel, isLive } from "../api/client";
import type { ChampionStats, DraftBacktest, SeriesDraft, TeamSummary, WinModel } from "../api/types";
import { buildBudget } from "../lib/budget";
import { winChance, winTimeline } from "../lib/winprob";
import { advise, callRate, type Meta } from "../lib/copilot";
import { infoOf, useCatalog } from "../lib/ddragon";
import {
  ORDER,
  analyseTeam,
  assignPicks,
  draftList,
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
import { TrustPanel } from "./Panels";
import { PlayerPools } from "./PlayerPools";
import { advanceReplay, truthOf, type ReplayState } from "../lib/seriesReplay";
import { RealSeriesBar, RealSeriesPicker } from "./RealSeries";
import { RecentForm } from "./RecentForm";
import { RiftMap } from "./RiftMap";
import { BudgetCard, SeriesPanel } from "./SeriesPanel";
import { Tendencies } from "./Tendencies";
import { TeamBadge, TeamSearch } from "./TeamSearch";

interface Props {
  teams: TeamSummary[];
  matchup: Matchup;
  onMatchup: (m: Matchup) => void;
}

const toMeta = (rows: ChampionStats[]): Meta => new Map(rows.map((c) => [c.champion, c]));

/** The interactive Fearless draft room for one matchup. Kept mounted while other pages are open, so a draft in progress is never lost. */
export function DraftRoom({ teams, matchup, onMatchup }: Props) {
  const catalog = useCatalog();
  const [ctx, setCtx] = useState<SeriesContext | null>(null);
  const [games, setGames] = useState<GameDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [jungler, setJungler] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<DraftBacktest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMeta, setLiveMeta] = useState<Meta>(new Map());
  const [hover, setHover] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [winModel, setWinModel] = useState<WinModel | null>(null);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    setError(null);
    setReplay(null);
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
    fetchChampions().then((rows) => setLiveMeta(toMeta(rows)));
  }, []);

  // the win model of the matchup on screen; a replay uses one fitted only on games before the series
  const replaySeries = replay?.draft.series;
  useEffect(() => {
    let alive = true;
    setWinModel(null);
    const [a, b] = replaySeries ? replaySeries.teams.map((t) => t.team_id) : [ctx?.ours.team_id, ctx?.opponent.team_id];
    if (!a || !b) return;
    fetchWinModel(a, b, replaySeries ? `${replaySeries.date}T00:00:00Z` : undefined).then((m) => alive && setWinModel(m));
    return () => {
      alive = false;
    };
  }, [ctx?.ours.team_id, ctx?.opponent.team_id, replaySeries]);

  // autoplay of a real-series replay
  useEffect(() => {
    if (!replay?.playing) return;
    const id = window.setTimeout(() => setReplay((r) => (r ? advanceReplay(r, 1) : r)), 1100);
    return () => window.clearTimeout(id);
  }, [replay]);

  // what the board shows: the live series, or the real series revealed up to the replay cursor
  const replayMeta = useMemo(() => (replay ? toMeta(replay.draft.meta) : null), [replay?.draft]);
  const shown = useMemo(() => {
    if (replay) {
      const truth = replay.truth;
      const cur = truth[replay.gi] as GameDraft;
      const g: GameDraft = {
        ...cur,
        steps: cur.steps.map((c, i) => (i < replay.step ? (c ?? "—") : null)),
        winner: replay.step >= ORDER.length ? cur.winner : null,
      };
      return { ctx: { ...replay.draft.context, games: [] } as SeriesContext, games: [...truth.slice(0, replay.gi), g], index: replay.gi, meta: replayMeta ?? new Map() };
    }
    return ctx ? { ctx, games, index, meta: liveMeta } : null;
  }, [replay, replayMeta, ctx, games, index, liveMeta]);

  const info = (c: string) => infoOf(catalog, c);
  const view = useMemo(() => {
    if (!shown) return null;
    const { ctx: c, games: gs, index: i, meta } = shown;
    const game = gs[i];
    if (!game) return null;
    const locked = lockedBefore(gs, i);
    const used = usedIn(game);
    const bannedNow = new Set(ORDER.map((o, k) => (o.action === "ban" ? game.steps[k] : null)).filter(Boolean) as string[]);
    const unavailable = new Set([...locked, ...used]);
    const them = analyseTeam(c.opponent, unavailable);
    const us = analyseTeam(c.ours, unavailable);
    const jg = them.find((s) => s.player.role === "jungle");
    const jungleOptions = (jg?.available ?? []).slice(0, 5).map((e) => e.champion).filter((x) => c.jungle_bridges[x]);
    const theirPicks = draftList(game, sideOf(game, "them"), "pick").filter((x): x is string => !!x && x !== "—");
    const jgPlayer = c.opponent.players.find((p) => p.role === "jungle");
    const theirJungle = jgPlayer ? (assignPicks(c.opponent, theirPicks, (x) => meta.get(x)?.role).get(jgPlayer.player_id) ?? null) : null;
    const opts = { meta, info };
    const advice = advise(c, gs, i, opts);
    const calls = callRate(c, gs, i, opts);
    return { game, locked, used, bannedNow, them, us, jungleOptions, theirJungle, jgPlayer, advice, calls };
  }, [shown, catalog]);

  const win = useMemo(() => {
    if (!winModel || !shown || !view) return null;
    const { ctx: c, games: gs, index: i, meta } = shown;
    const now = winChance(winModel, c, gs, i, meta);
    const deltas = new Map<string, number>();
    if (view.advice?.action === "pick") {
      for (const sg of view.advice.suggestions) deltas.set(sg.champion, winChance(winModel, c, gs, i, meta, { side: view.advice.side, champion: sg.champion }) - now);
    }
    return { model: winModel, timeline: winTimeline(winModel, c, gs, i, meta), deltas };
  }, [winModel, shown, view]);

  const budget = useMemo(() => (shown ? buildBudget(shown.ctx, shown.games, shown.index, shown.meta, hover) : null), [shown, hover]);

  const picker = isLive && teams.length > 0 ? <MatchupBar teams={teams} value={matchup} onChange={onMatchup} /> : null;
  if (error) return <main className="app">{picker}<p className="err card" role="alert">{error}</p></main>;
  if (!ctx || !shown || !view || !budget) return <main className="app">{picker}<p className="muted">Loading series…</p></main>;

  const { game } = view;
  const live = !replay;
  const update = (g: GameDraft) => setGames(games.map((x, i) => (i === index ? g : x)));
  const onPick = (c: string) => {
    const s = nextStep(game);
    if (s < 0) return;
    const steps = [...game.steps];
    steps[s] = c;
    update({ ...game, steps });
    setHover(null);
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
  const startReplay = (draft: SeriesDraft) => {
    setReplay({ draft, truth: truthOf(draft), gi: 0, step: 0, playing: false });
    setPicking(false);
    setJungler(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const autoJungler = view.theirJungle && shown.ctx.jungle_bridges[view.theirJungle] ? view.theirJungle : null;
  const activeJungler = autoJungler ?? (jungler && view.jungleOptions.includes(jungler) ? jungler : (view.jungleOptions[0] ?? null));
  const usWins = shown.games.filter((g) => g.winner === "us").length;
  const themWins = shown.games.filter((g) => g.winner === "them").length;
  const s = shown.ctx;
  const ourBan = view.advice?.ours && view.advice.action === "ban";
  const lastStep = replay && replay.step > 0 ? replay.step - 1 : -1;
  const last =
    replay && lastStep >= 0
      ? (() => {
          const champ = (replay.truth[replay.gi] as GameDraft).steps[lastStep];
          const o = ORDER[lastStep] as (typeof ORDER)[number];
          const team = o.side === sideOf(game, "us") ? s.ours.name : s.opponent.name;
          return champ ? { champion: champ, hit: view.calls.steps[lastStep] === true, label: `${team} ${o.action}` } : null;
        })()
      : null;

  return (
    <>
      <header className="draft-head">
        <div className="app draft-head-inner">
          <div>
            <span className="eyebrow">{replay ? "Real series replay" : "Fearless draft room"}</span>
            <div className="scoreline" aria-label="Series score">
              <span className={`side-dot ${sideOf(game, "us")}`} aria-hidden />
              <TeamBadge team={s.ours} size={28} />
              <b>{s.ours.name}</b>
              <span className="score-num">
                {usWins} – {themWins}
              </span>
              <b>{s.opponent.name}</b>
              <TeamBadge team={s.opponent} size={28} />
              <span className={`side-dot ${sideOf(game, "them")}`} aria-hidden />
              <span className="muted">
                Game {game.number} · Bo{s.format}
              </span>
            </div>
          </div>
          {live && picker}
          {live && (
            <button type="button" className={`ghost replay-btn ${picking ? "on" : ""}`} onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
              <History size={15} aria-hidden /> Replay a real series
            </button>
          )}
          {!isLive && <span className="badge demo">Demo: synthetic teams and numbers</span>}
        </div>
      </header>

      <main className="app">
        {replay && <RealSeriesBar replay={replay} calls={view.calls} onChange={setReplay} onExit={() => setReplay(null)} />}
        {live && picking && <RealSeriesPicker ours={ctx.ours} opponent={ctx.opponent} onPick={startReplay} onClose={() => setPicking(false)} />}

        <SeriesPanel
          ctx={s}
          games={shown.games}
          index={shown.index}
          readOnly={!live}
          onSelect={(i) => (replay ? setReplay({ ...replay, gi: i, step: i < replay.gi ? ORDER.length : 0, playing: false }) : setIndex(i))}
          onFinish={onFinish}
          onSwapSide={() => update({ ...game, ourSide: game.ourSide === "blue" ? "red" : "blue" })}
        />

        <DraftBoard
          ctx={s}
          games={shown.games}
          index={shown.index}
          advice={view.advice}
          calls={view.calls}
          meta={shown.meta}
          last={last}
          onPick={live ? onPick : undefined}
          onUndo={live ? onUndo : undefined}
          onClear={live ? () => update(emptyDraft(game.number, game.ourSide)) : undefined}
          onHover={setHover}
          win={win}
        />

        <BudgetCard ctx={s} budget={budget} games={Array.from({ length: Math.max(s.format, shown.games.length) }, (_, i) => i + 1)} current={game.number} />

        <div className="grid2">
          <Insights ctx={s} them={view.them} us={view.us} gameNumber={game.number} meta={shown.meta} onBan={live && ourBan ? onPick : undefined} />
          <RiftMap
            bridge={activeJungler ? s.jungle_bridges[activeJungler] : undefined}
            bridges={s.jungle_bridges}
            side={sideOf(game, "them")}
            jungleOptions={view.jungleOptions}
            onChoose={setJungler}
            locked={autoJungler}
            jungler={view.jgPlayer?.name}
          />
        </div>

        <details className="more">
          <summary>
            <span>More detail: comfort pools, their draft habits, recent games, how far to trust this</span>
            <ChevronDown size={18} aria-hidden />
          </summary>
          <div className="grid2">
            <PlayerPools title={`${s.opponent.name}: comfort picks left`} accent="var(--side-them)" states={view.them} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
            <PlayerPools title={`${s.ours.name}: comfort picks left`} accent="var(--side-us)" states={view.us} locked={view.locked} bannedNow={view.bannedNow} usedNow={view.used} />
          </div>
          <Tendencies teamId={s.opponent.team_id} teamName={s.opponent.name} />
          <RecentForm team={s.opponent.name} games={s.opponent_recent} />
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
