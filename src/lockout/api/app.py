"""The Lockout HTTP API: a read-only view of the local cache.

The contract is ``docs/api-contract.md``; the response models are in ``schemas.py``. Every route declares
its ``response_model``, so nothing outside the schemas can leave the server (no raw feed content).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import JSONResponse

from lockout.api import schemas as s
from lockout.api.queries import NotFoundError, Repository
from lockout.config import Settings, load_settings
from lockout.logos import load_logos

Name = Annotated[str, Query(min_length=1, description="A team id, or part of a team name")]


def _champions(csv_value: str) -> set[str]:
    return {c.strip() for c in csv_value.split(",") if c.strip()}


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Raises ``CacheNotReadyError`` when the cache or the team names are missing."""
    repo = Repository(settings or load_settings())
    app = FastAPI(
        title="Lockout API",
        version="0.1.0",
        description="Read-only API over the Lockout cache: scouting profiles, replays and Fearless "
        "draft planning. Every rate comes with its sample size.",
    )

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    api = APIRouter(prefix="/api")

    @api.get("/health", response_model=s.Health, summary="Liveness and corpus size")
    def health() -> s.Health:
        return repo.health()

    @api.get("/teams", response_model=list[s.TeamSummary], summary="Teams with their game counts")
    def teams(
        q: Annotated[str, Query(description="Case-insensitive name filter")] = "",
        event: Annotated[str | None, Query(description="Exact event name")] = None,
    ) -> list[s.TeamSummary]:
        return repo.teams(q, event)

    @api.get(
        "/logos",
        response_model=s.TeamLogos,
        summary="Team logo URLs from Leaguepedia (empty until `lockout logos` has run)",
    )
    def logos() -> s.TeamLogos:
        return s.TeamLogos(logos=load_logos(repo.settings.cache_dir), source="Leaguepedia")

    @api.get(
        "/teams/{team_id}/profile",
        response_model=s.TeamProfile,
        summary="Jungle, objective set-up and tells of a team (404 below 6 games)",
    )
    def team_profile(
        team_id: str,
        event: Annotated[str | None, Query(description="Restrict to one split/league")] = None,
    ) -> s.TeamProfile:
        return repo.team_profile(team_id, event)

    @api.get(
        "/teams/{team_id}/tells/{template_id}/evidence",
        response_model=list[s.EvidenceItem],
        summary="Every occurrence behind a tell, newest first",
    )
    def tell_evidence(team_id: str, template_id: str) -> list[s.EvidenceItem]:
        return repo.tell_evidence(team_id, template_id)

    @api.get(
        "/teams/{team_id}/draft-tendencies",
        response_model=s.TeamDraftTendencies,
        summary="Pick/ban tendencies versus the league and the Fearless shift (404 below 6 games)",
    )
    def draft_tendencies(
        team_id: str,
        scope: Annotated[
            Literal["all", "g1", "later"], Query(description="All games, first games, games 2+")
        ] = "all",
    ) -> s.TeamDraftTendencies:
        return repo.draft_tendencies(team_id, scope)

    @api.get(
        "/games/{game_id}/replay",
        response_model=s.Replay,
        summary="One position per second per player, plus the key events",
    )
    def replay(game_id: str) -> s.Replay:
        return repo.replay(game_id)

    @api.get(
        "/draft/plan",
        response_model=s.SeriesPlanResponse,
        summary="Pool state, ban targets and series forecast for both teams",
    )
    def plan(
        team: Name,
        opponent: Name,
        locked: Annotated[str, Query(description="Comma-separated champions locked earlier")] = "",
        banned: Annotated[str, Query(description="Comma-separated champions banned now")] = "",
    ) -> s.SeriesPlanResponse:
        return repo.plan(team, opponent, _champions(locked), _champions(banned))

    @api.get(
        "/series/context",
        response_model=s.SeriesContext,
        summary="Everything the draft room needs for one matchup",
    )
    def series_context(team: Name, opponent: Name) -> s.SeriesContext:
        return repo.series_context(team, opponent)

    @api.get(
        "/champions",
        response_model=list[s.ChampionStats],
        summary="League pick/ban/win rates and roles per champion over 90 days",
    )
    def champions(
        before: Annotated[
            str | None, Query(description="ISO time; the window ends here (default: newest game)")
        ] = None,
    ) -> list[s.ChampionStats]:
        return repo.champions(before)

    @api.get(
        "/series",
        response_model=list[s.SeriesSummary],
        summary="Finished real series, newest first; filter by a team and/or its opponent",
    )
    def series_list(
        team: Annotated[str | None, Query(description="A team id or part of a name")] = None,
        opponent: Annotated[str | None, Query(description="A team id or part of a name")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 30,
    ) -> list[s.SeriesSummary]:
        return repo.series_list(team, opponent, limit)

    @api.get(
        "/series/{series_id}/draft",
        response_model=s.SeriesDraft,
        summary="Every draft of a real series plus the draft-room context as it was before game 1",
    )
    def series_draft(
        series_id: str,
        ours: Annotated[str | None, Query(description="Team to treat as 'us'")] = None,
    ) -> s.SeriesDraft:
        return repo.series_draft(series_id, ours)

    @api.get(
        "/draft/win-model",
        response_model=s.WinModel,
        summary="Logistic win-probability model of the draft state, trained on games before `before`",
    )
    def win_model(
        team: Name,
        opponent: Name,
        before: Annotated[
            str | None, Query(description="ISO time; train only on earlier games")
        ] = None,
    ) -> s.WinModel:
        return repo.win_model(team, opponent, before)

    @api.get(
        "/draft/backtest",
        response_model=s.DraftBacktest,
        summary="How far the pool-stress idea can be trusted (read from the cache)",
    )
    def backtest() -> s.DraftBacktest:
        return repo.backtest()

    @api.get(
        "/draft/bridge",
        response_model=s.JungleBridge,
        summary="How a jungle champion opens, from the macro detectors",
    )
    def bridge(
        champion: Annotated[str, Query(min_length=1)],
        team: Annotated[str | None, Query(description="Prefer this team's own numbers")] = None,
    ) -> s.JungleBridge:
        return repo.bridge(champion, team)

    app.include_router(api)
    return app
