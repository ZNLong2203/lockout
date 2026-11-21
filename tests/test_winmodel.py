"""Win model: fitting on synthetic rows, features on the synthetic cache, and the endpoint's guard rails."""

from __future__ import annotations

import math
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

from asgi_client import AsgiClient
from lockout.api.app import create_app
from lockout.draft.analysis import load_picks
from lockout.draft.winmodel import (
    GameRow,
    build_rows,
    champ_edge,
    evaluate,
    fit,
    predict,
    rating_before,
)
from synthetic_cache import build_synthetic_cache


def _rows(n: int = 600, seed: int = 3) -> list[GameRow]:
    rng = random.Random(seed)
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    rows = []
    for i in range(n):
        x = (rng.gauss(0, 0.3), rng.gauss(0, 0.1), rng.gauss(0, 0.02), rng.gauss(0, 0.1))
        logit = 0.2 + 3.0 * x[0] + 4.0 * x[1]
        rows.append(
            GameRow(f"g{i}", t0 + timedelta(hours=i), rng.random() < 1 / (1 + math.exp(-logit)), x)
        )
    return rows


def test_fit_recovers_the_signs_and_beats_elo_alone_when_the_draft_matters() -> None:
    rows = _rows()
    m = fit(rows)
    assert m.coef[0] > 0 and m.coef[1] > 0 and m.intercept > 0
    assert 0.5 < predict(m, [0.3, 0.1, 0.0, 0.0]) < 1
    e = evaluate(rows)
    assert e.n_train + e.n_test == len(rows)
    assert e.log_loss < e.elo_log_loss < e.blue_log_loss


def test_champion_edge_is_shrunk_towards_even() -> None:
    assert champ_edge(0, 0) == 0
    assert 0 < champ_edge(3, 3) < 0.5 * 3 / 3


def test_features_on_the_synthetic_cache_use_only_earlier_games(tmp_path: Path) -> None:
    settings = build_synthetic_cache(tmp_path)
    cache = settings.cache_dir / "lol"
    rows, elo = build_rows(cache, load_picks(cache))
    assert rows and all(len(r.x) == 4 and all(math.isfinite(v) for v in r.x) for r in rows)
    first = min(rows, key=lambda r: r.t)
    assert first.x[0] == 0  # nobody has an Elo history before the first game
    assert rating_before(elo, "t1", first.t) == 1500
    client = AsgiClient(create_app(settings))
    res = client.get("/api/draft/win-model", params={"team": "t1", "opponent": "t2"})
    assert res.status_code == 404 and "at least 50" in res.json()["detail"]
