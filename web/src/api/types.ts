// Mirrors src/macrodna/api/schemas.py. Keep the two in sync; the contract is docs/api-contract.md.

export type Side = "blue" | "red";
export type Strength = "strong" | "suggestive" | "typical";
export type Role = "top" | "jungle" | "mid" | "adc" | "support" | "unknown";
export type PoolStatus = "ok" | "thin" | "critical";

// --- Scouting: team profile, tells, evidence --------------------------------------------------------------

export interface Health {
  status: "ok";
  games: number;
}

export interface TeamSummary {
  team_id: string;
  name: string;
  games: number;
  first_seen: string;
  last_seen: string;
  events: string[];
}

/** A proportion with its sample size: always show `n` next to `rate`. */
export interface Rate {
  n: number;
  hits: number;
  rate: number;
  ci_lo: number;
  ci_hi: number;
  baseline: number | null;
}

export interface RouteShare {
  route: string;
  n: number;
  share: number;
  example_game_ids: string[];
}

export interface JungleProfile {
  games: number;
  routes: RouteShare[];
  start_side: Record<string, number>;
  first_lane: Record<string, number>;
  median_first_lane_t: Record<string, number | null>;
}

export type ObjectiveName = "dragon" | "baron" | "herald" | "grubs";

export interface ObjectiveProfile {
  objective: ObjectiveName;
  taken: number;
  mean_players_m30_when_taken: number;
  league_mean_players_m30: number;
  median_setup_s: number;
  prepositioned_secure: Rate | null;
}

export interface Tell {
  template_id: string;
  group: string;
  title: string;
  rate: Rate;
  shrunk_rate: number;
  q: number;
  strength: Strength;
  direction: "above" | "below";
}

export interface TeamProfile {
  team: TeamSummary;
  jungle: JungleProfile | null;
  objectives: ObjectiveProfile[];
  tells: Tell[];
  notes: string[];
}

export interface EvidenceItem {
  game_id: string;
  series_id: string;
  date: string;
  opponent: string;
  side: Side;
  t_trigger: number;
  hit: boolean;
  t_outcome: number | null;
}

// --- Replay -----------------------------------------------------------------------------------------------

export interface ReplayPlayer {
  slot: number;
  player_id: string;
  name: string;
  side: Side;
  role: Role;
  champion: string | null;
}

export interface ReplayEvent {
  t: number;
  kind: string;
  name: string;
  slot: number | null;
  target_slot: number | null;
  x: number | null;
  y: number | null;
}

export interface Replay {
  game_id: string;
  series_id: string;
  duration_s: number;
  bounds: [number, number, number, number];
  players: ReplayPlayer[];
  positions: [number, number][][]; // positions[t][slot], (-1, -1) when unknown
  events: ReplayEvent[];
  blue_team: string;
  red_team: string;
  winner_side: Side | null;
  event?: string | null;
  started_at?: string | null;
  game_number?: number | null;
}

// --- Draft: Fearless pool planner and its backtest -----------------------------------------------------

export interface PoolEntry {
  champion: string;
  share: number;
}

export interface RolePool {
  role: Role;
  player_id: string;
  player_name: string | null;
  history: number;
  mass: number;
  depth: number;
  status: PoolStatus;
  remaining: PoolEntry[];
}

export interface BanSuggestion {
  role: Role;
  champion: string;
  share_of_remaining: number;
}

export interface TeamPoolState {
  team_id: string;
  name: string;
  roles: RolePool[];
  untrusted_roles: string[];
  ban_suggestions: BanSuggestion[];
}

export interface TeamForecast {
  team_id: string;
  mean_stress: number[];
  p_critical: Record<string, number[]>;
  weakest_at_end: Record<string, number>;
}

export interface JungleBridge {
  champion: string;
  n: number;
  scope: "team" | "league";
  start_top: number;
  start_bot: number;
  first_lane: Record<string, number>;
  no_early_lane: number;
  median_first_lane_t: number | null;
}

export interface SeriesPlanResponse {
  ours: TeamPoolState;
  opponent: TeamPoolState;
  forecast: TeamForecast[] | null;
  n_sims: number;
  jungle_bridges: JungleBridge[];
  notes: string[];
}

export interface DepletionPoint {
  game_number: number;
  team_games: number;
  mean_stress: number;
}

export interface PairwiseResult {
  n: number;
  wins: number;
  rate: number;
  ci_lo: number;
  ci_hi: number;
  p_value: number;
}

export interface StressBucket {
  label: string;
  n: number;
  wins: number;
  win_rate: number;
  ci_lo: number;
  ci_hi: number;
}

export interface PickDepthPoint {
  game_number: number;
  picks: number;
  mean_rank: number;
  share_top3: number;
  share_new: number;
}

export interface CalibrationPoint {
  game_number: number;
  series: number;
  simulated: number;
  actual: number | null;
  actual_n: number;
}

export interface DraftBacktest {
  depletion: DepletionPoint[];
  buckets: StressBucket[];
  pairwise: PairwiseResult;
  calibration: CalibrationPoint[];
  weakest_role_share: Record<string, number>;
  pick_depth: PickDepthPoint[];
  caveats: string[];
}

export interface PlanQuery {
  team: string;
  opponent: string;
  locked: string[];
  banned: string[];
}

// --- Draft room: everything the board needs for one matchup ----------------------------------------------

export interface ContextPoolEntry {
  champion: string;
  share: number;
  games: number;
}

export interface ContextPlayer {
  player_id: string;
  name: string;
  role: Role;
  history: number;
  pool: ContextPoolEntry[];
}

export interface ContextTeam {
  team_id: string;
  name: string;
  short: string;
  players: ContextPlayer[];
}

export interface RecentPick {
  champion: string;
  role: Role;
}

export interface RecentGame {
  game_id: string;
  date: string;
  opponent: string;
  side: Side;
  won: boolean;
  duration_s: number;
  picks: RecentPick[];
  bans: string[];
}

/** What `GET /api/series/context` returns. The games of the live series are entered by the coach in the UI. */
export interface SeriesContext {
  ours: ContextTeam;
  opponent: ContextTeam;
  format: number;
  opponent_recent: RecentGame[];
  jungle_bridges: Record<string, JungleBridge>;
  league_top3_share_by_game: number[];
}

// --- Draft tendencies of one team ----------------------------------------------------------------------------

export type TendencyScope = "all" | "g1" | "later";

export interface DraftTendencyItem {
  champion: string;
  count: number;
  team_games: number;
  rate: number;
  league_rate: number;
  q: number;
  direction: "above" | "below";
  strength: Strength;
  evidence_game_ids: string[];
}

export interface BanTarget {
  role: Role;
  team_share: number;
  league_share: number;
  n: number;
}

export interface FearlessShiftPoint {
  game_number: number;
  picks: number;
  mean_rank: number;
  league_mean_rank: number | null;
  share_top3: number;
  league_share_top3: number | null;
  share_new: number;
  league_share_new: number | null;
}

export interface TeamDraftTendencies {
  team_id: string;
  name: string;
  scope: TendencyScope;
  team_games: number;
  picks: DraftTendencyItem[];
  bans: DraftTendencyItem[];
  ban_targets: BanTarget[];
  fearless_shift: FearlessShiftPoint[];
  notes: string[];
}
