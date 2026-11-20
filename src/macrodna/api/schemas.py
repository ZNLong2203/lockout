"""Response models of the MacroDNA HTTP API (the contract between back end and front end).

The API is read-only and serves aggregates and per-game replays computed from the local cache. Field names
here are the source of truth: FastAPI publishes them as OpenAPI at ``/openapi.json`` and the web app is
typed against that.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Side = Literal["blue", "red"]
Strength = Literal["strong", "suggestive", "typical"]
Role = Literal["top", "jungle", "mid", "adc", "support", "unknown"]


class Health(BaseModel):
    status: Literal["ok"]
    games: int = Field(description="Games in the cache")


class TeamSummary(BaseModel):
    team_id: str
    name: str
    games: int
    first_seen: str = Field(description="ISO date of the first game in the corpus")
    last_seen: str
    events: list[str] = Field(
        description="Leagues/splits the team appears in, e.g. 'LCS - Split 2 2026'"
    )


class Rate(BaseModel):
    """A proportion with its sample size. ``n`` must always be shown next to ``rate``."""

    n: int
    hits: int
    rate: float
    ci_lo: float
    ci_hi: float
    baseline: float | None = Field(None, description="League-wide rate for the same situation")


class RouteShare(BaseModel):
    route: str = Field(description="Camps in order of first detected contact, joined by '>'")
    n: int
    share: float
    example_game_ids: list[str] = Field(description="Up to 3 games, for the replay deep-link")


class JungleProfile(BaseModel):
    games: int
    routes: list[RouteShare]
    start_side: dict[str, float] = Field(description="Share of games opening 'top' or 'bot' side")
    first_lane: dict[str, float] = Field(
        description="Share of games where the first lane seen is top/mid/bot"
    )
    median_first_lane_t: dict[str, int | None] = Field(
        description="Median game second of that first appearance"
    )


class ObjectiveProfile(BaseModel):
    objective: Literal["dragon", "baron", "herald", "grubs"]
    taken: int
    mean_players_m30_when_taken: float = Field(
        description="Living players in the area 30 s before taking it"
    )
    league_mean_players_m30: float
    median_setup_s: float = Field(description="Seconds of sustained >= 3 players before taking it")
    prepositioned_secure: Rate | None = Field(
        None, description="Secure rate when 3+ players were in place at spawn"
    )


class Tell(BaseModel):
    template_id: str
    group: str
    title: str
    rate: Rate
    shrunk_rate: float
    q: float = Field(description="Benjamini-Hochberg adjusted p-value")
    strength: Strength
    direction: Literal["above", "below"]


class TeamProfile(BaseModel):
    team: TeamSummary
    jungle: JungleProfile | None
    objectives: list[ObjectiveProfile]
    tells: list[Tell] = Field(
        description="All scored templates; filter on `strength` for notable ones"
    )
    notes: list[str] = Field(
        default_factory=list, description="Caveats to show next to the numbers"
    )


class EvidenceItem(BaseModel):
    game_id: str
    series_id: str
    date: str
    opponent: str
    side: Side
    t_trigger: int
    hit: bool
    t_outcome: int | None


class ReplayPlayer(BaseModel):
    slot: int = Field(ge=0, le=9)
    player_id: str
    name: str
    side: Side
    role: Role
    champion: str | None


class ReplayEvent(BaseModel):
    t: int
    kind: str = Field(description="kill | objective | structure | spawn | respawn | ...")
    name: str
    slot: int | None = None
    target_slot: int | None = None
    x: int | None = None
    y: int | None = None


class Replay(BaseModel):
    game_id: str
    series_id: str
    duration_s: int
    bounds: tuple[float, float, float, float] = Field(description="min_x, min_y, max_x, max_y")
    players: list[ReplayPlayer]
    positions: list[list[tuple[int, int]]] = Field(
        description="positions[t][slot] = (x, y) once per second; (-1, -1) when unknown"
    )
    events: list[ReplayEvent]
    blue_team: str
    red_team: str
    winner_side: Side | None
    event: str | None = Field(None, description="League and split, e.g. 'LCS - Split 2 2026'")
    started_at: str | None = Field(None, description="ISO start time of the game (UTC)")
    game_number: int | None = Field(None, description="Game number within the series")


# --- Draft: Fearless pool planner and its backtest -------------------------------------------------


class PoolEntry(BaseModel):
    champion: str
    share: float = Field(
        description="Share of the player's full comfortable pool this champion represents"
    )


class RolePool(BaseModel):
    role: Role
    player_id: str
    player_name: str | None = None
    history: int = Field(description="Picks the pool is based on; always show next to the numbers")
    mass: float = Field(
        description="Share of the pool still available after locked champions and bans"
    )
    depth: int = Field(description="Available champions the player has played at least twice")
    status: Literal["ok", "thin", "critical"]
    remaining: list[PoolEntry]


class BanSuggestion(BaseModel):
    role: Role
    champion: str
    share_of_remaining: float = Field(
        description="Fraction of what the player has left that this ban removes"
    )


class TeamPoolState(BaseModel):
    team_id: str
    name: str
    roles: list[RolePool] = Field(description="Weakest role first")
    untrusted_roles: list[str] = Field(description="Roles left out for lack of history")
    ban_suggestions: list[BanSuggestion]


class TeamForecast(BaseModel):
    team_id: str
    mean_stress: list[float] = Field(
        description="Mean lowest-role pool left at the start of game 1..N"
    )
    p_critical: dict[str, list[float]] = Field(
        description="role -> P(critical) at the start of game 1..N"
    )
    weakest_at_end: dict[str, float] = Field(
        description="role -> P(it is the weakest role at game N)"
    )


class JungleBridge(BaseModel):
    champion: str
    n: int
    scope: Literal["team", "league"]
    start_top: float
    start_bot: float
    first_lane: dict[str, float]
    no_early_lane: float
    median_first_lane_t: int | None


class SeriesPlanResponse(BaseModel):
    ours: TeamPoolState
    opponent: TeamPoolState
    forecast: list[TeamForecast] | None
    n_sims: int
    jungle_bridges: list[JungleBridge]
    notes: list[str]


class DepletionPoint(BaseModel):
    game_number: int
    team_games: int
    mean_stress: float


class StressBucket(BaseModel):
    label: str
    n: int
    wins: int
    win_rate: float
    ci_lo: float
    ci_hi: float


class PairwiseResult(BaseModel):
    n: int
    wins: int
    rate: float
    ci_lo: float
    ci_hi: float
    p_value: float


class CalibrationPoint(BaseModel):
    game_number: int
    series: int
    simulated: float
    actual: float | None
    actual_n: int


class PickDepthPoint(BaseModel):
    game_number: int
    picks: int
    mean_rank: float = Field(
        description="Rank of the pick in the player's full pool (1 = most played)"
    )
    share_top3: float
    share_new: float = Field(description="Share of picks the player had never played before")


class DraftBacktest(BaseModel):
    """Served as-is from ``draft_backtest.json``. Always show ``caveats`` next to the numbers."""

    depletion: list[DepletionPoint]
    buckets: list[StressBucket]
    pairwise: PairwiseResult
    calibration: list[CalibrationPoint]
    weakest_role_share: dict[str, float]
    pick_depth: list[PickDepthPoint] = Field(
        description="League-wide Fearless shift by game number"
    )
    caveats: list[str]


# --- Draft room: everything the board needs for one matchup -----------------------------------------


class ContextPoolEntry(BaseModel):
    champion: str
    share: float = Field(description="Share of the player's recency-weighted pool")
    games: int


class ContextPlayer(BaseModel):
    player_id: str
    name: str
    role: Role
    history: int = Field(description="Picks the pool is based on")
    pool: list[ContextPoolEntry]


class ContextTeam(BaseModel):
    team_id: str
    name: str
    short: str
    players: list[ContextPlayer] = Field(description="The team's most recent lineup, in role order")


class RecentPick(BaseModel):
    champion: str
    role: Role


class RecentGame(BaseModel):
    game_id: str
    date: str
    opponent: str
    side: Side
    won: bool
    duration_s: int
    picks: list[RecentPick]
    bans: list[str]


class SeriesContext(BaseModel):
    """The draft room for one matchup. The games of the live series are entered by the coach in the UI."""

    ours: ContextTeam
    opponent: ContextTeam
    format: int = 5
    opponent_recent: list[RecentGame] = Field(description="Opponent's last 5 games, newest first")
    jungle_bridges: dict[str, JungleBridge] = Field(
        description="Keyed by champion, for the opponent jungler's pool"
    )
    league_top3_share_by_game: list[float] = Field(
        description="From draft_backtest.json pick_depth.share_top3"
    )


# --- Draft tendencies of one team: what repeats, and how the draft shifts in Fearless games -------------


class DraftTendencyItem(BaseModel):
    """A champion's ban or pick rate for the team next to the league rate. Show ``team_games`` as ``n``."""

    champion: str
    count: int
    team_games: int
    rate: float
    league_rate: float
    q: float = Field(description="Benjamini-Hochberg adjusted p-value against the league rate")
    direction: Literal["above", "below"]
    strength: Strength
    evidence_game_ids: list[str] = Field(description="Games where it happened, newest last (max 8)")


class BanTarget(BaseModel):
    role: Role
    team_share: float = Field(description="Share of the team's bans that aim at this role")
    league_share: float
    n: int = Field(description="The team's bans that could be read through a role")


class FearlessShiftPoint(BaseModel):
    game_number: int
    picks: int = Field(description="Picks with a trusted pool; the sample size of the point")
    mean_rank: float = Field(
        description="Rank of the pick in the player's full pool (1 = most played)"
    )
    league_mean_rank: float | None
    share_top3: float
    league_share_top3: float | None
    share_new: float = Field(description="Share of picks the player had never played before")
    league_share_new: float | None


class TeamDraftTendencies(BaseModel):
    team_id: str
    name: str
    scope: Literal["all", "g1", "later"]
    team_games: int
    picks: list[DraftTendencyItem]
    bans: list[DraftTendencyItem]
    ban_targets: list[BanTarget]
    fearless_shift: list[FearlessShiftPoint]
    notes: list[str]
