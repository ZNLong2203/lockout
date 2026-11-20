"""Draft pools, stress analysis and the Fearless simulator (synthetic data only)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from macrodna.draft.analysis import (
    bucketise,
    depletion_curve,
    locked_before,
    stress_rows,
    weakest_role_share,
)
from macrodna.draft.pools import (
    MIN_HISTORY,
    PickRec,
    ban_targets,
    classify,
    pool_weights,
    runway,
    stress,
    weight,
)
from macrodna.draft.simulate import SimPlayer, simulate

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _pick(
    i: int,
    champion: str,
    *,
    player: str = "p1",
    team: str = "t1",
    game: int = 1,
    series: str = "s0",
    days: float = 0.0,
    won: bool = True,
    role: str = "mid",
) -> PickRec:
    return PickRec(
        f"g{i}", series, game, T0 + timedelta(days=days), team, player, role, champion, won
    )


def _history(champs: list[str], player: str = "p1") -> list[PickRec]:
    return [_pick(i, c, player=player, series=f"h{i}", days=i) for i, c in enumerate(champs)]


def test_recency_weight_halves_every_half_life() -> None:
    assert weight(0) == 1.0
    assert weight(120) == pytest.approx(0.5)
    assert weight(240) == pytest.approx(0.25)


def test_pool_weights_sum_to_one_and_favour_recent_picks() -> None:
    hist = [_pick(0, "Ahri", days=0), _pick(1, "Orianna", days=300)]
    shares = pool_weights(hist, T0 + timedelta(days=301))
    assert sum(shares.values()) == pytest.approx(1.0)
    assert shares["Orianna"] > shares["Ahri"]


def test_runway_removes_locked_champions_and_flags_status() -> None:
    hist = _history(["Ahri"] * 6 + ["Azir"] * 2 + ["Syndra"] * 2)
    now = T0 + timedelta(days=100)
    free = runway("p1", "mid", hist, now, set())
    assert free is not None and free.mass == pytest.approx(1.0) and free.status == "ok"
    locked = runway("p1", "mid", hist, now, {"Ahri"})
    assert locked is not None and locked.mass < 0.6
    assert "Ahri" not in [c for c, _ in locked.remaining]
    assert locked.status in {"thin", "critical"}
    assert classify(0.2) == "critical" and classify(0.5) == "thin" and classify(0.9) == "ok"


def test_runway_needs_enough_history() -> None:
    hist = _history(["Ahri"] * (MIN_HISTORY - 1))
    assert runway("p1", "mid", hist, T0 + timedelta(days=100), set()) is None


def test_stress_is_the_lowest_mass_and_needs_four_valid_players() -> None:
    hist = _history(["Ahri"] * 8 + ["Azir"] * 2)
    r_ok = runway("p1", "mid", hist, T0 + timedelta(days=100), set())
    r_low = runway("p1", "mid", hist, T0 + timedelta(days=100), {"Ahri"})
    assert stress([r_ok, r_ok, r_ok, r_low, None]) == r_low.mass  # type: ignore[union-attr]
    assert stress([r_ok, r_ok, None, None, None]) is None


def test_ban_targets_report_share_of_what_is_left() -> None:
    hist = _history(["Ahri"] * 6 + ["Azir"] * 3 + ["Syndra"] * 1)
    r = runway("p1", "mid", hist, T0 + timedelta(days=50), {"Syndra"})
    assert r is not None
    targets = ban_targets(r, k=2)
    assert [c for c, _ in targets] == ["Ahri", "Azir"]
    assert sum(share for _, share in ban_targets(r, k=5)) == pytest.approx(1.0)


def test_locked_before_collects_both_teams_earlier_games_only() -> None:
    series = [
        _pick(0, "A", game=1),
        _pick(1, "B", game=1, team="t2", player="p2"),
        _pick(2, "C", game=2),
    ]
    assert locked_before(series, 2) == {"A", "B"}
    assert locked_before(series, 1) == set()


def _league_with_series() -> list[PickRec]:
    """Five players per team with a long history, then one 2-game Fearless series."""
    picks: list[PickRec] = []
    i = 0
    roles = ["top", "jungle", "mid", "adc", "support"]
    for team in ("t1", "t2"):
        for k, role in enumerate(roles):
            pid = f"{team}{role}"
            for n in range(MIN_HISTORY + 2):
                champ = f"{role}-{k}-{n % 3}"  # three champions per player
                picks.append(
                    PickRec(
                        f"h{i}", f"hist{i}", 1, T0 + timedelta(days=n), team, pid, role, champ, True
                    )
                )
                i += 1
    start = T0 + timedelta(days=100)
    for game in (1, 2):
        for team in ("t1", "t2"):
            for k, role in enumerate(roles):
                champ = f"{role}-{k}-{game - 1}"  # game 1 spends champion 0, game 2 champion 1
                picks.append(
                    PickRec(
                        f"s{game}",
                        "series",
                        game,
                        start + timedelta(days=game),
                        team,
                        f"{team}{role}",
                        role,
                        champ,
                        team == "t1",
                    )
                )
    return picks


def test_stress_rows_score_later_games_and_see_the_lock() -> None:
    rows = [r for r in stress_rows(_league_with_series()) if r.game_id == "s2"]
    assert len(rows) == 2 and {r.game_number for r in rows} == {2}
    assert all(0 < r.stress < 1 for r in rows), "one of three champions is locked for every player"
    assert {r.team_id: r.won for r in rows} == {"t1": True, "t2": False}


def test_buckets_curve_and_weakest_role() -> None:
    rows = stress_rows(_league_with_series())
    buckets = bucketise(rows)
    assert sum(b.n for b in buckets) == len(rows)
    assert depletion_curve(rows)[2][0] == 2
    assert pytest.approx(sum(weakest_role_share(rows).values())) == 1.0


def _sim_team(prefix: str, shares: dict[str, float]) -> list[SimPlayer]:
    return [
        SimPlayer(f"{prefix}{r}", r, dict(shares))
        for r in ("top", "jungle", "mid", "adc", "support")
    ]


def test_simulation_with_one_champion_per_player_runs_dry_immediately() -> None:
    f = simulate(
        {"a": _sim_team("a", {"X": 1.0}), "b": _sim_team("b", {"Y": 1.0})}, games=3, n_sims=20
    )
    assert f.mean_stress["a"][0] == 1.0, "nothing is locked before game 1"
    assert f.mean_stress["a"][1] == 0.0
    assert f.p_critical["a"]["mid"][1] == 1.0


def test_simulation_is_reproducible_and_pools_only_shrink() -> None:
    deep = {f"c{i}": 1 / 12 for i in range(12)}
    teams = {"a": _sim_team("a", deep), "b": _sim_team("b", deep)}
    f1, f2 = (
        simulate(teams, games=4, n_sims=100, seed=3),
        simulate(teams, games=4, n_sims=100, seed=3),
    )
    assert f1.mean_stress == f2.mean_stress
    curve = f1.mean_stress["a"]
    assert curve[0] == 1.0 and all(x >= y for x, y in zip(curve, curve[1:], strict=False))
