"""Draft analysis over the enriched cache: pool stress backtest, depletion curve, ban targeting.

``backtest_stress`` is the honesty check for the headline idea. It asks, using only information available
*before* each game, whether lineups that start a Fearless game with a more depleted pool actually do worse.
The answer is reported as it comes out, with sample sizes and intervals.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import duckdb

from macrodna.detectors.tells import wilson_interval
from macrodna.draft.pools import PickRec, RoleRunway, runway, stress


def load_picks(cache_lol_dir: Path) -> list[PickRec]:
    con = duckdb.connect()
    rows = con.sql(
        f"""select game_id, series_id, game_number, started_at, team_id, player_id, role, champion, won
            from read_parquet('{cache_lol_dir}/draft_enriched.parquet')
            where action = 'pick' and player_id is not null and role is not null and role <> 'unknown'
            order by started_at, game_id"""
    ).fetchall()
    return [
        PickRec(
            g, s, int(n), datetime.fromisoformat(t.replace("Z", "+00:00")), team, p, r, c, bool(w)
        )
        for g, s, n, t, team, p, r, c, w in rows
    ]


@dataclass(frozen=True, slots=True)
class StressRow:
    game_id: str
    team_id: str
    game_number: int
    stress: float
    weakest_role: str
    won: bool


def _index(picks: list[PickRec]):
    by_player: dict[str, list[PickRec]] = defaultdict(list)
    by_team_game: dict[tuple[str, str], list[PickRec]] = defaultdict(list)
    by_series: dict[str, list[PickRec]] = defaultdict(list)
    for p in picks:
        by_player[p.player_id].append(p)
        by_team_game[(p.game_id, p.team_id)].append(p)
        by_series[p.series_id].append(p)
    return by_player, by_team_game, by_series


def locked_before(series_picks: list[PickRec], game_number: int) -> set[str]:
    """Champions picked in earlier games of the series, by either team (Fearless lock)."""
    return {p.champion for p in series_picks if p.game_number < game_number}


def lineup_runways(
    lineup: list[PickRec], by_player: dict[str, list[PickRec]], locked: set[str]
) -> list[RoleRunway | None]:
    return [runway(p.player_id, p.role, by_player[p.player_id], p.t, locked) for p in lineup]


def stress_rows(picks: list[PickRec]) -> list[StressRow]:
    by_player, by_team_game, by_series = _index(picks)
    rows: list[StressRow] = []
    for (game_id, team_id), lineup in by_team_game.items():
        first = lineup[0]
        if first.game_number < 2 or len(lineup) != 5:
            continue
        locked = locked_before(by_series[first.series_id], first.game_number)
        runways = lineup_runways(lineup, by_player, locked)
        s = stress(runways)
        if s is None:
            continue
        valid = [r for r in runways if r is not None]
        weakest = min(valid, key=lambda r: r.mass)
        rows.append(StressRow(game_id, team_id, first.game_number, s, weakest.role, first.won))
    return rows


@dataclass(frozen=True, slots=True)
class Bucket:
    label: str
    n: int
    wins: int
    win_rate: float
    ci_lo: float
    ci_hi: float


def bucketise(rows: list[StressRow], edges: tuple[float, float] = (0.35, 0.6)) -> list[Bucket]:
    spec = [
        (f"critical (< {edges[0]:.0%} of pool left)", lambda s: s < edges[0]),
        (f"thin ({edges[0]:.0%}-{edges[1]:.0%})", lambda s: edges[0] <= s < edges[1]),
        (f"comfortable (>= {edges[1]:.0%})", lambda s: s >= edges[1]),
    ]
    out = []
    for label, pred in spec:
        sel = [r for r in rows if pred(r.stress)]
        wins = sum(r.won for r in sel)
        lo, hi = wilson_interval(wins, len(sel))
        out.append(Bucket(label, len(sel), wins, wins / len(sel) if sel else 0.0, lo, hi))
    return out


def depletion_curve(rows: list[StressRow]) -> dict[int, tuple[int, float]]:
    """{game_number: (team-games, mean stress)}: how fast the weakest role's pool disappears."""
    acc: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        acc[r.game_number].append(r.stress)
    return {g: (len(v), sum(v) / len(v)) for g, v in sorted(acc.items())}


def weakest_role_share(rows: list[StressRow]) -> dict[str, float]:
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r.weakest_role] += 1
    total = sum(counts.values()) or 1
    return {role: n / total for role, n in sorted(counts.items(), key=lambda kv: -kv[1])}
