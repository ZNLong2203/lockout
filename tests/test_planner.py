"""Planner and macro-bridge tests (synthetic data only)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from macrodna.draft.planner import PickIndex, jungle_bridge, plan_series, team_state
from macrodna.draft.pools import MIN_HISTORY, PickRec

T0 = datetime(2026, 1, 1, tzinfo=UTC)
ROLES = ("top", "jungle", "mid", "adc", "support")


def _league() -> PickIndex:
    picks: list[PickRec] = []
    for team in ("t1", "t2"):
        for role in ROLES:
            pid = f"{team}-{role}"
            for n in range(MIN_HISTORY + 4):
                # mid players of t1 are one-trick (Ahri); everybody else rotates across three champions
                champ = "Ahri" if (team == "t1" and role == "mid") else f"{role}-{n % 3}"
                picks.append(
                    PickRec(
                        f"{pid}-{n}",
                        f"s{pid}{n}",
                        1,
                        T0 + timedelta(days=n),
                        team,
                        pid,
                        role,
                        champ,
                        True,
                    )
                )
    # one recent game so that `current_lineup` has a full five
    for team in ("t1", "t2"):
        for role in ROLES:
            picks.append(
                PickRec(
                    "last",
                    "slast",
                    1,
                    T0 + timedelta(days=60),
                    team,
                    f"{team}-{role}",
                    role,
                    f"{role}-0",
                    True,
                )
            )
    return PickIndex(sorted(picks, key=lambda p: p.t))


def test_current_lineup_is_the_latest_game_in_role_order() -> None:
    lineup = _league().current_lineup("t1")
    assert [p.role for p in lineup] == list(ROLES)
    assert {p.game_id for p in lineup} == {"last"}


def test_a_one_trick_collapses_when_the_champion_is_locked() -> None:
    index = _league()
    state = team_state(index, "t1", {"Ahri"}, index.now())
    assert state.runways[0].role == "mid" and state.runways[0].mass < 0.2
    assert state.runways[0].status == "critical"
    assert all(r.mass > 0.6 for r in state.runways[1:])


def test_ban_suggestions_target_the_fragile_roles_first() -> None:
    index = _league()
    state = team_state(index, "t2", {"top-0", "jungle-0"}, index.now())
    assert {role for role, _, _ in state.ban_suggestions} <= {r.role for r in state.runways[:2]}
    assert all(0 < share <= 1 for _, _, share in state.ban_suggestions)


def test_plan_series_produces_a_forecast_and_notes_about_missing_history() -> None:
    index = _league()
    plan = plan_series(index, "t1", "t2", locked=set(), n_sims=40)
    assert plan.forecast is not None and plan.forecast.games == 4
    assert plan.forecast.mean_stress["t1"][0] == pytest.approx(1.0)
    # a team with no history cannot be forecast, and says so
    plan2 = plan_series(index, "t1", "ghost", locked=set(), n_sims=10)
    assert plan2.forecast is None and any("Forecast skipped" in n for n in plan2.notes)


def test_jungle_bridge_summarises_how_a_champion_is_played(tmp_path: Path) -> None:
    draft = pa.table(
        {
            "game_id": ["g1", "g2", "g3", "g4"],
            "team_id": ["t1"] * 4,
            "action": ["pick"] * 4,
            "role": ["jungle"] * 4,
            "champion": ["Vi", "Vi", "Vi", "Nocturne"],
        }
    )
    jungle = pa.table(
        {
            "game_id": ["g1", "g2", "g3", "g4"],
            "team_id": ["t1"] * 4,
            "start_side": ["top", "top", "bot", "bot"],
            "first_lane": ["mid", "mid", None, "bot"],
            "first_lane_t": pa.array([200, 220, None, 300], type=pa.int64()),
            "buff_start": [True, False, True, True],
        }
    )
    pq.write_table(draft, tmp_path / "draft_enriched.parquet")
    pq.write_table(jungle, tmp_path / "jungle.parquet")
    bridge = jungle_bridge(tmp_path, "Vi")
    assert bridge is not None and bridge["n"] == 3
    assert bridge["start_top"] == pytest.approx(2 / 3)
    assert bridge["first_lane"]["mid"] == pytest.approx(2 / 3)  # type: ignore[index]
    assert bridge["no_early_lane"] == pytest.approx(1 / 3)
    assert jungle_bridge(tmp_path, "Vi", team_id="other") is None
    assert duckdb  # the helper reads Parquet through DuckDB
