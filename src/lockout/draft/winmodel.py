"""Live draft win probability: a small logistic model over the draft state, with no look-ahead.

Every feature of a game is computed only from games played *before* it, from the blue side's point of view
(blue minus red), and is defined for a partial draft too, so the same model updates pick by pick:

* ``elo``: team Elo difference / 400 (chronological Elo over every game, K = 32, pulled halfway back to 1500
  after a break of more than 30 days);
* ``comfort``: sum over the picks so far of each picker's pool share of that champion (top 8 of a
  recency-weighted pool, like the draft room) / 5;
* ``champ``: sum over the picks so far of the champion's league win rate in the previous 90 days, shrunk towards
  50 % with 10 + 10 pseudo games, minus 0.5, / 5;
* ``stress``: the lowest share of comfort pool still open in each lineup at the start of the game (Fearless).

The intercept is the blue-side advantage. The model is a ridge-regularised logistic regression fitted by Newton's
method on standardised features. :func:`evaluate` trains on the earlier 75 % of games and scores the later 25 %,
against Elo alone and against a constant blue-side rate.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

from lockout.draft.pools import MIN_HISTORY, PickRec, pool_weights

FEATURES = ("elo", "comfort", "champ", "stress")
ELO_START = 1500.0
ELO_K = 32.0
SEASON_GAP_DAYS = 30  # a longer break (off-season) pulls a team's Elo halfway back to the start
SEASON_RESET = 0.5
META_DAYS = 90
POOL_TOP = 8
PRIOR = 10.0  # pseudo wins and pseudo losses for a champion's win rate
RIDGE = 1.0


@dataclass(frozen=True, slots=True)
class GameRow:
    game_id: str
    t: datetime
    blue_won: bool
    x: tuple[float, float, float, float]  # FEATURES, blue minus red


@dataclass(slots=True)
class Fitted:
    mean: list[float]
    scale: list[float]
    coef: list[float]  # on standardised features
    intercept: float
    n_train: int


@dataclass(slots=True)
class Evaluation:
    n_train: int
    n_test: int
    accuracy: float
    log_loss: float
    auc: float
    elo_accuracy: float
    elo_log_loss: float
    elo_auc: float
    blue_rate: float
    blue_log_loss: float
    notes: list[str] = field(default_factory=list)


def _games(cache_lol_dir: Path) -> list[tuple[str, str, int, datetime, str, str, str | None]]:
    con = duckdb.connect()
    d = str(cache_lol_dir)
    rows = con.execute(
        f"""select g.game_id, g.series_id, g.game_number, min(e.started_at), g.blue_team_id, g.red_team_id,
                   g.winner_team_id
            from read_parquet('{d}/games.parquet') g
            join read_parquet('{d}/draft_enriched.parquet') e using (game_id)
            group by 1, 2, 3, 5, 6, 7 order by 4, 1"""
    ).fetchall()
    return [
        (gid, sid, int(n), datetime.fromisoformat(t.replace("Z", "+00:00")), b, r, w)
        for gid, sid, n, t, b, r, w in rows
        if t
    ]


def _top_pool(history: list[PickRec], as_of: datetime) -> dict[str, float]:
    past = [p for p in history if p.t < as_of]
    if len(past) < MIN_HISTORY:
        return {}
    weights = pool_weights(past, as_of)
    return dict(sorted(weights.items(), key=lambda kv: -kv[1])[:POOL_TOP])


def champ_edge(wins: float, picks: float) -> float:
    """A champion's shrunk league win rate minus 0.5."""
    return (wins + PRIOR) / (picks + 2 * PRIOR) - 0.5


def build_rows(
    cache_lol_dir: Path, picks: list[PickRec]
) -> tuple[list[GameRow], dict[str, list[tuple[datetime, float]]]]:
    """Feature rows for every game with a winner, plus each team's Elo history (time, rating after the game)."""
    by_game: dict[str, list[PickRec]] = defaultdict(list)
    by_player: dict[str, list[PickRec]] = defaultdict(list)
    for p in picks:
        by_game[p.game_id].append(p)
        by_player[p.player_id].append(p)
    elo: dict[str, float] = defaultdict(lambda: ELO_START)
    elo_hist: dict[str, list[tuple[datetime, float]]] = defaultdict(list)
    window: deque[tuple[datetime, str, bool]] = deque()
    w_picks: Counter[str] = Counter()
    w_wins: Counter[str] = Counter()
    series_locked: dict[str, set[str]] = defaultdict(set)
    last_seen: dict[str, datetime] = {}
    rows: list[GameRow] = []
    for gid, sid, _n, t, blue, red, winner in _games(cache_lol_dir):
        while window and window[0][0] < t - timedelta(days=META_DAYS):
            _, c, won = window.popleft()
            w_picks[c] -= 1
            w_wins[c] -= won
        for team in (blue, red):
            if team in last_seen and (t - last_seen[team]).days > SEASON_GAP_DAYS:
                elo[team] = ELO_START + (elo[team] - ELO_START) * SEASON_RESET
            last_seen[team] = t
        game_picks = by_game.get(gid, [])
        locked = series_locked[sid]
        feats: dict[str, dict[str, float]] = {}
        for team in (blue, red):
            mine = [p for p in game_picks if p.team_id == team]
            comfort = champ = 0.0
            masses = []
            for p in mine:
                pool = _top_pool(by_player[p.player_id], t)
                comfort += pool.get(p.champion, 0.0)
                champ += champ_edge(w_wins[p.champion], w_picks[p.champion])
                if pool:
                    masses.append(sum(s for c, s in pool.items() if c not in locked))
            feats[team] = {
                "elo": elo[team] / 400.0,
                "comfort": comfort / 5.0,
                "champ": champ / 5.0,
                "stress": min(masses) if masses else 0.0,
            }
        if winner in (blue, red) and len(game_picks) >= 8:
            x = tuple(feats[blue][f] - feats[red][f] for f in FEATURES)
            rows.append(GameRow(gid, t, winner == blue, x))  # type: ignore[arg-type]
        # update state with this game's results, after its features were taken
        if winner in (blue, red):
            loser = red if winner == blue else blue
            expected = 1.0 / (1.0 + 10 ** ((elo[loser] - elo[winner]) / 400.0))
            elo[winner] += ELO_K * (1.0 - expected)
            elo[loser] -= ELO_K * (1.0 - expected)
            elo_hist[winner].append((t, elo[winner]))
            elo_hist[loser].append((t, elo[loser]))
            for p in game_picks:
                window.append((t, p.champion, p.team_id == winner))
                w_picks[p.champion] += 1
                w_wins[p.champion] += p.team_id == winner
        locked.update(p.champion for p in game_picks)
    return rows, elo_hist


def fit(rows: list[GameRow], columns: tuple[int, ...] = (0, 1, 2, 3)) -> Fitted:
    x = np.array([[r.x[i] for i in columns] for r in rows], dtype=float)
    y = np.array([1.0 if r.blue_won else 0.0 for r in rows])
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1.0
    z = np.column_stack([np.ones(len(x)), (x - mean) / scale])
    w = np.zeros(z.shape[1])
    reg = np.eye(z.shape[1]) * RIDGE
    reg[0, 0] = 0.0
    for _ in range(50):
        p = 1.0 / (1.0 + np.exp(-z @ w))
        grad = z.T @ (p - y) + reg @ w
        hess = (z * (p * (1 - p))[:, None]).T @ z + reg
        step = np.linalg.solve(hess, grad)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return Fitted(mean.tolist(), scale.tolist(), w[1:].tolist(), float(w[0]), len(rows))


def predict(model: Fitted, x: list[float]) -> float:
    zs = [(v - m) / s for v, m, s in zip(x, model.mean, model.scale, strict=True)]
    logit = model.intercept + sum(c * v for c, v in zip(model.coef, zs, strict=True))
    return 1.0 / (1.0 + float(np.exp(-logit)))


def _auc(p: np.ndarray, y: np.ndarray) -> float:
    order = np.argsort(p)
    ranks = np.empty(len(p))
    ranks[order] = np.arange(1, len(p) + 1)
    pos = y == 1
    n_pos, n_neg = pos.sum(), (~pos).sum()
    if not n_pos or not n_neg:
        return float("nan")
    return float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def _scores(p: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    acc = float(((p >= 0.5) == (y == 1)).mean())
    ll = float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())
    return acc, ll, _auc(p, y)


def evaluate(rows: list[GameRow], train_share: float = 0.75) -> Evaluation:
    """Train on the earlier games, score the later ones; compare with Elo alone and a constant blue rate."""
    rows = sorted(rows, key=lambda r: (r.t, r.game_id))
    cut = int(len(rows) * train_share)
    train, test = rows[:cut], rows[cut:]
    y = np.array([1.0 if r.blue_won else 0.0 for r in test])
    full = fit(train)
    elo_only = fit(train, (0,))
    p_full = np.array([predict(full, list(r.x)) for r in test])
    p_elo = np.array([predict(elo_only, [r.x[0]]) for r in test])
    blue = float(np.mean([r.blue_won for r in train]))
    acc, ll, auc = _scores(p_full, y)
    e_acc, e_ll, e_auc = _scores(p_elo, y)
    _, b_ll, _ = _scores(np.full(len(y), blue), y)
    return Evaluation(len(train), len(test), acc, ll, auc, e_acc, e_ll, e_auc, blue, b_ll)


def rating_before(
    elo_hist: dict[str, list[tuple[datetime, float]]], team_id: str, t: datetime
) -> float:
    """A team's Elo just before time ``t`` (the start rating if it had not played), off-season pull included."""
    rating, last = ELO_START, None
    for when, value in elo_hist.get(team_id, []):
        if when >= t:
            break
        rating, last = value, when
    if last is not None and (t - last).days > SEASON_GAP_DAYS:
        rating = ELO_START + (rating - ELO_START) * SEASON_RESET
    return rating
