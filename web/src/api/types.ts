// Mirrors src/macrodna/api/schemas.py. Keep the two in sync; the contract is docs/api-contract.md.

export type Role = "top" | "jungle" | "mid" | "adc" | "support" | "unknown";
export type PoolStatus = "ok" | "thin" | "critical";

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

export interface DraftBacktest {
  depletion: DepletionPoint[];
  buckets: StressBucket[];
  pairwise: PairwiseResult;
  calibration: { game_number: number; series: number; simulated: number; actual: number | null; actual_n: number }[];
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
