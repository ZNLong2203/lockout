"""API tests over a tiny SYNTHETIC cache built in a temp folder (see ``synthetic_cache.py``)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from asgi_client import AsgiClient
from macrodna.api import schemas as s
from macrodna.api.app import create_app
from macrodna.api.queries import CacheNotReadyError
from macrodna.config import Settings
from synthetic_cache import EVENT_A, EVENT_B, NO_CHAMPION, ROLES, build_synthetic_cache

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def settings(tmp_path_factory: pytest.TempPathFactory) -> Settings:
    return build_synthetic_cache(tmp_path_factory.mktemp("api"))


@pytest.fixture(scope="module")
def client(settings: Settings) -> AsgiClient:
    return AsgiClient(create_app(settings))


def ok(client: AsgiClient, url: str, **params: str) -> dict | list:
    res = client.get(url, params=params)
    assert res.status_code == 200, res.text
    return res.json()


# --- every endpoint in the contract, happy path -------------------------------------------------------


def test_health_reports_the_games_in_the_cache(client: AsgiClient) -> None:
    assert ok(client, "/api/health") == {"status": "ok", "games": 15}


def test_teams_carry_names_counts_dates_and_all_their_events(client: AsgiClient) -> None:
    teams = {t["team_id"]: t for t in ok(client, "/api/teams")}  # type: ignore[union-attr]
    assert set(teams) == {"t1", "t2", "t3"}, "the VALORANT row of teams.csv is ignored"
    t1 = teams["t1"]
    assert (t1["name"], t1["games"]) == ("Alpha Team", 12)
    assert (t1["first_seen"], t1["last_seen"]) == ("2026-01-01", "2026-01-12")
    assert t1["events"] == [EVENT_A, EVENT_B]
    assert [t["team_id"] for t in ok(client, "/api/teams")][0] == "t2"  # type: ignore[union-attr]


def test_teams_filter_by_name_and_by_event(client: AsgiClient) -> None:
    by_name = ok(client, "/api/teams", q="charl")
    assert [t["team_id"] for t in by_name] == ["t3"]  # type: ignore[union-attr]
    in_a = {t["team_id"]: t for t in ok(client, "/api/teams", event=EVENT_A)}  # type: ignore[union-attr]
    assert set(in_a) == {"t1", "t2"} and in_a["t1"]["games"] == 8
    assert in_a["t1"]["events"] == [EVENT_A, EVENT_B], "events stay complete so a UI can offer them"


def test_profile_has_jungle_objectives_and_tells_with_sample_sizes(client: AsgiClient) -> None:
    profile = s.TeamProfile.model_validate(ok(client, "/api/teams/t1/profile"))
    assert profile.team.games == 12
    jungle = profile.jungle
    assert jungle is not None and jungle.games == 12
    assert jungle.routes[0].route == "blue_buff>gromp>wolves"
    assert (jungle.routes[0].n, jungle.routes[0].share) == (12, 1.0)
    assert 0 < len(jungle.routes[0].example_game_ids) <= 3
    assert jungle.start_side == {"top": 1.0, "bot": 0.0}
    assert jungle.first_lane["top"] + jungle.first_lane["mid"] == pytest.approx(1.0)
    assert all(t is None or t > 0 for t in jungle.median_first_lane_t.values())

    dragon = next(o for o in profile.objectives if o.objective == "dragon")
    assert dragon.taken == 6 and dragon.mean_players_m30_when_taken == 4.0
    assert dragon.league_mean_players_m30 == 4.0 and dragon.median_setup_s == 40.0
    secure = dragon.prepositioned_secure
    assert secure is not None and (secure.n, secure.hits, secure.rate) == (6, 6, 1.0)
    assert secure.baseline == 1.0 and secure.ci_lo < 1.0

    assert [t.template_id for t in profile.tells] == ["tell_a", "tell_b"], "ordered by q"
    first = profile.tells[0]
    assert (first.rate.n, first.rate.hits, first.strength) == (8, 7, "strong")
    assert profile.notes


def test_profile_event_filter_restricts_jungle_and_objectives(client: AsgiClient) -> None:
    profile = s.TeamProfile.model_validate(ok(client, "/api/teams/t1/profile", event=EVENT_A))
    assert profile.team.games == 8 and profile.jungle is not None and profile.jungle.games == 8
    assert next(o for o in profile.objectives if o.objective == "dragon").taken == 4
    assert any("not filtered by event" in n for n in profile.notes)
    assert len(profile.tells) == 2, "tells are read from the cache, not recomputed per event"


def test_a_team_with_too_few_games_gets_a_404_not_empty_numbers(client: AsgiClient) -> None:
    res = client.get("/api/teams/t3/profile")
    assert res.status_code == 404
    assert "Charlie Team" in res.json()["detail"] and "at least 6" in res.json()["detail"]
    low_event = client.get("/api/teams/t1/profile", params={"event": EVENT_B})
    assert low_event.status_code == 404 and EVENT_B in low_event.json()["detail"]
    assert client.get("/api/teams/nobody/profile").status_code == 404
    assert client.get("/api/teams/t3/draft-tendencies").status_code == 404


def test_evidence_lists_every_occurrence_newest_first(client: AsgiClient) -> None:
    items = [
        s.EvidenceItem.model_validate(i)
        for i in ok(client, "/api/teams/t1/tells/tell_a/evidence")  # type: ignore[union-attr]
    ]
    assert len(items) == 8 and sum(i.hit for i in items) == 7
    assert [i.date for i in items] == sorted((i.date for i in items), reverse=True)
    first = items[0]
    assert first.opponent == "Bravo Team" and first.side in ("blue", "red")
    assert first.t_outcome is None or first.t_outcome > first.t_trigger
    assert client.get("/api/teams/t1/tells/nope/evidence").status_code == 404
    assert client.get("/api/teams/nobody/tells/tell_a/evidence").status_code == 404


def test_replay_has_one_position_per_second_per_player(client: AsgiClient) -> None:
    replay = s.Replay.model_validate(ok(client, "/api/games/g01/replay"))
    assert (replay.blue_team, replay.red_team, replay.winner_side) == (
        "Alpha Team",
        "Bravo Team",
        "blue",
    )
    assert len(replay.positions) == 10 and all(len(frame) == 10 for frame in replay.positions)
    assert replay.positions[3][2] == (1000 + 200 + 30, 2000 + 100 + 15)
    assert [p.role for p in replay.players[:5]] == list(ROLES)
    assert [p.side for p in replay.players] == ["blue"] * 5 + ["red"] * 5
    assert replay.bounds[2] > replay.bounds[0]
    by_player = {p.player_id: p for p in replay.players}
    assert by_player["t1-top"].champion == "TopA0"
    assert by_player[NO_CHAMPION[1]].champion is None, "no champion in rosters.csv -> null"
    kinds = {e.kind for e in replay.events}
    assert kinds == {"kill", "objective", "structure"}, "purchases are not replay events"
    kill = next(e for e in replay.events if e.kind == "kill")
    assert (kill.slot, kill.target_slot) == (0, 5) and kill.x == 3000


def test_replay_404_for_unknown_games_and_games_without_positions(client: AsgiClient) -> None:
    assert client.get("/api/games/nope/replay").status_code == 404
    missing = client.get("/api/games/g13/replay")
    assert missing.status_code == 404 and "positions" in missing.json()["detail"]


def test_plan_wraps_the_planner_and_removes_locked_champions(client: AsgiClient) -> None:
    fresh = s.SeriesPlanResponse.model_validate(
        ok(client, "/api/draft/plan", team="Alpha", opponent="Bravo")
    )
    locked = s.SeriesPlanResponse.model_validate(
        ok(
            client,
            "/api/draft/plan",
            team="t1",
            opponent="t2",
            locked="TopA0, TopA1",
            banned="JungleB0",
        )
    )
    assert {r.role for r in fresh.ours.roles} == set(ROLES) and not fresh.ours.untrusted_roles
    top = next(r for r in locked.ours.roles if r.role == "top")
    top_fresh = next(r for r in fresh.ours.roles if r.role == "top")
    assert {e.champion for e in top.remaining}.isdisjoint({"TopA0", "TopA1"})
    assert top.mass < top_fresh.mass and top.history == 12
    jungle = next(r for r in locked.opponent.roles if r.role == "jungle")
    assert "JungleB0" not in {e.champion for e in jungle.remaining}
    assert [r.mass for r in fresh.ours.roles] == sorted(r.mass for r in fresh.ours.roles), (
        "weakest first"
    )
    assert fresh.forecast is not None and fresh.n_sims > 0
    assert [f.team_id for f in fresh.forecast] == ["t1", "t2"]
    assert len(fresh.forecast[0].mean_stress) == 4 and set(fresh.forecast[0].p_critical) == set(
        ROLES
    )
    assert fresh.jungle_bridges and all(b.scope == "team" for b in fresh.jungle_bridges)
    assert fresh.ours.ban_suggestions and fresh.ours.name == "Alpha Team"
    assert top_fresh.player_name == "Alpha Team top"


def test_plan_validates_its_input(client: AsgiClient) -> None:
    assert client.get("/api/draft/plan", params={"team": "Alpha"}).status_code == 422
    assert (
        client.get("/api/draft/plan", params={"team": "", "opponent": "Bravo"}).status_code == 422
    )
    unknown = client.get("/api/draft/plan", params={"team": "Alpha", "opponent": "Nobody"})
    assert unknown.status_code == 404 and "Nobody" in unknown.json()["detail"]


def test_series_context_powers_the_draft_room(client: AsgiClient) -> None:
    ctx = s.SeriesContext.model_validate(
        ok(client, "/api/series/context", team="Alpha", opponent="Bravo")
    )
    assert (ctx.ours.name, ctx.ours.short, ctx.opponent.name) == ("Alpha Team", "AT", "Bravo Team")
    assert [p.role for p in ctx.ours.players] == list(ROLES)
    top = ctx.ours.players[0]
    assert top.history == 12 and top.name == "Alpha Team top"
    assert {e.champion for e in top.pool} == {"TopA0", "TopA1", "TopA2", "TopA3"}
    assert sum(e.share for e in top.pool) == pytest.approx(1.0) and all(
        e.games == 3 for e in top.pool
    )
    recent = ctx.opponent_recent
    assert [g.game_id for g in recent] == ["g15", "g14", "g13", "g12", "g11"]
    assert (
        recent[0].opponent == "Charlie Team"
        and len(recent[0].picks) == 5
        and len(recent[0].bans) == 3
    )
    assert {p.role for p in recent[0].picks} == set(ROLES)
    jungle = next(p for p in ctx.opponent.players if p.role == "jungle")
    assert set(ctx.jungle_bridges) == {e.champion for e in jungle.pool}
    assert all(b.scope == "team" and b.n >= 3 for b in ctx.jungle_bridges.values())
    assert ctx.league_top3_share_by_game == [0.9, 0.7]
    assert ctx.format == 5


def test_backtest_is_served_as_written_by_draft_build(
    client: AsgiClient, settings: Settings
) -> None:
    served = ok(client, "/api/draft/backtest")
    stored = json.loads((settings.cache_dir / "lol" / "draft_backtest.json").read_text())
    assert served == s.DraftBacktest.model_validate(stored).model_dump(mode="json")
    assert served["caveats"]  # type: ignore[index]


def test_bridge_prefers_the_team_and_falls_back_to_the_league(client: AsgiClient) -> None:
    own = s.JungleBridge.model_validate(
        ok(client, "/api/draft/bridge", champion="JungleA0", team="t1")
    )
    assert (own.scope, own.n, own.start_top, own.start_bot) == ("team", 3, 1.0, 0.0)
    league = s.JungleBridge.model_validate(
        ok(client, "/api/draft/bridge", champion="JungleA0", team="t2")
    )
    assert (league.scope, league.n) == ("league", 3)
    assert (
        s.JungleBridge.model_validate(ok(client, "/api/draft/bridge", champion="JungleA0")).scope
        == "league"
    )
    assert client.get("/api/draft/bridge", params={"champion": "Nobody"}).status_code == 404


def test_tendencies_flag_the_repeated_ban_with_its_sample_size(client: AsgiClient) -> None:
    report = s.TeamDraftTendencies.model_validate(ok(client, "/api/teams/t1/draft-tendencies"))
    assert (report.team_games, report.scope, report.name) == (12, "all", "Alpha Team")
    poppy = report.bans[0]
    assert poppy.champion == "Poppy" and (poppy.count, poppy.team_games) == (12, 12)
    assert (
        poppy.strength == "strong" and poppy.direction == "above" and poppy.rate > poppy.league_rate
    )
    assert 0 < len(poppy.evidence_game_ids) <= 8
    assert report.notes and all(p.picks > 0 for p in report.fearless_shift)
    for scope in ("g1", "later"):
        part = s.TeamDraftTendencies.model_validate(
            ok(client, "/api/teams/t1/draft-tendencies", scope=scope)
        )
        assert part.team_games == 6 and part.scope == scope
    assert client.get("/api/teams/t1/draft-tendencies", params={"scope": "x"}).status_code == 422


# --- contract guards ---------------------------------------------------------------------------------------

RESPONSES: list[tuple[str, dict[str, str], type[BaseModel] | None]] = [
    ("/api/health", {}, s.Health),
    ("/api/teams", {}, None),
    ("/api/teams/t1/profile", {}, s.TeamProfile),
    ("/api/teams/t1/tells/tell_a/evidence", {}, None),
    ("/api/teams/t1/draft-tendencies", {}, s.TeamDraftTendencies),
    ("/api/games/g01/replay", {}, s.Replay),
    ("/api/draft/plan", {"team": "t1", "opponent": "t2"}, s.SeriesPlanResponse),
    ("/api/series/context", {"team": "t1", "opponent": "t2"}, s.SeriesContext),
    ("/api/draft/backtest", {}, s.DraftBacktest),
    ("/api/draft/bridge", {"champion": "JungleA0"}, s.JungleBridge),
]


@pytest.mark.parametrize(("url", "params", "model"), RESPONSES)
def test_no_response_contains_fields_outside_the_schemas(
    client: AsgiClient, url: str, params: dict[str, str], model: type[BaseModel] | None
) -> None:
    payload = ok(client, url, **params)
    if model is not None:
        assert model.model_validate(payload).model_dump(mode="json") == payload
    elif url.endswith("/teams"):
        assert [s.TeamSummary.model_validate(t).model_dump(mode="json") for t in payload] == payload  # type: ignore[union-attr]
    else:
        assert [
            s.EvidenceItem.model_validate(t).model_dump(mode="json") for t in payload
        ] == payload  # type: ignore[union-attr]


def test_openapi_lists_every_endpoint_of_the_contract(client: AsgiClient) -> None:
    contract = (REPO / "docs" / "api-contract.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"^\| `GET (/api/[^`?]+)", contract, flags=re.MULTILINE))
    served = set(client.get("/openapi.json").json()["paths"])
    assert documented, "the contract table could not be parsed"
    assert documented == served


# --- start-up ---------------------------------------------------------------------------------------------------


def test_the_server_refuses_to_start_without_a_cache(tmp_path: Path, settings: Settings) -> None:
    empty = Settings(data_dir=settings.data_dir, cache_dir=tmp_path / "nothing")
    with pytest.raises(CacheNotReadyError, match=r"macrodna etl"):
        create_app(empty)


def test_the_server_refuses_to_start_without_team_names(tmp_path: Path, settings: Settings) -> None:
    no_names = Settings(data_dir=tmp_path / "no-data", cache_dir=settings.cache_dir)
    with pytest.raises(CacheNotReadyError, match=r"teams\.csv"):
        create_app(no_names)
