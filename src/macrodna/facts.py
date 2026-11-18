"""Per-game facts: a compact, typed view of one game for the tell templates.

Everything here is derived from the local cache. Sides are ``"blue"`` / ``"red"``; ``side`` on an event is
the side that *did* the thing (killed the objective, destroyed the structure, got the kill).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import numpy as np

from macrodna.detectors.objectives import GRUB_WAVE_GAP, objective_type
from macrodna.geometry import LANE_NAMES, lane_distance

KILL_LANE_RADIUS = 1500.0
OTHER = {"blue": "red", "red": "blue"}


@dataclass(frozen=True, slots=True)
class Obj:
    t: int
    side: str
    kind: str  # dragon | herald | grubs | baron
    name: str


@dataclass(frozen=True, slots=True)
class Struct:
    t: int
    side: str  # the side that destroyed it
    kind: str  # tower | inhibitor | nexus
    lane: str | None


@dataclass(frozen=True, slots=True)
class KillFact:
    t: int
    side: str
    lane: str | None  # lane the killer stood in, if any


@dataclass(frozen=True, slots=True)
class JungleFact:
    start_side: str | None
    first_lane: str | None
    first_lane_t: int | None
    route: str


@dataclass(frozen=True, slots=True)
class Setup:
    """How a team was positioned for one objective (from the objective radar)."""

    objective: str
    t_kill: int
    side: str
    is_killer: bool
    t_spawn: int | None
    n_spawn_0: int | None
    setup_s: int


@dataclass(slots=True)
class GameFacts:
    game_id: str
    teams: dict[str, str]  # side -> team_id
    winner_side: str | None
    objs: list[Obj] = field(default_factory=list)
    structs: list[Struct] = field(default_factory=list)
    kills: list[KillFact] = field(default_factory=list)
    jungle: dict[str, JungleFact] = field(default_factory=dict)
    setups: list[Setup] = field(default_factory=list)


def lane_of(x: float | None, y: float | None) -> str | None:
    if x is None or y is None:
        return None
    pt = np.array([[x, y]], dtype=float)
    dists = {lane: float(lane_distance(pt, lane)[0]) for lane in LANE_NAMES}
    lane = min(dists, key=dists.__getitem__)
    return lane if dists[lane] <= KILL_LANE_RADIUS else None


def _structure(name: str, target_id: str | None) -> tuple[str, str | None, str] | None:
    """(kind, lane, owner_side) of a destroyed structure from ids such as ``blue-turret-bot-1``."""
    if not target_id:
        return None
    parts = target_id.split("-")
    owner = parts[0]
    if owner not in OTHER:
        return None
    lane = parts[2] if len(parts) > 2 and parts[2] in LANE_NAMES else None
    return name, lane, owner


def load_facts(cache_lol_dir: Path) -> list[GameFacts]:
    con = duckdb.connect()
    d = str(cache_lol_dir)
    games = con.sql(
        f"select game_id, blue_team_id, red_team_id, winner_team_id from read_parquet('{d}/games.parquet')"
    ).fetchall()
    facts: dict[str, GameFacts] = {}
    for gid, blue, red, winner in games:
        side = "blue" if winner == blue else "red" if winner == red else None
        facts[gid] = GameFacts(gid, {"blue": str(blue), "red": str(red)}, side)

    side_of = {
        (g, p): s
        for g, p, s in con.sql(
            f"select game_id, player_id, side from read_parquet('{d}/players.parquet')"
        ).fetchall()
    }
    rows = con.sql(
        f"""select game_id, t, kind, name, actor_pid, target_id, x, y
            from read_parquet('{d}/events.parquet')
            where kind in ('objective', 'structure', 'kill') order by game_id, t, seq"""
    ).fetchall()
    last_grub: dict[str, int] = {}
    for gid, t, kind, name, actor, target_id, x, y in rows:
        gf = facts.get(gid)
        side = side_of.get((gid, actor))
        if gf is None or side is None:
            continue
        if kind == "objective":
            obj = objective_type(name)
            if obj is None:
                continue
            if obj == "grubs":
                if gid in last_grub and t - last_grub[gid] <= GRUB_WAVE_GAP:
                    last_grub[gid] = t
                    continue
                last_grub[gid] = t
            gf.objs.append(Obj(int(t), side, obj, name))
        elif kind == "structure":
            parsed = _structure(name, target_id)
            if parsed:
                skind, lane, owner = parsed
                gf.structs.append(Struct(int(t), OTHER[owner], skind, lane))
        else:
            gf.kills.append(KillFact(int(t), side, lane_of(x, y)))

    jungle = con.sql(
        f"""select game_id, side, start_side, first_lane, first_lane_t, route
            from read_parquet('{d}/jungle.parquet')"""
    ).fetchall()
    for gid, side, start, lane, lane_t, route in jungle:
        if gid in facts:
            facts[gid].jungle[side] = JungleFact(
                start, lane, None if lane_t is None else int(lane_t), route
            )

    setups = defaultdict(list)
    for gid, objective, t_kill, side, is_killer, t_spawn, n0, setup_s in con.sql(
        f"""select game_id, objective, t_kill, side, is_killer, t_spawn, n_spawn_0, setup_s
            from read_parquet('{d}/objectives.parquet')"""
    ).fetchall():
        setups[gid].append(
            Setup(
                objective,
                int(t_kill),
                side,
                bool(is_killer),
                None if t_spawn is None else int(t_spawn),
                n0,
                int(setup_s),
            )
        )
    for gid, items in setups.items():
        if gid in facts:
            facts[gid].setups = items
    return list(facts.values())
