"""Geometry and role-assignment tests (pure logic, no data needed)."""

from __future__ import annotations

import numpy as np

from macrodna.geometry import BARON_PIT, DRAGON_PIT, LANES, lane_distance, nearest_lane_distance
from macrodna.roles import assign_team


def test_points_on_a_lane_have_zero_distance() -> None:
    for lane, path in LANES.items():
        pts = np.array(path, dtype=float)
        assert np.allclose(lane_distance(pts, lane), 0.0), lane


def test_jungle_is_far_from_every_lane() -> None:
    # The dragon pit and the baron pit sit in the river/jungle, well away from all three lanes.
    pits = np.array([DRAGON_PIT, BARON_PIT])
    assert (nearest_lane_distance(pits) > 1000).all()


def test_lane_distance_is_symmetric_midpoint() -> None:
    # A point halfway across the mid-lane waypoint spacing stays on the lane polyline.
    a, b = np.array(LANES["mid"][2]), np.array(LANES["mid"][3])
    assert lane_distance(((a + b) / 2)[None, :], "mid")[0] < 1e-6


def test_assign_team_roles_from_signals() -> None:
    # slots 0..4. slot 1 farthest from lanes -> jungle; slot 4 bought the atlas -> support;
    # remaining ordered by y-x: slot 0 (top-left) top, slot 2 mid, slot 3 adc.
    jungle_dist = {0: 300.0, 1: 2400.0, 2: 200.0, 3: 400.0, 4: 500.0}
    lane_score = {0: 9000.0, 1: -200.0, 2: 10.0, 3: -9000.0, 4: -9100.0}
    roles, conf = assign_team({4}, jungle_dist, lane_score)
    assert roles == {1: "jungle", 4: "support", 0: "top", 2: "mid", 3: "adc"}
    assert conf == "high"


def test_assign_team_flags_low_confidence_without_unique_support_signal() -> None:
    jungle_dist = {0: 300.0, 1: 2400.0, 2: 200.0, 3: 400.0, 4: 500.0}
    lane_score = {0: 9000.0, 1: -200.0, 2: 10.0, 3: -9000.0, 4: -9100.0}
    roles, conf = assign_team(set(), jungle_dist, lane_score)
    assert conf == "low"
    assert sorted(roles.values()) == ["adc", "jungle", "mid", "support", "top"]


def test_assign_team_rejects_incomplete_team() -> None:
    roles, conf = assign_team(set(), {0: 1.0, 1: 2.0}, {0: 1.0, 1: 2.0})
    assert roles == {} and conf == "low"
