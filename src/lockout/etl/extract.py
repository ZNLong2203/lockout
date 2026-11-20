"""Stream one GRID League of Legends event feed into compact per-game data.

A feed is a zstd-compressed JSON-Lines file: one *envelope* per line, each holding events that carry a
full ``seriesState`` snapshot. We never materialise the whole file. For every game we keep

* ``pos``    1 Hz position of the ten players, shape ``(T, 10, 2)`` int16, ``-1`` where unknown,
* ``events`` the macro-relevant events (kills, objectives, structures, spawns, items, ...),
* ``draft``  the ordered picks and bans, and a few facts from the final box score.

Rules from the data README that this module honours:
* ``type == f"{actor.type}-{action}-{target.type}"``; an action starting with ``!`` undoes an earlier event.
* ``series-!started-game`` rolls a game back (abandoned/restarted); only games in the final state count.
* Positions are Summoner's Rift units; ``map.bounds`` gives the playable area.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import orjson
import zstandard

SLAY_PREFIX = "player-completed-slay"
PLATE_PREFIX = "player-completed-destroyTurretPlate"
N_PLAYERS = 10
MAX_GAME_S = 7200  # no pro game lasts 2 h; anything longer is a feed anomaly
_DURATION_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?")


@dataclass(slots=True)
class PlayerInfo:
    slot: int
    player_id: str
    name: str
    team_id: str
    side: str


@dataclass(slots=True)
class Event:
    t: int
    kind: str
    name: str
    actor_pid: str | None = None
    target_pid: str | None = None
    target_id: str | None = None
    x: int | None = None
    y: int | None = None
    assists: tuple[str, ...] = ()


@dataclass(slots=True)
class DraftAction:
    seq: int
    action: str  # "ban" | "pick"
    team_id: str
    character_id: str
    character: str


@dataclass(slots=True)
class GameData:
    game_id: str
    game_number: int
    duration_s: int
    bounds: tuple[float, float, float, float] | None
    winner_team_id: str | None
    teams: dict[str, tuple[str, str]]  # team_id -> (side, name)
    players: list[PlayerInfo]
    pos: np.ndarray  # (T, 10, 2) int16, -1 = unknown
    age: np.ndarray  # (T, 10) uint8, seconds since the last real sample (255 = none yet)
    events: list[Event]
    draft: list[DraftAction]


@dataclass
class _Acc:
    order: int
    samples: dict[str, dict[int, tuple[int, int]]] = field(default_factory=dict)
    events: list[Event] = field(default_factory=list)
    last_t: int = 0
    full: dict[str, Any] | None = None  # richest snapshot of the game seen so far


def iter_lines(path: Path) -> Iterator[bytes]:
    """Yield raw JSON lines from a ``.jsonl.zst`` file without decompressing it to disk."""
    dctx = zstandard.ZstdDecompressor()
    with path.open("rb") as fh, dctx.stream_reader(fh) as reader:
        yield from io.BufferedReader(reader)  # type: ignore[arg-type]


def parse_duration(value: str | None) -> int | None:
    """ISO-8601 duration such as ``PT32M37.648S`` -> whole seconds."""
    if not value:
        return None
    m = _DURATION_RE.fullmatch(value)
    if not m:
        return None
    h, mi, s = m.groups()
    return int(int(h or 0) * 3600 + int(mi or 0) * 60 + float(s or 0))


def extract_series(lines: Iterator[bytes]) -> list[GameData]:
    """Turn the lines of one series feed into one ``GameData`` per game actually played."""
    accs: dict[str, _Acc] = {}
    dead: set[str] = set()
    current: str | None = None

    for raw in lines:
        env = orjson.loads(raw)
        for ev in env.get("events", ()):
            typ = ev["type"]
            if typ == "series-started-game":
                current = ev["target"]["id"]
                accs.setdefault(current, _Acc(order=len(accs)))
            elif typ == "series-!started-game":
                gid = ev["target"]["id"]
                dead.add(gid)
                accs.pop(gid, None)
                if current == gid:
                    current = None
            if current is None or current not in accs:
                continue
            acc = accs[current]
            ss = ev.get("seriesState")
            if not ss:
                continue
            game = next((g for g in ss.get("games", ()) if g.get("id") == current), None)
            if game is None:
                continue
            if "map" in game:
                acc.full = game
            clock = game.get("clock")
            t = clock.get("currentSeconds") if clock else None
            if t is None:
                t = acc.last_t
            t = max(int(t), 0)
            acc.last_t = t
            positions = _record_positions(acc, game, t)
            if not typ.startswith("series-") and "!" not in ev.get("action", ""):
                record = _classify(ev, typ, t, positions)
                if record is not None:
                    acc.events.append(record)

    games = [_finalise(gid, acc) for gid, acc in accs.items() if gid not in dead and acc.full]
    games.sort(key=lambda g: g.game_number)
    return games


def _record_positions(acc: _Acc, game: dict[str, Any], t: int) -> dict[str, tuple[int, int]]:
    seen: dict[str, tuple[int, int]] = {}
    for team in game.get("teams", ()):
        for p in team.get("players", ()):
            pos = p.get("position")
            if pos is None:
                continue
            xy = (int(pos["x"]), int(pos["y"]))
            pid = p["id"]
            acc.samples.setdefault(pid, {})[t] = xy
            seen[pid] = xy
    return seen


def _classify(
    ev: dict[str, Any], typ: str, t: int, positions: dict[str, tuple[int, int]]
) -> Event | None:
    actor, target = ev["actor"], ev["target"]
    actor_pid = actor["id"] if actor.get("type") == "player" else None
    xy = positions.get(actor_pid) if actor_pid else None
    x, y = xy if xy else (None, None)

    def make(kind: str, name: str, **kw: Any) -> Event:
        return Event(t=t, kind=kind, name=name, actor_pid=actor_pid, x=x, y=y, **kw)

    if typ == "player-killed-player":
        assists = _assists(actor)
        return make("kill", "kill", target_pid=target["id"], assists=assists)
    if typ.startswith(SLAY_PREFIX):
        return make("objective", typ[len(SLAY_PREFIX) :])
    if typ.startswith(PLATE_PREFIX):
        return make("plate", typ[len(PLATE_PREFIX) :], target_id=target.get("id"))
    if typ == "player-destroyed-tower":
        return make("structure", "tower", target_id=target.get("id"))
    if typ == "player-destroyed-fortifier":
        return make("structure", "inhibitor", target_id=target.get("id"))
    if typ == "player-destroyed-base":
        return make("structure", "nexus", target_id=target.get("id"))
    if typ in ("game-respawned-ATierNPC", "game-respawned-BTierNPC", "game-respawned-STierNPC"):
        return Event(t=t, kind="spawn", name=target.get("id", ""), target_id=target.get("id"))
    if typ == "game-respawned-player":
        return Event(t=t, kind="respawn", name="respawn", target_pid=target.get("id"))
    if typ == "player-completed-increaseLevel":
        return make("level", "level")
    if typ == "player-purchased-item":
        state = target.get("state") or {}
        return make("purchase", state.get("name") or "", target_id=target.get("id"))
    if typ == "player-sold-item":
        state = target.get("state") or {}
        return make("sell", state.get("name") or "", target_id=target.get("id"))
    return None


def _assists(actor: dict[str, Any]) -> tuple[str, ...]:
    delta = actor.get("stateDelta") or {}
    for scope in ("game", "series"):
        items = (delta.get(scope) or {}).get("killAssistsReceivedFromPlayer")
        if items:
            return tuple(i["playerId"] for i in items if "playerId" in i)
    return ()


def _finalise(game_id: str, acc: _Acc) -> GameData:
    full = acc.full or {}
    teams_raw = sorted(full.get("teams", ()), key=lambda tm: 0 if tm.get("side") == "blue" else 1)
    teams = {tm["id"]: (tm.get("side", "?"), tm.get("name", "")) for tm in teams_raw}
    players: list[PlayerInfo] = []
    for tm in teams_raw:
        for p in tm.get("players", ()):
            players.append(
                PlayerInfo(
                    slot=len(players),
                    player_id=p["id"],
                    name=p.get("name", ""),
                    team_id=tm["id"],
                    side=tm.get("side", "?"),
                )
            )
    players = players[:N_PLAYERS]
    duration = parse_duration(full.get("duration"))
    if duration is None or not 0 < duration <= MAX_GAME_S:
        # A few feeds carry an absurd ``duration`` (seen: ~16 million seconds). Trust the game clock.
        duration = acc.last_t
    length = min(max(duration, acc.last_t), MAX_GAME_S) + 1
    pos, age = _build_positions(acc.samples, players, length)
    winner = next((tm["id"] for tm in teams_raw if tm.get("won")), None)
    b = (full.get("map") or {}).get("bounds")
    bounds = (b["min"]["x"], b["min"]["y"], b["max"]["x"], b["max"]["y"]) if b else None
    return GameData(
        game_id=game_id,
        game_number=acc.order + 1,
        duration_s=duration,
        bounds=bounds,
        winner_team_id=winner,
        teams=teams,
        players=players,
        pos=pos,
        age=age,
        events=sorted(acc.events, key=lambda e: e.t),
        draft=_draft(full),
    )


def _build_positions(
    samples: dict[str, dict[int, tuple[int, int]]], players: list[PlayerInfo], length: int
) -> tuple[np.ndarray, np.ndarray]:
    """Resample irregular snapshots to 1 Hz by holding the last value, and record how stale each is.

    Real samples arrive every 1-10 s per player, not exactly once a second, so ``age`` lets analyses
    discard or down-weight positions that are mostly extrapolation.
    """
    arr = np.full((length, N_PLAYERS, 2), -1, dtype=np.int16)
    for p in players:
        for t, (x, y) in samples.get(p.player_id, {}).items():
            if t < length:
                arr[t, p.slot] = (x, y)
    valid = arr[:, :, 0] >= 0
    seen = np.maximum.accumulate(valid, axis=0)
    rows = np.arange(length)[:, None]
    idx = np.where(valid, rows, 0)
    np.maximum.accumulate(idx, axis=0, out=idx)
    filled = arr[idx, np.arange(N_PLAYERS)[None, :]]
    filled[~seen] = -1
    age = np.minimum(rows - idx, 254).astype(np.uint8)
    age[~seen] = 255
    return filled, age


def _draft(full: dict[str, Any]) -> list[DraftAction]:
    out: list[DraftAction] = []
    for a in sorted(full.get("draftActions", ()), key=lambda d: d.get("sequenceNumber", 0)):
        d = a.get("draftable") or {}
        out.append(
            DraftAction(
                seq=int(a.get("sequenceNumber", 0)),
                action=a.get("type", ""),
                team_id=(a.get("drafter") or {}).get("id", ""),
                character_id=d.get("id", ""),
                character=d.get("name", ""),
            )
        )
    return out


def extract_file(path: Path) -> list[GameData]:
    return extract_series(iter_lines(path))
