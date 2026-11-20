# API contract

Read-only HTTP API over the local cache. Models live in
[`src/macrodna/api/schemas.py`](../src/macrodna/api/schemas.py) and are the source of truth.
Base path `/api`. Errors use standard HTTP codes with a JSON `{"detail": "..."}` body.

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/health` | `{"status": "ok", "games": int}` | `games` is read from the cache |
| `GET /api/teams?q=&event=` | `TeamSummary[]` | `q` is a case-insensitive name filter, `event` an exact event name |
| `GET /api/teams/{team_id}/profile?event=` | `TeamProfile` | `event` restricts every aggregate to one split/league |
| `GET /api/teams/{team_id}/tells/{template_id}/evidence` | `EvidenceItem[]` | One item per occurrence, newest first |
| `GET /api/games/{game_id}/replay` | `Replay` | One position per second per player |
| `GET /api/draft/plan?team=&opponent=&locked=&banned=` | `SeriesPlanResponse` | `locked` and `banned` are comma-separated champion names; the logic is `macrodna.draft.planner.plan_series` |
| `GET /api/draft/backtest` | `DraftBacktest` | Read `draft_backtest.json` from the cache; do not recompute |
| `GET /api/draft/bridge?champion=&team=` | `JungleBridge` | `scope` is `team` when that team has the champion, else `league`; 404 if never played |

## Rules the implementation must follow

1. **Never return raw feed content** (event payloads, series state). Only the fields in `schemas.py`.
2. **Always return `n`** with every rate. Never round a rate without its sample size.
3. A `TeamProfile` for a team with fewer than 6 games returns `404` with a clear message, not empty numbers.
4. Tell `strength` comes straight from the cache (`tells.parquet`); do not recompute statistics in the API.
5. League baselines come from the cache; objectives' `league_mean_players_m30` is the mean over all teams.
6. The API reads the cache from `MACRODNA_CACHE_DIR` (default `private/cache/lol`) and team/champion names from
   `STL_DATA_DIR/meta`. It must start with a clear error if either is missing.

## Cache tables (Parquet, under `private/cache/lol/`)

`games`, `players`, `roles`, `events`, `draft`, `draft_enriched`, `jungle`, `objectives`, `tells`,
`tell_evidence`, `tracks/*.parquet`, and `draft_backtest.json`. Column lists are in `src/macrodna/etl/build.py`, `detectors/jungle.py`,
`detectors/objectives.py` and `detectors/tells.py`.
