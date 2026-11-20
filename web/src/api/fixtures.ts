// SYNTHETIC demo data. Invented numbers and team names: nothing here comes from the licensed GRID data.
// It lets the app run, and be demonstrated, without the data or the API.

import type {
  DraftBacktest,
  PlanQuery,
  PoolStatus,
  RolePool,
  Role,
  SeriesPlanResponse,
  TeamPoolState,
} from "./types";

const CRITICAL = 0.35;
const THIN = 0.6;

export const classify = (mass: number): PoolStatus => (mass < CRITICAL ? "critical" : mass < THIN ? "thin" : "ok");

type Pool = { role: Role; player: string; history: number; shares: [string, number][] };

const ALPHA: Pool[] = [
  { role: "top", player: "Demo Top A", history: 96, shares: [["Gnar", 0.22], ["Renekton", 0.2], ["Ornn", 0.16], ["Jax", 0.14], ["Sion", 0.1], ["K'Sante", 0.1], ["Aatrox", 0.08]] },
  { role: "jungle", player: "Demo Jungle A", history: 96, shares: [["Vi", 0.2], ["Sejuani", 0.18], ["Viego", 0.16], ["Maokai", 0.14], ["Nocturne", 0.12], ["Zac", 0.1], ["Skarner", 0.1]] },
  { role: "mid", player: "Demo Mid A", history: 70, shares: [["Azir", 0.24], ["Ahri", 0.2], ["Syndra", 0.16], ["Orianna", 0.14], ["Taliyah", 0.1], ["Viktor", 0.1], ["Sylas", 0.06]] },
  { role: "adc", player: "Demo Bot A", history: 31, shares: [["Kalista", 0.34], ["Ezreal", 0.3], ["Jinx", 0.16], ["Varus", 0.12], ["Ashe", 0.08]] },
  { role: "support", player: "Demo Support A", history: 96, shares: [["Nautilus", 0.2], ["Rell", 0.18], ["Braum", 0.16], ["Alistar", 0.16], ["Karma", 0.12], ["Lulu", 0.1], ["Rakan", 0.08]] },
];

const BETA: Pool[] = [
  { role: "top", player: "Demo Top B", history: 80, shares: [["Rumble", 0.3], ["Gnar", 0.22], ["Jayce", 0.16], ["Camille", 0.12], ["Gragas", 0.12], ["Malphite", 0.08]] },
  { role: "jungle", player: "Demo Jungle B", history: 60, shares: [["Wukong", 0.34], ["Jarvan IV", 0.24], ["Lee Sin", 0.16], ["Elise", 0.14], ["Poppy", 0.12]] },
  { role: "mid", player: "Demo Mid B", history: 88, shares: [["Ryze", 0.2], ["Viktor", 0.18], ["Orianna", 0.16], ["Yone", 0.14], ["Taliyah", 0.12], ["Azir", 0.1], ["Corki", 0.1]] },
  { role: "adc", player: "Demo Bot B", history: 74, shares: [["Jhin", 0.26], ["Ashe", 0.2], ["Lucian", 0.16], ["Aphelios", 0.14], ["Kai'Sa", 0.14], ["Varus", 0.1]] },
  { role: "support", player: "Demo Support B", history: 60, shares: [["Rakan", 0.28], ["Alistar", 0.2], ["Bard", 0.16], ["Renata Glasc", 0.14], ["Neeko", 0.12], ["Nautilus", 0.1]] },
];

function state(teamId: string, name: string, pools: Pool[], unavailable: Set<string>): TeamPoolState {
  const roles: RolePool[] = pools.map((p) => {
    const remaining = p.shares.filter(([c]) => !unavailable.has(c)).map(([champion, share]) => ({ champion, share }));
    const mass = remaining.reduce((s, r) => s + r.share, 0);
    return {
      role: p.role,
      player_id: `${teamId}-${p.role}`,
      player_name: p.player,
      history: p.history,
      mass,
      depth: remaining.filter((r) => r.share >= 0.1).length,
      status: classify(mass),
      remaining,
    };
  });
  roles.sort((a, b) => a.mass - b.mass);
  const ban_suggestions = roles.slice(0, 2).flatMap((r) =>
    r.remaining.slice(0, 2).map((e) => ({ role: r.role, champion: e.champion, share_of_remaining: r.mass ? e.share / r.mass : 0 })),
  );
  return { team_id: teamId, name, roles, untrusted_roles: [], ban_suggestions };
}

export function mockPlan(q: PlanQuery): SeriesPlanResponse {
  const unavailable = new Set([...q.locked, ...q.banned]);
  const ours = state("demo-a", q.team || "Demo Team A", ALPHA, unavailable);
  const opponent = state("demo-b", q.opponent || "Demo Team B", BETA, unavailable);
  const jungle = opponent.roles.find((r) => r.role === "jungle");
  return {
    ours,
    opponent,
    n_sims: 400,
    forecast: [
      { team_id: "demo-a", mean_stress: [1, 0.73, 0.55, 0.39], p_critical: { adc: [0, 0.12, 0.38, 0.7], mid: [0, 0.02, 0.14, 0.34] }, weakest_at_end: { adc: 0.53, mid: 0.22 } },
      { team_id: "demo-b", mean_stress: [1, 0.75, 0.57, 0.42], p_critical: { jungle: [0, 0.08, 0.3, 0.55], top: [0, 0.04, 0.2, 0.41] }, weakest_at_end: { jungle: 0.31, top: 0.24 } },
    ],
    jungle_bridges: (jungle?.remaining ?? []).slice(0, 3).map((e, i) => ({
      champion: e.champion,
      n: [18, 11, 7][i] ?? 6,
      scope: i === 2 ? "league" : "team",
      start_top: [0.28, 0.1, 0.45][i] ?? 0.3,
      start_bot: [0.72, 0.9, 0.55][i] ?? 0.7,
      first_lane: { top: [0.12, 0.4, 0.2][i] ?? 0.2, mid: [0.55, 0.3, 0.45][i] ?? 0.4, bot: [0.25, 0.2, 0.25][i] ?? 0.3 },
      no_early_lane: [0.08, 0.1, 0.1][i] ?? 0.1,
      median_first_lane_t: [236, 221, 244][i] ?? 240,
    })),
    notes: ["Synthetic demo data: connect the API to see real teams."],
  };
}

export const MOCK_BACKTEST: DraftBacktest = {
  depletion: [
    { game_number: 2, team_games: 1000, mean_stress: 0.65 },
    { game_number: 3, team_games: 566, mean_stress: 0.44 },
    { game_number: 4, team_games: 154, mean_stress: 0.31 },
    { game_number: 5, team_games: 60, mean_stress: 0.2 },
  ],
  buckets: [
    { label: "critical (< 35% of pool left)", n: 268, wins: 126, win_rate: 0.47, ci_lo: 0.41, ci_hi: 0.53 },
    { label: "thin (35%-60%)", n: 744, wins: 382, win_rate: 0.513, ci_lo: 0.48, ci_hi: 0.55 },
    { label: "comfortable (>= 60%)", n: 768, wins: 389, win_rate: 0.507, ci_lo: 0.47, ci_hi: 0.54 },
  ],
  pairwise: { n: 863, wins: 468, rate: 0.542, ci_lo: 0.509, ci_hi: 0.575, p_value: 0.014 },
  calibration: [
    { game_number: 2, series: 234, simulated: 0.687, actual: 0.658, actual_n: 463 },
    { game_number: 3, series: 234, simulated: 0.476, actual: 0.451, actual_n: 462 },
  ],
  weakest_role_share: { support: 0.23, jungle: 0.2, top: 0.2, mid: 0.19, adc: 0.18 },
  pick_depth: [
    { game_number: 1, picks: 6112, mean_rank: 4.75, share_top3: 0.4, share_new: 0.14 },
    { game_number: 2, picks: 5060, mean_rank: 5.57, share_top3: 0.31, share_new: 0.16 },
    { game_number: 3, picks: 2848, mean_rank: 6.61, share_top3: 0.21, share_new: 0.21 },
    { game_number: 4, picks: 769, mean_rank: 7.69, share_top3: 0.14, share_new: 0.24 },
    { game_number: 5, picks: 297, mean_rank: 9.08, share_top3: 0.11, share_new: 0.32 },
  ],
  caveats: [
    "Pools use only information available before each game (no look-ahead).",
    "The within-game comparison is one of several looked at; treat it as suggestive.",
    "Bans are not modelled in the simulator, which makes it slightly optimistic.",
    "Games 4 and 5 are rare in the corpus (about 150 and 60 team-games).",
  ],
};
