"""Infer each player's role (top / jungle / mid / adc / support) from the match itself.

GRID does not tag roles and the order of players in the feed is not reliable (checked on all 1,739
games), so roles come from behaviour:

* **support**  bought the support quest item (World Atlas) in the opening purchases;
* **jungle**   spends minutes 1:45-3:15 farthest from every lane;
* **top / mid / adc**  the remaining three, ordered by how far the player sits toward the top-left
  (``y - x``) while laning (2:00-6:00): top > mid > adc.

Each team-game gets a ``confidence`` flag so analyses can drop doubtful assignments instead of guessing.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from lockout.geometry import nearest_lane_distance

ROLES = ("top", "jungle", "mid", "adc", "support")
SUPPORT_ITEM = "World Atlas"
JUNGLE_WINDOW = (105, 195)
LANING_WINDOW = (120, 360)
MAX_AGE = 15  # ignore positions that are more than 15 s of extrapolation


@dataclass(slots=True)
class RoleRow:
    game_id: str
    slot: int
    role: str
    confidence: str  # "high" | "low"


def assign_team(
    atlas_slots: set[int],
    jungle_dist: dict[int, float],
    lane_score: dict[int, float],
    bot_pair_dist: float | None = None,
) -> tuple[dict[int, str], str]:
    """Assign the five slots of one team to roles. Returns ``({slot: role}, confidence)``."""
    slots = set(jungle_dist) | set(lane_score)
    if len(slots) != 5:
        return {}, "low"
    confidence = "high"
    jungler = max(slots, key=lambda s: jungle_dist.get(s, -1.0))
    rest = slots - {jungler}
    if len(atlas_slots & rest) == 1:
        support = next(iter(atlas_slots & rest))
    else:
        confidence = "low"
        # No unique World Atlas buyer: take the more bottom-side of the two bottom-most laners.
        bottom_two = sorted(rest, key=lambda s: lane_score.get(s, 0.0))[:2]
        support = min(bottom_two, key=lambda s: lane_score.get(s, 0.0))
    lane = sorted(rest - {support}, key=lambda s: lane_score.get(s, 0.0), reverse=True)
    if bot_pair_dist is not None and bot_pair_dist > 4500:
        confidence = "low"
    roles = {jungler: "jungle", support: "support"}
    for slot, role in zip(lane, ("top", "mid", "adc"), strict=True):
        roles[slot] = role
    return roles, confidence


def infer_roles(cache_lol_dir: Path) -> pa.Table:
    con = duckdb.connect()
    tracks = f"read_parquet('{cache_lol_dir}/tracks/*.parquet')"
    events = f"read_parquet('{cache_lol_dir}/events.parquet')"
    games = con.sql(f"select game_id from read_parquet('{cache_lol_dir}/games.parquet')").fetchall()
    game_ids = [g[0] for g in games]

    atlas = con.sql(
        f"""select e.game_id, p.slot from {events} e
            join read_parquet('{cache_lol_dir}/players.parquet') p
              on p.game_id = e.game_id and p.player_id = e.actor_pid
            where e.kind = 'purchase' and e.t <= 40 and e.name = '{SUPPORT_ITEM}'"""
    ).fetchall()
    atlas_by_game: dict[str, set[int]] = {}
    for gid, slot in atlas:
        atlas_by_game.setdefault(gid, set()).add(int(slot))

    j0, j1 = JUNGLE_WINDOW
    l0, l1 = LANING_WINDOW
    rows = con.sql(
        f"""select game_id, slot, t, x, y from {tracks}
            where age <= {MAX_AGE} and ((t between {j0} and {j1}) or (t between {l0} and {l1}))"""
    ).fetchnumpy()
    gid_arr, slot_arr, t_arr = rows["game_id"], rows["slot"], rows["t"]
    xy = np.column_stack([rows["x"], rows["y"]]).astype(np.float64)
    lane_d = nearest_lane_distance(xy)

    out: list[RoleRow] = []
    order = np.argsort(gid_arr, kind="stable")
    gid_sorted = gid_arr[order]
    bounds = np.flatnonzero(np.r_[True, gid_sorted[1:] != gid_sorted[:-1], True])
    for a, b in zip(bounds[:-1], bounds[1:], strict=True):
        idx = order[a:b]
        gid = str(gid_sorted[a])
        slots, ts = slot_arr[idx], t_arr[idx]
        for side in (0, 1):
            side_mask = (slots // 5) == side
            jd: dict[int, float] = {}
            ls: dict[int, float] = {}
            for s in range(side * 5, side * 5 + 5):
                m = side_mask & (slots == s)
                jm = m & (ts >= j0) & (ts <= j1)
                lm = m & (ts >= l0) & (ts <= l1)
                if jm.any():
                    jd[s] = float(np.median(lane_d[idx][jm]))
                if lm.any():
                    ls[s] = float(np.median(xy[idx][lm, 1] - xy[idx][lm, 0]))
            roles, conf = assign_team(
                atlas_by_game.get(gid, set()) & set(range(side * 5, side * 5 + 5)), jd, ls
            )
            out += [RoleRow(gid, s, r, conf) for s, r in roles.items()]
    missing = set(game_ids) - {r.game_id for r in out}
    out += [RoleRow(g, -1, "unknown", "low") for g in missing]
    return pa.table(
        {
            "game_id": [r.game_id for r in out],
            "slot": pa.array([r.slot for r in out], type=pa.int8()),
            "role": [r.role for r in out],
            "confidence": [r.confidence for r in out],
        }
    )


def write_roles(cache_lol_dir: Path) -> int:
    table = infer_roles(cache_lol_dir)
    pq.write_table(table, cache_lol_dir / "roles.parquet", compression="zstd")
    return table.num_rows
