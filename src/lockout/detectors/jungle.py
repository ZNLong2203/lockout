"""Jungle opening fingerprint: first-clear route and first appearance in a lane.

The feed has no camp-clear events, so the route is read from the jungler's trajectory: which camps the
jungler was *seen at* (a real position sample within ``CAMP_RADIUS`` of a camp) and in which order. Only
real samples (``age == 0``) are used, so held positions never create a visit. Tuned on all 3,462 junglers:
a stricter two-sample rule found all six camps for only 18 % of junglers (vs 57 %) and a speed filter
against pass-through visits changed nothing, so neither is used. Treat the route as "first detected
contact", and use ``n_camps`` as the confidence signal.

Outputs are evidence-friendly: every row names its game and slot, and the visit times are kept so the UI
can jump to the exact moment on the replay.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from lockout.geometry import (
    JUNGLE_CAMPS,
    LANE_NAMES,
    lane_progress_from_base,
    own_outer_tower_progress,
    project_on_lane,
    to_blue_frame,
)

CAMP_RADIUS = 900.0
MIN_VISIT_SAMPLES = 1  # samples are 1-10 s apart, so a camp often gets a single sample
ROUTE_WINDOW = (20, 240)  # seconds of game time scanned for the opening route
ARRIVAL_WINDOW = (90, 420)  # seconds scanned for the first appearance in a lane
ARRIVAL_LANE_DISTANCE = 1000.0
ARRIVAL_PAST_OUTER_BY = 400.0  # how far before the own outer tower still counts as "in lane"
TOP_SIDE_CAMPS = frozenset({"blue_buff", "gromp", "wolves"})
CAMP_NAMES = tuple(JUNGLE_CAMPS)
_CAMP_XY = np.array([JUNGLE_CAMPS[n] for n in CAMP_NAMES], dtype=np.float64)


@dataclass(frozen=True, slots=True)
class Visit:
    camp: str
    t_start: int
    t_end: int
    n_samples: int


def camp_visits(t: np.ndarray, xy_blue: np.ndarray) -> list[Visit]:
    """Visits to jungle camps, in time order. ``xy_blue`` is in the blue-side frame."""
    if len(t) == 0:
        return []
    dist = np.linalg.norm(xy_blue[:, None, :] - _CAMP_XY[None, :, :], axis=2)
    nearest = dist.argmin(axis=1)
    near = dist.min(axis=1) <= CAMP_RADIUS
    visits: list[Visit] = []
    i, n = 0, len(t)
    while i < n:
        if not near[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and near[j + 1] and nearest[j + 1] == nearest[i]:
            j += 1
        if j - i + 1 >= MIN_VISIT_SAMPLES:
            visits.append(Visit(CAMP_NAMES[nearest[i]], int(t[i]), int(t[j]), j - i + 1))
        i = j + 1
    return visits


def route_of(visits: list[Visit]) -> list[Visit]:
    """First visit to each distinct camp, in order: the clear route."""
    seen: set[str] = set()
    route: list[Visit] = []
    for v in visits:
        if v.camp not in seen:
            seen.add(v.camp)
            route.append(v)
    return route


def first_lane_arrival(t: np.ndarray, xy: np.ndarray, side: str) -> tuple[str | None, int | None]:
    """First time the jungler is *in* a lane (on its path, at or past the own outer tower)."""
    if len(t) == 0:
        return None, None
    best: tuple[int, str] | None = None
    for lane in LANE_NAMES:
        arc, dist = project_on_lane(xy, lane)
        progress = lane_progress_from_base(arc, lane, side)
        threshold = own_outer_tower_progress(lane, side) - ARRIVAL_PAST_OUTER_BY
        hit = np.flatnonzero((dist <= ARRIVAL_LANE_DISTANCE) & (progress >= threshold))
        if len(hit) and (best is None or int(t[hit[0]]) < best[0]):
            best = (int(t[hit[0]]), lane)
    return (best[1], best[0]) if best else (None, None)


def analyse_jungler(t: np.ndarray, xy: np.ndarray, side: str) -> dict[str, object]:
    """Fingerprint of one jungler-game from its real (age 0) position samples."""
    in_route = (t >= ROUTE_WINDOW[0]) & (t <= ROUTE_WINDOW[1])
    visits = camp_visits(t[in_route], to_blue_frame(xy[in_route], side))
    route = route_of(visits)
    in_arrival = (t >= ARRIVAL_WINDOW[0]) & (t <= ARRIVAL_WINDOW[1])
    lane, arrival_t = first_lane_arrival(t[in_arrival], xy[in_arrival], side)
    first = route[0].camp if route else None
    return {
        "route": ">".join(v.camp for v in route),
        "n_camps": len(route),
        "first_camp": first,
        "start_side": None if first is None else ("top" if first in TOP_SIDE_CAMPS else "bot"),
        "buff_start": first in ("blue_buff", "red_buff") if first else None,
        "t_first_camp": route[0].t_start if route else None,
        "t_clear_end": route[-1].t_end if route else None,
        "visit_times": ",".join(f"{v.camp}:{v.t_start}-{v.t_end}" for v in visits),
        "first_lane": lane,
        "first_lane_t": arrival_t,
    }


def build_jungle_table(cache_lol_dir: Path) -> pa.Table:
    con = duckdb.connect()
    rows = con.sql(
        f"""select t.game_id, t.slot, p.side, p.team_id, p.player_id, t.t, t.x, t.y
            from read_parquet('{cache_lol_dir}/tracks/*.parquet') t
            join read_parquet('{cache_lol_dir}/roles.parquet') r
              on r.game_id = t.game_id and r.slot = t.slot and r.role = 'jungle'
            join read_parquet('{cache_lol_dir}/players.parquet') p
              on p.game_id = t.game_id and p.slot = t.slot
            where t.age = 0 and t.t <= {ARRIVAL_WINDOW[1]}
            order by t.game_id, t.slot, t.t"""
    ).fetchnumpy()
    keys = np.char.add(np.char.add(rows["game_id"].astype(str), "|"), rows["slot"].astype(str))
    edges = np.flatnonzero(np.r_[True, keys[1:] != keys[:-1], True])
    xy_all = np.column_stack([rows["x"], rows["y"]]).astype(np.float64)
    out: list[dict[str, object]] = []
    for a, b in zip(edges[:-1], edges[1:], strict=True):
        side = str(rows["side"][a])
        result = analyse_jungler(rows["t"][a:b], xy_all[a:b], side)
        out.append(
            {
                "game_id": str(rows["game_id"][a]),
                "slot": int(rows["slot"][a]),
                "side": side,
                "team_id": str(rows["team_id"][a]),
                "player_id": str(rows["player_id"][a]),
                **result,
            }
        )
    return pa.Table.from_pylist(out)


def write_jungle(cache_lol_dir: Path) -> int:
    table = build_jungle_table(cache_lol_dir)
    pq.write_table(table, cache_lol_dir / "jungle.parquet", compression="zstd")
    return table.num_rows
