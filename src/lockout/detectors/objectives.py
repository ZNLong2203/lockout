"""Objective setup radar: who is in position, and how early, before each objective.

For every dragon, Baron, Herald and grub wave we measure, for *both* teams, how many living players stood
in the objective area in the seconds before it was taken and around the moment it spawned. This turns
"they always seem to be there first" into a number with evidence (game, time).

Details that matter for correctness:
* Dead players keep their death position in the feed, so a living mask is built from kill and respawn
  events. About 16 % of deaths have no respawn event; their downtime is estimated from the median
  downtime of deaths in the same minute of the game.
* Positions are held between real samples. Anything staler than ``MAX_AGE`` seconds is not counted.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from lockout.geometry import BARON_PIT, DRAGON_PIT, GRUB_PIT, HERALD_PIT
from lockout.store import GameTrack, iter_game_tracks

AREA_RADIUS = 2500.0  # "in the objective area": the pit plus its approaches
PIT_RADIUS = 1300.0  # "inside the pit"
MAX_AGE = 12
LOOKBACK = 120
GRUB_WAVE_GAP = 45  # grub kills closer than this belong to the same wave
MIN_SETUP_PLAYERS = 3

PITS: dict[str, tuple[float, float]] = {
    "dragon": DRAGON_PIT,
    "baron": BARON_PIT,
    "herald": HERALD_PIT,
    "grubs": GRUB_PIT,
}


def objective_type(name: str) -> str | None:
    if name == "Baron":
        return "baron"
    if name == "RiftHerald":
        return "herald"
    if name == "VoidGrub":
        return "grubs"
    if name.endswith("Drake") or name == "ElderDragon":
        return "dragon"
    return None


def spawn_match(name: str) -> str | None:
    """Spawn-event name that belongs to an objective kill name (``OceanDrake`` -> ``oceanDrake``)."""
    return {"Baron": "baron", "RiftHerald": "riftHerald", "VoidGrub": "voidGrub"}.get(
        name, name[:1].lower() + name[1:] if objective_type(name) == "dragon" else None
    )


@dataclass(slots=True)
class ObjectiveKill:
    objective: str
    name: str
    t: int
    killer_slot: int | None


def alive_mask(
    length: int,
    deaths: list[tuple[int, int, int | None]],
    fallback_downtime: dict[int, int],
) -> np.ndarray:
    """(T, 10) bool. ``deaths`` holds ``(slot, t_death, t_respawn_or_None)``."""
    alive = np.ones((length, 10), dtype=bool)
    for slot, t_death, t_respawn in deaths:
        down = fallback_downtime.get(min(t_death // 60, 60), 40) if t_respawn is None else None
        end = t_respawn if t_respawn is not None else t_death + (down or 40)
        alive[max(t_death, 0) : min(end, length), slot] = False
    return alive


def team_counts(
    track: GameTrack, alive: np.ndarray, centre: tuple[float, float], radius: float, t: int
) -> tuple[int, int]:
    """(blue, red) number of living players with a fresh position within ``radius`` of ``centre``."""
    t = int(np.clip(t, 0, track.length - 1))
    xy = track.pos[t].astype(np.float64)
    dist = np.hypot(xy[:, 0] - centre[0], xy[:, 1] - centre[1])
    ok = (track.pos[t, :, 0] >= 0) & (track.age[t] <= MAX_AGE) & alive[t] & (dist <= radius)
    return int(ok[:5].sum()), int(ok[5:].sum())


def sustained_setup(series: np.ndarray) -> int:
    """Seconds, counted back from 5 s before the kill, that the team had >= 3 players in the area.

    ``series[i]`` is the count at ``kill - LOOKBACK + i``; the index of "kill - 5 s" is LOOKBACK - 5.
    """
    i = LOOKBACK - 5
    n = 0
    while i >= 0 and series[i] >= MIN_SETUP_PLAYERS:
        n += 1
        i -= 1
    return n


def analyse_game(
    track: GameTrack,
    kills: list[ObjectiveKill],
    spawns: dict[str, list[int]],
    alive: np.ndarray,
    team_ids: tuple[str, str],
    sides: tuple[str, str] = ("blue", "red"),
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for k in kills:
        centre = PITS[k.objective]
        window = np.array(
            [
                team_counts(track, alive, centre, AREA_RADIUS, k.t - LOOKBACK + i)
                for i in range(LOOKBACK + 1)
            ]
        )  # (LOOKBACK+1, 2)
        spawn_times = [s for s in spawns.get(spawn_match(k.name) or "", []) if s <= k.t]
        t_spawn = max(spawn_times) if spawn_times else None
        killer_side = None if k.killer_slot is None else (0 if k.killer_slot < 5 else 1)
        at_spawn = (
            {
                off: team_counts(track, alive, centre, AREA_RADIUS, t_spawn + off)
                for off in (-30, -15, 0)
            }
            if t_spawn is not None
            else None
        )
        for side_idx in (0, 1):
            other = 1 - side_idx
            series = window[:, side_idx]
            rows.append(
                {
                    "game_id": track.game_id,
                    "objective": k.objective,
                    "name": k.name,
                    "t_kill": k.t,
                    "t_spawn": t_spawn,
                    "since_spawn": None if t_spawn is None else k.t - t_spawn,
                    "side": sides[side_idx],
                    "team_id": team_ids[side_idx],
                    "is_killer": killer_side == side_idx,
                    "n_m60": int(series[LOOKBACK - 60]),
                    "n_m30": int(series[LOOKBACK - 30]),
                    "n_m15": int(series[LOOKBACK - 15]),
                    "n_m5": int(series[LOOKBACK - 5]),
                    "n_pit_m5": team_counts(track, alive, centre, PIT_RADIUS, k.t - 5)[side_idx],
                    "setup_s": sustained_setup(series),
                    "opp_n_m10": int(window[LOOKBACK - 10, other]),
                    "n_spawn_m15": None if at_spawn is None else at_spawn[-15][side_idx],
                    "n_spawn_0": None if at_spawn is None else at_spawn[0][side_idx],
                }
            )
    return rows


def _fallback_downtime(con: duckdb.DuckDBPyConnection, events: str) -> dict[int, int]:
    rows = con.sql(
        f"""with k as (select game_id, t, target_pid pid from {events} where kind = 'kill'),
            nr as (select k.t, min(r.t) - k.t down from k
                   left join {events} r on r.game_id = k.game_id and r.kind = 'respawn'
                     and r.target_pid = k.pid and r.t > k.t group by k.game_id, k.pid, k.t)
            select least(t // 60, 60) as game_minute, median(down) from nr where down is not null group by 1"""
    ).fetchall()
    return {int(m): int(d) for m, d in rows}


def build_objective_table(cache_lol_dir: Path) -> pa.Table:
    con = duckdb.connect()
    events = f"read_parquet('{cache_lol_dir}/events.parquet')"
    players = f"read_parquet('{cache_lol_dir}/players.parquet')"
    fallback = _fallback_downtime(con, events)

    slot_of: dict[tuple[str, str], int] = {
        (g, p): int(s)
        for g, p, s in con.sql(f"select game_id, player_id, slot from {players}").fetchall()
    }
    team_of: dict[str, list[str]] = defaultdict(lambda: ["", ""])
    for g, side, team in con.sql(
        f"select distinct game_id, side, team_id from {players}"
    ).fetchall():
        team_of[g][0 if side == "blue" else 1] = team

    obj_events: dict[str, list[ObjectiveKill]] = defaultdict(list)
    for g, t, name, actor in con.sql(
        f"select game_id, t, name, actor_pid from {events} where kind = 'objective' order by game_id, t"
    ).fetchall():
        obj = objective_type(name)
        if obj is None:
            continue
        obj_events[g].append(ObjectiveKill(obj, name, int(t), slot_of.get((g, actor))))
    for g, ks in obj_events.items():  # one row per grub wave, not per grub
        kept: list[ObjectiveKill] = []
        for k in ks:
            if (
                k.objective == "grubs"
                and kept
                and kept[-1].objective == "grubs"
                and k.t - kept[-1].t <= GRUB_WAVE_GAP
            ):
                continue
            kept.append(k)
        obj_events[g] = kept

    spawns: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for g, name, t in con.sql(
        f"select game_id, name, t from {events} where kind = 'spawn'"
    ).fetchall():
        key = "voidGrub" if name.startswith("voidGrub") else name
        spawns[g][key].append(int(t))

    deaths: dict[str, list[tuple[int, int, int | None]]] = defaultdict(list)
    respawn_times: dict[tuple[str, int], list[int]] = defaultdict(list)
    for g, t, pid in con.sql(
        f"select game_id, t, target_pid from {events} where kind = 'respawn'"
    ).fetchall():
        respawn_times[(g, slot_of.get((g, pid), -1))].append(int(t))
    for g, t, pid in con.sql(
        f"select game_id, t, target_pid from {events} where kind = 'kill'"
    ).fetchall():
        slot = slot_of.get((g, pid))
        if slot is None:
            continue
        later = [r for r in respawn_times.get((g, slot), []) if r > t]
        deaths[g].append((slot, int(t), min(later) if later else None))

    rows: list[dict[str, object]] = []
    for track in iter_game_tracks(cache_lol_dir):
        ks = obj_events.get(track.game_id)
        if not ks:
            continue
        alive = alive_mask(track.length, deaths.get(track.game_id, []), fallback)
        ids = team_of[track.game_id]
        rows += analyse_game(track, ks, spawns.get(track.game_id, {}), alive, (ids[0], ids[1]))
    return pa.Table.from_pylist(rows)


def write_objectives(cache_lol_dir: Path) -> int:
    table = build_objective_table(cache_lol_dir)
    pq.write_table(table, cache_lol_dir / "objectives.parquet", compression="zstd")
    return table.num_rows
