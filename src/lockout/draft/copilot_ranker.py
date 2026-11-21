"""Gradient-boosted re-ranker for the draft co-pilot (LightGBM LambdaRank).

The browser's linear softmax (``web/src/lib/copilot.ts``) scores every available champion; this model re-ranks
its top ``TOP`` candidates with trees, which capture interactions the linear model cannot (the same signal means
something else at the first ban of game 1 and at the fourth ban of game 3).

Training data is the export of ``npm run export:features`` (one JSON line per draft step, candidates' features
laid out by ``rankerRow`` in copilot.ts). The split is by series and by time:

* test: the 80 most recent series, never used for training or choices;
* validation: the next 80, used for early stopping;
* training: every older series.

The fitted model is derived from licensed data, so it stays in the gitignored cache and is served by the local
API only. ``lightgbm`` lives in the optional ``ml`` dependency group.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

TOP = 60
HOLD = 80
FEATURES_FILE = Path("eval") / "copilot_features.jsonl"
MODEL_FILE = "copilot_ranker.json"
KEYS = ("ban-us", "ban-them", "pick-us", "pick-them")
KEY_COLUMN = 18  # position of the step-type index in a ranker row
LINEAR_COLUMN = 16
PARAMS = {
    "objective": "lambdarank",
    "n_estimators": 600,
    "learning_rate": 0.03,
    "num_leaves": 31,  # chosen on the validation series (docs/methodology.md)
    "min_child_samples": 50,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "lambdarank_truncation_level": 10,
    "verbose": -1,
}

Group = tuple[
    np.ndarray, int
]  # candidate rows, index of the real choice (-1 if outside the candidates)


def load_groups(path: Path) -> dict[str, list[Group]]:
    groups: dict[str, list[Group]] = {"train": [], "val": [], "test": []}
    with path.open() as fh:
        for line in fh:
            r = json.loads(line)
            if not r["rows"]:
                continue
            split = "test" if r["s"] < HOLD else "val" if r["s"] < 2 * HOLD else "train"
            groups[split].append((np.array(r["rows"], dtype=np.float32), int(r["y"])))
    return groups


def _stack(groups: list[Group]) -> tuple[np.ndarray, np.ndarray, list[int]]:
    x = np.vstack([g[0] for g in groups])
    y = np.concatenate([(np.arange(len(g[0])) == g[1]).astype(int) for g in groups])
    return x, y, [len(g[0]) for g in groups]


def hit_rate(scores: list[np.ndarray], groups: list[Group], k: int) -> float:
    hits = sum(
        1 for s, (_, y) in zip(scores, groups, strict=True) if y >= 0 and y in np.argsort(-s)[:k]
    )
    return hits / max(len(groups), 1)


def flatten(node: dict[str, Any]) -> dict[str, list[float] | list[int]]:
    """A LightGBM tree as flat arrays: f (split feature, -1 = leaf), t (threshold, left if x <= t), l, r, v."""
    f: list[int] = []
    t: list[float] = []
    lc: list[int] = []
    rc: list[int] = []
    v: list[float] = []

    def walk(n: dict[str, Any]) -> int:
        i = len(f)
        f.append(-1)
        t.append(0.0)
        lc.append(0)
        rc.append(0)
        v.append(0.0)
        if "leaf_value" in n:
            v[i] = float(n["leaf_value"])
            return i
        if n.get("decision_type", "<=") != "<=":
            raise ValueError(f"unsupported split {n.get('decision_type')}")
        f[i] = int(n["split_feature"])
        t[i] = float(n["threshold"])
        lc[i] = walk(n["left_child"])
        rc[i] = walk(n["right_child"])
        return i

    walk(node)
    return {"f": f, "t": [round(x, 6) for x in t], "l": lc, "r": rc, "v": [round(x, 6) for x in v]}


def train(cache_dir: Path) -> dict[str, Any]:
    """Fit, score on the held-out series and write the model next to the cache. Returns the evaluation."""
    import lightgbm as lgb  # optional dependency group `ml`

    groups = load_groups(cache_dir / FEATURES_FILE)
    x_tr, y_tr, g_tr = _stack(groups["train"])
    x_va, y_va, g_va = _stack(groups["val"])
    model = lgb.LGBMRanker(**PARAMS)
    model.fit(
        x_tr,
        y_tr,
        group=g_tr,
        eval_set=[(x_va, y_va)],
        eval_group=[g_va],
        eval_at=[3],
        callbacks=[lgb.early_stopping(50, verbose=False)],
    )

    def scores(gs: list[Group], use_model: bool) -> list[np.ndarray]:
        if not use_model:
            return [g[0][:, LINEAR_COLUMN] for g in gs]
        x, _, sizes = _stack(gs)
        p = model.predict(x, num_iteration=model.best_iteration_)
        return np.split(p, np.cumsum(sizes)[:-1])

    test = groups["test"]
    s_model, s_linear = scores(test, True), scores(test, False)
    evaluation: dict[str, Any] = {
        "test_steps": len(test),
        "train_steps": len(groups["train"]),
        "trees": int(model.best_iteration_),
    }
    for k in (1, 3, 5, 10):
        evaluation[f"top{k}"] = hit_rate(s_model, test, k)
        evaluation[f"linear_top{k}"] = hit_rate(s_linear, test, k)
    for ki, key in enumerate(KEYS):
        idx = [i for i, g in enumerate(test) if int(g[0][0, KEY_COLUMN]) == ki]
        evaluation[f"top3_{key}"] = hit_rate([s_model[i] for i in idx], [test[i] for i in idx], 3)
    dump = model.booster_.dump_model(num_iteration=model.best_iteration_)
    out = {
        "top": TOP,
        "trees": [flatten(t["tree_structure"]) for t in dump["tree_info"]],
        "evaluation": evaluation,
    }
    (cache_dir / MODEL_FILE).write_text(json.dumps(out, separators=(",", ":")))
    return evaluation


def load_ranker(cache_dir: Path) -> dict[str, Any] | None:
    path = cache_dir / MODEL_FILE
    if not path.is_file():
        return None
    return json.loads(path.read_text())
