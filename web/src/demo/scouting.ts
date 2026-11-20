// SYNTHETIC scouting data. Team names, rates and games are invented; nothing here comes from the licensed GRID data.
import type {
  DraftTendencyItem,
  EvidenceItem,
  Rate,
  TeamDraftTendencies,
  TeamProfile,
  TeamSummary,
  Tell,
  TendencyScope,
} from "../api/types";
import { MOCK_BACKTEST } from "../api/fixtures";

const EVENT = "Demo League - Split 2";

export const DEMO_TEAMS: TeamSummary[] = [
  { team_id: "alpha", name: "Team Alpha", games: 38, first_seen: "2026-01-14", last_seen: "2026-10-18", events: [EVENT, "Demo League - Split 1"] },
  { team_id: "bravo", name: "Team Bravo", games: 41, first_seen: "2026-01-14", last_seen: "2026-10-20", events: [EVENT, "Demo League - Split 1"] },
  { team_id: "delta", name: "Team Delta", games: 4, first_seen: "2026-09-02", last_seen: "2026-10-12", events: [EVENT] },
];

const wilson = (k: number, n: number): [number, number] => {
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const rate = (n: number, hits: number, baseline: number | null): Rate => {
  const [ci_lo, ci_hi] = wilson(hits, n);
  return { n, hits, rate: hits / n, ci_lo, ci_hi, baseline };
};

const tell = (template_id: string, group: string, title: string, n: number, hits: number, baseline: number, q: number, strength: Tell["strength"]): Tell => ({
  template_id,
  group,
  title,
  rate: rate(n, hits, baseline),
  shrunk_rate: (hits + 10 * baseline) / (n + 10),
  q,
  strength,
  direction: hits / n >= baseline ? "above" : "below",
});

const TELLS: Tell[] = [
  tell("lost_first_dragon_responds", "objective trades", "after losing the first dragon, takes another objective within 2 minutes", 11, 9, 0.46, 0.012, "strong"),
  tell("top_start_grubs", "jungle", "jungler starts top-side and the team takes the first grubs", 24, 17, 0.52, 0.04, "suggestive"),
  tell("baron_converts", "conversion", "after taking Baron, destroys two structures within 2.5 minutes", 9, 4, 0.58, 0.64, "typical"),
  tell("prepositioned_secures", "setup", "with three players in place when an objective spawns, secures it", 18, 15, 0.71, 0.55, "typical"),
];

export function demoProfile(teamId: string, event: string | null = null): TeamProfile {
  const team = DEMO_TEAMS.find((t) => t.team_id === teamId);
  if (!team) throw new Error(`No team with id '${teamId}'.`);
  const games = event === "Demo League - Split 1" ? Math.round(team.games * 0.45) : event ? team.games - Math.round(team.games * 0.45) : team.games;
  if (games < 6) throw new Error(`${team.name} has ${games} game(s)${event ? ` in '${event}'` : ""}; a profile needs at least 6.`);
  const scale = games / team.games;
  const n = (v: number) => Math.max(1, Math.round(v * scale));
  return {
    team: { ...team, games },
    jungle: {
      games: n(38),
      routes: [
        { route: "blue_buff>gromp>wolves", n: n(15), share: 0.43, example_game_ids: ["demo-ev-0", "demo-ev-1", "demo-ev-2"] },
        { route: "red_buff>krugs>raptors", n: n(11), share: 0.31, example_game_ids: ["demo-ev-3", "demo-ev-4"] },
        { route: "blue_buff>wolves>raptors", n: n(6), share: 0.17, example_game_ids: ["demo-ev-5"] },
        { route: "gromp>blue_buff>wolves", n: n(3), share: 0.09, example_game_ids: ["demo-ev-6"] },
      ],
      start_side: { top: 0.62, bot: 0.38 },
      first_lane: { top: 0.34, mid: 0.4, bot: 0.18 },
      median_first_lane_t: { top: 231, mid: 214, bot: 247 },
    },
    objectives: [
      { objective: "dragon", taken: n(27), mean_players_m30_when_taken: 3.6, league_mean_players_m30: 3.3, median_setup_s: 42, prepositioned_secure: rate(n(18), n(15), 0.71) },
      { objective: "baron", taken: n(12), mean_players_m30_when_taken: 4.1, league_mean_players_m30: 3.9, median_setup_s: 55, prepositioned_secure: rate(n(7), n(6), 0.83) },
      { objective: "herald", taken: n(19), mean_players_m30_when_taken: 3.1, league_mean_players_m30: 3.2, median_setup_s: 31, prepositioned_secure: null },
      { objective: "grubs", taken: n(22), mean_players_m30_when_taken: 3.4, league_mean_players_m30: 2.9, median_setup_s: 36, prepositioned_secure: rate(n(14), n(11), 0.68) },
    ],
    tells: TELLS.map((t) => ({ ...t, rate: { ...t.rate } })),
    notes: [
      "Synthetic demo data: connect the API to see real teams.",
      "Jungle routes group the first three camps in order of first detected contact; the feed has no camp-clear events.",
      ...(event ? [`Jungle and objective figures are restricted to '${event}'. Tells are computed once over all of the team's games and are not filtered by event.`] : []),
    ],
  };
}

export function demoEvidence(teamId: string, templateId: string): EvidenceItem[] {
  const t = TELLS.find((x) => x.template_id === templateId);
  if (!t || !DEMO_TEAMS.some((x) => x.team_id === teamId)) throw new Error(`No evidence for tell '${templateId}'.`);
  const rivals = ["Team Delta", "Team Echo", "Team Kilo", "Team Alpha", "Team Bravo"].filter((r) => r !== (teamId === "alpha" ? "Team Alpha" : "Team Bravo"));
  return Array.from({ length: t.rate.n }, (_, i) => ({
    game_id: `demo-ev-${i}`,
    series_id: `demo-s${Math.floor(i / 2)}`,
    date: `2026-${String(10 - Math.floor(i / 5)).padStart(2, "0")}-${String(28 - ((i * 3) % 27)).padStart(2, "0")}`,
    opponent: rivals[i % rivals.length] as string,
    side: i % 2 ? "red" : "blue",
    t_trigger: 410 + i * 37,
    hit: i < t.rate.hits,
    t_outcome: i < t.rate.hits ? 470 + i * 37 : null,
  }));
}

const item = (champion: string, count: number, games: number, league: number, q: number, strength: DraftTendencyItem["strength"]): DraftTendencyItem => ({
  champion,
  count,
  team_games: games,
  rate: count / games,
  league_rate: league,
  q,
  direction: count / games >= league ? "above" : "below",
  strength,
  evidence_game_ids: Array.from({ length: Math.min(count, 8) }, (_, i) => `demo-ev-${i}`),
});

export function demoTendencies(teamId: string, scope: TendencyScope): TeamDraftTendencies {
  const team = DEMO_TEAMS.find((t) => t.team_id === teamId);
  if (!team) throw new Error(`No team with id '${teamId}'.`);
  const games = scope === "all" ? team.games : scope === "g1" ? Math.round(team.games * 0.46) : Math.round(team.games * 0.54);
  if (games < 6) throw new Error(`${team.name} has fewer than 6 games in scope '${scope}'; no tendency report.`);
  const k = games / team.games;
  const c = (v: number) => Math.max(1, Math.round(v * k));
  return {
    team_id: teamId,
    name: team.name,
    scope,
    team_games: games,
    bans: [
      item("Kalista", c(14), games, 0.09, 0.001, "strong"),
      item("Azir", c(12), games, 0.1, 0.006, "strong"),
      item("Rumble", c(9), games, 0.06, 0.09, "suggestive"),
      item("Vi", c(7), games, 0.07, 0.4, "typical"),
    ],
    picks: [
      item("Wukong", c(13), games, 0.04, 0.001, "strong"),
      item("Ryze", c(10), games, 0.05, 0.02, "strong"),
      item("Rakan", c(11), games, 0.08, 0.3, "typical"),
      item("Lee Sin", c(2), games, 0.07, 0.12, "suggestive"),
    ].map((i, idx) => (idx === 3 ? { ...i, direction: "below" as const } : i)),
    ban_targets: [
      { role: "adc", team_share: 0.31, league_share: 0.21, n: c(110) },
      { role: "mid", team_share: 0.26, league_share: 0.21, n: c(110) },
      { role: "jungle", team_share: 0.17, league_share: 0.22, n: c(110) },
      { role: "top", team_share: 0.15, league_share: 0.18, n: c(110) },
      { role: "support", team_share: 0.11, league_share: 0.18, n: c(110) },
    ],
    fearless_shift: MOCK_BACKTEST.pick_depth.map((d, i) => ({
      game_number: d.game_number,
      picks: Math.max(5, Math.round(((team.games * 5) / (1 + i * 1.6)) * 0.55)),
      mean_rank: d.mean_rank + [0.1, 0.6, -0.3, 0.9, -1.2][i]!,
      league_mean_rank: d.mean_rank,
      share_top3: Math.max(0.04, d.share_top3 + [0.04, -0.06, 0.05, -0.04, 0.02][i]!),
      league_share_top3: d.share_top3,
      share_new: Math.max(0, d.share_new + [-0.03, 0.05, -0.04, 0.07, 0.03][i]!),
      league_share_new: d.share_new,
    })),
    notes: ["Synthetic demo data: connect the API to see real teams."],
  };
}
