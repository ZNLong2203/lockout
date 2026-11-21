// SYNTHETIC demo series. Team names, players, pools and results are invented; nothing comes from the licensed
// GRID data. The only real figures are the league-wide aggregates in `league_top3_share_by_game` (from the backtest).
import type { GameDraft, PastGame, PlayerPool, SeriesContext, TeamCtx } from "../lib/draft";
import type { ChampionStats, Role, SeriesDraft, SeriesSummary, WinModel } from "../api/types";

type Raw = [string, Role, number, [string, number][]];

const team = (team_id: string, name: string, short: string, raw: Raw[]): TeamCtx => ({
  team_id,
  name,
  short,
  players: raw.map(
    ([name, role, history, pool]): PlayerPool => ({
      player_id: `${team_id}-${role}`,
      name,
      role,
      history,
      pool: pool.map(([champion, share]) => ({ champion, share, games: Math.max(1, Math.round(share * history)) })),
      // invented: the last month's picks come from the top of the pool
      recent: Object.fromEntries(pool.slice(0, 3).map(([champion], i) => [champion, 3 - i])),
    }),
  ),
});

const OURS = team("alpha", "Team Alpha", "ALP", [
  ["Atlas", "top", 96, [["Gnar", 0.22], ["Renekton", 0.2], ["Ornn", 0.16], ["Jax", 0.14], ["Sion", 0.1], ["K'Sante", 0.1], ["Aatrox", 0.08]]],
  ["Vector", "jungle", 96, [["Vi", 0.2], ["Sejuani", 0.18], ["Viego", 0.16], ["Maokai", 0.14], ["Nocturne", 0.12], ["Zac", 0.1], ["Skarner", 0.1]]],
  ["Nova", "mid", 70, [["Azir", 0.24], ["Ahri", 0.2], ["Syndra", 0.16], ["Orianna", 0.14], ["Taliyah", 0.1], ["Viktor", 0.1], ["Sylas", 0.06]]],
  ["Echo", "adc", 31, [["Kalista", 0.34], ["Ezreal", 0.3], ["Jinx", 0.16], ["Varus", 0.12], ["Ashe", 0.08]]],
  ["Halo", "support", 96, [["Nautilus", 0.2], ["Rell", 0.18], ["Braum", 0.16], ["Alistar", 0.16], ["Karma", 0.12], ["Lulu", 0.1], ["Rakan", 0.08]]],
]);

const THEIRS = team("bravo", "Team Bravo", "BRV", [
  ["Granite", "top", 80, [["Rumble", 0.3], ["Gnar", 0.22], ["Jayce", 0.16], ["Camille", 0.12], ["Gragas", 0.12], ["Malphite", 0.08]]],
  ["Viper", "jungle", 60, [["Wukong", 0.34], ["Jarvan IV", 0.24], ["Lee Sin", 0.16], ["Elise", 0.14], ["Poppy", 0.12]]],
  ["Sable", "mid", 88, [["Ryze", 0.2], ["Viktor", 0.18], ["Orianna", 0.16], ["Yone", 0.14], ["Taliyah", 0.12], ["Azir", 0.1], ["Corki", 0.1]]],
  ["Quill", "adc", 74, [["Jhin", 0.26], ["Ashe", 0.2], ["Lucian", 0.16], ["Aphelios", 0.14], ["Kai'Sa", 0.14], ["Varus", 0.1]]],
  ["Mender", "support", 60, [["Rakan", 0.28], ["Alistar", 0.2], ["Bard", 0.16], ["Renata Glasc", 0.14], ["Neeko", 0.12], ["Nautilus", 0.1]]],
]);

// Steps follow ORDER: B ban, R ban x3; B, R, R, B, B, R picks; R, B, R, B bans; R, B, B, R picks.
const G1: GameDraft = {
  number: 1,
  ourSide: "blue",
  winner: "us",
  steps: ["Rumble", "Kalista", "Wukong", "Azir", "Rakan", "Vi",
    "Ezreal", "Jhin", "Gnar", "Sejuani", "Ahri", "Lee Sin",
    "Ornn", "Ryze", "Nautilus", "Bard",
    "Viktor", "Renekton", "Braum", "Alistar"],
};
const G2: GameDraft = {
  number: 2,
  ourSide: "red",
  winner: "them",
  steps: ["Kalista", "Wukong", "Azir", "Rumble", "Vi", "Rakan",
    "Jarvan IV", "Jinx", "Syndra", "Ashe", "Jayce", "Viego",
    "Ryze", "Rell", "Bard", "Orianna",
    "Jax", "Yone", "Renata Glasc", "Nautilus"],
};

const recent = (i: number, opponent: string, won: boolean, picks: [string, Role][], bans: string[]): PastGame => ({
  game_id: `demo-r${i}`,
  date: `2026-10-${String(20 - i * 3).padStart(2, "0")}`,
  opponent,
  side: i % 2 ? "red" : "blue",
  won,
  duration_s: 1680 + i * 133,
  picks: picks.map(([champion, role]) => ({ champion, role })),
  bans,
});

const bridge = (champion: string, n: number, top: number, lanes: [number, number, number], t: number, scope: "team" | "league" = "team") => ({
  champion,
  n,
  scope,
  start_top: top,
  start_bot: 1 - top,
  first_lane: { top: lanes[0], mid: lanes[1], bot: lanes[2] },
  no_early_lane: Math.max(0, 1 - lanes[0] - lanes[1] - lanes[2]),
  median_first_lane_t: t,
});

export const DEMO_SERIES: SeriesContext = {
  ours: OURS,
  opponent: THEIRS,
  format: 5,
  games: [G1, G2, { number: 3, ourSide: "blue", winner: null, steps: Array<string | null>(20).fill(null) }],
  opponent_recent: [
    recent(1, "Team Delta", true, [["Rumble", "top"], ["Wukong", "jungle"], ["Ryze", "mid"], ["Jhin", "adc"], ["Rakan", "support"]], ["Kalista", "Azir", "Vi", "Orianna", "Nautilus"]),
    recent(2, "Team Echo", false, [["Gnar", "top"], ["Jarvan IV", "jungle"], ["Viktor", "mid"], ["Ashe", "adc"], ["Alistar", "support"]], ["Rumble", "Kalista", "Azir", "Ezreal", "Rell"]),
    recent(3, "Team Echo", true, [["Jayce", "top"], ["Wukong", "jungle"], ["Orianna", "mid"], ["Lucian", "adc"], ["Bard", "support"]], ["Kalista", "Vi", "Sejuani", "Ahri", "Braum"]),
    recent(4, "Team Kilo", true, [["Rumble", "top"], ["Lee Sin", "jungle"], ["Yone", "mid"], ["Jhin", "adc"], ["Rakan", "support"]], ["Azir", "Kalista", "Gnar", "Viego", "Nautilus"]),
    recent(5, "Team Kilo", false, [["Camille", "top"], ["Elise", "jungle"], ["Taliyah", "mid"], ["Kai'Sa", "adc"], ["Neeko", "support"]], ["Wukong", "Rumble", "Kalista", "Ryze", "Rakan"]),
  ],
  jungle_bridges: {
    Wukong: bridge("Wukong", 18, 0.28, [0.12, 0.55, 0.25], 236),
    "Jarvan IV": bridge("Jarvan IV", 11, 0.1, [0.4, 0.3, 0.2], 221),
    "Lee Sin": bridge("Lee Sin", 9, 0.56, [0.22, 0.33, 0.33], 229),
    Elise: bridge("Elise", 7, 0.71, [0.57, 0.14, 0.14], 204),
    Poppy: bridge("Poppy", 23, 0.39, [0.26, 0.3, 0.3], 247, "league"),
  },
  // League-wide share of picks that come from a player's top 3 champions, by game number (real aggregate).
  league_top3_share_by_game: [0.4, 0.31, 0.21, 0.14, 0.11],
  ours_recent: [
    recent(6, "Team Delta", true, [["Gnar", "top"], ["Vi", "jungle"], ["Azir", "mid"], ["Kalista", "adc"], ["Nautilus", "support"]], ["Rumble", "Wukong", "Ryze", "Jhin", "Rakan"]),
    recent(7, "Team Kilo", false, [["Renekton", "top"], ["Sejuani", "jungle"], ["Ahri", "mid"], ["Ezreal", "adc"], ["Rell", "support"]], ["Wukong", "Rakan", "Jayce", "Viktor", "Ashe"]),
  ],
  // Invented role order by pick slot (side-n): which role a team tends to take with its n-th pick.
  role_by_pick: Object.fromEntries(
    (["blue", "red"] as const).flatMap((side) =>
      [
        { jungle: 0.3, support: 0.25, mid: 0.2, adc: 0.15, top: 0.1 },
        { jungle: 0.25, support: 0.25, adc: 0.2, mid: 0.15, top: 0.15 },
        { mid: 0.25, adc: 0.25, top: 0.2, support: 0.15, jungle: 0.15 },
        { top: 0.35, mid: 0.25, adc: 0.2, jungle: 0.1, support: 0.1 },
        { top: 0.4, mid: 0.3, adc: 0.15, jungle: 0.1, support: 0.05 },
      ].map((d, i) => [`${side}-${i + 1}`, d]),
    ),
  ),
};

// --- SYNTHETIC league meta and one finished demo series, for the co-pilot and the real-series replay ---------

const G3: GameDraft = {
  number: 3,
  ourSide: "blue",
  winner: "us",
  steps: ["Rumble", "Kalista", "Wukong", "Azir", "Ryze", "Vi",
    "Orianna", "Lucian", "Elise", "Varus", "Rell", "Camille",
    "Ornn", "Bard", "Maokai", "Rakan",
    "Corki", "Nocturne", "Sion", "Neeko"],
};

/** Invented league meta: every champion of the demo pools, in its player's role, with made-up rates. */
export const DEMO_META: ChampionStats[] = (() => {
  const out = new Map<string, ChampionStats>();
  const GAMES = 400;
  [...OURS.players, ...THEIRS.players].forEach((p, pi) =>
    p.pool.forEach((e, i) => {
      const picks = Math.round(e.share * 160) + ((pi * 7 + i * 3) % 11);
      const bans = Math.round(e.share * 120) + ((pi + i) % 5) * 6;
      const cur = out.get(e.champion);
      if (cur && cur.picks >= picks) return;
      out.set(e.champion, {
        champion: e.champion,
        games: GAMES,
        picks,
        bans,
        presence: Math.min(1, (picks + bans) / GAMES),
        wins: Math.round(picks * (0.44 + ((i * 13 + pi) % 12) / 100)),
        win_rate: 0.44 + ((i * 13 + pi) % 12) / 100,
        roles: { [p.role]: 1 },
        role: p.role,
        presence_recent: Math.min(1, ((picks + bans) / GAMES) * (0.8 + ((pi + i) % 5) / 10)),
      });
    }),
  );
  return [...out.values()].sort((a, b) => b.presence - a.presence);
})();

export const DEMO_SERIES_LIST: SeriesSummary[] = [
  {
    series_id: "demo-series-1",
    date: "2026-10-24",
    event: "Demo Cup - Finals",
    format: 3,
    teams: [
      { team_id: "alpha", name: "Team Alpha", wins: 2 },
      { team_id: "bravo", name: "Team Bravo", wins: 1 },
    ],
    games: 3,
  },
];

export function demoSeriesDraft(): SeriesDraft {
  const { games: _games, ...context } = DEMO_SERIES;
  return {
    series: DEMO_SERIES_LIST[0] as SeriesSummary,
    context: { ...context, format: 3 },
    games: [G1, G2, G3].map((g) => ({
      game_id: `demo-g${g.number}`,
      game_number: g.number,
      blue_team_id: g.ourSide === "blue" ? "alpha" : "bravo",
      red_team_id: g.ourSide === "blue" ? "bravo" : "alpha",
      winner_team_id: g.winner === "us" ? "alpha" : "bravo",
      steps: g.steps,
    })),
    meta: DEMO_META,
    notes: ["Synthetic demo series: teams, players and drafts are invented."],
  };
}

/** SYNTHETIC win model for the demo: invented ratings and coefficients of a realistic size. */
export const DEMO_WIN_MODEL: WinModel = {
  features: ["elo", "comfort", "champ", "stress"],
  mean: [0, 0, 0, 0],
  scale: [0.25, 0.12, 0.02, 0.15],
  coef: [0.75, 0.1, 0.07, -0.05],
  intercept: 0.12,
  n_train: 400,
  ours_id: "alpha",
  opponent_id: "bravo",
  ours_elo: 1540,
  opponent_elo: 1515,
  meta_days: 90,
  prior: 10,
  pool_top: 8,
  evaluation: {
    n_train: 300, n_test: 100, accuracy: 0.66, log_loss: 0.64, auc: 0.69,
    elo_accuracy: 0.65, elo_log_loss: 0.645, elo_auc: 0.68, blue_rate: 0.52, blue_log_loss: 0.69, confident_n: 40, confident_accuracy: 0.72,
  },
  notes: ["Synthetic demo model: invented ratings and coefficients."],
};
