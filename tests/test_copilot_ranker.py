"""The co-pilot re-ranker's export format, without needing LightGBM installed."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from lockout.draft.copilot_ranker import flatten, hit_rate, load_groups, load_ranker


def test_flatten_matches_a_lightgbm_tree_walk() -> None:
    node = {
        "split_feature": 0,
        "threshold": 0.5,
        "decision_type": "<=",
        "left_child": {"split_feature": 1, "threshold": 2.0, "decision_type": "<=",
                       "left_child": {"leaf_value": 1.0}, "right_child": {"leaf_value": 2.0}},
        "right_child": {"leaf_value": 3.0},
    }  # fmt: skip
    flat = flatten(node)

    def walk(x: list[float]) -> float:
        n = 0
        while flat["f"][n] >= 0:
            n = flat["l"][n] if x[int(flat["f"][n])] <= flat["t"][n] else flat["r"][n]
        return float(flat["v"][n])

    assert [walk([0.2, 1]), walk([0.2, 5]), walk([0.9, 0])] == [1.0, 2.0, 3.0]


def test_groups_split_by_series_recency_and_hits_count_misses(tmp_path: Path) -> None:
    path = tmp_path / "f.jsonl"
    rows = [[0.0] * 3, [1.0] * 3]
    lines = [{"s": s, "y": y, "rows": rows} for s, y in ((0, 1), (100, 0), (200, -1), (201, 0))]
    lines.append({"s": 300, "y": 0, "rows": []})  # no candidates: skipped
    path.write_text("\n".join(json.dumps(x) for x in lines))
    g = load_groups(path)
    assert [len(g[k]) for k in ("test", "val", "train")] == [1, 1, 2]
    scores = [np.array([0.0, 1.0]), np.array([1.0, 0.0])]
    assert hit_rate(scores, g["train"], 1) == 0.5  # the y = -1 step counts as a miss
    assert load_ranker(tmp_path) is None
