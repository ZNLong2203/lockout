"""Monte Carlo forecast of a Fearless series: which role runs out of champions, and when.

Both teams pick from their players' historical pools (weights = recency-weighted pick shares), game after
game, with every pick locked for both teams. The output is the probability that each role is *critical*
(less than ``CRITICAL_MASS`` of its pool left) at the start of each later game.

Bans are not modelled: they would only remove a few more champions, so the forecast is, if anything,
slightly optimistic about how long pools last. :func:`calibrate` compares it with what really happened.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from macrodna.draft.pools import CRITICAL_MASS


@dataclass(frozen=True, slots=True)
class SimPlayer:
    player_id: str
    role: str
    shares: dict[str, float]  # champion -> share of the player's pool


@dataclass(slots=True)
class SeriesForecast:
    n_sims: int
    games: int
    # {team: {role: [mean mass at the start of game 1..games]}}
    mean_mass: dict[str, dict[str, list[float]]]
    # {team: {role: [P(critical) at the start of game 1..games]}}
    p_critical: dict[str, dict[str, list[float]]]
    # {team: [mean stress (lowest role mass) at the start of game 1..games]}
    mean_stress: dict[str, list[float]]
    # {team: {role: P(role is the team's weakest) at the start of game `games`}}
    weakest_at_end: dict[str, dict[str, float]]


def _pick(shares: dict[str, float], taken: set[str], rng: np.random.Generator) -> str | None:
    options = [(c, s) for c, s in shares.items() if c not in taken]
    if not options:
        return None
    weights = np.array([s for _, s in options])
    return options[int(rng.choice(len(options), p=weights / weights.sum()))][0]


def _mass(player: SimPlayer, locked: set[str]) -> float:
    return sum(s for c, s in player.shares.items() if c not in locked)


def simulate(
    lineups: dict[str, list[SimPlayer]],
    games: int = 4,
    n_sims: int = 400,
    seed: int = 0,
) -> SeriesForecast:
    rng = np.random.default_rng(seed)
    teams = list(lineups)
    mass_acc: dict[str, dict[str, list[list[float]]]] = {
        t: {p.role: [[] for _ in range(games)] for p in lineups[t]} for t in teams
    }
    stress_acc: dict[str, list[list[float]]] = {t: [[] for _ in range(games)] for t in teams}
    weakest_count: dict[str, dict[str, int]] = {t: defaultdict(int) for t in teams}
    for _ in range(n_sims):
        locked: set[str] = set()
        for g in range(games):
            for t in teams:
                masses = {p.role: _mass(p, locked) for p in lineups[t]}
                for role, m in masses.items():
                    mass_acc[t][role][g].append(m)
                stress_acc[t][g].append(min(masses.values()))
                if g == games - 1:
                    weakest_count[t][min(masses, key=masses.__getitem__)] += 1
            taken: set[str] = set()
            order = [(t, p) for t in teams for p in lineups[t]]
            rng.shuffle(order)  # type: ignore[arg-type]
            for _t, p in order:
                champ = _pick(p.shares, locked | taken, rng)
                if champ is not None:
                    taken.add(champ)
            locked |= taken
    return SeriesForecast(
        n_sims=n_sims,
        games=games,
        mean_mass={
            t: {r: [float(np.mean(v)) for v in gs] for r, gs in d.items()}
            for t, d in mass_acc.items()
        },
        p_critical={
            t: {r: [float(np.mean(np.array(v) < CRITICAL_MASS)) for v in gs] for r, gs in d.items()}
            for t, d in mass_acc.items()
        },
        mean_stress={t: [float(np.mean(v)) for v in gs] for t, gs in stress_acc.items()},
        weakest_at_end={t: {r: n / n_sims for r, n in c.items()} for t, c in weakest_count.items()},
    )
