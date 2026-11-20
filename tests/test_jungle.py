"""Jungle detector tests on synthetic trajectories (no licensed data)."""

from __future__ import annotations

import numpy as np

from lockout.detectors.jungle import analyse_jungler, camp_visits, route_of
from lockout.geometry import (
    JUNGLE_CAMPS,
    lane_progress_from_base,
    own_outer_tower_progress,
    project_on_lane,
    to_blue_frame,
)


def _path(*camps: str, step: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """A jungler that spends two samples at each camp, ``step`` seconds apart."""
    pts, times = [], []
    t = 20
    for camp in camps:
        x, y = JUNGLE_CAMPS[camp]
        for dx in (0, 60):
            pts.append((x + dx, y))
            times.append(t)
            t += step
    return np.array(times), np.array(pts, dtype=float)


def test_route_follows_the_order_of_camps_visited() -> None:
    t, xy = _path("blue_buff", "gromp", "wolves", "raptors", "red_buff", "krugs")
    route = route_of(camp_visits(t, xy))
    assert [v.camp for v in route] == [
        "blue_buff", "gromp", "wolves", "raptors", "red_buff", "krugs",
    ]  # fmt: skip


def test_revisiting_a_camp_does_not_duplicate_it_in_the_route() -> None:
    t, xy = _path("red_buff", "krugs", "red_buff")
    assert [v.camp for v in route_of(camp_visits(t, xy))] == ["red_buff", "krugs"]


def test_points_far_from_every_camp_are_ignored() -> None:
    t = np.array([20, 30, 40])
    xy = np.array([[14000.0, 800.0], [9000.0, 9000.0], [200.0, 14000.0]])
    assert camp_visits(t, xy) == []


def test_red_side_route_is_read_in_the_blue_frame() -> None:
    # A red jungler standing on the mirror image of the blue buff is at the red side's own "blue buff".
    blue_xy = np.array([JUNGLE_CAMPS["blue_buff"]] * 2, dtype=float)
    red_xy = np.column_stack([14848.0 - blue_xy[:, 0], 14688.0 - blue_xy[:, 1]])
    assert np.allclose(to_blue_frame(red_xy, "red"), blue_xy)
    result = analyse_jungler(np.array([30, 40]), red_xy, "red")
    assert result["first_camp"] == "blue_buff"
    assert result["start_side"] == "top" and result["buff_start"] is True


def test_first_lane_arrival_requires_reaching_the_own_outer_tower() -> None:
    lane = "mid"
    # Walk along the mid lane from the blue end; the first sample at/after the outer tower is "arrival".
    from lockout.geometry import LANES

    path = np.array(LANES[lane], dtype=float)
    t = np.arange(100, 100 + 10 * len(path), 10)
    result = analyse_jungler(t, path, "blue")
    assert result["first_lane"] == "mid"
    # blue outer mid tower is waypoint 3: arrival should come at that waypoint (minus the tolerance)
    arc, _ = project_on_lane(path[3:4], lane)
    assert (
        lane_progress_from_base(arc, lane, "blue")[0] >= own_outer_tower_progress(lane, "blue") - 1
    )
    assert result["first_lane_t"] <= int(t[3])


def test_a_jungler_that_never_leaves_the_jungle_has_no_lane_arrival() -> None:
    t, xy = _path("blue_buff", "gromp", "wolves")
    result = analyse_jungler(t, xy, "blue")
    assert result["first_lane"] is None and result["first_lane_t"] is None
