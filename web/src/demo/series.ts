// SYNTHETIC demo series. Team names, players, pools and results are invented; nothing comes from the licensed
// GRID data. The only real figures are the league-wide aggregates in `league_top3_share_by_game` (from the backtest).
import type { GameDraft, PastGame, PlayerPool, SeriesContext, TeamCtx } from "../lib/draft";
import type { Role } from "../api/types";

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
};
