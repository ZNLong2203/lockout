"""Tells: conditional behaviours of a team, each with evidence and an honest sample size.

A *tell* is "when <situation>, this team does <response> in k of n cases", compared with how the rest of the
league behaves in the same situation. To avoid the usual trap of mining thousands of patterns and
presenting the lucky ones, the situations come from a fixed, coach-meaningful library
(:data:`TEMPLATES`), every (team, template) pair is tested against the league baseline with an exact
binomial test, and the p-values are corrected for the number of comparisons (Benjamini-Hochberg).

The output keeps every occurrence (game, trigger time, outcome time) so the UI can open the replay at the
exact moment, and ranks nothing as a "tell" unless it is both frequent enough and clearly unusual.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from scipy.stats import binomtest

from lockout.facts import OTHER, GameFacts, load_facts

MIN_ATTEMPTS = 6  # fewer occurrences than this are never reported as a tell
SHRINK_STRENGTH = 10.0  # pseudo-observations pulling a team's rate toward the league rate
RESPONSE_WINDOW = 120
GANK_WINDOW = 90
GANK_DEADLINE = 300  # a jungler's first lane appearance counts as a "gank" only before 5:00
FOLLOW_UP_KINDS = frozenset({"herald", "grubs", "dragon", "baron"})


@dataclass(frozen=True, slots=True)
class Attempt:
    t_trigger: int
    hit: bool
    t_outcome: int | None = None


Evaluator = Callable[[GameFacts, str], list[Attempt]]


@dataclass(frozen=True, slots=True)
class Template:
    id: str
    group: str
    title: str  # reads as "<team>: <title>"
    evaluate: Evaluator


def _first_obj(g: GameFacts, kind: str):
    return next((o for o in g.objs if o.kind == kind), None)


def _follow_up(g: GameFacts, side: str, after: int, window: int):
    return next(
        (
            o
            for o in g.objs
            if o.side == side and o.kind in FOLLOW_UP_KINDS and after < o.t <= after + window
        ),
        None,
    )


def lost_first_dragon_responds(g: GameFacts, side: str) -> list[Attempt]:
    d = _first_obj(g, "dragon")
    if d is None or d.side == side:
        return []
    r = _follow_up(g, side, d.t, RESPONSE_WINDOW)
    return [Attempt(d.t, r is not None, r.t if r else None)]


def took_first_dragon_snowballs(g: GameFacts, side: str) -> list[Attempt]:
    d = _first_obj(g, "dragon")
    if d is None or d.side != side:
        return []
    r = _follow_up(g, side, d.t, RESPONSE_WINDOW)
    return [Attempt(d.t, r is not None, r.t if r else None)]


def baron_converts_into_structures(g: GameFacts, side: str) -> list[Attempt]:
    b = _first_obj(g, "baron")
    if b is None or b.side != side:
        return []
    hits = [s for s in g.structs if s.side == side and b.t < s.t <= b.t + 150]
    return [Attempt(b.t, len(hits) >= 2, hits[1].t if len(hits) >= 2 else None)]


def first_blood_leads_to_first_dragon(g: GameFacts, side: str) -> list[Attempt]:
    if not g.kills or g.kills[0].side != side or g.kills[0].t > 480:
        return []
    d = _first_obj(g, "dragon")
    hit = d is not None and d.side == side
    return [Attempt(g.kills[0].t, hit, d.t if hit and d else None)]


def first_grubs_lead_to_first_tower(g: GameFacts, side: str) -> list[Attempt]:
    grubs = _first_obj(g, "grubs")
    tower = next((s for s in g.structs if s.kind == "tower"), None)
    if grubs is None or grubs.side != side or tower is None:
        return []
    return [Attempt(grubs.t, tower.side == side, tower.t if tower.side == side else None)]


def top_start_takes_first_grubs(g: GameFacts, side: str) -> list[Attempt]:
    j, grubs = g.jungle.get(side), _first_obj(g, "grubs")
    if j is None or j.start_side != "top" or grubs is None:
        return []
    return [Attempt(30, grubs.side == side, grubs.t if grubs.side == side else None)]


def bot_start_takes_first_dragon(g: GameFacts, side: str) -> list[Attempt]:
    j, d = g.jungle.get(side), _first_obj(g, "dragon")
    if j is None or j.start_side != "bot" or d is None:
        return []
    return [Attempt(30, d.side == side, d.t if d.side == side else None)]


def _gank(lane: str) -> Evaluator:
    def evaluate(g: GameFacts, side: str) -> list[Attempt]:
        j = g.jungle.get(side)
        if (
            j is None
            or j.first_lane != lane
            or j.first_lane_t is None
            or j.first_lane_t > GANK_DEADLINE
        ):
            return []
        t0 = j.first_lane_t
        kill = next(
            (
                k
                for k in g.kills
                if k.side == side and k.lane == lane and t0 <= k.t <= t0 + GANK_WINDOW
            ),
            None,
        )
        return [Attempt(t0, kill is not None, kill.t if kill else None)]

    return evaluate


def prepositioned_secures_objective(g: GameFacts, side: str) -> list[Attempt]:
    out = []
    for s in g.setups:
        if s.side != side or s.objective not in ("dragon", "herald", "baron"):
            continue
        if s.t_spawn is None or s.n_spawn_0 is None or s.n_spawn_0 < 3:
            continue
        out.append(Attempt(s.t_spawn, s.is_killer, s.t_kill if s.is_killer else None))
    return out


def first_baron_wins_game(g: GameFacts, side: str) -> list[Attempt]:
    b = _first_obj(g, "baron")
    if b is None or b.side != side or g.winner_side is None:
        return []
    return [Attempt(b.t, g.winner_side == side)]


TEMPLATES: tuple[Template, ...] = (
    Template("lost_first_dragon_responds", "objective trades",
             "after losing the first dragon, takes another objective within 2 minutes",
             lost_first_dragon_responds),
    Template("took_first_dragon_snowballs", "objective trades",
             "after taking the first dragon, follows up with another objective within 2 minutes",
             took_first_dragon_snowballs),
    Template("baron_converts", "conversion",
             "after taking Baron, destroys two structures within 2.5 minutes",
             baron_converts_into_structures),
    Template("first_blood_to_dragon", "early game",
             "after first blood (before 8:00), takes the first dragon",
             first_blood_leads_to_first_dragon),
    Template("grubs_to_first_tower", "early game",
             "after taking the first grubs, also takes the first tower",
             first_grubs_lead_to_first_tower),
    Template("top_start_grubs", "jungle",
             "jungler starts top-side and the team takes the first grubs",
             top_start_takes_first_grubs),
    Template("bot_start_dragon", "jungle",
             "jungler starts bot-side and the team takes the first dragon",
             bot_start_takes_first_dragon),
    Template("gank_top", "jungle", "first appearance in top lane (before 5:00) turns into a kill there within 90 s",
             _gank("top")),
    Template("gank_mid", "jungle", "first appearance in mid lane (before 5:00) turns into a kill there within 90 s",
             _gank("mid")),
    Template("gank_bot", "jungle", "first appearance in bot lane (before 5:00) turns into a kill there within 90 s",
             _gank("bot")),
    Template("prepositioned_secures", "setup",
             "with three players in place when an objective spawns, secures it",
             prepositioned_secures_objective),
    Template("first_baron_wins", "conversion",
             "after taking the first Baron, wins the game",
             first_baron_wins_game),
)  # fmt: skip


def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def benjamini_hochberg(pvalues: list[float]) -> list[float]:
    """Adjusted p-values (q-values) controlling the false discovery rate."""
    m = len(pvalues)
    if m == 0:
        return []
    order = np.argsort(pvalues)
    q = np.empty(m)
    running = 1.0
    for rank, idx in reversed(list(enumerate(order, start=1))):
        running = min(running, pvalues[idx] * m / rank)
        q[idx] = running
    return q.tolist()


def classify(q: float, n: int) -> str:
    if n >= 8 and q <= 0.05:
        return "strong"
    if n >= MIN_ATTEMPTS and q <= 0.2:
        return "suggestive"
    return "typical"


def collect_attempts(
    facts: list[GameFacts], templates: tuple[Template, ...] = TEMPLATES
) -> dict[str, dict[str, list[tuple[str, Attempt]]]]:
    """``{template_id: {team_id: [(game_id, attempt), ...]}}`` over every game and both sides."""
    out: dict[str, dict[str, list[tuple[str, Attempt]]]] = {
        t.id: defaultdict(list) for t in templates
    }
    for g in facts:
        for side in OTHER:
            for t in templates:
                for a in t.evaluate(g, side):
                    out[t.id][g.teams[side]].append((g.game_id, a))
    return out


def score_tells(
    attempts: dict[str, dict[str, list[tuple[str, Attempt]]]],
    templates: tuple[Template, ...] = TEMPLATES,
) -> list[dict[str, object]]:
    info = {t.id: t for t in templates}
    rows: list[dict[str, object]] = []
    for tid, by_team in attempts.items():
        total_n = sum(len(v) for v in by_team.values())
        total_k = sum(a.hit for v in by_team.values() for _, a in v)
        if total_n == 0:
            continue
        base = total_k / total_n
        for team, items in by_team.items():
            n = len(items)
            if n < MIN_ATTEMPTS:
                continue
            k = sum(a.hit for _, a in items)
            lo, hi = wilson_interval(k, n)
            rows.append(
                {
                    "team_id": team,
                    "template_id": tid,
                    "group": info[tid].group,
                    "title": info[tid].title,
                    "n": n,
                    "hits": k,
                    "rate": k / n,
                    "shrunk_rate": (k + SHRINK_STRENGTH * base) / (n + SHRINK_STRENGTH),
                    "baseline": base,
                    "baseline_n": total_n,
                    "ci_lo": lo,
                    "ci_hi": hi,
                    "p": float(binomtest(k, n, base).pvalue),
                }
            )
    qs = benjamini_hochberg([float(r["p"]) for r in rows])  # type: ignore[arg-type]
    for r, q in zip(rows, qs, strict=True):
        r["q"] = q
        r["strength"] = classify(q, int(r["n"]))  # type: ignore[arg-type]
        r["direction"] = "above" if float(r["rate"]) > float(r["baseline"]) else "below"  # type: ignore[arg-type]
    return rows


def evidence_rows(
    attempts: dict[str, dict[str, list[tuple[str, Attempt]]]], scored: list[dict[str, object]]
) -> list[dict[str, object]]:
    kept = {(r["team_id"], r["template_id"]) for r in scored}
    return [
        {
            "team_id": team,
            "template_id": tid,
            "game_id": gid,
            "t_trigger": a.t_trigger,
            "hit": a.hit,
            "t_outcome": a.t_outcome,
        }
        for tid, by_team in attempts.items()
        for team, items in by_team.items()
        if (team, tid) in kept
        for gid, a in items
    ]


def write_tells(cache_lol_dir: Path) -> tuple[int, int]:
    facts = load_facts(cache_lol_dir)
    attempts = collect_attempts(facts)
    scored = score_tells(attempts)
    evidence = evidence_rows(attempts, scored)
    pq.write_table(
        pa.Table.from_pylist(scored), cache_lol_dir / "tells.parquet", compression="zstd"
    )
    pq.write_table(
        pa.Table.from_pylist(evidence), cache_lol_dir / "tell_evidence.parquet", compression="zstd"
    )
    return len(scored), len(evidence)
