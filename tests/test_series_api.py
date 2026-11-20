"""League meta and real-series endpoints over the SYNTHETIC cache (see ``synthetic_cache.py``)."""

from __future__ import annotations

import pytest

from asgi_client import AsgiClient
from lockout.api.app import create_app
from lockout.api.queries import DRAFT_ORDER, order_steps
from lockout.config import Settings
from synthetic_cache import build_synthetic_cache


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> AsgiClient:
    settings: Settings = build_synthetic_cache(tmp_path_factory.mktemp("series"))
    return AsgiClient(create_app(settings))


def test_order_steps_places_each_side_and_phase_on_its_slots() -> None:
    rows = [
        ("blue", "ban", "B1"),
        ("red", "ban", "R1"),
        ("blue", "pick", "BP1"),
        ("red", "pick", "RP1"),
    ]
    steps = order_steps(rows)
    assert len(steps) == len(DRAFT_ORDER) == 20
    assert steps[0] == "B1" and steps[1] == "R1"
    assert steps[6] == "BP1" and steps[7] == "RP1"
    assert steps.count(None) == 16


def test_champion_stats_carry_rates_roles_and_n(client: AsgiClient) -> None:
    rows = client.get("/api/champions").json()
    assert rows and all(0 <= r["presence"] <= 1 for r in rows)
    poppy = next(r for r in rows if r["champion"] == "Poppy")
    assert poppy["picks"] == 0 and poppy["bans"] == 12 and poppy["win_rate"] is None
    top = next(r for r in rows if r["champion"].startswith("TopA"))
    assert top["role"] == "top" and top["roles"] == {"top": 1.0}


def test_series_list_puts_the_asked_team_first_and_filters_opponents(client: AsgiClient) -> None:
    mine = client.get("/api/series", params={"team": "t1"}).json()
    assert len(mine) == 6 and all(x["teams"][0]["team_id"] == "t1" for x in mine)
    assert [x["date"] for x in mine] == sorted((x["date"] for x in mine), reverse=True)
    vs = client.get("/api/series", params={"team": "t2", "opponent": "t3"}).json()
    assert [x["series_id"] for x in vs] == ["s7"]
    assert vs[0]["format"] == 3 and sum(t["wins"] for t in vs[0]["teams"]) == 3


def test_series_draft_has_every_game_and_no_look_ahead(client: AsgiClient) -> None:
    res = client.get("/api/series/s7/draft", params={"ours": "t2"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["context"]["ours"]["team_id"] == "t2"
    assert [g["game_number"] for g in body["games"]] == [1, 2, 3]
    assert all(len(g["steps"]) == 20 for g in body["games"])
    assert sum(c is not None for c in body["games"][0]["steps"]) == 16
    series_day = body["series"]["date"]
    assert all(g["date"] < series_day for g in body["context"]["opponent_recent"])
    # t2's pools come from the six earlier series only
    assert all(p["history"] == 12 for p in body["context"]["ours"]["players"])


def test_series_draft_404s(client: AsgiClient) -> None:
    assert client.get("/api/series/nope/draft").status_code == 404
    assert client.get("/api/series/s7/draft", params={"ours": "t1"}).status_code == 404


def test_meta_window_ends_at_before_and_series_draft_carries_its_own(client: AsgiClient) -> None:
    early = client.get("/api/champions", params={"before": "2026-01-03T00:00:00Z"}).json()
    assert early and all(r["games"] == 2 for r in early)  # only g01 and g02 are older
    body = client.get("/api/series/s7/draft", params={"ours": "t2"}).json()
    assert body["meta"] and all(r["games"] == 12 for r in body["meta"])  # the 12 games before s7
