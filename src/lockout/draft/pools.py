"""Fearless champion pools and the *pool stress* of a series.

In Fearless Draft every champion picked in a game is locked for the rest of the series, for **both**
teams. A player's comfortable pool therefore shrinks game after game. This module quantifies that:

* a player's **pool** is the champions they have played, weighted by recency;
* the **remaining mass** is the share of that pool that is still available given the locked champions;
* the **stress** of a team in a game is the lowest remaining mass among its players: the first role
  to run out of comfortable options.

Everything here is pure (no I/O) so it can be tested and reused by the API and the backtest.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

HALF_LIFE_DAYS = 120.0
MIN_HISTORY = 8  # picks needed before a player's pool is trusted
CRITICAL_MASS = 0.35
THIN_MASS = 0.6


@dataclass(frozen=True, slots=True)
class PickRec:
    game_id: str
    series_id: str
    game_number: int
    t: datetime
    team_id: str
    player_id: str
    role: str
    champion: str
    won: bool


@dataclass(frozen=True, slots=True)
class RoleRunway:
    player_id: str
    role: str
    history: int  # picks the pool is based on
    mass: float  # share of the (recency-weighted) pool still available
    depth: int  # distinct available champions the player has played at least twice
    remaining: list[tuple[str, float]]  # (champion, share of the full pool), best first
    status: str  # "ok" | "thin" | "critical"


def weight(age_days: float) -> float:
    return 0.5 ** (max(age_days, 0.0) / HALF_LIFE_DAYS)


def pool_weights(history: list[PickRec], as_of: datetime) -> dict[str, float]:
    """Recency-weighted share of each champion in a player's history before ``as_of``."""
    raw: dict[str, float] = defaultdict(float)
    for p in history:
        if p.t < as_of:
            raw[p.champion] += weight((as_of - p.t).total_seconds() / 86400.0)
    total = sum(raw.values())
    return {c: w / total for c, w in raw.items()} if total else {}


def classify(mass: float) -> str:
    return "critical" if mass < CRITICAL_MASS else "thin" if mass < THIN_MASS else "ok"


def runway(
    player_id: str,
    role: str,
    history: list[PickRec],
    as_of: datetime,
    unavailable: set[str],
) -> RoleRunway | None:
    """How much of a player's pool survives the locked/banned champions. ``None`` if too little history."""
    past = [p for p in history if p.t < as_of]
    if len(past) < MIN_HISTORY:
        return None
    shares = pool_weights(past, as_of)
    counts: dict[str, int] = defaultdict(int)
    for p in past:
        counts[p.champion] += 1
    remaining = sorted(
        ((c, s) for c, s in shares.items() if c not in unavailable),
        key=lambda cs: cs[1],
        reverse=True,
    )
    mass = sum(s for _, s in remaining)
    depth = sum(1 for c, _ in remaining if counts[c] >= 2)
    return RoleRunway(player_id, role, len(past), mass, depth, remaining, classify(mass))


def stress(runways: list[RoleRunway | None], min_valid: int = 4) -> float | None:
    """Lowest remaining mass in the lineup; ``None`` unless enough players have a trusted pool."""
    valid = [r.mass for r in runways if r is not None]
    return min(valid) if len(valid) >= min_valid else None


def ban_targets(r: RoleRunway, k: int = 3) -> list[tuple[str, float]]:
    """Champions whose removal takes the largest bite out of what the player has left."""
    if r.mass <= 0:
        return []
    return [(c, s / r.mass) for c, s in r.remaining[:k]]
