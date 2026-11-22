// Static mode: the hosted demo reads real public data (Leaguepedia, CC BY-SA 3.0) exported by
// `lockout public-export` into web/public/data. No server, no licensed GRID data. Player positions do not exist in
// public data, so the replay and the position-based scouting fall back to simulated data.
import { demoReplay } from "../demo/replay";
import type { SeriesContext } from "../lib/draft";
import type {
  ChampionStats,
  ContextTeam,
  CopilotRanker,
  DraftBacktest,
  RecentGame,
  Replay,
  SeriesDraft,
  SeriesSummary,
  TeamDraftTendencies,
  TeamLogos,
  TeamSummary,
  TendencyScope,
  WinModel,
} from "./types";

const DATA = `${import.meta.env.BASE_URL}data/`;

export const GRID_ONLY =
  "Map habits and tells come from player positions, which only the licensed GRID data has. They run in the local build; this public demo shows the draft features on Leaguepedia data.";

const cache = new Map<string, Promise<unknown>>();
function get<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(DATA + path).then((r) => {
        if (!r.ok) throw new Error(`Not in the public demo data (${r.status})`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

interface TeamFile {
  context: ContextTeam;
  recent: RecentGame[];
  elo: [string, number][];
  tendencies: Partial<Record<TendencyScope, TeamDraftTendencies>>;
}

interface League {
  role_by_pick: Record<string, Record<string, number>>;
  league_top3_share_by_game: number[];
  attribution: string;
}

const teamFile = (id: string) => get<TeamFile>(`teams/${id}.json`);

export const staticTeams = () => get<TeamSummary[]>("teams.json");
export const staticLogos = () => get<TeamLogos>("logos.json").then((r) => r.logos).catch(() => ({}));
export const staticChampions = () => get<ChampionStats[]>("champions.json").catch(() => []);
export const staticBacktest = () => get<DraftBacktest>("backtest.json");
export const staticRanker = () => get<CopilotRanker>("copilot-ranker.json").catch(() => null);

export async function staticContext(team: string, opponent: string): Promise<SeriesContext> {
  const teams = await staticTeams();
  const a = team || teams[0]?.team_id || "";
  const b = opponent || teams.find((t) => t.team_id !== a)?.team_id || "";
  const [us, them, league] = await Promise.all([teamFile(a), teamFile(b), get<League>("league.json")]);
  return {
    ours: us.context,
    opponent: them.context,
    format: 5,
    opponent_recent: them.recent,
    ours_recent: us.recent,
    jungle_bridges: {},
    league_top3_share_by_game: league.league_top3_share_by_game,
    role_by_pick: league.role_by_pick,
    games: [],
  };
}

export async function staticTendencies(teamId: string, scope: TendencyScope): Promise<TeamDraftTendencies> {
  const t = (await teamFile(teamId)).tendencies[scope];
  if (!t) throw new Error("Not enough games in this scope for a tendency report.");
  return t;
}

export async function staticSeriesList(team: string, opponent = ""): Promise<SeriesSummary[]> {
  const all = await get<SeriesSummary[]>("series.json");
  return all
    .filter((s) => s.teams.some((t) => t.team_id === team) && (!opponent || s.teams.some((t) => t.team_id === opponent)))
    .map((s) => (s.teams[0]?.team_id === team ? s : { ...s, teams: [...s.teams].reverse() }))
    .slice(0, 40);
}

export async function staticSeriesDraft(id: string, ours = ""): Promise<SeriesDraft> {
  const d = await get<SeriesDraft>(`series/${id}.json`);
  if (!ours || d.series.teams[0]?.team_id === ours) return d;
  const c = d.context;
  return {
    ...d,
    series: { ...d.series, teams: [...d.series.teams].reverse() },
    context: { ...c, ours: c.opponent, opponent: c.ours, ours_recent: c.opponent_recent, opponent_recent: c.ours_recent, jungle_bridges: {} },
  };
}

/** A team's Elo just before `t`, with the same off-season pull as src/lockout/draft/winmodel.py. */
export function eloBefore(history: [string, number][], t: Date, gapDays = 30, reset = 0.5): number {
  let rating = 1500;
  let last: Date | null = null;
  for (const [when, value] of history) {
    const w = new Date(when);
    if (w >= t) break;
    rating = value;
    last = w;
  }
  if (last && (t.getTime() - last.getTime()) / 86_400_000 > gapDays) rating = 1500 + (rating - 1500) * reset;
  return rating;
}

export async function staticWinModel(team: string, opponent: string, before?: string): Promise<WinModel | null> {
  const [m, a, b] = await Promise.all([get<WinModel & { season_gap_days: number; season_reset: number }>("win-model.json"), teamFile(team), teamFile(opponent)]);
  const t = before ? new Date(before) : new Date();
  return {
    ...m,
    ours_id: team,
    opponent_id: opponent,
    ours_elo: eloBefore(a.elo, t, m.season_gap_days, m.season_reset),
    opponent_elo: eloBefore(b.elo, t, m.season_gap_days, m.season_reset),
    notes: [],
  };
}

interface GameIndexEntry {
  blue_team: string;
  red_team: string;
  winner_side: "blue" | "red";
  game_number: number;
  event: string;
  started_at: string;
  players: { slot: number; player_id: string; name: string; side: "blue" | "red"; role: string; champion: string }[];
}

/**
 * A simulated replay dressed as the real game: real teams, players, champions, roles, sides, winner, event and date
 * from Leaguepedia; positions and events are simulated (only GRID has them), and the page says so.
 */
export async function staticReplay(gameId: string): Promise<Replay> {
  const sim = demoReplay();
  const index = await get<Record<string, GameIndexEntry>>("games.json").catch(() => ({}) as Record<string, GameIndexEntry>);
  const real = index[gameId];
  if (!real) return sim;
  const bySlot = new Map(real.players.map((p) => [p.slot, p]));
  return {
    ...sim,
    game_id: gameId,
    blue_team: real.blue_team,
    red_team: real.red_team,
    winner_side: real.winner_side,
    event: real.event,
    started_at: real.started_at,
    game_number: real.game_number,
    players: sim.players.map((p) => {
      const r = bySlot.get(p.slot);
      return r ? { ...p, player_id: r.player_id, name: r.name, role: r.role as typeof p.role, champion: r.champion } : p;
    }),
  };
}
