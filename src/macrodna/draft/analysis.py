"""Draft analysis over the enriched cache: pool stress backtest, depletion curve, ban targeting.

``backtest_stress`` is the honesty check for the headline idea. It asks, using only information available
*before* each game, whether lineups that start a Fearless game with a more depleted pool actually do worse.
The answer is reported as it comes out, with sample sizes and intervals.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
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


def pairwise_result(rows: list[StressRow]) -> dict[str, float | int]:
    """Within the same game: does the team with the more comfortable pool win more often?

    Comparing the two teams of one game removes the effect of the game number and series context.
    """
    from scipy.stats import binomtest

    by_game: dict[str, list[StressRow]] = defaultdict(list)
    for r in rows:
        by_game[r.game_id].append(r)
    n = wins = 0
    for pair in by_game.values():
        if len(pair) != 2 or pair[0].stress == pair[1].stress:
            continue
        comfortable = max(pair, key=lambda r: r.stress)
        n += 1
        wins += comfortable.won
    if n == 0:
        return {"n": 0, "wins": 0, "rate": 0.0, "ci_lo": 0.0, "ci_hi": 1.0, "p_value": 1.0}
    lo, hi = wilson_interval(wins, n)
    return {
        "n": n,
        "wins": wins,
        "rate": wins / n,
        "ci_lo": lo,
        "ci_hi": hi,
        "p_value": float(binomtest(wins, n, 0.5).pvalue),
    }


def calibrate_simulator(
    picks: list[PickRec], rows: list[StressRow], n_sims: int = 200
) -> list[dict[str, float | int | None]]:
    """Compare the simulator's mean stress with the real one, on series where both are defined."""
    import numpy as np

    from macrodna.draft.pools import MIN_HISTORY, pool_weights
    from macrodna.draft.simulate import SimPlayer, simulate

    by_player, _, by_series = _index(picks)
    by_game: dict[tuple[str, int], list[PickRec]] = defaultdict(list)
    for p in picks:
        by_game[(p.series_id, p.game_number)].append(p)
    simulated: dict[int, list[float]] = defaultdict(list)
    series_used: set[str] = set()
    for sid, series_picks in by_series.items():
        games = {p.game_number for p in series_picks}
        first = by_game.get((sid, 1), [])
        if max(games) < 3 or len(first) != 10:
            continue
        t0 = first[0].t
        teams: dict[str, list[SimPlayer]] = defaultdict(list)
        ok = True
        for p in first:
            hist = [h for h in by_player[p.player_id] if h.t < t0]
            if len(hist) < MIN_HISTORY:
                ok = False
                break
            teams[p.team_id].append(SimPlayer(p.player_id, p.role, pool_weights(hist, t0)))
        if not ok or len(teams) != 2 or any(len(v) != 5 for v in teams.values()):
            continue
        forecast = simulate(dict(teams), games=3, n_sims=n_sims, seed=1)
        for curve in forecast.mean_stress.values():
            for g, v in enumerate(curve, start=1):
                simulated[g].append(v)
        series_used.add(sid)
    game_series = {p.game_id: p.series_id for p in picks}
    actual: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        if game_series[r.game_id] in series_used and r.game_number in (2, 3):
            actual[r.game_number].append(r.stress)
    return [
        {
            "game_number": g,
            "series": len(series_used),
            "simulated": float(np.mean(simulated[g])),
            "actual": float(np.mean(actual[g])) if actual.get(g) else None,
            "actual_n": len(actual.get(g, [])),
        }
        for g in (1, 2, 3)
    ]


def write_backtest(cache_lol_dir: Path) -> dict[str, object]:
    import json

    picks = load_picks(cache_lol_dir)
    rows = stress_rows(picks)
    summary: dict[str, object] = {
        "depletion": [
            {"game_number": g, "team_games": n, "mean_stress": m}
            for g, (n, m) in depletion_curve(rows).items()
        ],
        "buckets": [asdict(b) for b in bucketise(rows)],
        "pairwise": pairwise_result(rows),
        "calibration": calibrate_simulator(picks, rows),
        "weakest_role_share": weakest_role_share(rows),
        "caveats": [
            "Pools use only information available before each game (no look-ahead).",
            "The within-game comparison is one of several looked at; treat it as suggestive.",
            "Bans are not modelled in the simulator, which makes it slightly optimistic.",
            "Games 4 and 5 are rare in the corpus (about 150 and 60 team-games).",
        ],
    }
    (cache_lol_dir / "draft_backtest.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary
