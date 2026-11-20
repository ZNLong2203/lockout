# Task for Junie / Air / an IDE agent: implement the read-only API

> **Status: done** (2026-11-20). Implemented with Claude Code running inside PyCharm from this brief:
> `src/lockout/api/{app,queries}.py`, `lockout serve`, `tests/test_api.py` (28 tests on a synthetic cache).
> Deviations from the brief, and why: tests call the app through a small stdlib ASGI client
> (`tests/asgi_client.py`) instead of `TestClient`, because Starlette 1.10's `TestClient` needs the extra package
> `httpx2` and the brief says to add no dependencies; the contract gained `/api/teams/{id}/draft-tendencies`.

Paste this into Junie (in PyCharm) as the task.

---

Implement the FastAPI back end described in `docs/api-contract.md`, using the response models in
`src/lockout/api/schemas.py`. Follow `.junie/guidelines.md` and `AGENTS.md`.

**Do**

1. Create `src/lockout/api/app.py` (FastAPI app factory `create_app(settings)`), `src/lockout/api/queries.py`
   (DuckDB queries over the Parquet cache, returning the schema models) and a `lockout serve` command in
   `src/lockout/cli.py` that runs it with uvicorn on `127.0.0.1:8000`.
2. Implement all endpoints in the contract, including the 404 rule for teams with fewer than 6 games and
   the optional `event` filter on the profile. The `/api/draft/*` and `/api/series/context` endpoints wrap code that already exists:
   `lockout.draft.planner.plan_series` / `jungle_bridge` and `draft_backtest.json`. Map their results to the
   models in `schemas.py` (`SeriesPlanResponse`, `DraftBacktest`, `JungleBridge`, `SeriesContext`); `SeriesContext` is what the web app's draft room loads first; do not re-implement the maths.
3. Team and champion names come from `meta/teams.csv` and `meta/rosters.csv` under `STL_DATA_DIR`; if
   `rosters.csv` has no champion for a player, return `null`.
4. Write tests in `tests/test_api.py` against a **tiny synthetic cache** that a fixture builds in a temp folder
   (a few games, two teams, a handful of rows per table). Use FastAPI's `TestClient`. Cover: each endpoint's
   happy path, the 404 rule, the `event` filter, and that no response contains fields outside the schemas.
5. Run `uv run pytest` and `uv run ruff check src tests` until both pass.

**Do not**

- Read or open real data or anything under `private/`.
- Recompute tell statistics in the API (read them from `tells.parquet`).
- Add dependencies beyond what `pyproject.toml` already lists, unless essential (explain why).

**Done when** the tests pass, `uv run lockout serve` starts, and `/openapi.json` lists every endpoint in the contract.
