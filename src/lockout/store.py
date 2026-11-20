"""Read access to the local cache (derived from licensed data: never export or commit it)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

N_SLOTS = 10
UNKNOWN_AGE = 255


@dataclass(slots=True)
class GameTrack:
    """Dense 1 Hz trajectories of one game."""

    game_id: str
    pos: np.ndarray  # (T, 10, 2) int16, -1 = unknown
    age: np.ndarray  # (T, 10) uint8, seconds since the last real sample

    @property
    def length(self) -> int:
        return self.pos.shape[0]


def iter_game_tracks(cache_lol_dir: Path) -> Iterator[GameTrack]:
    """Yield every game's dense trajectories, one series shard at a time (bounded memory)."""
    for shard in sorted((cache_lol_dir / "tracks").glob("*.parquet")):
        table = pq.read_table(shard)
        game_ids = table["game_id"].to_numpy(zero_copy_only=False).astype(str)
        t = table["t"].to_numpy()
        slot = table["slot"].to_numpy()
        x, y, age = table["x"].to_numpy(), table["y"].to_numpy(), table["age"].to_numpy()
        for gid in dict.fromkeys(game_ids.tolist()):
            m = game_ids == gid
            length = int(t[m].max()) + 1
            pos = np.full((length, N_SLOTS, 2), -1, dtype=np.int16)
            ages = np.full((length, N_SLOTS), UNKNOWN_AGE, dtype=np.uint8)
            tt, ss = t[m], slot[m]
            pos[tt, ss, 0] = x[m]
            pos[tt, ss, 1] = y[m]
            ages[tt, ss] = age[m]
            yield GameTrack(gid, pos, ages)
