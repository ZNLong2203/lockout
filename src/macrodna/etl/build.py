"""Build the local analysis cache (Parquet) from the GRID LoL feeds.

Everything is written under the gitignored cache directory (``private/cache`` by default). The cache is
derived from licensed data: it must never be committed or published.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from macrodna.config import Settings
from macrodna.etl.extract import GameData, extract_file

_SERIES_RE = re.compile(r"events_(\d+)_grid")

TABLE_NAMES = ("games", "players", "events", "draft")


def series_id_of(path: Path) -> str:
    m = _SERIES_RE.match(path.name)
    if not m:
        raise ValueError(f"unexpected feed file name: {path.name}")
    return m.group(1)


def _tracks_table(game: GameData) -> pa.Table:
    t_len = game.pos.shape[0]
    flat = game.pos.reshape(-1, 2)
    t = np.repeat(np.arange(t_len, dtype=np.int16), game.pos.shape[1])
    slot = np.tile(np.arange(game.pos.shape[1], dtype=np.int8), t_len)
    keep = flat[:, 0] >= 0
    age = game.age.reshape(-1)
    n = int(keep.sum())
    return pa.table(
        {
            "game_id": pa.repeat(game.game_id, n),
            "t": pa.array(t[keep]),
            "slot": pa.array(slot[keep]),
            "x": pa.array(flat[keep, 0]),
            "y": pa.array(flat[keep, 1]),
            "age": pa.array(age[keep]),
        }
    )


def _rows(series_id: str, games: Iterable[GameData]) -> dict[str, list[dict[str, Any]]]:
    rows: dict[str, list[dict[str, Any]]] = {name: [] for name in TABLE_NAMES}
    for g in games:
        blue = next((tid for tid, (side, _) in g.teams.items() if side == "blue"), None)
        red = next((tid for tid, (side, _) in g.teams.items() if side == "red"), None)
        rows["games"].append(
            {
                "series_id": series_id,
                "game_id": g.game_id,
                "game_number": g.game_number,
                "duration_s": g.duration_s,
                "winner_team_id": g.winner_team_id,
                "blue_team_id": blue,
                "red_team_id": red,
                "blue_name": g.teams[blue][1] if blue else None,
                "red_name": g.teams[red][1] if red else None,
                "n_draft_actions": len(g.draft),
            }
        )
        rows["players"] += [
            {
                "game_id": g.game_id,
                "slot": p.slot,
                "player_id": p.player_id,
                "name": p.name,
                "team_id": p.team_id,
                "side": p.side,
            }
            for p in g.players
        ]
        rows["events"] += [
            {
                "game_id": g.game_id,
                "seq": i,
                "t": e.t,
                "kind": e.kind,
                "name": e.name,
                "actor_pid": e.actor_pid,
                "target_pid": e.target_pid,
                "target_id": e.target_id,
                "x": e.x,
                "y": e.y,
                "assists": ",".join(e.assists) if e.assists else None,
            }
            for i, e in enumerate(g.events)
        ]
        rows["draft"] += [
            {
                "game_id": g.game_id,
                "seq": d.seq,
                "action": d.action,
                "team_id": d.team_id,
                "character_id": d.character_id,
                "character": d.character,
            }
            for d in g.draft
        ]
    return rows


def _extract(path_s: str) -> tuple[str, list[GameData] | None, str]:
    """Worker: pure-Python/NumPy extraction only. Parquet is written by the parent process."""
    series_id = series_id_of(Path(path_s))
    try:
        return series_id, extract_file(Path(path_s)), ""
    except Exception as exc:  # keep the batch going; report the failure at the end
        return series_id, None, f"{type(exc).__name__}: {exc}"


def _backfill_item_names(events: list[dict[str, Any]]) -> None:
    """Some purchase events omit the item name although the item id is known from other events."""
    item_kinds = ("purchase", "sell")
    names = {e["target_id"]: e["name"] for e in events if e["kind"] in item_kinds and e["name"]}
    for e in events:
        if e["kind"] in item_kinds and not e["name"]:
            e["name"] = names.get(e["target_id"], "")


def build_cache(
    settings: Settings, limit: int | None = None, workers: int | None = None
) -> dict[str, Any]:
    settings.validate()
    out = settings.cache_dir / "lol"
    tracks_dir = out / "tracks"
    tracks_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(settings.lol_dir.glob("events_*_grid.jsonl.zst"))
    if limit:
        files = files[:limit]
    merged: dict[str, list[dict[str, Any]]] = {name: [] for name in TABLE_NAMES}
    failures: list[tuple[str, str]] = []
    n_workers = workers or max(1, (os.cpu_count() or 2) - 1)
    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        for series_id, games, err in pool.map(_extract, [str(f) for f in files], chunksize=2):
            if games is None:
                failures.append((series_id, err))
                continue
            if games:
                table = pa.concat_tables([_tracks_table(g) for g in games])
                pq.write_table(table, tracks_dir / f"{series_id}.parquet", compression="zstd")
            rows = _rows(series_id, games)
            for name in TABLE_NAMES:
                merged[name] += rows[name]
    _backfill_item_names(merged["events"])
    for name, rows in merged.items():
        pq.write_table(pa.Table.from_pylist(rows), out / f"{name}.parquet", compression="zstd")
    return {
        "series": len(files),
        "games": len(merged["games"]),
        "events": len(merged["events"]),
        "failures": failures,
        "out": str(out),
    }
