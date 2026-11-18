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


def nearest_lane_distance(xy: np.ndarray) -> np.ndarray:
    """Distance to the closest of the three lanes: small in lane, large in the jungle."""
    return np.min([lane_distance(xy, lane) for lane in LANE_NAMES], axis=0)
