"""Leaguepedia rows -> Lockout cache, on hand-made rows (no network)."""

from __future__ import annotations

from pathlib import Path

import duckdb

from lockout.public.export import clean, slug
from lockout.public.leaguepedia import _event, build


def _row(game: str, blue: str, red: str, pb1: str, winner: str, n: int) -> dict[str, str]:
    r = {
        "game": game, "match": "M1", "page": "LCK/2026 Season/Season Playoffs", "dt": "2026-09-13 08:19:00",
        "blue": blue, "red": red, "winner": winner, "patch": "26.16", "n": str(n), "minutes": "30",
        "bplayers": "B1,B2,B3,B4,B5", "rplayers": "R1,R2,R3,R4 (Real Name),R5",
        "bpicks": "Gwen,Trundle,Viktor,Corki,Alistar", "rpicks": "Jayce,Vi,Azir,Jhin,Rell",
        "pb1": pb1, "pb2": red if pb1 == blue else blue,
    }  # fmt: skip
    blue_key, red_key = ("1", "2") if pb1 == blue else ("2", "1")
    for i, c in enumerate(["Gwen", "Trundle", "Viktor", "Corki", "Alistar"], 1):
        r[f"t{blue_key}pick{i}"] = c
    for i, c in enumerate(["Jayce", "Vi", "Azir", "Jhin", "Rell"], 1):
        r[f"t{red_key}pick{i}"] = c
    for i in range(1, 6):
        r[f"t{blue_key}ban{i}"] = f"BlueBan{i}"
        r[f"t{red_key}ban{i}"] = f"RedBan{i}" if i != 5 else "None"
    return r


def test_build_places_each_side_on_its_slots_even_when_pb_lists_red_first(tmp_path: Path) -> None:
    rows = [
        _row("G1", "Gen.G", "HLE", "Gen.G", "Gen.G", 1),
        _row("G2", "HLE", "Gen.G", "Gen.G", "Gen.G", 2),
    ]
    stats = build(rows, tmp_path / "data", tmp_path / "cache")
    assert stats == {
        "games": 2,
        "draft_actions": 38,
        "skipped": 0,
    }  # 19 per game: one "None" ban each
    lol = tmp_path / "cache" / "lol"
    d = duckdb.sql(
        f"select game_id, seq, side, team_id, action, champion, role, player_id, won from '{lol}/draft_enriched.parquet'"
    ).fetchall()
    g2 = {
        seq: (side, team, action, champ, role, pid, won)
        for gid, seq, side, team, action, champ, role, pid, won in d
        if gid == "G2"
    }
    # HLE is blue in G2 although Leaguepedia's draft table lists Gen.G first: blue drafts first
    assert g2[7] == ("blue", "HLE", "pick", "Gwen", "top", "B1", False)
    assert g2[8][:4] == ("red", "Gen.G", "pick", "Jayce")
    assert g2[1][3] == "BlueBan1"
    assert 15 not in g2  # red's missing fifth ban (seq 15) leaves its slot empty
    players = duckdb.sql(
        f"select name, role from '{lol}/players.parquet' where game_id = 'G1' and slot = 8"
    ).fetchall()
    assert players == [("R4", "adc")]
    assert (tmp_path / "data" / "meta" / "teams.csv").read_text().count("\n") == 3


def test_event_names_and_display_helpers() -> None:
    assert _event("2026 Season World Championship/Main Event") == ("Worlds - Main Event", "Worlds")
    assert _event("LCK/2026 Season/Season Playoffs") == ("LCK - 2026 Season Season Playoffs", "LCK")
    assert clean("LYON (2024 American Team)") == "LYON"
    assert slug("a/b c") == slug("a/b c") and len(slug("x")) == 12
