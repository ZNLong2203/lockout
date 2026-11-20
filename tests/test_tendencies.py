"""Pick/ban tendency tests (synthetic rows only)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from lockout.draft.pools import MIN_HISTORY, PickRec
from lockout.draft.tendencies import (
    MIN_TEAM_GAMES,
    DraftRow,
    ban_role_targeting,
    champion_roles,
    in_scope,
    pick_depth_by_game,
    team_tendencies,
    tendency_report,
)

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _rows() -> list[DraftRow]:
    """20 games. Team A bans Poppy in 15 of them; team B and everyone else rarely does."""
    rows: list[DraftRow] = []
    for g in range(20):
        for team, side in (("A", "blue"), ("B", "red")):
            rows.append(
                DraftRow(f"g{g}", 1 + g % 3, team, side, "pick", "pick1", f"c{g % 5}", "mid")
            )
            if team == "A" and g < 15:
                rows.append(DraftRow(f"g{g}", 1 + g % 3, team, side, "ban", "ban1", "Poppy", None))
            if team == "B" and g < 2:
                rows.append(DraftRow(f"g{g}", 1 + g % 3, team, side, "ban", "ban1", "Poppy", None))
            rows.append(
                DraftRow(f"g{g}", 1 + g % 3, team, side, "ban", "ban1", f"filler{g % 7}", None)
            )
    return rows


def test_a_repeated_ban_is_flagged_against_the_league() -> None:
    tend = team_tendencies(_rows(), "A")
    poppy = next(t for t in tend if t.action == "ban" and t.champion == "Poppy")
    assert poppy.count == 15 and poppy.team_games == 20 and poppy.direction == "above"
    assert poppy.q < 0.05 and poppy.strength == "strong"
    assert len(poppy.evidence) <= 8 and poppy.evidence[-1].startswith("g")
    assert poppy.league_rate == pytest.approx(17 / 40)


def test_the_other_team_is_not_flagged_for_the_same_champion() -> None:
    tend = team_tendencies(_rows(), "B")
    poppy = next((t for t in tend if t.champion == "Poppy" and t.action == "ban"), None)
    assert poppy is None or poppy.direction == "below"


def test_scopes_split_first_games_from_later_ones() -> None:
    rows = _rows()
    g1 = [r for r in rows if in_scope(r, "g1")]
    later = [r for r in rows if in_scope(r, "later")]
    assert g1 and later and len(g1) + len(later) == len(rows)
    assert all(r.game_number == 1 for r in g1) and all(r.game_number >= 2 for r in later)
    assert team_tendencies(rows, "ghost") == []


def test_ban_role_targeting_reads_the_role_a_banned_champion_usually_plays() -> None:
    rows = [
        DraftRow("g1", 1, "A", "blue", "pick", "pick1", "Ahri", "mid"),
        DraftRow("g1", 1, "B", "red", "pick", "pick1", "Ornn", "top"),
        DraftRow("g2", 1, "A", "blue", "ban", "ban1", "Ahri", None),
        DraftRow("g2", 1, "A", "blue", "ban", "ban1", "Ahri", None),
        DraftRow("g2", 1, "B", "red", "ban", "ban1", "Ornn", None),
    ]
    assert champion_roles(rows) == {"Ahri": "mid", "Ornn": "top"}
    target = ban_role_targeting(rows, "A")
    assert target["mid"][0] == pytest.approx(1.0) and target["mid"][2] == 2
    assert target["top"][0] == 0.0 and target["top"][1] == pytest.approx(1 / 3)


def test_pick_depth_rises_when_a_player_is_pushed_off_his_main() -> None:
    picks: list[PickRec] = []
    # one player with a clear ordering: Main (10x) > Second (6x) > Third (4x), then a short series
    for i in range(MIN_HISTORY + 12):
        champ = "Main" if i < 10 else "Second" if i < 16 else "Third"
        picks.append(
            PickRec(f"h{i}", f"hs{i}", 1, T0 + timedelta(days=i), "t", "p", "mid", champ, True)
        )
    start = T0 + timedelta(days=100)
    picks.append(PickRec("s1", "series", 1, start, "t", "p", "mid", "Main", True))
    picks.append(
        PickRec("s2", "series", 2, start + timedelta(days=1), "t", "p", "mid", "Third", False)
    )
    picks.append(
        PickRec("s3", "series", 3, start + timedelta(days=2), "t", "p", "mid", "Brand New", False)
    )
    depth = {d.game_number: d for d in pick_depth_by_game(picks, "t")}
    assert depth[1].mean_rank < depth[2].mean_rank
    assert depth[3].share_new == 1.0, "a champion never played before counts as new"
    assert pick_depth_by_game(picks, "someone else") == []


def _report_picks() -> list[PickRec]:
    """Team A's player drifts off his main in game 2; team B's player never does (the league baseline)."""
    picks: list[PickRec] = []
    for team, player, game2 in (("A", "pA", "Third"), ("B", "pB", "Main")):
        for i in range(MIN_HISTORY + 12):
            champ = "Main" if i < 10 else "Second" if i < 16 else "Third"
            picks.append(
                PickRec(f"{player}h{i}", f"{player}hs{i}", 1, T0 + timedelta(days=i), team, player, "mid", champ, True)
            )  # fmt: skip
        start = T0 + timedelta(days=100)
        picks.append(
            PickRec(f"{player}s1", f"{player}s", 1, start, team, player, "mid", "Main", True)
        )
        picks.append(
            PickRec(f"{player}s2", f"{player}s", 2, start + timedelta(days=1), team, player, "mid", game2, False)
        )  # fmt: skip
    return picks


def test_report_bundles_rates_and_the_fearless_shift_with_league_baselines() -> None:
    report = tendency_report(_rows(), _report_picks(), "A", "all", top=3)
    assert report is not None and report.team_games == 20
    assert report.bans[0].champion == "Poppy" and report.bans[0].strength == "strong"
    assert report.bans[0].team_games == 20 and report.bans[0].evidence_game_ids
    assert len(report.picks) <= 3 and len(report.bans) <= 3
    shift = {d.game_number: d for d in report.fearless_shift}
    assert set(shift) == {1, 2}
    assert shift[2].mean_rank > shift[1].mean_rank, "team A reaches deeper in game 2"
    assert shift[2].league_mean_rank is not None
    assert shift[2].league_mean_rank < shift[2].mean_rank, "...more than the league does"
    assert report.notes


def test_report_refuses_a_team_with_too_few_games_and_an_unknown_scope() -> None:
    few = [r for r in _rows() if int(r.game_id[1:]) < MIN_TEAM_GAMES - 1]
    assert tendency_report(few, _report_picks(), "A") is None
    assert tendency_report(_rows(), _report_picks(), "ghost") is None
    with pytest.raises(ValueError, match="scope"):
        tendency_report(_rows(), _report_picks(), "A", "everything")
