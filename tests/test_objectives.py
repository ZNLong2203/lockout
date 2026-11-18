"""Objective-setup detector tests on synthetic games (no licensed data)."""

from __future__ import annotations

import numpy as np

from macrodna.detectors.objectives import (
    LOOKBACK,
    ObjectiveKill,
    alive_mask,
    analyse_game,
    objective_type,
    spawn_match,
    sustained_setup,
    team_counts,
)
from macrodna.geometry import DRAGON_PIT
from macrodna.store import GameTrack

BASE = (1000, 1000)


def _track(length: int = 220) -> GameTrack:
    pos = np.full((length, 10, 2), BASE, dtype=np.int16)
    age = np.zeros((length, 10), dtype=np.uint8)
    return GameTrack("g1", pos, age)


def _place(track: GameTrack, slots: range | list[int], t0: int, t1: int) -> None:
    track.pos[t0:t1, list(slots), 0] = int(DRAGON_PIT[0])
    track.pos[t0:t1, list(slots), 1] = int(DRAGON_PIT[1])


def test_objective_and_spawn_names() -> None:
    assert objective_type("OceanDrake") == "dragon"
    assert objective_type("ElderDragon") == "dragon"
    assert objective_type("Baron") == "baron"
    assert objective_type("RiftScuttlerTop") is None
    assert spawn_match("OceanDrake") == "oceanDrake"
    assert spawn_match("RiftHerald") == "riftHerald"
    assert spawn_match("VoidGrub") == "voidGrub"


def test_dead_players_are_not_counted_in_the_area() -> None:
    track = _track()
    _place(track, [0, 1, 2], 0, 220)
    alive = alive_mask(220, [(1, 50, 120)], {})  # slot 1 is dead between 50 and 120
    assert team_counts(track, alive, DRAGON_PIT, 2500, 100) == (2, 0)
    assert team_counts(track, alive, DRAGON_PIT, 2500, 130) == (3, 0)


def test_missing_respawn_uses_the_minute_fallback() -> None:
    alive = alive_mask(300, [(0, 70, None)], {1: 25})  # death in minute 1, typical downtime 25 s
    assert not alive[70:95, 0].any()
    assert alive[95, 0]


def test_stale_positions_are_not_counted() -> None:
    track = _track()
    _place(track, [0], 0, 220)
    track.age[100, 0] = 40
    alive = np.ones((220, 10), dtype=bool)
    assert team_counts(track, alive, DRAGON_PIT, 2500, 100)[0] == 0
    assert team_counts(track, alive, DRAGON_PIT, 2500, 101)[0] == 1


def test_sustained_setup_counts_seconds_with_three_players() -> None:
    series = np.zeros(LOOKBACK + 1, dtype=int)
    series[70 : LOOKBACK - 4] = 3  # three players from kill-50 s to kill-5 s (indices 70..115)
    assert sustained_setup(series) == 46
    assert sustained_setup(np.zeros(LOOKBACK + 1, dtype=int)) == 0


def test_analyse_game_separates_the_team_that_set_up() -> None:
    track = _track()
    _place(track, [0, 1, 2], 100, 220)  # blue sets up from t=100
    alive = np.ones((220, 10), dtype=bool)
    kill = ObjectiveKill("dragon", "OceanDrake", 150, killer_slot=0)
    rows = analyse_game(track, [kill], {"oceanDrake": [95]}, alive, ("100", "200"))
    blue, red = (next(r for r in rows if r["side"] == s) for s in ("blue", "red"))
    assert blue["is_killer"] is True and red["is_killer"] is False
    assert (blue["n_m5"], red["n_m5"]) == (3, 0)
    assert blue["setup_s"] == 46 and red["setup_s"] == 0
    assert blue["since_spawn"] == 55
    assert blue["n_spawn_0"] == 0, "nobody was in place at the spawn second (t=95)"
