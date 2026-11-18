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
