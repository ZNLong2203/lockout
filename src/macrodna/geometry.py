"""Summoner's Rift geometry, measured from the GRID data (no Riot map art is used).

Every constant below is a map fact estimated as the median position of the player who destroyed a
structure or killed an objective. They sit within ~300 units of the true object, which is plenty for
lane membership and objective-setup radii. Coordinates are Summoner's Rift units (bounds 300..16000).
"""

from __future__ import annotations

import numpy as np

BLUE_NEXUS = (1774.0, 1598.0)
RED_NEXUS = (13074.0, 13090.0)

# Objective pits: where the killer stood when the objective died.
DRAGON_PIT = (10020.0, 4790.0)
BARON_PIT = (4970.0, 10290.0)
GRUB_PIT = (4730.0, 10030.0)
HERALD_PIT = (4680.0, 9920.0)

# Lane paths from the blue base to the red base (waypoints follow towers, inhibitors and the corners).
LANES: dict[str, list[tuple[float, float]]] = {
    "top": [
        (1444, 3768), (1374, 4450), (1472, 7032), (1254, 10615), (1500, 13300),
        (4171, 13608), (7670, 13457), (10320, 13541), (10964, 13363),
    ],
    "mid": [
        (3205, 3342), (3681, 3785), (5191, 5147), (6295, 6666), (8583, 8156),
        (9649, 9729), (11101, 11053), (11710, 11451),
    ],
    "bot": [
        (3701, 1453), (4409, 1366), (7193, 1426), (10650, 1293), (13300, 1500),
        (13596, 4368), (13385, 7906), (13464, 10392), (13327, 11049),
    ],
}  # fmt: skip

LANE_NAMES = tuple(LANES)


def _segment_distance(pts: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    denom = float(ab @ ab)
    t = np.clip(((pts - a) @ ab) / denom, 0.0, 1.0) if denom else np.zeros(len(pts))
    proj = a + t[:, None] * ab
    return np.linalg.norm(pts - proj, axis=1)


def lane_distance(xy: np.ndarray, lane: str) -> np.ndarray:
    """Distance (units) from each point of ``xy`` (N, 2) to the polyline of ``lane``."""
    pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    path = np.asarray(LANES[lane], dtype=np.float64)
    dists = [_segment_distance(pts, path[i], path[i + 1]) for i in range(len(path) - 1)]
    return np.min(dists, axis=0)


#: index of each team's outer (first) tower inside ``LANES[lane]`` (blue end first, red end last)
OUTER_TOWER_INDEX: dict[str, dict[str, int]] = {
    "top": {"blue": 3, "red": 5},
    "mid": {"blue": 3, "red": 4},
    "bot": {"blue": 3, "red": 5},
}

# Standard jungle camps in the blue-side frame, checked against jungler dwell points in the data
# (e.g. the wolves cluster sits 135 units from this reference).
JUNGLE_CAMPS: dict[str, tuple[float, float]] = {
    "blue_buff": (3800.0, 7900.0),
    "gromp": (2100.0, 8400.0),
    "wolves": (3800.0, 6500.0),
    "raptors": (6900.0, 5400.0),
    "red_buff": (7800.0, 4000.0),
    "krugs": (8400.0, 2700.0),
}

#: the map is symmetric under a half-turn about this centre, so a red-side point maps to the blue frame
_SUM = (BLUE_NEXUS[0] + RED_NEXUS[0], BLUE_NEXUS[1] + RED_NEXUS[1])


def to_blue_frame(xy: np.ndarray, side: str) -> np.ndarray:
    """Express positions of a red-side player in the blue-side frame (identity for blue)."""
    pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    return pts if side == "blue" else np.column_stack([_SUM[0] - pts[:, 0], _SUM[1] - pts[:, 1]])


def _cumulative(path: np.ndarray) -> np.ndarray:
    return np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]


def project_on_lane(xy: np.ndarray, lane: str) -> tuple[np.ndarray, np.ndarray]:
    """Project points on a lane path. Returns ``(arc, dist)``: position along it from the blue end
    and the distance to it."""
    pts = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    path = np.asarray(LANES[lane], dtype=np.float64)
    cum = _cumulative(path)
    best_d = np.full(len(pts), np.inf)
    best_arc = np.zeros(len(pts))
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        ab = b - a
        denom = float(ab @ ab)
        t = np.clip(((pts - a) @ ab) / denom, 0.0, 1.0)
        d = np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)
        closer = d < best_d
        best_d = np.where(closer, d, best_d)
        best_arc = np.where(closer, cum[i] + t * np.sqrt(denom), best_arc)
    return best_arc, best_d


def lane_progress_from_base(arc: np.ndarray, lane: str, side: str) -> np.ndarray:
    """Distance travelled along ``lane`` away from the player's own base."""
    total = _cumulative(np.asarray(LANES[lane], dtype=np.float64))[-1]
    return arc if side == "blue" else total - arc


def own_outer_tower_progress(lane: str, side: str) -> float:
    """Progress (from the own base) at which the team's outer tower stands in ``lane``."""
    path = np.asarray(LANES[lane], dtype=np.float64)
    cum = _cumulative(path)
    idx = OUTER_TOWER_INDEX[lane][side]
    return float(cum[idx] if side == "blue" else cum[-1] - cum[idx])


def nearest_lane_distance(xy: np.ndarray) -> np.ndarray:
    """Distance to the closest of the three lanes: small in lane, large in the jungle."""
    return np.min([lane_distance(xy, lane) for lane in LANE_NAMES], axis=0)
