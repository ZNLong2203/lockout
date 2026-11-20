"""Tell engine tests: templates, statistics and false-discovery control (synthetic data only)."""

from __future__ import annotations

import pytest

from lockout.detectors.tells import (
    TEMPLATES,
    Attempt,
    Template,
    benjamini_hochberg,
    classify,
    collect_attempts,
    evidence_rows,
    lost_first_dragon_responds,
    score_tells,
    wilson_interval,
)
from lockout.facts import GameFacts, JungleFact, KillFact, Obj, Setup, Struct


def _game(gid: str = "g", **kw) -> GameFacts:
    return GameFacts(gid, {"blue": "100", "red": "200"}, kw.pop("winner", "blue"), **kw)


def test_wilson_interval_brackets_the_estimate() -> None:
    lo, hi = wilson_interval(7, 20)
    assert lo < 7 / 20 < hi
    assert wilson_interval(0, 0) == (0.0, 1.0)
    lo0, hi0 = wilson_interval(0, 10)
    assert lo0 == 0.0 and 0 < hi0 < 0.4


def test_benjamini_hochberg_known_example() -> None:
    q = benjamini_hochberg([0.01, 0.04, 0.03, 0.005])
    assert q == pytest.approx([0.02, 0.04, 0.04, 0.02])
    assert benjamini_hochberg([]) == []
    assert all(0 <= x <= 1 for x in benjamini_hochberg([0.5, 0.9, 1.0]))


def test_classify_needs_both_significance_and_sample_size() -> None:
    assert classify(0.01, 20) == "strong"
    assert classify(0.01, 7) == "suggestive", "too few cases for 'strong'"
    assert classify(0.3, 50) == "typical"


def test_lost_first_dragon_responds_only_when_the_team_lost_it() -> None:
    g = _game(objs=[Obj(300, "red", "dragon", "OceanDrake"), Obj(360, "blue", "grubs", "VoidGrub")])
    assert lost_first_dragon_responds(g, "red") == []
    (attempt,) = lost_first_dragon_responds(g, "blue")
    assert attempt.hit and attempt.t_outcome == 360 and attempt.t_trigger == 300


def test_response_outside_the_window_is_a_miss() -> None:
    g = _game(
        objs=[Obj(300, "red", "dragon", "OceanDrake"), Obj(500, "blue", "herald", "RiftHerald")]
    )
    (attempt,) = lost_first_dragon_responds(g, "blue")
    assert not attempt.hit and attempt.t_outcome is None


def test_gank_template_requires_a_kill_in_that_lane_soon_after_arrival() -> None:
    g = _game(
        jungle={"blue": JungleFact("top", "bot", 200, "")},
        kills=[KillFact(240, "blue", "bot"), KillFact(250, "blue", "mid")],
    )
    gank_bot = next(t for t in TEMPLATES if t.id == "gank_bot")
    (a,) = gank_bot.evaluate(g, "blue")
    assert a.hit and a.t_outcome == 240
    assert next(t for t in TEMPLATES if t.id == "gank_mid").evaluate(g, "blue") == []
    late = _game(jungle={"blue": JungleFact("top", "bot", 400, "")})
    assert gank_bot.evaluate(late, "blue") == [], "an arrival after 5:00 is not an early gank"


def test_baron_conversion_counts_two_structures() -> None:
    g = _game(
        objs=[Obj(1500, "blue", "baron", "Baron")],
        structs=[Struct(1550, "blue", "tower", "mid"), Struct(1600, "blue", "tower", "top")],
    )
    baron = next(t for t in TEMPLATES if t.id == "baron_converts")
    (a,) = baron.evaluate(g, "blue")
    assert a.hit and a.t_outcome == 1600


def test_prepositioned_template_uses_spawn_presence() -> None:
    g = _game(
        setups=[
            Setup("dragon", 600, "blue", True, 540, 3, 20),
            Setup("dragon", 600, "red", False, 540, 1, 0),
            Setup("baron", 1500, "blue", False, 1440, 4, 5),
        ]
    )
    tpl = next(t for t in TEMPLATES if t.id == "prepositioned_secures")
    assert [a.hit for a in tpl.evaluate(g, "blue")] == [True, False]
    assert tpl.evaluate(g, "red") == [], "one player in place is not a set-up"


def _synthetic_league(n_games: int = 60) -> list[GameFacts]:
    """Team 100 never answers a lost first dragon; everybody else answers half of the time."""
    games = []
    for i in range(n_games):
        answers = i % 2 == 0
        objs = [Obj(300, "red", "dragon", "OceanDrake")]
        if answers:
            objs.append(Obj(350, "blue", "grubs", "VoidGrub"))
        games.append(_game(f"g{i}", objs=objs))
    return games


def test_a_team_that_never_responds_is_flagged_against_the_league() -> None:
    template = Template("lost_first_dragon_responds", "x", "responds", lost_first_dragon_responds)
    games = _synthetic_league()
    for g in (
        games
    ):  # in 'bad' games team 100 sits on blue and never answers; team 300 plays blue otherwise
        g.teams["blue"] = "100" if int(g.game_id[1:]) % 2 else "300"
    attempts = collect_attempts(games, (template,))
    scored = score_tells(attempts, (template,))
    by_team = {r["team_id"]: r for r in scored}
    assert by_team["100"]["hits"] == 0 and by_team["100"]["n"] == 30
    assert by_team["100"]["direction"] == "below" and by_team["100"]["strength"] == "strong"
    assert by_team["300"]["hits"] == 30 and by_team["300"]["direction"] == "above"
    evidence = evidence_rows(attempts, scored)
    assert len([e for e in evidence if e["team_id"] == "100"]) == 30
    assert {e["hit"] for e in evidence if e["team_id"] == "100"} == {False}


def test_tiny_samples_are_never_reported() -> None:
    template = Template("lost_first_dragon_responds", "x", "responds", lost_first_dragon_responds)
    attempts = {template.id: {"100": [("g1", Attempt(300, True, 350))] * 3}}
    assert score_tells(attempts, (template,)) == []
