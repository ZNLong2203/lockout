"""Pick and ban tendencies of a team, compared with the rest of the league.

Answers the coach's two standing questions:

* *What pick/ban tendencies repeat for this opponent?* Each champion's rate for the team is tested against
  the league rate in the same scope (exact binomial test, Benjamini-Hochberg across the team's champions),
  so a champion is only called distinctive when it is both frequent enough and unusual.
* *How does their draft shift in Fearless games 2-5?* ``pick_depth_by_game`` measures how far down their
  available pool they have to reach: the rank of each pick among the champions still available to that
  player, and how often it is a champion the player has never played before.

Pure functions over rows, so everything is testable without data.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
from scipy.stats import binomtest

from macrodna.detectors.tells import benjamini_hochberg
from macrodna.draft.analysis import _index
from macrodna.draft.pools import PickRec, runway

MIN_COUNT = 4  # a champion needs this many appearances (or this many expected) to be tested
MIN_TEAM_GAMES = 6  # fewer games than this and a team gets no tendency report, never empty numbers
SCOPES = ("all", "g1", "later")
EVIDENCE_LIMIT = 8


@dataclass(frozen=True, slots=True)
class DraftRow:
    game_id: str
    game_number: int
    team_id: str
    side: str
    action: str  # ban | pick
    phase: str
    champion: str
    role: str | None


@dataclass(slots=True)
class Tendency:
    team_id: str
    action: str
    champion: str
    count: int
    team_games: int
    rate: float
    league_rate: float
    p: float
    q: float = 1.0
    direction: str = "above"
    strength: str = "typical"
    evidence: list[str] = field(default_factory=list)  # game ids, newest last


def load_draft_rows(cache_lol_dir: Path) -> list[DraftRow]:
    rows = (
        duckdb.connect()
        .sql(
            f"""select game_id, game_number, team_id, side, action, phase, champion, role
            from read_parquet('{cache_lol_dir}/draft_enriched.parquet') order by started_at, game_id, seq"""
        )
        .fetchall()
    )
    return [DraftRow(g, int(n), t, s, a, ph, c, r) for g, n, t, s, a, ph, c, r in rows]


def in_scope(row: DraftRow, scope: str) -> bool:
    return scope == "all" or (scope == "g1") == (row.game_number == 1)


def champion_roles(rows: list[DraftRow]) -> dict[str, str]:
    """The role a champion is most often picked in, league-wide (used to read what a ban targets)."""
    by_champ: dict[str, Counter[str]] = defaultdict(Counter)
    for r in rows:
        if r.action == "pick" and r.role and r.role != "unknown":
            by_champ[r.champion][r.role] += 1
    return {c: cnt.most_common(1)[0][0] for c, cnt in by_champ.items()}


def team_tendencies(
    rows: list[DraftRow], team_id: str, scope: str = "all", min_count: int = MIN_COUNT
) -> list[Tendency]:
    scoped = [r for r in rows if in_scope(r, scope)]
    team_games = {r.game_id for r in scoped if r.team_id == team_id}
    all_team_games = {(r.game_id, r.team_id) for r in scoped}
    if not team_games or not all_team_games:
        return []
    n_team, n_league = len(team_games), len(all_team_games)
    league = Counter((r.action, r.champion) for r in scoped)
    mine = Counter((r.action, r.champion) for r in scoped if r.team_id == team_id)
    games_by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in scoped:
        if r.team_id == team_id:
            games_by_key[(r.action, r.champion)].append(r.game_id)

    out: list[Tendency] = []
    for key in set(mine) | {k for k, v in league.items() if v / n_league * n_team >= min_count}:
        action, champion = key
        count = mine.get(key, 0)
        league_rate = league[key] / n_league
        if count < min_count and league_rate * n_team < min_count:
            continue
        out.append(
            Tendency(
                team_id, action, champion, count, n_team, count / n_team, league_rate,
                float(binomtest(count, n_team, min(max(league_rate, 1e-9), 1 - 1e-9)).pvalue),
                evidence=games_by_key.get(key, [])[-EVIDENCE_LIMIT:],
            )
        )  # fmt: skip
    for t, q in zip(out, benjamini_hochberg([t.p for t in out]), strict=True):
        t.q = q
        t.direction = "above" if t.rate > t.league_rate else "below"
        t.strength = (
            "strong" if q <= 0.05 and t.count >= 6 else "suggestive" if q <= 0.2 else "typical"
        )
    return sorted(out, key=lambda t: (t.q, -abs(t.rate - t.league_rate)))


def ban_role_targeting(
    rows: list[DraftRow], team_id: str, scope: str = "all"
) -> dict[str, tuple[float, float, int]]:
    """``{role: (team share, league share, team bans)}`` of the roles a team's bans aim at."""
    roles = champion_roles(rows)
    scoped = [r for r in rows if r.action == "ban" and in_scope(r, scope) and r.champion in roles]
    mine = Counter(roles[r.champion] for r in scoped if r.team_id == team_id)
    league = Counter(roles[r.champion] for r in scoped)
    n_mine, n_league = sum(mine.values()), sum(league.values())
    if not n_mine or not n_league:
        return {}
    return {
        role: (mine[role] / n_mine, league[role] / n_league, mine[role]) for role in sorted(league)
    }


@dataclass(frozen=True, slots=True)
class DepthPoint:
    game_number: int
    picks: int  # picks with a trusted pool
    mean_rank: float  # rank in the player's full pool (1 = most played); higher = reaching deeper
    share_top3: float
    share_new: float  # champions the player had never played before


def pick_depth_by_game(
    picks: list[PickRec], team_id: str | None = None, max_game: int = 5
) -> list[DepthPoint]:
    """How far down their available pool players reach as the series goes on."""
    by_player, _, _ = _index(picks)
    ranks: dict[int, list[int | None]] = defaultdict(list)
    for p in picks:
        if team_id is not None and p.team_id != team_id:
            continue
        # Rank in the player's FULL pool (locks ignored): 1 = their most-played champion. Ranking only the
        # champions still available would shrink the list and make late games look shallower than they are.
        r = runway(p.player_id, p.role, by_player[p.player_id], p.t, set())
        if r is None:
            continue
        names = [c for c, _ in r.remaining]
        ranks[min(p.game_number, max_game)].append(
            names.index(p.champion) + 1 if p.champion in names else None
        )
    out = []
    for g in sorted(ranks):
        vals = ranks[g]
        known = [v for v in vals if v is not None]
        out.append(
            DepthPoint(
                g,
                len(vals),
                sum(known) / len(known) if known else 0.0,
                sum(1 for v in known if v <= 3) / len(vals),
                sum(1 for v in vals if v is None) / len(vals),
            )
        )
    return out


@dataclass(frozen=True, slots=True)
class TendencyItem:
    """One champion's ban or pick rate for the team, next to the league rate in the same scope."""

    champion: str
    count: int
    team_games: int  # the sample size every rate must be shown with
    rate: float
    league_rate: float
    q: float
    direction: str
    strength: str
    evidence_game_ids: list[str]


@dataclass(frozen=True, slots=True)
class BanTarget:
    role: str
    team_share: float
    league_share: float
    n: int  # the team's bans read through this role


@dataclass(frozen=True, slots=True)
class ShiftPoint:
    """How far down their pool the team reaches in game ``game_number``, beside the league."""

    game_number: int
    picks: int
    mean_rank: float
    league_mean_rank: float | None
    share_top3: float
    league_share_top3: float | None
    share_new: float
    league_share_new: float | None


@dataclass(frozen=True, slots=True)
class TendencyReport:
    team_id: str
    scope: str
    team_games: int
    picks: list[TendencyItem]
    bans: list[TendencyItem]
    ban_targets: list[BanTarget]
    fearless_shift: list[ShiftPoint]
    notes: list[str]


def tendency_report(
    rows: list[DraftRow],
    picks: list[PickRec],
    team_id: str,
    scope: str = "all",
    top: int = 8,
) -> TendencyReport | None:
    """Everything the draft room shows about a team's habits, or ``None`` below ``MIN_TEAM_GAMES``.

    ``fearless_shift`` always covers every game number (the scope only filters ban/pick rates): the shift by
    game is the point of the chart, and splitting it by scope would hide it.
    """
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {SCOPES}, got {scope!r}")
    tend = team_tendencies(rows, team_id, scope)
    if not tend or tend[0].team_games < MIN_TEAM_GAMES:
        return None

    def items(action: str) -> list[TendencyItem]:
        return [
            TendencyItem(
                t.champion, t.count, t.team_games, t.rate, t.league_rate, t.q, t.direction,
                t.strength, list(t.evidence),
            )
            for t in [t for t in tend if t.action == action][:top]
        ]  # fmt: skip

    league = {d.game_number: d for d in pick_depth_by_game(picks)}
    shift = []
    for d in pick_depth_by_game(picks, team_id):
        lg = league.get(d.game_number)
        shift.append(
            ShiftPoint(
                d.game_number, d.picks, d.mean_rank, lg.mean_rank if lg else None, d.share_top3,
                lg.share_top3 if lg else None, d.share_new, lg.share_new if lg else None,
            )
        )  # fmt: skip
    targets = [
        BanTarget(role, mine, lg, n)
        for role, (mine, lg, n) in ban_role_targeting(rows, team_id, scope).items()
    ]
    notes = [
        "Rates are tested against the league in the same scope with a Benjamini-Hochberg correction; "
        "'typical' means no evidence the team differs from the league.",
        "Pick depth counts only players with a trusted pool; read it with the number of picks (n).",
    ]
    return TendencyReport(
        team_id, scope, tend[0].team_games, items("pick"), items("ban"), targets, shift, notes
    )
