"""Extractor tests on a tiny hand-built feed (no licensed data is used)."""

from __future__ import annotations

from typing import Any

import numpy as np
import orjson

from macrodna.etl.extract import MAX_GAME_S, extract_series, parse_duration

BLUE = ["b0", "b1", "b2", "b3", "b4"]
RED = ["r0", "r1", "r2", "r3", "r4"]


def _players(positions: dict[str, tuple[int, int]]) -> list[dict[str, Any]]:
    return [
        {"id": pid, "name": pid.upper(), "position": {"x": x, "y": y}}
        for pid, (x, y) in positions.items()
    ]


def _game(
    gid: str,
    t: int,
    positions: dict[str, tuple[int, int]],
    *,
    full: bool = False,
    duration: str | None = None,
    won_blue: bool = True,
) -> dict[str, Any]:
    blue = {p: positions[p] for p in BLUE if p in positions}
    red = {p: positions[p] for p in RED if p in positions}
    g: dict[str, Any] = {
        "id": gid,
        "clock": {"type": "gameClock", "currentSeconds": t},
        "teams": [
            {
                "id": "100",
                "players": _players(blue),
                **({"side": "blue", "name": "Blue", "won": won_blue} if full else {}),
            },
            {
                "id": "200",
                "players": _players(red),
                **({"side": "red", "name": "Red", "won": not won_blue} if full else {}),
            },
        ],
    }
    if full:
        g["map"] = {
            "name": "Summoner's Rift",
            "bounds": {"min": {"x": 300, "y": 200}, "max": {"x": 16000, "y": 16000}},
        }
        g["duration"] = duration or f"PT{t}S"
        g["draftActions"] = [
            {
                "sequenceNumber": 2,
                "type": "pick",
                "drafter": {"id": "200"},
                "draftable": {"id": "c2", "name": "Ahri"},
            },
            {
                "sequenceNumber": 1,
                "type": "ban",
                "drafter": {"id": "100"},
                "draftable": {"id": "c1", "name": "Rumble"},
            },
        ]
    return g


def _env(
    seq: int,
    typ: str,
    games: list[dict[str, Any]],
    actor: dict | None = None,
    target: dict | None = None,
) -> bytes:
    actor_type, action, target_type = typ.split("-", 2)
    ev = {
        "id": f"e{seq}",
        "type": typ,
        "action": action,
        "actor": actor or {"type": actor_type, "id": "x"},
        "target": target or {"type": target_type, "id": "y"},
        "seriesState": {"id": "s", "games": games},
    }
    return orjson.dumps({"id": f"env{seq}", "sequenceNumber": seq, "events": [ev]})


def _pos(offset: int = 0) -> dict[str, tuple[int, int]]:
    return {pid: (1000 + 10 * i + offset, 2000 + offset) for i, pid in enumerate(BLUE + RED)}


def _feed() -> list[bytes]:
    return [
        _env(
            1, "series-started-game", [_game("gA", 0, _pos())], target={"type": "game", "id": "gA"}
        ),
        _env(
            2,
            "player-purchased-item",
            [_game("gA", 0, _pos())],
            actor={"type": "player", "id": "b2"},
            target={"type": "item", "id": "atlas", "state": {"name": "World Atlas"}},
        ),
        _env(3, "game-set-gameClock", [_game("gA", 1, _pos(5))]),
        # t = 2 has no snapshot: positions must be held and flagged as stale
        _env(
            4,
            "player-killed-player",
            [_game("gA", 4, _pos(20))],
            actor={"type": "player", "id": "b0"},
            target={"type": "player", "id": "r0"},
        ),
        # an abandoned game that is rolled back must disappear
        _env(
            5, "series-started-game", [_game("gB", 0, _pos())], target={"type": "game", "id": "gB"}
        ),
        _env(
            6, "series-!started-game", [_game("gB", 0, _pos())], target={"type": "game", "id": "gB"}
        ),
        _env(
            7,
            "series-started-game",
            [_game("gA", 4, _pos(20))],
            target={"type": "game", "id": "gA"},
        ),
        _env(
            8, "game-set-gameClock", [_game("gA", 5, _pos(30), full=True, duration="PT4456H12M3S")]
        ),
    ]


def test_parse_duration() -> None:
    assert parse_duration("PT32M37.648S") == 1957
    assert parse_duration("PT1H0M5S") == 3605
    assert parse_duration(None) is None
    assert parse_duration("garbage") is None


def test_rolled_back_game_is_dropped_and_duration_anomaly_is_clamped() -> None:
    games = extract_series(iter(_feed()))
    assert [g.game_id for g in games] == ["gA"]
    g = games[0]
    assert g.duration_s <= MAX_GAME_S, "an absurd feed duration must fall back to the game clock"
    assert g.pos.shape[0] == g.duration_s + 1


def test_positions_are_held_and_staleness_is_tracked() -> None:
    g = extract_series(iter(_feed()))[0]
    slot = 0  # first blue player
    assert tuple(g.pos[1, slot]) == (1005, 2005)
    assert tuple(g.pos[2, slot]) == (1005, 2005), "no sample at t=2: previous position is held"
    assert g.age[1, slot] == 0
    assert g.age[2, slot] == 1
    assert g.age[3, slot] == 2
    assert tuple(g.pos[4, slot]) == (1020, 2020)


def test_events_teams_and_draft() -> None:
    g = extract_series(iter(_feed()))[0]
    kinds = [(e.kind, e.name) for e in g.events]
    assert ("kill", "kill") in kinds
    kill = next(e for e in g.events if e.kind == "kill")
    assert (kill.t, kill.actor_pid, kill.target_pid) == (4, "b0", "r0")
    buy = next(e for e in g.events if e.kind == "purchase")
    assert buy.name == "World Atlas" and buy.actor_pid == "b2"
    assert g.teams == {"100": ("blue", "Blue"), "200": ("red", "Red")}
    assert g.winner_team_id == "100"
    assert [d.character for d in g.draft] == ["Rumble", "Ahri"], (
        "draft is ordered by sequence number"
    )
    assert g.bounds == (300.0, 200.0, 16000.0, 16000.0)
    assert [p.player_id for p in g.players] == BLUE + RED
    assert np.all(g.pos[0] >= 0)
