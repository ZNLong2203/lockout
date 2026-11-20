"""Fearless series planner: pool state, ban targets, forecast and the bridge to macro context.

Given two teams and the champions already locked in the series, it answers the coach's questions:
*which role of theirs (and ours) is running out of comfortable champions, what would a ban take away,
and how likely is each role to be critical in the next games?*
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import duckdb

from lockout.draft.analysis import load_picks
from lockout.draft.pools import MIN_HISTORY, PickRec, RoleRunway, ban_targets, pool_weights, runway
from lockout.draft.simulate import SeriesForecast, SimPlayer, simulate

ROLE_ORDER = ("top", "jungle", "mid", "adc", "support")


@dataclass(slots=True)
class TeamState:
    team_id: str
    runways: list[RoleRunway]  # weakest first
    untrusted: list[str] = field(default_factory=list)  # players with too little history
    ban_suggestions: list[tuple[str, str, float]] = field(
        default_factory=list
    )  # (role, champion, share left)


@dataclass(slots=True)
class SeriesPlan:
    team: TeamState
    opponent: TeamState
    forecast: SeriesForecast | None
    notes: list[str]


class PickIndex:
    """Pick history indexed for the planner."""

    def __init__(self, picks: list[PickRec]) -> None:
        self.picks = picks
        self.by_player: dict[str, list[PickRec]] = defaultdict(list)
        self.by_team: dict[str, list[PickRec]] = defaultdict(list)
        for p in picks:
            self.by_player[p.player_id].append(p)
            self.by_team[p.team_id].append(p)

    @classmethod
    def load(cls, cache_lol_dir: Path) -> PickIndex:
        return cls(load_picks(cache_lol_dir))

    def current_lineup(self, team_id: str) -> list[PickRec]:
        """The five players of the team's most recent game, in role order."""
        history = self.by_team.get(team_id, [])
        if not history:
            return []
        last = max(history, key=lambda p: (p.t, p.game_id))
        lineup = [p for p in history if p.game_id == last.game_id]
        return sorted(lineup, key=lambda p: ROLE_ORDER.index(p.role) if p.role in ROLE_ORDER else 9)

    def now(self) -> datetime:
        return max(p.t for p in self.picks)

    def find_team(self, names: dict[str, str], query: str) -> tuple[str, str] | None:
        """A team id, or part of a team name, to ``(team_id, name)``; ``None`` if nobody matches.

        Only teams with picks qualify. When several share a name the most recently active one wins.
        """
        q = query.strip()
        if not q:
            return None
        if q in names and q in self.by_team:
            return q, names[q]
        hits = [
            (tid, n) for tid, n in names.items() if q.lower() in n.lower() and tid in self.by_team
        ]
        if not hits:
            return None
        return max(hits, key=lambda h: max(p.t for p in self.by_team[h[0]]))


def team_state(index: PickIndex, team_id: str, unavailable: set[str], as_of: datetime) -> TeamState:
    runways: list[RoleRunway] = []
    untrusted: list[str] = []
    for p in index.current_lineup(team_id):
        r = runway(p.player_id, p.role, index.by_player[p.player_id], as_of, unavailable)
        (runways.append(r) if r is not None else untrusted.append(p.role))
    runways.sort(key=lambda r: r.mass)
    suggestions: list[tuple[str, str, float]] = []
    for r in runways[:2]:  # the two most fragile roles
        suggestions += [(r.role, c, share) for c, share in ban_targets(r, k=2)]
    return TeamState(team_id, runways, untrusted, suggestions)


def plan_series(
    index: PickIndex,
    team_id: str,
    opponent_id: str,
    locked: set[str],
    banned: set[str] | None = None,
    games: int = 4,
    n_sims: int = 400,
    as_of: datetime | None = None,
) -> SeriesPlan:
    as_of = as_of or index.now()
    unavailable = set(locked) | set(banned or ())
    mine = team_state(index, team_id, unavailable, as_of)
    theirs = team_state(index, opponent_id, unavailable, as_of)
    notes: list[str] = []
    for state, label in ((mine, "our"), (theirs, "opponent")):
        if state.untrusted:
            notes.append(
                f"{label}: not enough history for {', '.join(state.untrusted)} "
                f"(needs {MIN_HISTORY}+ picks); those roles are left out."
            )
    forecast = None
    lineups = {}
    for tid in (team_id, opponent_id):
        sims = []
        for p in index.current_lineup(tid):
            hist = [h for h in index.by_player[p.player_id] if h.t < as_of]
            if len(hist) >= MIN_HISTORY:
                sims.append(SimPlayer(p.player_id, p.role, pool_weights(hist, as_of)))
        if len(sims) == 5:
            lineups[tid] = sims
    if len(lineups) == 2:
        # the forecast starts from an empty lock: it answers "what happens over the series", not "from here"
        forecast = simulate(lineups, games=games, n_sims=n_sims, seed=7)
    else:
        notes.append("Forecast skipped: both lineups need five players with enough history.")
    if locked:
        notes.append(
            "Forecast assumes a fresh series; the pool state above already includes your locked champions."
        )
    return SeriesPlan(mine, theirs, forecast, notes)


def jungle_bridge(
    cache_lol_dir: Path, champion: str, team_id: str | None = None
) -> dict[str, object] | None:
    """Macro context for a jungle pick: how the jungler with this champion opens and where they show first."""
    con = duckdb.connect()
    d = str(cache_lol_dir)
    where = "e.champion = ? and e.action = 'pick' and e.role = 'jungle'"
    params: list[object] = [champion]
    if team_id:
        where += " and e.team_id = ?"
        params.append(team_id)
    rows = con.execute(
        f"""select j.start_side, j.first_lane, j.first_lane_t, j.buff_start
            from read_parquet('{d}/draft_enriched.parquet') e
            join read_parquet('{d}/jungle.parquet') j on j.game_id = e.game_id and j.team_id = e.team_id
            where {where}""",
        params,
    ).fetchall()
    n = len(rows)
    if n == 0:
        return None

    def share(idx: int, value: str) -> float:
        return sum(1 for r in rows if r[idx] == value) / n

    lane_ts = sorted(r[2] for r in rows if r[2] is not None)
    return {
        "champion": champion,
        "n": n,
        "start_top": share(0, "top"),
        "start_bot": share(0, "bot"),
        "first_lane": {lane: share(1, lane) for lane in ("top", "mid", "bot")},
        "no_early_lane": sum(1 for r in rows if r[1] is None) / n,
        "median_first_lane_t": lane_ts[len(lane_ts) // 2] if lane_ts else None,
    }
